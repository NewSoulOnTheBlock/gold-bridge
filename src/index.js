// $GOLD bridge: DayZ server -> this service -> Robinhood Chain ERC-20.
// Accrue-and-claim: /reward credits an off-chain ledger; tokens move only on /claim.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifySecret, ipAllowlist, rateLimit } from "./middleware.js";
import {
  initSchema, accrueReward, saveLinkCode, getLinkCode, consumeLinkCode,
  getWalletByAddress, getLedger, saveClaimChallenge, getClaimChallenge, beginClaim, finishClaim,
} from "./db.js";
import {
  TOKEN, RH_CHAIN, DECIMALS, loadDecimals, toBaseUnits, transferTokens, treasuryBalances,
  treasuryAddress, CLAIMS_ENABLED, isAddress, getAddress, verifyMessage,
} from "./chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 500);
const STEAMID_RE = /^\d{17}$/;
const REWARD_RULES = {
  pvp_kill:      { max: 100 },
  playtime_tick: { max: 50 },
  infected_kill: { max: 10 },
};

const linkMessage = (rec) =>
  `Link my DayZ account to $GOLD.\nsteamId: ${rec.steam_id}\ncode: ${rec.code}\nnonce: ${rec.nonce}`;
const claimMessage = (address, nonce) =>
  `Claim my $GOLD rewards.\naddress: ${getAddress(address)}\nnonce: ${nonce}`;

// ---------------- Status ----------------
app.get("/", async (_req, res) => {
  res.json({
    service: "gold-bridge",
    chainId: RH_CHAIN.id,
    token: TOKEN,
    decimals: DECIMALS,
    claimsEnabled: CLAIMS_ENABLED,
    treasury: treasuryAddress,
  });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---------------- Reward accrual (called by the DayZ mod) ----------------
app.post("/reward", verifySecret, ipAllowlist, rateLimit, async (req, res) => {
  try {
    const { steamId, eventType, amount, eventId } = req.body ?? {};
    if (!STEAMID_RE.test(String(steamId)))        return res.status(400).json({ error: "steamId" });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "amount" });
    if (typeof eventId !== "string" || !eventId)  return res.status(400).json({ error: "eventId" });
    const rule = REWARD_RULES[eventType];
    if (!rule || amount > rule.max)               return res.status(400).json({ error: "event/max" });

    const r = await accrueReward(eventId, String(steamId), eventType, amount, DAILY_CAP);
    if (r.status === "duplicate") return res.json({ status: "duplicate" });
    if (r.status === "cap")       return res.status(429).json({ status: "cap" });
    return res.json({ status: "accrued", amount });
  } catch (err) {
    console.error("[reward]", req.body?.eventId, err);
    return res.status(500).json({ error: "internal" });
  }
});

// ---------------- Wallet linking ----------------
// DayZ mod asks for a one-time code; we return it and the mod shows it to the player.
app.post("/link/request", verifySecret, ipAllowlist, rateLimit, async (req, res) => {
  try {
    const { steamId, playerName } = req.body ?? {};
    if (!STEAMID_RE.test(String(steamId))) return res.status(400).json({ error: "steamId" });

    const code = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 hex chars
    const nonce = crypto.randomBytes(16).toString("hex");
    const ttlSec = 900;
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    await saveLinkCode(code, String(steamId), String(playerName ?? ""), nonce, expiresAt);

    const url = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/link?code=${code}` : `/link?code=${code}`;
    return res.json({ code, url, expiresInSec: ttlSec });
  } catch (err) {
    console.error("[link/request]", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Web page reads the code -> gets the exact message to sign (and the steamId it will link).
app.get("/link/lookup", async (req, res) => {
  const rec = await getLinkCode(String(req.query.code ?? ""));
  if (!rec || rec.used || new Date(rec.expires_at) < new Date())
    return res.status(404).json({ error: "invalid or expired code" });
  return res.json({ steamId: rec.steam_id, playerName: rec.player_name, message: linkMessage(rec) });
});

// Web page submits the wallet signature; we verify it and store the mapping.
app.post("/link/verify", async (req, res) => {
  try {
    const { code, address, signature } = req.body ?? {};
    if (!code || !isAddress(String(address)) || !signature)
      return res.status(400).json({ error: "bad input" });

    const rec = await getLinkCode(String(code));
    if (!rec || rec.used || new Date(rec.expires_at) < new Date())
      return res.status(404).json({ error: "invalid or expired code" });

    const ok = await verifyMessage({ address: getAddress(address), message: linkMessage(rec), signature });
    if (!ok) return res.status(401).json({ error: "bad signature" });

    const stored = await consumeLinkCode(String(code), rec.steam_id, getAddress(address));
    if (!stored) return res.status(409).json({ error: "code already used" });
    return res.json({ status: "linked", steamId: rec.steam_id, address: getAddress(address) });
  } catch (err) {
    console.error("[link/verify]", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ---------------- Claiming (wallet owner triggers on-chain transfer) ----------------
app.get("/claim/challenge", async (req, res) => {
  const address = String(req.query.address ?? "");
  if (!isAddress(address)) return res.status(400).json({ error: "address" });
  const w = await getWalletByAddress(address);
  if (!w) return res.status(404).json({ error: "wallet not linked" });

  const nonce = crypto.randomBytes(16).toString("hex");
  await saveClaimChallenge(getAddress(address), nonce, new Date(Date.now() + 600_000));
  const led = await getLedger(w.steam_id);
  return res.json({ message: claimMessage(address, nonce), pending: String(led.pending) });
});

app.post("/claim", async (req, res) => {
  try {
    if (!CLAIMS_ENABLED) return res.status(503).json({ error: "claims disabled (no treasury key set)" });
    const { address, signature } = req.body ?? {};
    if (!isAddress(String(address)) || !signature) return res.status(400).json({ error: "bad input" });

    const w = await getWalletByAddress(String(address));
    if (!w) return res.status(404).json({ error: "wallet not linked" });

    const ch = await getClaimChallenge(String(address));
    if (!ch || new Date(ch.expires_at) < new Date()) return res.status(400).json({ error: "no valid challenge" });

    const ok = await verifyMessage({
      address: getAddress(address), message: claimMessage(address, ch.nonce), signature,
    });
    if (!ok) return res.status(401).json({ error: "bad signature" });

    const claim = await beginClaim(w.steam_id);
    if (claim === "0") return res.status(400).json({ error: "nothing to claim" });

    const amountWhole = claim.amount; // token count as string (whole tokens)
    let result;
    try {
      result = await transferTokens(getAddress(address), toBaseUnits(amountWhole));
    } catch (e) {
      await finishClaim(claim.claimId, w.steam_id, getAddress(address), amountWhole, false, null);
      console.error("[claim] transfer threw", e);
      return res.status(502).json({ error: "transfer failed", refunded: amountWhole });
    }
    await finishClaim(claim.claimId, w.steam_id, getAddress(address), amountWhole, result.ok, result.txHash);
    if (!result.ok) return res.status(502).json({ error: "reverted", txHash: result.txHash, refunded: amountWhole });
    return res.json({ status: "paid", amount: amountWhole, txHash: result.txHash });
  } catch (err) {
    console.error("[claim]", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ---------------- Boot ----------------
const PORT = process.env.PORT || 8787;
(async () => {
  await initSchema();
  try { await loadDecimals(); } catch (e) { console.warn("decimals() read failed, using default", DECIMALS); }
  try { console.log("treasury balances", await treasuryBalances()); } catch {}
  app.listen(PORT, () => console.log(`gold-bridge on :${PORT} chain=${RH_CHAIN.id} token=${TOKEN} claims=${CLAIMS_ENABLED}`));
})();

import { useState, useEffect } from "react";
import { usePrivy, useWallets, useSignMessage } from "@privy-io/react-auth";

const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

export default function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();

  const [code, setCode] = useState("");
  const [linkMsg, setLinkMsg] = useState(null);
  const [claimMsg, setClaimMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = new URLSearchParams(location.search).get("code");
    if (c) setCode(c.toUpperCase());
  }, []);

  const wallet = wallets && wallets[0];
  const address = wallet?.address;

  async function sign(message) {
    const { signature } = await signMessage({ message }, { address });
    return signature;
  }

  async function doLink() {
    setBusy(true);
    try {
      if (!code) throw new Error("Enter your in-game link code.");
      if (!address) throw new Error("Wallet still being created — try again in a moment.");
      setLinkMsg({ ok: true, text: "Looking up code…" });
      const look = await (await fetch("/link/lookup?code=" + encodeURIComponent(code))).json();
      if (look.error) throw new Error(look.error);
      const signature = await sign(look.message);
      const r = await (
        await fetch("/link/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, address, signature }),
        })
      ).json();
      if (r.error) throw new Error(r.error);
      setLinkMsg({ ok: true, text: "Linked! " + short(r.address) + " ↔ Steam " + r.steamId });
    } catch (e) {
      setLinkMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function doClaim() {
    setBusy(true);
    try {
      if (!address) throw new Error("Wallet still being created — try again in a moment.");
      setClaimMsg({ ok: true, text: "Fetching claim challenge…" });
      const ch = await (await fetch("/claim/challenge?address=" + address)).json();
      if (ch.error) throw new Error(ch.error);
      if (ch.pending === "0") {
        setClaimMsg({ ok: false, text: "Nothing to claim yet." });
        return;
      }
      const signature = await sign(ch.message);
      const r = await (
        await fetch("/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, signature }),
        })
      ).json();
      if (r.error) throw new Error(r.error);
      setClaimMsg({ ok: true, text: "Paid " + r.amount + " $GOLD — tx " + short(r.txHash) });
    } catch (e) {
      setClaimMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!ready)
    return (
      <div className="card">
        <h1>$GOLD</h1>
        <p className="sub">Loading…</p>
      </div>
    );

  return (
    <div className="card">
      <h1>
        Link your <span>$GOLD</span> wallet
      </h1>

      {!authenticated ? (
        <>
          <p className="sub">
            Log in with email or Google — we'll create a wallet for you automatically. No MetaMask needed.
          </p>
          <button onClick={login}>Log in to earn $GOLD</button>
        </>
      ) : (
        <>
          <p className="sub">
            Signed in{user?.email?.address ? " as " + user.email.address : ""} · Wallet:{" "}
            {address ? short(address) : "creating…"}
          </p>

          <label>Link code (from in-game)</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" />
          <button onClick={doLink} disabled={busy || !address}>
            Link wallet
          </button>
          {linkMsg && <div className={"status " + (linkMsg.ok ? "ok" : "err")}>{linkMsg.text}</div>}

          <hr />
          <h2>Claim rewards</h2>
          <p className="sub">Send your accrued $GOLD to your wallet.</p>
          <button onClick={doClaim} disabled={busy || !address}>
            Claim $GOLD
          </button>
          {claimMsg && <div className={"status " + (claimMsg.ok ? "ok" : "err")}>{claimMsg.text}</div>}

          <button className="link-btn" onClick={logout}>
            Log out
          </button>
        </>
      )}
    </div>
  );
}

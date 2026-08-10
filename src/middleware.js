// Auth + abuse protection for endpoints the DayZ server calls.
import crypto from "node:crypto";

const SHARED_SECRET = process.env.SHARED_SECRET ?? "";

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

// Constant-time secret check. Hash both sides to a fixed length first so timingSafeEqual never
// throws on length mismatch (which would itself leak length).
export function verifySecret(req, res, next) {
  const given = req.body?.secret ?? "";
  if (!SHARED_SECRET) return res.status(500).json({ error: "server misconfigured: no SHARED_SECRET" });
  const a = sha256(given);
  const b = sha256(SHARED_SECRET);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// Optional IP allowlist (CSV in DAYZ_IP_ALLOWLIST). If unset, rely on the shared secret only.
export function ipAllowlist(req, res, next) {
  const raw = process.env.DAYZ_IP_ALLOWLIST;
  if (!raw) return next();
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "";
  const norm = ip.replace(/^::ffff:/, "");
  if (allowed.includes(norm)) return next();
  return res.status(403).json({ error: "ip not allowed" });
}

// Simple in-memory token-bucket rate limiter, per key + global.
function makeLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { hits.set(key, { start: now, count: 1 }); return true; }
    rec.count++;
    return rec.count <= max;
  };
}

const perPlayer = makeLimiter({ windowMs: 60_000, max: 60 });
const global = makeLimiter({ windowMs: 60_000, max: 600 });

export function rateLimit(req, res, next) {
  const key = String(req.body?.steamId ?? req.socket.remoteAddress ?? "anon");
  if (!global("__global__") || !perPlayer(key)) return res.status(429).json({ error: "rate limited" });
  next();
}

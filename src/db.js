// Durable store (Postgres). Holds the idempotency ledger, per-player accrued balances,
// linked wallets, one-time link codes, and the atomic daily cap.
import pg from "pg";

const { Pool } = pg;

// Render Postgres requires SSL. Local dev without DATABASE_URL will throw on first query (intended).
// All tables live in a dedicated `goldbridge` schema so this service can safely share a Postgres
// instance with other projects without any table-name collisions.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false,
  options: "-c search_path=goldbridge,public",
});

export async function initSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS goldbridge;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      event_id    TEXT PRIMARY KEY,
      steam_id    TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      amount      BIGINT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'accrued',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      steam_id       TEXT PRIMARY KEY,
      pending        BIGINT NOT NULL DEFAULT 0,
      claimed_total  BIGINT NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      steam_id   TEXT PRIMARY KEY,
      address    TEXT NOT NULL,
      linked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS link_codes (
      code        TEXT PRIMARY KEY,
      steam_id    TEXT NOT NULL,
      player_name TEXT,
      nonce       TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS daily_credited (
      steam_id  TEXT NOT NULL,
      day       DATE NOT NULL,
      amount    BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (steam_id, day)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id          BIGSERIAL PRIMARY KEY,
      steam_id    TEXT NOT NULL,
      address     TEXT NOT NULL,
      amount      BIGINT NOT NULL,
      status      TEXT NOT NULL,
      tx_hash     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS claim_challenges (
      address     TEXT PRIMARY KEY,
      nonce       TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL
    );
  `);
}

// Accrue a reward atomically: reserve eventId (idempotency), enforce daily cap, credit the ledger.
// Returns { status: 'accrued' | 'duplicate' | 'cap' }.
export async function accrueReward(eventId, steamId, eventType, amount, dailyCap) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency: unique event_id. Conflict = already processed -> pay nothing.
    const ins = await client.query(
      `INSERT INTO events (event_id, steam_id, event_type, amount)
       VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, steamId, eventType, amount]
    );
    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "duplicate" };
    }

    // Daily cap, atomic within this transaction.
    const cap = await client.query(
      `INSERT INTO daily_credited (steam_id, day, amount)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (steam_id, day) DO UPDATE SET amount = daily_credited.amount + EXCLUDED.amount
       RETURNING amount`,
      [steamId, amount]
    );
    if (Number(cap.rows[0].amount) > dailyCap) {
      await client.query("ROLLBACK");
      return { status: "cap" };
    }

    // Credit the pending balance.
    await client.query(
      `INSERT INTO ledger (steam_id, pending) VALUES ($1,$2)
       ON CONFLICT (steam_id) DO UPDATE SET pending = ledger.pending + EXCLUDED.pending, updated_at = now()`,
      [steamId, amount]
    );

    await client.query("COMMIT");
    return { status: "accrued" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function saveLinkCode(code, steamId, playerName, nonce, expiresAt) {
  await pool.query(
    `INSERT INTO link_codes (code, steam_id, player_name, nonce, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [code, steamId, playerName, nonce, expiresAt]
  );
}

export async function getLinkCode(code) {
  const r = await pool.query(`SELECT * FROM link_codes WHERE code = $1`, [code]);
  return r.rows[0] || null;
}

export async function consumeLinkCode(code, steamId, address) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE link_codes SET used = true WHERE code = $1 AND used = false AND expires_at > now()`,
      [code]
    );
    if (upd.rowCount === 0) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `INSERT INTO wallets (steam_id, address) VALUES ($1,$2)
       ON CONFLICT (steam_id) DO UPDATE SET address = EXCLUDED.address, linked_at = now()`,
      [steamId, address]
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getWalletByAddress(address) {
  const r = await pool.query(`SELECT * FROM wallets WHERE lower(address) = lower($1)`, [address]);
  return r.rows[0] || null;
}

export async function getLedger(steamId) {
  const r = await pool.query(`SELECT * FROM ledger WHERE steam_id = $1`, [steamId]);
  return r.rows[0] || { steam_id: steamId, pending: 0, claimed_total: 0 };
}

export async function saveClaimChallenge(address, nonce, expiresAt) {
  await pool.query(
    `INSERT INTO claim_challenges (address, nonce, expires_at) VALUES ($1,$2,$3)
     ON CONFLICT (address) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
    [address, nonce, expiresAt]
  );
}

export async function getClaimChallenge(address) {
  const r = await pool.query(`SELECT * FROM claim_challenges WHERE lower(address) = lower($1)`, [address]);
  return r.rows[0] || null;
}

// Atomically move the whole pending balance to "claiming". Returns the amount to send (as string) or 0.
export async function beginClaim(steamId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const led = await client.query(`SELECT pending FROM ledger WHERE steam_id = $1 FOR UPDATE`, [steamId]);
    const pending = led.rows[0] ? BigInt(led.rows[0].pending) : 0n;
    if (pending <= 0n) { await client.query("ROLLBACK"); return "0"; }
    await client.query(`UPDATE ledger SET pending = 0, updated_at = now() WHERE steam_id = $1`, [steamId]);
    const claim = await client.query(
      `INSERT INTO claims (steam_id, address, amount, status) VALUES ($1,'',$2,'sending') RETURNING id`,
      [steamId, pending.toString()]
    );
    await client.query("COMMIT");
    return { amount: pending.toString(), claimId: claim.rows[0].id };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// On success: record tx + bump claimed_total. On failure: refund pending.
export async function finishClaim(claimId, steamId, address, amount, ok, txHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ok) {
      await client.query(
        `UPDATE claims SET status='paid', tx_hash=$1, address=$2 WHERE id=$3`, [txHash, address, claimId]);
      await client.query(
        `UPDATE ledger SET claimed_total = claimed_total + $1, updated_at=now() WHERE steam_id=$2`,
        [amount, steamId]);
    } else {
      await client.query(
        `UPDATE claims SET status='failed', tx_hash=$1, address=$2 WHERE id=$3`, [txHash || null, address, claimId]);
      await client.query(
        `UPDATE ledger SET pending = pending + $1, updated_at=now() WHERE steam_id=$2`, [amount, steamId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

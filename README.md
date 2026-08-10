# gold-bridge

Bridge between the DayZ "Robinhood" server and the **$GOLD** ERC-20 on **Robinhood Chain** (EVM L2,
chain id `4663`, token `0xC99C8D7C4fA25a7459F78b9Fbb4c66deeD18E9bF`, 18 decimals).

**The DayZ server never holds a key.** It POSTs events here; this service holds the treasury key and
does the on-chain transfer. Model is **accrue-and-claim**: `/reward` credits an off-chain ledger,
tokens move only when a player `/claim`s.

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/` | — | status (chain, token, decimals, claimsEnabled, treasury) |
| GET  | `/healthz` | — | health check |
| POST | `/reward` | shared secret | accrue a reward (idempotent on `eventId`, daily-capped) |
| POST | `/link/request` | shared secret | mint a one-time wallet-link code for a player |
| GET  | `/link` | — | wallet linking + claim web page |
| GET  | `/link/lookup?code=` | code | returns the exact message to sign |
| POST | `/link/verify` | signature | verify wallet signature, store steamId↔address |
| GET  | `/claim/challenge?address=` | linked wallet | issue a claim nonce + show pending balance |
| POST | `/claim` | signature | verify + transfer pending $GOLD to the wallet |

`/reward` body: `{secret, steamId, playerName, eventType, amount, eventId}` where `eventType` ∈
`pvp_kill | playtime_tick | infected_kill`. `eventId` is the idempotency key.

## Env vars
See `.env.example`. Secrets (`SHARED_SECRET`, `TREASURY_PRIVATE_KEY`) are set on Render, never committed.
Without `TREASURY_PRIVATE_KEY` the service runs **accrue-only** (rewards recorded; `/claim` → 503).

## Deploy (Render)
`render.yaml` is a Blueprint that provisions a free web service + free Postgres. Set `SHARED_SECRET`
(must match the DayZ `config.json`), `PUBLIC_BASE_URL`, and — when ready to pay out — `TREASURY_PRIVATE_KEY`.

## Local dev
```
npm install
cp .env.example .env   # fill DATABASE_URL etc.
npm start
```

## Security notes
- Treasury key lives ONLY here (Render secret). The DayZ box never sees it.
- Idempotency + daily cap are enforced atomically in Postgres.
- On-chain sends are serialized (one treasury nonce in flight) to avoid nonce collisions.
- Consider testing on Robinhood **testnet** (chain 46630) with a throwaway token before funding the mainnet treasury.

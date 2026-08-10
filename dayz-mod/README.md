# @GoldReward — DayZ side of the $GOLD reward economy

Token (Robinhood Chain, id 4663): `0xC99C8D7C4fA25a7459F78b9Fbb4c66deeD18E9bF`
Bridge: `https://gold-bridge-jdue.onrender.com`
**The DayZ server never touches the blockchain and never holds a key.** It only POSTs events to the
bridge; the bridge holds the treasury key and does the on-chain transfer.

## How it's loaded

A **packed server-only mod** (`-servermod=@GoldReward` in `Robinhood.Bat`). Server-only means it is
never sent to clients and needs no `.bikey`. The PBO uses a raw (un-binarized) `config.cpp`, so it is
built by a tiny bundled packer — **no DayZ Tools required**.

```
@GoldReward/
  addons/GoldReward.pbo        <- the built mod (loaded by the server)
  pack.mjs                     <- rebuilds the PBO from _src (node pack.mjs)
  _src/GoldReward/             <- EDITABLE SOURCE
    config.cpp                 (CfgPatches + CfgMods: world + mission script modules)
    scripts/4_World/GoldRewardConfig.c    (config load/save)
                   GoldRewardApi.c        (RestApi bodies + callbacks)
                   GoldRewardManager.c    (RestApi client, playtime timer, wallet-link, daily cap)
                   PlayerBase_GoldReward.c(PvP kill hook via EEHitBy fatal-hit detection)
    scripts/5_Mission/MissionServer_GoldReward.c (boots manager, forwards player connect)
```

### Editing + rebuilding
1. Edit files in `_src/GoldReward/`.
2. From the `@GoldReward` folder: `node pack.mjs`
3. Restart the server (`Robinhood.Bat`).

Config values live at `<profiles>/GoldReward/config.json` (auto-created on first boot).

## Live features
- **PvP kill rewards** — killer awarded on a fatal hit (`PlayerBase.EEHitBy`, one-shot guarded).
- **Playtime rewards** — every `PlaytimeIntervalMinutes`, POSTs `/reward` per alive player.
- **Wallet-link prompt on connect** — POSTs `/link/request`, shows the player a code + link URL in-game.

> Note on kills: reward fires on a fatal *hit*. A victim who bleeds out later from a PvP wound (no final
> hit) isn't counted — acceptable for v1. `EEKilled` is not overridable on PlayerBase in DayZ 1.29,
> which is why detection lives in `EEHitBy`.

## Bridge API contract (implemented by gold-bridge)

`POST` JSON over HTTPS; every body from the DayZ side includes the shared `secret`.

### `POST /reward`
```json
{ "secret":"...", "steamId":"7656119...", "playerName":"Bob",
  "eventType":"pvp_kill|playtime_tick|infected_kill", "amount":5,
  "eventId":"pvp_kill:7656119...:12345:7" }
```
`eventId` = idempotency key. Reply: `{ "status":"accrued|duplicate|cap" }`.

### `POST /link/request`
```json
{ "secret":"...", "steamId":"7656119...", "playerName":"Bob" }
```
Reply: `{ "code":"AB12CD34", "url":"https://.../link?code=...", "expiresInSec":900 }`.

## Config reference (`<profiles>/GoldReward/config.json`)

| Key | Default | Meaning |
|---|---|---|
| `BridgeUrl` | live bridge URL | Bridge base URL, **no trailing slash** |
| `SharedSecret` | (set) | Must match the bridge `SHARED_SECRET` |
| `EnablePvpKill` / `PvpKillReward` | `1` / `5` | PvP kill reward |
| `EnablePlaytime` / `PlaytimeIntervalMinutes` / `PlaytimeReward` | `1` / `15` / `1` | Playtime tick reward |
| `EnableInfectedKill` / `InfectedKillReward` | `0` / `0` | Zombie-kill reward (hook not wired yet) |
| `DailyCapPerPlayer` | `500` | Courtesy client-side cap; the bridge cap is authoritative |
| `ShowLinkPromptOnConnect` | `1` | Ask the bridge for a link code when a player joins |

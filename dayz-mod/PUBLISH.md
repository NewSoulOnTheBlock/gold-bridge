# Publishing @GoldReward to the Steam Workshop

Division of labor:
- **You (Steam GUI / account):** install DayZ Tools, run it once, and do the final upload in DayZ Publisher.
- **Me (command line):** build + binarize + sign the PBO with AddonBuilder once DayZ Tools is installed.

## Folder layout
```
@GoldReward/
  _src/GoldReward/                 <- SOURCE (config.cpp + $PBOPREFIX$ + scripts)   [do not publish]
  _keys/GoldReward.biprivatekey    <- PRIVATE signing key   [NEVER publish / never commit]
        GoldReward.bikey           <- public key
  build/                           <- THE PUBLISHABLE MOD FOLDER (point DayZ Publisher here)
    mod.cpp                        <- mod metadata
    addons/GoldReward.pbo          <- binarized, signed  (built by me)
    addons/GoldReward.pbo.GoldReward.bisign
    keys/GoldReward.bikey          <- public key shipped with the mod
```

## Step 1 — Install DayZ Tools (YOU)
Steam is already showing the install dialog (AppID 830660). Confirm and let it download (~a few GB).
Then **launch DayZ Tools once** from Steam and accept the EULA. If it offers "Prepare Drive" (the P:
work drive), you can do it, but it is **not required** for this script-only mod.
When it's installed, tell me and I'll build + sign.

## Step 2 — Build + sign (ME, via AddonBuilder CLI)
I will run (paths auto-detected):
```
DSCreateKey.exe GoldReward                              (creates the keypair once)
AddonBuilder.exe _src\GoldReward  build\addons\GoldReward.pbo  -clear -sign=_keys\GoldReward.biprivatekey
```
Result: binarized `config.bin` inside the PBO, a `.bisign` next to it, and the `.bikey` copied to `build\keys\`.

## Step 3 — Upload with DayZ Publisher (YOU)
1. Launch **DayZ Tools** from Steam → open **DayZ Publisher**.
2. **New** (Create new mod) → set the mod directory to:
   `C:\Program Files (x86)\Steam\steamapps\common\DayZServer\@GoldReward\build`
3. Fill in:
   - **Title:** GoldReward — $GOLD Reward Economy
   - **Description:** (server-side reward mod; playtime + PvP kills; wallet linking; Robinhood Chain $GOLD)
   - **Preview image:** a 512×512 (or larger) PNG/JPG. (Optional but recommended — tell me if you want me to generate one.)
   - **Tags:** pick relevant (e.g. Server-side, Gameplay).
4. First time only: **accept the Steam Workshop Legal Agreement** (a checkbox / prompt).
5. Click **Publish**. You'll get a **Workshop item ID + URL**.

## Step 4 — Using it from Workshop (optional)
Your server already runs the mod locally via `-servermod=@GoldReward`, so publishing is for distribution.
To instead load the Workshop copy: subscribe/download it and point `-servermod` at that folder.
Keep it in `-servermod` (server-only) so players don't have to download it.

## Security
- `_keys\GoldReward.biprivatekey` signs your mod — keep it private. Only `GoldReward.bikey` (public) ships.
- No secrets are in the mod code. The bridge URL default is a placeholder and the real `SharedSecret`
  lives only in the server's `profiles\GoldReward\config.json`, which is NOT part of the mod.

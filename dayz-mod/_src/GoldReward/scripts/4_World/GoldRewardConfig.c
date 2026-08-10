// Config for the $GOLD reward bridge. Loaded from / written to the server -profiles folder.
// Path: <profiles>/GoldReward/config.json
// The DayZ side is intentionally "dumb": it only knows the bridge URL + shared secret and
// the reward amounts. The bridge enforces the real caps, idempotency and on-chain transfer.
class GoldRewardConfig
{
	// --- Bridge connection ---
	string  BridgeUrl        = "https://your-bridge.onrender.com"; // NO trailing slash
	string  SharedSecret     = "CHANGE_ME";                        // must match the bridge's secret

	// --- PvP kills ---
	int     EnablePvpKill    = 1;
	int     PvpKillReward    = 5;

	// --- Playtime ---
	int     EnablePlaytime         = 1;
	int     PlaytimeIntervalMinutes = 15;
	int     PlaytimeReward         = 1;

	// --- Infected (zombie) kills (off by default; spammy) ---
	int     EnableInfectedKill = 0;
	int     InfectedKillReward = 0;

	// --- Courtesy client-side daily cap (bridge is authoritative) ---
	int     DailyCapPerPlayer = 500;

	// --- Wallet linking ---
	int     ShowLinkPromptOnConnect = 1;

	static const string CONFIG_DIR  = "$profile:GoldReward";
	static const string CONFIG_PATH = "$profile:GoldReward/config.json";

	// Load config, creating a default file on first run.
	static ref GoldRewardConfig Load()
	{
		GoldRewardConfig cfg = new GoldRewardConfig();

		if (!FileExist(CONFIG_DIR))
			MakeDirectory(CONFIG_DIR);

		if (FileExist(CONFIG_PATH))
		{
			JsonFileLoader<GoldRewardConfig>.JsonLoadFile(CONFIG_PATH, cfg);
			Print("[GoldReward] Config loaded from " + CONFIG_PATH);
		}
		else
		{
			JsonFileLoader<GoldRewardConfig>.JsonSaveFile(CONFIG_PATH, cfg);
			Print("[GoldReward] Default config written to " + CONFIG_PATH + " -- edit BridgeUrl + SharedSecret!");
		}

		return cfg;
	}
}

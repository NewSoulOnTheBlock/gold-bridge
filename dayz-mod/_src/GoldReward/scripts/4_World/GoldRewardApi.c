// HTTP client wrapper around DayZ's native RestApi. All calls are outbound POSTs to the bridge.
// This file knows nothing about the blockchain -- only the bridge URL + endpoints.

// ---- JSON request bodies (serialized with JsonSerializer, never string concatenation) ----
class GoldRewardRequest
{
	string secret;
	string steamId;
	string playerName;
	string eventType;   // "pvp_kill" | "playtime_tick" | "infected_kill"
	int    amount;
	string eventId;     // unique + STABLE per event -> bridge idempotency key
}

class GoldLinkRequest
{
	string secret;
	string steamId;
	string playerName;
}

// Bridge reply to /link/request, parsed to build a clean in-game message.
class GoldLinkResponse
{
	string code;
	string url;
	int    expiresInSec;
}

// ---- Callbacks. Enforce GC can collect these mid-flight, so the manager retains them. ----
class GoldRewardCallback extends RestCallback
{
	string m_EventId;
	ref GoldRewardManager m_Mgr;

	void GoldRewardCallback(string eventId, GoldRewardManager mgr) { m_EventId = eventId; m_Mgr = mgr; }

	override void OnSuccess(string data, int dataSize)
	{
		Print("[GoldReward] reward " + m_EventId + " -> " + data);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
	override void OnError(int errorCode)
	{
		// Transient. Safe to retry with the SAME eventId (bridge is idempotent) -- left to a future pass.
		Print("[GoldReward] reward ERROR " + errorCode + " for " + m_EventId);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
	override void OnTimeout()
	{
		Print("[GoldReward] reward TIMEOUT for " + m_EventId);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
}

class GoldLinkCallback extends RestCallback
{
	string m_SteamId;
	ref GoldRewardManager m_Mgr;

	void GoldLinkCallback(string steamId, GoldRewardManager mgr) { m_SteamId = steamId; m_Mgr = mgr; }

	override void OnSuccess(string data, int dataSize)
	{
		// Bridge replies with a short-lived link code; the manager relays it to the player in-game.
		Print("[GoldReward] link code for " + m_SteamId + " -> " + data);
		if (m_Mgr) m_Mgr.OnLinkCodeReceived(m_SteamId, data);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
	override void OnError(int errorCode)
	{
		Print("[GoldReward] link ERROR " + errorCode + " for " + m_SteamId);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
	override void OnTimeout()
	{
		Print("[GoldReward] link TIMEOUT for " + m_SteamId);
		if (m_Mgr) m_Mgr.ReleasePending(this);
	}
}

// Central server-side manager for the $GOLD reward economy.
// Singleton created by MissionServer.OnInit(). Holds config, the RestApi context, the playtime
// timer, retained in-flight callbacks, and a courtesy per-player daily cap.
class GoldRewardManager
{
	ref GoldRewardConfig            m_Config;
	RestContext                     m_Ctx;
	ref array<ref RestCallback>     m_Pending;   // keep callbacks alive across async round-trips
	ref map<string, int>            m_DailyPaid; // steamId -> tokens credited this window (courtesy)
	float                           m_CapWindowStartMs;
	int                             m_EventCounter;

	void GoldRewardManager()
	{
		m_Pending   = new array<ref RestCallback>();
		m_DailyPaid = new map<string, int>();
	}

	void Init()
	{
		m_Config = GoldRewardConfig.Load();

		if (!GetRestApi())
			CreateRestApi();

		m_CapWindowStartMs = GetGame().GetTime();

		if (m_Config.EnablePlaytime && m_Config.PlaytimeIntervalMinutes > 0)
		{
			int ms = m_Config.PlaytimeIntervalMinutes * 60 * 1000;
			GetGame().GetCallQueue(CALL_CATEGORY_GAMEPLAY).CallLater(this.PlaytimeTick, ms, true);
		}

		Print("[GoldReward] Manager initialised. Bridge=" + m_Config.BridgeUrl + " pvp=" + m_Config.EnablePvpKill + " playtime=" + m_Config.EnablePlaytime);
	}

	RestContext GetContext()
	{
		if (!m_Ctx)
		{
			RestApi api = GetRestApi();
			if (!api) return null;
			m_Ctx = api.GetRestContext(m_Config.BridgeUrl);
			m_Ctx.SetHeader("Content-Type: application/json");
		}
		return m_Ctx;
	}

	string NextEventId(string eventType, string steamId)
	{
		m_EventCounter++;
		return eventType + ":" + steamId + ":" + GetGame().GetTime().ToString() + ":" + m_EventCounter.ToString();
	}

	// -------- Daily cap (courtesy only; the bridge enforces the real cap) --------
	void RollCapWindow()
	{
		if (GetGame().GetTime() - m_CapWindowStartMs >= 86400000) // 24h of uptime
		{
			m_DailyPaid.Clear();
			m_CapWindowStartMs = GetGame().GetTime();
		}
	}

	bool WithinDailyCap(string steamId, int amount)
	{
		RollCapWindow();
		int already = 0;
		if (m_DailyPaid.Contains(steamId)) already = m_DailyPaid.Get(steamId);
		if (already + amount > m_Config.DailyCapPerPlayer) return false;
		m_DailyPaid.Set(steamId, already + amount);
		return true;
	}

	// -------- Core reward dispatch --------
	void SendReward(string steamId, string playerName, string eventType, int amount)
	{
		if (amount <= 0 || steamId == "") return;
		if (!WithinDailyCap(steamId, amount)) { Print("[GoldReward] daily cap hit for " + steamId); return; }

		RestContext ctx = GetContext();
		if (!ctx) { Print("[GoldReward] no RestApi context; reward dropped"); return; }

		GoldRewardRequest r = new GoldRewardRequest();
		r.secret     = m_Config.SharedSecret;
		r.steamId    = steamId;
		r.playerName = playerName;
		r.eventType  = eventType;
		r.amount     = amount;
		r.eventId    = NextEventId(eventType, steamId);

		string body;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(r, false, body);

		GoldRewardCallback cb = new GoldRewardCallback(r.eventId, this);
		m_Pending.Insert(cb);
		ctx.POST(cb, "/reward", body);
	}

	// -------- Event entry points --------
	void OnPvpKill(PlayerBase victim, PlayerBase killer)
	{
		if (!m_Config.EnablePvpKill) return;
		if (!killer || !killer.GetIdentity()) return;
		SendReward(killer.GetIdentity().GetPlainId(), killer.GetIdentity().GetName(), "pvp_kill", m_Config.PvpKillReward);
	}

	void OnInfectedKill(PlayerBase killer)
	{
		if (!m_Config.EnableInfectedKill) return;
		if (!killer || !killer.GetIdentity()) return;
		SendReward(killer.GetIdentity().GetPlainId(), killer.GetIdentity().GetName(), "infected_kill", m_Config.InfectedKillReward);
	}

	void PlaytimeTick()
	{
		if (!m_Config.EnablePlaytime) return;
		array<Man> players = new array<Man>();
		GetGame().GetPlayers(players);
		foreach (Man m : players)
		{
			PlayerBase p = PlayerBase.Cast(m);
			if (p && p.IsAlive() && p.GetIdentity())
				SendReward(p.GetIdentity().GetPlainId(), p.GetIdentity().GetName(), "playtime_tick", m_Config.PlaytimeReward);
		}
	}

	// -------- Wallet linking --------
	void OnPlayerConnect(PlayerBase player, PlayerIdentity identity)
	{
		if (!identity) return;
		if (!m_Config.ShowLinkPromptOnConnect) return;
		// Fire ~12s after connect so the message lands once the player is in-world, not on the loading screen.
		GetGame().GetCallQueue(CALL_CATEGORY_GAMEPLAY).CallLater(this.RequestLinkCode, 12000, false, identity.GetPlainId(), identity.GetName());
	}

	void RequestLinkCode(string steamId, string playerName)
	{
		RestContext ctx = GetContext();
		if (!ctx) return;

		GoldLinkRequest r = new GoldLinkRequest();
		r.secret     = m_Config.SharedSecret;
		r.steamId    = steamId;
		r.playerName = playerName;

		string body;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(r, false, body);

		GoldLinkCallback cb = new GoldLinkCallback(steamId, this);
		m_Pending.Insert(cb);
		ctx.POST(cb, "/link/request", body);
	}

	void OnLinkCodeReceived(string steamId, string data)
	{
		PlayerBase p = FindPlayerBySteamId(steamId);
		if (!p) return;

		GoldLinkResponse resp = new GoldLinkResponse();
		JsonSerializer js = new JsonSerializer();
		string err;
		if (js.ReadFromString(resp, data, err) && resp.code != "")
		{
			int mins = resp.expiresInSec / 60;
			p.MessageImportant("[$GOLD] Link your wallet to earn $GOLD! Visit " + m_Config.BridgeUrl + "/link and enter code: " + resp.code + " (expires in " + mins.ToString() + " min)");
		}
		else
		{
			p.MessageImportant("[$GOLD] Link your wallet: " + data);
		}
	}

	PlayerBase FindPlayerBySteamId(string steamId)
	{
		array<Man> players = new array<Man>();
		GetGame().GetPlayers(players);
		foreach (Man m : players)
		{
			PlayerBase p = PlayerBase.Cast(m);
			if (p && p.GetIdentity() && p.GetIdentity().GetPlainId() == steamId)
				return p;
		}
		return null;
	}

	// -------- Housekeeping --------
	void ReleasePending(RestCallback cb)
	{
		int idx = m_Pending.Find(cb);
		if (idx != -1) m_Pending.Remove(idx);
	}
}

// -------- Global accessors --------
ref GoldRewardManager g_GoldRewardManager;

GoldRewardManager GoldReward_GetManager()
{
	return g_GoldRewardManager;
}

void GoldReward_CreateManager()
{
	if (!g_GoldRewardManager)
	{
		g_GoldRewardManager = new GoldRewardManager();
		g_GoldRewardManager.Init();
	}
}

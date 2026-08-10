// Awards the killer on PvP death. DayZ 1.29 PlayerBase has no overridable EEKilled, so we detect
// the fatal hit inside EEHitBy: when a hit leaves the victim not-alive, the damage source is the killer.
// A one-shot guard prevents double-awarding from post-death hits.
modded class PlayerBase
{
	bool m_GoldKillAwarded;

	override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
	{
		super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

		if (m_GoldKillAwarded) return;
		if (IsAlive()) return; // only act on the hit that killed this player

		PlayerBase attacker;
		if (source)
		{
			if (!Class.CastTo(attacker, source))
				Class.CastTo(attacker, source.GetHierarchyRootPlayer());
		}

		if (attacker && attacker != this)
		{
			m_GoldKillAwarded = true;
			GoldRewardManager mgr = GoldReward_GetManager();
			if (mgr)
				mgr.OnPvpKill(this, attacker);
		}
	}
}

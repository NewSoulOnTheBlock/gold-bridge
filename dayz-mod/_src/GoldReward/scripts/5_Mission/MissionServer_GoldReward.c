// Boots the reward manager and forwards player-connect events to it.
modded class MissionServer
{
	override void OnInit()
	{
		super.OnInit();
		GoldReward_CreateManager();
	}

	override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
	{
		super.InvokeOnConnect(player, identity);

		GoldRewardManager mgr = GoldReward_GetManager();
		if (mgr)
			mgr.OnPlayerConnect(player, identity);
	}
}

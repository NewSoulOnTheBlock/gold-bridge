class CfgPatches
{
	class GoldReward
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data"};
	};
};

class CfgMods
{
	class GoldReward
	{
		type = "mod";
		name = "GoldReward";
		author = "Robinhood";
		version = "0.1";
		dependencies[] = {"World", "Mission"};
		class defs
		{
			class worldScriptModule
			{
				value = "";
				files[] = {"GoldReward/scripts/4_World"};
			};
			class missionScriptModule
			{
				value = "";
				files[] = {"GoldReward/scripts/5_Mission"};
			};
		};
	};
};

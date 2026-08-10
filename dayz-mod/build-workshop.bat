@echo off
REM Rebuild @GoldReward the proper way: binarize config -> pack PBO -> sign -> deploy to live server.
REM Run from the @GoldReward folder:  build-workshop.bat
REM Requires DayZ Tools installed (default Steam path) and Node.js.
setlocal
set TOOLS=C:\Program Files (x86)\Steam\steamapps\common\DayZ Tools\Bin
cd /d "%~dp0"

echo [1/5] Binarizing config.cpp -> config.bin ...
if exist build_stage rmdir /s /q build_stage
mkdir build_stage\GoldReward\scripts
xcopy /e /i /y "_src\GoldReward\scripts" "build_stage\GoldReward\scripts" >nul
"%TOOLS%\CfgConvert\CfgConvert.exe" -bin -dst "build_stage\GoldReward\config.bin" "_src\GoldReward\config.cpp"
if errorlevel 1 goto :err

echo [2/5] Packing PBO ...
node pack.mjs "build_stage\GoldReward" "build\addons\GoldReward.pbo" "GoldReward"
if errorlevel 1 goto :err

echo [3/5] Signing PBO ...
"%TOOLS%\DsUtils\DSSignFile.exe" "_keys\GoldReward.biprivatekey" "build\addons\GoldReward.pbo"
if errorlevel 1 goto :err
copy /y "_keys\GoldReward.bikey" "build\keys\" >nul

echo [4/5] Deploying to live server (addons\) ...
copy /y "build\addons\GoldReward.pbo" "addons\GoldReward.pbo" >nul
copy /y "build\addons\GoldReward.pbo.GoldReward.bisign" "addons\" >nul

echo [5/5] Done. Restart the server to load the new build.
echo To publish the update: open DayZ Publisher on the @GoldReward\build folder and click Update.
goto :eof

:err
echo BUILD FAILED. See output above.
exit /b 1

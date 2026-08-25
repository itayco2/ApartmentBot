@echo off
REM Keeps the bot running: restarts it whenever it exits, for any reason.
REM Used by the Task Scheduler at-logon task; NSSM does this itself.
REM
REM Only one copy may poll a Telegram token. If a second one starts, the bot
REM detects the 409 Conflict, says so plainly and exits - so the loop below
REM will keep retrying until the other copy stops.
cd /d "%~dp0.."
set RUNNING_AS_SERVICE=1

:loop
node node_modules\tsx\dist\cli.mjs src\index.ts >> "data\service.log" 2>&1
echo [%date% %time%] bot exited with code %errorlevel%, restarting in 10s >> "data\service.log"
timeout /t 10 /nobreak >nul
goto loop

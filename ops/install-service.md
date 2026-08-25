# Running the bot 24/7 on Windows

**Already installed: the `ApartmentBot` scheduled task.** It needs no administrator rights and
is what is running now. Section A below documents it; section B is an optional upgrade that
starts the bot before anyone logs in, which needs an elevated prompt.

## What is installed

A Task Scheduler task named `ApartmentBot` runs `ops/run-hidden.vbs` **every 5 minutes**, with
"do not start a new instance if one is already running". That single rule covers three jobs:

- starts the bot within 5 minutes of you logging in,
- restarts it within 5 minutes if the process tree ever dies,
- does nothing at all while the bot is healthy.

`ops/run-hidden.vbs` starts `ops/run.cmd` with no console window - a task action pointing at
`cmd.exe` would leave a black window on screen for as long as the bot ran, which is forever.
`run.cmd` in turn restarts the bot after 10 seconds if it exits on its own, so an ordinary
crash recovers in seconds rather than minutes.

**There is no window to look at, by design.** Logs go to `data/service.log`, and `/status` in
Telegram reports uptime and per-source health.

Verified: killing the bot and its wrapper outright, the task brought it back on its own within
five minutes and resumed polling.

### Managing it

```powershell
Get-ScheduledTask -TaskName ApartmentBot | Select-Object TaskName, State
Start-ScheduledTask -TaskName ApartmentBot
Stop-ScheduledTask  -TaskName ApartmentBot
schtasks /delete /tn ApartmentBot /f
```

Stopping it properly means `Stop-ScheduledTask` **and** killing the node process, since the
wrapper would otherwise restart it:

```powershell
Stop-ScheduledTask -TaskName ApartmentBot
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*index.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### Sleep

**The bot stops while the computer sleeps.** Sleep suspends every process; nothing is polled and
no alerts are sent until the machine wakes. This PC is set to *never* sleep on AC power
(Ultimate Performance scheme), so it keeps running while plugged in, but it does sleep after
10 minutes on battery. To check or change:

```powershell
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /change standby-timeout-dc 0
```

---

## Option B - NSSM service (optional, needs administrator)

The scheduled task only runs once you have logged in. A Windows service starts at boot, before
any login. Worth it only if the machine reboots unattended.

---

## Option A - NSSM service (recommended)

**1. Install NSSM**

```powershell
winget install NSSM.NSSM
```

Or download from <https://nssm.cc/download> and put `nssm.exe` somewhere on your PATH.

**2. Find your node path**

```powershell
(Get-Command node).Source
```

**3. Create the service** (run PowerShell as Administrator)

```powershell
nssm install ApartmentBot "C:\Program Files\nodejs\node.exe"
nssm set ApartmentBot AppDirectory "C:\path\to\Apartment"
nssm set ApartmentBot AppParameters "node_modules\tsx\dist\cli.mjs src\index.ts"
nssm set ApartmentBot AppEnvironmentExtra RUNNING_AS_SERVICE=1
nssm set ApartmentBot DisplayName "Apartment Bot"
nssm set ApartmentBot Description "Telegram alerts for new rental listings"
nssm set ApartmentBot Start SERVICE_AUTO_START
```

**4. Send logs to a rotating file**

```powershell
nssm set ApartmentBot AppStdout "C:\path\to\Apartment\data\service.log"
nssm set ApartmentBot AppStderr "C:\path\to\Apartment\data\service-error.log"
nssm set ApartmentBot AppRotateFiles 1
nssm set ApartmentBot AppRotateOnline 1
nssm set ApartmentBot AppRotateBytes 10485760
```

**5. Restart policy** - wait 5s before restarting, and do not spin if it is crash-looping

```powershell
nssm set ApartmentBot AppThrottle 5000
nssm set ApartmentBot AppExit Default Restart
nssm set ApartmentBot AppRestartDelay 5000
```

**6. Start it**

```powershell
nssm start ApartmentBot
```

### Managing the service

```powershell
nssm status ApartmentBot
nssm restart ApartmentBot
nssm stop ApartmentBot
nssm edit ApartmentBot          # GUI for all of the above
nssm remove ApartmentBot confirm
```

Confirm it is alive by sending `/status` to the bot in Telegram - it reports uptime, the last
cycle and the health of each source.

---

## Option B - Task Scheduler (no install)

Starts when you log in, and `ops/run.cmd` restarts the bot if it exits.

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\path\to\Apartment\ops\run.cmd"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval 00:01:00
Register-ScheduledTask -TaskName "ApartmentBot" -Action $action -Trigger $trigger -Settings $settings
```

To remove it:

```powershell
Unregister-ScheduledTask -TaskName "ApartmentBot" -Confirm:$false
```

---

## Verifying it survives a restart

1. `nssm status ApartmentBot` reports `SERVICE_RUNNING`.
2. Kill the node process in Task Manager, wait ~10 seconds, and check it came back.
3. Reboot, do not log in, then send `/status` from your phone - it should answer.

## If the bot goes quiet

Run `npm run probe` from the project folder. It fetches every source live and prints what it
got, which distinguishes "the sites changed" from "the bot is not running". `/status` in
Telegram shows whether a source is failing or backing off.

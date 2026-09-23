<div dir="rtl">

# הרצה 24/7 ב-Windows

הבוט צריך לרוץ כל הזמן כדי לא לפספס דירות. יש שתי דרכים, ושתיהן מפעילות אותו מחדש לבד אם הוא נופל.

| | אפשרות א: Task Scheduler | אפשרות ב: שירות עם NSSM |
| --- | --- | --- |
| הרשאות מנהל | לא צריך | צריך |
| מתי עולה | אחרי שמתחברים למחשב | עם הדלקת המחשב, גם בלי להתחבר |
| מתאים ל | רוב האנשים | מחשב שמופעל מחדש בלי השגחה |

בשתי האפשרויות הלוגים נכתבים ל-`data/service.log`, ו-`/status` בטלגרם מראה זמן פעילות ומצב כל מקור.

## אפשרות א: Task Scheduler (בלי הרשאות מנהל)

`ops/run-hidden.vbs` מפעיל את `ops/run.cmd` בלי חלון שחור על המסך, ו-`run.cmd` מפעיל את הבוט מחדש עשר שניות אחרי שהוא נסגר. משימה שרצה כל חמש דקות, עם "לא להפעיל עותק נוסף אם אחד כבר רץ", מכסה את כל השאר: היא מעלה את הבוט אחרי ההתחברות, מחזירה אותו אם כל התהליך מת, ולא עושה כלום כשהכל תקין.

ב-PowerShell, מתוך תיקיית הפרויקט:

</div>

```powershell
$vbs      = Join-Path (Get-Location) 'ops\run-hidden.vbs'
$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ApartmentBot' -Action $action -Trigger $trigger -Settings $settings
```

<div dir="rtl">

ניהול:

</div>

```powershell
Get-ScheduledTask -TaskName ApartmentBot | Select-Object TaskName, State
Start-ScheduledTask -TaskName ApartmentBot
Unregister-ScheduledTask -TaskName ApartmentBot -Confirm:$false
```

<div dir="rtl">

כדי לעצור את הבוט באמת צריך גם לעצור את המשימה וגם לסגור את תהליך ה-node, אחרת `run.cmd` יפעיל אותו שוב:

</div>

```powershell
Stop-ScheduledTask -TaskName ApartmentBot
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*index.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

<div dir="rtl">

## אפשרות ב: שירות Windows עם NSSM (צריך הרשאות מנהל)

**1. התקנת NSSM**

</div>

```powershell
winget install NSSM.NSSM
```

<div dir="rtl">

**2. יצירת השירות** (ב-PowerShell כמנהל). את `C:\path\to\Apartment` מחליפים בתיקיית הפרויקט, ואת נתיב ה-node בתוצאה של `(Get-Command node).Source`.

</div>

```powershell
nssm install ApartmentBot "C:\Program Files\nodejs\node.exe"
nssm set ApartmentBot AppDirectory "C:\path\to\Apartment"
nssm set ApartmentBot AppParameters "node_modules\tsx\dist\cli.mjs src\index.ts"
nssm set ApartmentBot AppEnvironmentExtra RUNNING_AS_SERVICE=1
nssm set ApartmentBot DisplayName "Apartment Bot"
nssm set ApartmentBot Start SERVICE_AUTO_START

nssm set ApartmentBot AppStdout "C:\path\to\Apartment\data\service.log"
nssm set ApartmentBot AppStderr "C:\path\to\Apartment\data\service-error.log"
nssm set ApartmentBot AppRotateFiles 1
nssm set ApartmentBot AppRotateOnline 1
nssm set ApartmentBot AppRotateBytes 10485760

nssm set ApartmentBot AppThrottle 5000
nssm set ApartmentBot AppExit Default Restart
nssm set ApartmentBot AppRestartDelay 5000

nssm start ApartmentBot
```

<div dir="rtl">

ניהול: `nssm status ApartmentBot`, `nssm restart ApartmentBot`, `nssm stop ApartmentBot`, ו-`nssm remove ApartmentBot confirm` להסרה.

## מצב שינה

**הבוט עוצר כשהמחשב נכנס לשינה**: שום דבר לא נבדק ושום התראה לא נשלחת עד שהוא מתעורר. כדי שימשיך לרוץ, כדאי לבטל שינה כשהמחשב מחובר לחשמל:

</div>

```powershell
powercfg /change standby-timeout-ac 0
```

<div dir="rtl">

## לוודא שזה עובד

1. שולחים `/status` לבוט בטלגרם ומקבלים תשובה.
2. סוגרים את תהליך ה-node במנהל המשימות, מחכים דקה (או עד חמש, באפשרות א) ובודקים שהוא חזר.
3. אם הבוט שותק, מריצים `npm run probe` מתיקיית הפרויקט: זה מראה אם האתרים השתנו או שפשוט הבוט לא רץ.

</div>

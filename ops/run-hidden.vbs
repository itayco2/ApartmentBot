' Launches the bot with no visible console window.
'
' The scheduled task points here rather than at run.cmd directly, because a
' task action of cmd.exe always shows its window while the process runs - and
' the bot runs forever, so the window never goes away. WScript.Shell.Run with
' a window style of 0 starts the same batch file hidden.
'
' The third argument MUST be True (wait for the child to exit). With False this
' script returns immediately, Task Scheduler treats the task as finished, and
' tears down the process tree it started - killing the bot moments after launch.
' Waiting keeps this script alive as the task's process for as long as the bot
' runs, and it is itself windowless.
'
' Arguments: command, window style (0 = hidden), wait for exit (True)
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c """ & here & "\run.cmd""", 0, True

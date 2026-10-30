' ChartVista / MyTV — start server with no console window.
' Used for login auto-start and for start.bat.
Option Explicit
Dim sh, fso, dir, nodeExe, already
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

' Skip if already serving on 8787
already = sh.Run( _
  "powershell -NoProfile -WindowStyle Hidden -Command ""try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health -TimeoutSec 2).StatusCode -eq 200) { exit 1 } else { exit 0 } } catch { exit 0 }""", _
  0, True)

If already = 1 Then
  WScript.Quit 0
End If

' Window style 0 = hidden (no terminal)
sh.Run """" & nodeExe & """ """ & dir & "\server.js""", 0, False

# Install ChartVista hidden auto-start at Windows login
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $root 'start-hidden.vbs'
if (-not (Test-Path $vbs)) { throw "Missing $vbs" }

$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'MyTV ChartVista.lnk'

$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($lnkPath)
$s.TargetPath = 'wscript.exe'
$s.Arguments = "//nologo `"$vbs`""
$s.WorkingDirectory = $root
$s.WindowStyle = 7  # minimized — wscript itself is brief; server stays hidden
$s.Description = 'MyTV ChartVista — auto-start (hidden, no terminal)'
$s.Save()

Write-Host "Installed auto-start:"
Write-Host "  $lnkPath"
Write-Host "Server starts hidden on login at http://localhost:8787/"

# Start now (hidden) so user doesn't need to reboot to verify
& wscript.exe //nologo $vbs
Start-Sleep -Seconds 2
try {
  $h = Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 5
  Write-Host "Running now. health ok=$($h.ok)"
} catch {
  Write-Host "Started, but health check failed: $($_.Exception.Message)"
}

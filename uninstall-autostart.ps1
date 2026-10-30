$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'MyTV ChartVista.lnk'
if (Test-Path $lnkPath) {
  Remove-Item -Force $lnkPath
  Write-Host "Removed: $lnkPath"
} else {
  Write-Host "No auto-start shortcut found."
}

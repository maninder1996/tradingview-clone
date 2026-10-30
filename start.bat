@echo off
cd /d "%~dp0"
:: Start server with no visible terminal, then open the chart
wscript //nologo "%~dp0start-hidden.vbs"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8787/"

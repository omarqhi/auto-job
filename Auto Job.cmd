@echo off
rem Double-click to open the Auto Job dashboard (starts it and n8n if needed).
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-dashboard.ps1"

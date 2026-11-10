@echo off
rem Perch for Windows - asistente de instalacion y configuracion. Doble clic para ejecutar.
title Perch - asistente
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 pause

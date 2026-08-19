@echo off
chcp 65001 >nul
title Backup do sistema Gestao
cd /d "%~dp0"

set DESTINO=%USERPROFILE%\OneDrive\Backups Gestao

call npm run backup -- "%DESTINO%"

if errorlevel 1 (
  echo.
  echo   O backup NAO foi guardado. Confira se a pasta abaixo existe e
  echo   se ha espaco em disco:
  echo     %DESTINO%
  echo.
  if "%1"=="/auto" exit /b 1
  pause
  exit /b 1
)

if "%1"=="/auto" exit /b 0
pause

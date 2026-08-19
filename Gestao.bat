@echo off
chcp 65001 >nul
title Gestao - Colegio Santa Chiara  (NAO FECHE ESTA JANELA)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   O Node.js nao esta instalado neste PC.
  echo   Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0package.json" (
  echo.
  echo   Este Gestao.bat esta na pasta errada.
  echo.
  echo   Ele esta em:
  echo       %~dp0
  echo   e nao ha um package.json aqui, entao o sistema nao esta nesta pasta.
  echo.
  echo   Provavelmente existe uma copia solta deste arquivo. Apague ela e
  echo   use o Gestao.bat que fica junto do src, do publico e do package.json.
  echo.
  pause
  exit /b 1
)

call npm start

echo.
echo   =============================================
echo   O sistema parou.
echo.
echo   Se apareceu erro acima, e ele que impede o sistema de subir.
echo   O Diagnostico.bat ajuda a entender o que fazer.
echo.
pause

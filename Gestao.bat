@echo off
chcp 65001 >nul
title Gestao - Colegio Santa Chiara  (NAO FECHE ESTA JANELA)
cd /d "%~dp0"
npm start
echo.
echo   O sistema parou. Feche esta janela ou rode o Gestao.bat de novo.
pause

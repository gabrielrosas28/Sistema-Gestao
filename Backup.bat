@echo off
chcp 65001 >nul
title Backup do sistema Gestao
cd /d "%~dp0"

rem Guarda a copia no OneDrive, para existir backup fora do predio.
rem Troque o caminho abaixo se a pasta do OneDrive for outra.
set DESTINO=%USERPROFILE%\OneDrive\Backups Gestao

call npm run backup -- "%DESTINO%"

rem Sem o pause abaixo, da para agendar no Agendador de Tarefas do Windows
rem para rodar todo dia as 19h sem ninguem precisar clicar em nada.
if "%1"=="/auto" exit /b 0
pause

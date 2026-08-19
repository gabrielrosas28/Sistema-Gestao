@echo off
chcp 65001 >nul
title Backup do sistema Gestao
cd /d "%~dp0"

rem Guarda a copia no OneDrive, para existir backup fora do predio.
rem Troque o caminho abaixo se a pasta do OneDrive for outra.
set DESTINO=%USERPROFILE%\OneDrive\Backups Gestao

call npm run backup -- "%DESTINO%"

rem O Atualizar.bat chama este arquivo com /auto e so continua se o backup
rem tiver dado certo -- por isso a falha precisa chegar inteira ate ele.
rem Antes o "exit /b 0" logo abaixo devolvia sucesso mesmo quando o npm
rem falhava, e quem chamasse ficava achando que tinha copia guardada.
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

rem Sem o pause abaixo, da para agendar no Agendador de Tarefas do Windows
rem para rodar todo dia as 19h sem ninguem precisar clicar em nada.
if "%1"=="/auto" exit /b 0
pause

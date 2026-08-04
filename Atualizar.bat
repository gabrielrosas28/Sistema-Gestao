@echo off
chcp 65001 >nul
setlocal
title Atualizar o sistema Gestao
cd /d "%~dp0"

echo.
echo   Atualizacao do sistema Gestao
echo   =============================================
echo.

rem ---------- o sistema esta rodando? ----------
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if not errorlevel 1 (
  echo   O sistema parece estar ligado.
  echo.
  echo   Feche a janela do Gestao.bat antes de atualizar, senao os
  echo   arquivos ficam travados no meio da troca.
  echo.
  pause
  exit /b 1
)

rem ---------- backup antes de qualquer coisa ----------
echo   Guardando uma copia do banco antes de mexer em nada...
call npm run backup >nul 2>nul
if errorlevel 1 (
  echo   Nao consegui fazer o backup. Atualizacao cancelada por seguranca.
  pause
  exit /b 1
)
echo   Copia guardada.
echo.

rem ---------- versao nova ----------
where git >nul 2>nul
if errorlevel 1 (
  echo   O Git nao esta instalado neste PC.
  echo   Baixe em https://git-scm.com, instale e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

echo   Baixando a versao nova...
call git pull
if errorlevel 1 (
  echo.
  echo   Nao consegui baixar. Confira a internet do servidor.
  pause
  exit /b 1
)
echo.

echo   Conferindo os componentes...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
echo.

echo   Conferindo se a versao nova esta coerente...
call node testes/coerencia.mjs
if errorlevel 1 goto erro

echo.
echo   =============================================
echo   Pronto. O banco se ajusta sozinho ao ligar.
echo.
echo   Abra o Gestao.bat para subir a versao nova.
echo.
pause
exit /b 0

:erro
echo.
echo   Algo deu errado. O banco nao foi tocado e a copia de seguranca
echo   esta em OneDrive\Backups Gestao. Mande o texto desta janela
echo   para quem acompanha o sistema.
echo.
pause
exit /b 1

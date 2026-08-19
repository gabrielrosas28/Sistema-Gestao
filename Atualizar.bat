@echo off
chcp 65001 >nul
setlocal
title Atualizar o sistema Gestao
cd /d "%~dp0"

echo.
echo   Atualizacao do sistema Gestao
echo   =============================================
echo.

tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if not errorlevel 1 (
  echo   O sistema parece estar ligado, e os arquivos ficariam travados
  echo   no meio da troca. Desligue antes de atualizar:
  echo.
  echo     - se estiver no modo sem janela, abra o "Rodar sem janela.bat"
  echo       como administrador e escolha a opcao [2]
  echo     - se nao, feche a janela preta do Gestao.bat
  echo.
  echo   Na duvida, o "Rodar sem janela.bat" opcao [3] diz qual e o caso.
  echo.
  pause
  exit /b 1
)

echo   Guardando uma copia do banco antes de mexer em nada...
call "%~dp0Backup.bat" /auto
if errorlevel 1 (
  echo   Nao consegui fazer o backup. Atualizacao cancelada por seguranca.
  pause
  exit /b 1
)
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo   O Git nao esta instalado neste PC.
  echo   Baixe em https://git-scm.com, instale e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%b in (`git rev-parse --abbrev-ref HEAD 2^>nul`) do set RAMO=%%b

if not defined RAMO (
  echo   Esta pasta nao e uma copia do repositorio do sistema, entao nao ha
  echo   de onde baixar a versao nova. Confira se o Atualizar.bat esta dentro
  echo   da pasta certa do sistema.
  echo.
  pause
  exit /b 1
)
if "%RAMO%"=="HEAD" (
  echo   O Git desta pasta esta fora de qualquer ramo. Rode uma vez, aqui
  echo   dentro, o comando abaixo e depois abra o Atualizar.bat de novo:
  echo.
  echo     git checkout main
  echo.
  pause
  exit /b 1
)

echo   Baixando a versao nova do ramo "%RAMO%"...
call git pull origin %RAMO%
if errorlevel 1 (
  echo.
  echo   Nao consegui baixar o ramo "%RAMO%".
  echo.
  echo   Costuma ser uma destas tres coisas:
  echo     - o servidor esta sem internet
  echo     - o ramo "%RAMO%" ainda nao existe no GitHub
  echo     - ha alteracao local nesta pasta atrapalhando a mesclagem
  echo       ^(rode "git status" aqui dentro para ver^)
  echo.
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
echo   Conferindo se o banco aguenta a atualizacao...
call node testes/migracao.mjs
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
echo   Algo deu errado. O banco nao foi tocado, e a copia de seguranca esta
echo   guardada no caminho que apareceu la em cima, no comeco desta janela.
echo   Mande o texto desta janela para quem acompanha o sistema.
echo.
pause
exit /b 1

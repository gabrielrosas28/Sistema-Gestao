@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Diagnostico do Gestao
cd /d "%~dp0"

set "PORTA=8080"
set "TAREFA=Gestao Santa Chiara"

echo.
echo   Diagnostico do sistema Gestao
echo   =============================================
echo   Pasta: %CD%
echo.

rem ---------- 1. Node ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   [x] Node.js NAO esta instalado
  echo       Baixe a versao LTS em https://nodejs.org
  goto fim
)
for /f "delims=" %%v in ('node -v') do echo   [ok] Node.js %%v

rem ---------- 2. arquivos ----------
if not exist "src\servidor.js" (
  echo   [x] Nao achei src\servidor.js
  echo       Este arquivo precisa estar dentro da pasta do sistema.
  goto fim
)
echo   [ok] Arquivos do sistema no lugar

rem Nao basta a pasta node_modules existir. Conferir so o express deixava
rem passar o caso real: node_modules copiada de outro PC ou tirada de um .zip,
rem com uma dependencia pela metade. O sistema so reclamava na hora do login.
set "FALTANDO="
for %%p in (express bcryptjs cookie-parser xlsx) do (
  if not exist "node_modules\%%p\package.json" set "FALTANDO=!FALTANDO! %%p"
)
if defined FALTANDO (
  echo   [x] Componentes com problema:!FALTANDO!
  echo.
  echo       A pasta node_modules esta incompleta. Isso acontece quando ela
  echo       e copiada de outro PC ou descompactada de um .zip, em vez de
  echo       instalada aqui. Os arquivos existem, mas pela metade.
  echo.
  echo       Conserto, nesta pasta e com internet no servidor:
  echo           rmdir /s /q node_modules
  echo           npm install
  echo.
  goto fim
)
echo   [ok] Componentes instalados

rem ---------- 3. banco ----------
if not exist "dados\gestao.db" (
  echo   [x] Banco de dados nao existe ainda
  echo       Rode o Instalar.bat para importar turmas e alunos.
  goto fim
)
for %%f in ("dados\gestao.db") do set "TAM=%%~zf"
echo   [ok] Banco encontrado (!TAM! bytes)

rem ---------- 4. tem alguem escutando na porta? ----------
set "ESCUTANDO="
for /f "tokens=*" %%l in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING"') do set "ESCUTANDO=%%l"

if defined ESCUTANDO (
  echo   [ok] Alguem esta escutando na porta %PORTA%
  echo.
  echo   O sistema esta NO AR. Abra no navegador:
  echo       http://localhost:%PORTA%
  echo.
  ipconfig ^| findstr /i "IPv4" >nul
  for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=* delims= " %%j in ("%%i") do echo       http://%%j:%PORTA%    ^(nos outros PCs^)
  )
  echo.
  echo   Se mesmo assim nao abrir no navegador deste PC, feche o
  echo   navegador por completo e abra de novo.
  goto fim
)

echo   [x] NINGUEM esta escutando na porta %PORTA%
echo       E por isso que o navegador diz "conexao recusada".
echo.

rem ---------- 5. por que nao esta rodando? ----------
echo   ---------------------------------------------
echo   Procurando o motivo...
echo.

tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if not errorlevel 1 (
  echo   O Node esta rodando, mas nao na porta %PORTA%.
  echo   Talvez o sistema esteja em outra porta, ou travado.
  echo   Feche as janelas pretas abertas e ligue de novo pelo Gestao.bat.
  goto fim
)
echo   Nenhum processo do sistema esta rodando.
echo.

schtasks /query /tn "%TAREFA%" >nul 2>nul
if not errorlevel 1 (
  echo   O modo sem janela esta registrado no Windows, mas parado.
  echo   Ligue com:  schtasks /run /tn "%TAREFA%"
  echo   Ou use o "Rodar sem janela.bat", opcao 1.
  echo.
) else (
  echo   O modo sem janela nao esta ligado, entao o sistema so fica no ar
  echo   enquanto a janela do Gestao.bat estiver aberta.
  echo.
  echo   O que fazer agora:
  echo     1. Abra o Gestao.bat e deixe a janela aberta, ou
  echo     2. Rode o "Rodar sem janela.bat" como administrador, opcao 1,
  echo        para ele subir sozinho e nunca mais depender de janela.
  echo.
)

rem ---------- 6. sobrou erro no log? ----------
if exist "dados\servidor.log" (
  echo   ---------------------------------------------
  echo   Ultimas linhas do dados\servidor.log:
  echo.
  powershell -NoProfile -Command "Get-Content 'dados\servidor.log' -Tail 15" 2>nul
  echo.
  echo   Se aparecer erro acima, e ele que impede o sistema de subir.
)

:fim
echo.
echo   =============================================
pause

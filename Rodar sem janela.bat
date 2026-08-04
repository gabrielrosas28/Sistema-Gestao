@echo off
chcp 65001 >nul
setlocal
title Gestao - rodar sem janela aberta
cd /d "%~dp0"

set "TAREFA=Gestao Santa Chiara"

rem ---------- precisa de administrador ----------
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Este arquivo precisa ser aberto como administrador.
  echo.
  echo   Feche esta janela, clique com o botao direito no
  echo   "Rodar sem janela.bat" e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)

echo.
echo   Rodar o Gestao sem janela aberta
echo   =============================================
echo.
echo   Hoje o sistema so fica no ar enquanto a janela preta do Gestao.bat
echo   estiver aberta. Qualquer pessoa que feche ela sem querer derruba o
echo   sistema para a escola inteira.
echo.
echo   Esta opcao registra o Gestao no Windows para ele:
echo     - subir sozinho quando o PC liga, antes de alguem fazer login
echo     - rodar escondido, sem janela para fechar por engano
echo     - voltar sozinho se travar
echo.
echo   O que sai na janela passa a ser gravado em dados\servidor.log.
echo.
echo   [1] Ligar o modo sem janela
echo   [2] Desligar e voltar para o Gestao.bat
echo   [3] Ver a situacao agora
echo.
set "OPCAO="
set /p OPCAO=  Escolha 1, 2 ou 3:
echo.

if "%OPCAO%"=="2" goto remover
if "%OPCAO%"=="3" goto situacao
if not "%OPCAO%"=="1" exit /b 0

rem ---------- instalar ----------
for /f "delims=" %%n in ('where node') do set "NODE=%%n" & goto achou
:achou
if not defined NODE (
  echo   Nao encontrei o Node.js neste PC. Instale pelo https://nodejs.org
  pause
  exit /b 1
)

if not exist "%~dp0dados" mkdir "%~dp0dados"

schtasks /query /tn "%TAREFA%" >nul 2>nul
if not errorlevel 1 schtasks /delete /tn "%TAREFA%" /f >nul

schtasks /create /tn "%TAREFA%" /sc onstart /ru SYSTEM /rl HIGHEST /f ^
  /tr "cmd /c cd /d \"%~dp0\" && \"%NODE%\" --experimental-sqlite --no-warnings src\servidor.js >> dados\servidor.log 2>&1" >nul
if errorlevel 1 (
  echo   Nao consegui registrar no Windows.
  pause
  exit /b 1
)

echo   Registrado. Ligando agora...
schtasks /run /tn "%TAREFA%" >nul
timeout /t 4 >nul

echo.
echo   =============================================
echo   Pronto. O sistema esta no ar e sobe sozinho quando o PC liga.
echo.
echo   Pode fechar qualquer janela preta que esteja aberta.
echo   Nao use mais o Gestao.bat: o sistema ja esta rodando por tras.
echo.
echo   Enderecos:
ipconfig | findstr /i "IPv4"
echo   Some a porta :8080 no fim do IP, por exemplo http://192.168.15.61:8080
echo.
echo   Antes de atualizar (Atualizar.bat), desligue pelo item [2] deste
echo   arquivo, atualize, e ligue de novo pelo item [1].
echo.
pause
exit /b 0

:remover
schtasks /query /tn "%TAREFA%" >nul 2>nul
if errorlevel 1 (
  echo   O modo sem janela nao esta ligado.
  pause
  exit /b 0
)
schtasks /end /tn "%TAREFA%" >nul 2>nul
schtasks /delete /tn "%TAREFA%" /f >nul
echo   Desligado. O sistema saiu do ar.
echo.
echo   Para ligar de novo, use o Gestao.bat ou o item [1] deste arquivo.
echo.
pause
exit /b 0

:situacao
schtasks /query /tn "%TAREFA%" /fo list 2>nul | findstr /i "TaskName Status"
if errorlevel 1 echo   O modo sem janela nao esta ligado.
echo.
pause
exit /b 0

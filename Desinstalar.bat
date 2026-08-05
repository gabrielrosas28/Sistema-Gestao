@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Desinstalar o sistema Gestao - Colegio Santa Chiara
cd /d "%~dp0"

set "TAREFA=Gestao Santa Chiara"
set "REGRA=Gestao Santa Chiara"
set "PASTA=%~dp0"
set "BACKUPS=%USERPROFILE%\OneDrive\Backups Gestao"

rem ---------- precisa de administrador ----------
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Este arquivo precisa ser aberto como administrador.
  echo.
  echo   Feche esta janela, clique com o botao direito no
  echo   "Desinstalar.bat" e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)

echo.
echo   Desinstalar o sistema Gestao
echo   =============================================
echo.
echo   Isto APAGA TUDO deste servidor:
echo.
echo     - o sistema no ar, e a tarefa que o liga sozinho no boot
echo     - a regra de firewall que libera a porta 8080 na rede
echo     - o banco de dados, com todos os pagamentos lancados
echo     - os backups em %BACKUPS%
echo     - a pasta inteira %PASTA%
echo.
echo   NAO TEM VOLTA. Depois disso nao existe mais como recuperar
echo   quem pagou o que. Se houver qualquer duvida, feche esta janela
echo   agora e rode o Backup.bat antes.
echo.
echo   =============================================
echo.
set "CONFIRMA="
set /p CONFIRMA=  Para continuar, digite DESINSTALAR e aperte Enter:
if /i not "%CONFIRMA%"=="DESINSTALAR" goto cancelado
echo.
set "CONFIRMA2="
set /p CONFIRMA2=  Tem certeza? Digite SIM:
if /i not "%CONFIRMA2%"=="SIM" goto cancelado
echo.

echo   =============================================
echo.

rem ---------- 1. tirar do ar ----------
echo   [1/6] Tirando o sistema do ar...
schtasks /query /tn "%TAREFA%" >nul 2>nul
if not errorlevel 1 (
  schtasks /end /tn "%TAREFA%" >nul 2>nul
  schtasks /delete /tn "%TAREFA%" /f >nul 2>nul
  echo         tarefa "%TAREFA%" removida do Windows.
) else (
  echo         nao havia tarefa registrada.
)

rem mata qualquer node que esteja segurando o banco ou a porta
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if not errorlevel 1 (
  taskkill /im node.exe /f >nul 2>nul
  echo         processos node.exe encerrados.
)
timeout /t 2 >nul

rem ---------- 2. firewall ----------
echo   [2/6] Fechando a porta no firewall...
netsh advfirewall firewall show rule name="%REGRA%" >nul 2>nul
if not errorlevel 1 (
  netsh advfirewall firewall delete rule name="%REGRA%" >nul 2>nul
  echo         regra "%REGRA%" apagada.
) else (
  echo         nao havia regra de firewall.
)

rem ---------- 3. backup agendado, se alguem criou ----------
echo   [3/6] Conferindo agendamento de backup...
schtasks /query /tn "Backup Gestao" >nul 2>nul
if not errorlevel 1 (
  schtasks /delete /tn "Backup Gestao" /f >nul 2>nul
  echo         tarefa "Backup Gestao" removida.
) else (
  echo         nao havia backup agendado.
)

rem ---------- 4. banco ----------
echo   [4/6] Apagando o banco de dados...
if exist "%PASTA%dados" (
  rd /s /q "%PASTA%dados" 2>nul
  if exist "%PASTA%dados" (
    echo         NAO CONSEGUI apagar a pasta dados. Algum programa ainda
    echo         esta com o arquivo aberto. Apague na mao depois.
  ) else (
    echo         pasta dados apagada.
  )
) else (
  echo         nao havia pasta dados.
)

rem ---------- 5. backups ----------
echo   [5/6] Apagando os backups...
if exist "%BACKUPS%" (
  rd /s /q "%BACKUPS%" 2>nul
  if exist "%BACKUPS%" (
    echo         NAO CONSEGUI apagar. Se o OneDrive estiver sincronizando,
    echo         apague a pasta na mao: %BACKUPS%
  ) else (
    echo         backups apagados.
  )
) else (
  echo         nao havia backups nessa pasta.
)
echo.
echo         Atencao: se o OneDrive ja sincronizou, a copia pode continuar
echo         na Lixeira do OneDrive na internet. Esvazie por la tambem.

rem ---------- 6. a propria pasta ----------
echo   [6/6] Apagando a pasta do sistema...
echo.

rem O .bat nao consegue apagar a pasta onde ele mesmo esta rodando.
rem Por isso ele grava um faxineiro no TEMP, sai da pasta e chama o faxineiro,
rem que espera este arquivo terminar e so entao apaga tudo.
set "FAXINA=%TEMP%\gestao-faxina.bat"
> "%FAXINA%" echo @echo off
>>"%FAXINA%" echo chcp 65001 ^>nul
>>"%FAXINA%" echo title Desinstalar o sistema Gestao - ultimo passo
>>"%FAXINA%" echo cd /d "%%TEMP%%"
>>"%FAXINA%" echo timeout /t 3 ^>nul
>>"%FAXINA%" echo rem o .git marca os objetos como somente leitura, e o rd trava neles
>>"%FAXINA%" echo attrib -r -h -s "%PASTA%*" /s /d ^>nul 2^>nul
>>"%FAXINA%" echo rd /s /q "%PASTA:~0,-1%" 2^>nul
>>"%FAXINA%" echo echo.
>>"%FAXINA%" echo if exist "%PASTA:~0,-1%" ^(
>>"%FAXINA%" echo   echo   Quase tudo saiu, mas a pasta abaixo resistiu:
>>"%FAXINA%" echo   echo     %PASTA:~0,-1%
>>"%FAXINA%" echo   echo.
>>"%FAXINA%" echo   echo   Feche o Explorador de Arquivos e qualquer janela aberta
>>"%FAXINA%" echo   echo   nessa pasta, e apague ela na mao.
>>"%FAXINA%" echo ^) else ^(
>>"%FAXINA%" echo   echo   =============================================
>>"%FAXINA%" echo   echo   Pronto. Nao sobrou nada do Gestao neste PC.
>>"%FAXINA%" echo   echo.
>>"%FAXINA%" echo   echo   O Node.js continua instalado, e nao faz mal nenhum.
>>"%FAXINA%" echo ^)
>>"%FAXINA%" echo echo.
>>"%FAXINA%" echo pause
>>"%FAXINA%" echo del "%%~f0"

echo   O ultimo passo abre em uma janela nova, porque este arquivo
echo   esta dentro da pasta que vai ser apagada.
echo.
timeout /t 3 >nul
start "" "%FAXINA%"
exit /b 0

:cancelado
echo.
echo   Cancelado. Nada foi apagado.
echo.
pause
exit /b 0

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Gestao - rodar sem janela aberta
cd /d "%~dp0"

set "TAREFA=Gestao Santa Chiara"
set "PORTA=8080"
set "SERVICO=%~dp0_servico.cmd"
set "LOG=%~dp0dados\servidor.log"

rem ---------- precisa de administrador ----------
rem  Nao dava para confiar so no "net session": ele tambem falha quando o
rem  servico "Servidor" (LanmanServer) esta desligado, e ai o arquivo acusava
rem  falta de administrador com o usuario ja elevado. O teste principal agora
rem  e o nivel de integridade do processo, que nao depende de servico nenhum.
rem  Sem pipe dentro de if: nesta casa isso ja deu problema.
set "ADM="
whoami /groups 2>nul | findstr /c:"S-1-16-12288" >nul
if not errorlevel 1 set "ADM=1"
if defined ADM goto eadmin
whoami /groups 2>nul | findstr /c:"S-1-16-16384" >nul
if not errorlevel 1 set "ADM=1"
if defined ADM goto eadmin
fsutil dirty query %SystemDrive% >nul 2>nul
if not errorlevel 1 set "ADM=1"
if defined ADM goto eadmin
net session >nul 2>nul
if not errorlevel 1 set "ADM=1"
if defined ADM goto eadmin

echo.
echo   Este arquivo precisa ser aberto como administrador.
echo.
echo   Feche esta janela, clique com o botao direito no
echo   "Rodar sem janela.bat" e escolha "Executar como administrador".
echo.
pause
exit /b 1

:eadmin

echo.
echo   Rodar o Gestao sem janela aberta
echo   =============================================
echo.
echo   Sem isto, o sistema so fica no ar enquanto a janela preta do
echo   Gestao.bat estiver aberta. Qualquer pessoa que feche ela sem querer
echo   derruba o sistema para a escola inteira.
echo.
echo   Esta opcao registra o Gestao no Windows para ele:
echo     - subir sozinho quando o PC liga, antes de alguem fazer login
echo     - rodar escondido, sem janela para fechar por engano
echo     - voltar sozinho se travar (tenta 3 vezes, de minuto em minuto)
echo.
echo   O que sairia na janela passa a ser gravado em dados\servidor.log.
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

rem =====================================================================
rem  LIGAR
rem =====================================================================

rem ---------- a porta ja esta ocupada? ----------
rem  Se o Gestao.bat estiver aberto, ele ja segura a porta 8080. O servico
rem  subiria por cima, nao conseguiria a porta e morreria -- e o netstat
rem  continuaria mostrando alguem escutando, entao eu diria "deu certo"
rem  olhando para o processo errado. Melhor exigir a porta livre.
set "OCUPADA="
for /f "tokens=*" %%l in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING" 2^>nul') do set "OCUPADA=%%l"
if defined OCUPADA goto ocupada

rem ---------- onde esta o node ----------
set "NODE="
for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE set "NODE=%%n"
if not defined NODE (
  echo   Nao encontrei o Node.js neste PC. Instale pelo https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo   Node encontrado em: !NODE!

if not exist "%~dp0src\servidor.js" (
  echo.
  echo   Este arquivo esta na pasta errada.
  echo.
  echo   Ele esta em:
  echo       %~dp0
  echo   e nao ha um src\servidor.js aqui.
  echo.
  echo   Provavelmente e uma copia solta. Apague ela e use o
  echo   "Rodar sem janela.bat" que fica junto do src e do package.json.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0dados" mkdir "%~dp0dados"

rem ---------- o lancador ----------
rem
rem  Este .cmd existe por um motivo concreto. A versao antiga enfiava o
rem  comando inteiro dentro do /tr do schtasks, com \" no meio. O schtasks
rem  le os argumentos pela regra do C, onde a barra invertida escapa a aspa
rem  seguinte -- e o caminho da pasta ja termina em barra. O \" do fim virava
rem  barra literal mais fim de aspas, e o schtasks recebia so
rem  "cmd /c cd /d C:\Gestao\", jogando fora o resto da linha: o node, o
rem  servidor.js, o log. A tarefa nascia truncada ou nem nascia.
rem
rem  Com o comando dentro de um .cmd proprio, o /tr vira um caminho simples
rem  e nao sobra nada para escapar.

echo   Gravando o lancador...
> "%SERVICO%" echo @echo off
>>"%SERVICO%" echo rem Gerado pelo "Rodar sem janela.bat". Nao edite na mao:
>>"%SERVICO%" echo rem e reescrito toda vez que o modo sem janela e ligado.
>>"%SERVICO%" echo chcp 65001 ^>nul
>>"%SERVICO%" echo cd /d "%~dp0."
>>"%SERVICO%" echo if not exist "%~dp0dados" mkdir "%~dp0dados"
>>"%SERVICO%" echo echo. ^>^> "%LOG%"
>>"%SERVICO%" echo echo ===== %%DATE%% %%TIME%% subindo ^>^> "%LOG%"
>>"%SERVICO%" echo "!NODE!" --experimental-sqlite --no-warnings "%~dp0src\servidor.js" ^>^> "%LOG%" 2^>^&1
>>"%SERVICO%" echo echo ===== %%DATE%% %%TIME%% parou, codigo %%ERRORLEVEL%% ^>^> "%LOG%"

if not exist "%SERVICO%" (
  echo   Nao consegui gravar o _servico.cmd nesta pasta.
  echo   Confira se a pasta nao esta somente leitura.
  echo.
  pause
  exit /b 1
)

rem ---------- registrar no Windows ----------
schtasks /query /tn "%TAREFA%" >nul 2>nul
if not errorlevel 1 (
  schtasks /end /tn "%TAREFA%" >nul 2>nul
  schtasks /delete /tn "%TAREFA%" /f >nul 2>nul
)

echo   Registrando no Windows...
schtasks /create /tn "%TAREFA%" /sc onstart /ru SYSTEM /rl HIGHEST /f /tr "\"%SERVICO%\""
if errorlevel 1 (
  echo.
  echo   Nao consegui registrar no Windows. A mensagem do erro esta logo
  echo   acima desta linha. Mande ela para quem acompanha o sistema.
  echo.
  pause
  exit /b 1
)

rem ---------- ajustes que o schtasks sozinho nao faz ----------
rem  Sem isto o Windows mata a tarefa depois de 72 horas, que e o limite
rem  padrao. O sistema cairia sozinho no meio da semana, sem motivo aparente.
echo   Ajustando os detalhes (sem limite de 72h, volta sozinho se travar)...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $t=Get-ScheduledTask -TaskName '%TAREFA%'; $t.Settings.ExecutionTimeLimit='PT0S'; $t.Settings.RestartInterval='PT1M'; $t.Settings.RestartCount=3; $t.Settings.DisallowStartIfOnBatteries=$false; $t.Settings.StopIfGoingOnBatteries=$false; $t.Settings.MultipleInstances='IgnoreNew'; Set-ScheduledTask -InputObject $t | Out-Null" 2>nul
if errorlevel 1 echo   (nao consegui ajustar; a tarefa funciona, mas o Windows pode pausar depois de 72h)

rem ---------- ligar e conferir de verdade ----------
echo   Ligando...
schtasks /run /tn "%TAREFA%" >nul 2>nul

rem  Espera ate 20s pelo servidor. Laco com goto, e nao com bloco ( ):
rem  dentro de bloco o ^| do for /f ja nos pregou peca antes.
set /a TENTATIVA=0

:esperando
set "ESCUTANDO="
for /f "tokens=*" %%l in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING" 2^>nul') do set "ESCUTANDO=%%l"
if defined ESCUTANDO goto subiu
set /a TENTATIVA+=1
if !TENTATIVA! geq 10 goto naosubiu
timeout /t 2 /nobreak >nul
goto esperando

:subiu

echo.
echo   =============================================
echo   Pronto. O sistema esta NO AR e sobe sozinho quando o PC liga.
echo.
echo   Pode fechar qualquer janela preta que esteja aberta.
echo   Nao use mais o Gestao.bat: o sistema ja esta rodando por tras.
echo.
echo   Enderecos:
echo       http://localhost:%PORTA%    ^(neste PC^)
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%j in ("%%i") do echo       http://%%j:%PORTA%    ^(nos outros PCs^)
)
echo.
echo   Se os outros PCs nao abrirem, rode o "Liberar na rede.bat".
echo.
echo   Antes de atualizar (Atualizar.bat), desligue pelo item [2] deste
echo   arquivo, atualize, e ligue de novo pelo item [1].
echo.
pause
exit /b 0

:ocupada
echo   A porta %PORTA% ja esta em uso.
echo.
echo   Quase certo que e a janela preta do Gestao.bat, aberta agora.
echo   Feche ela primeiro e rode este arquivo de novo.
echo.
echo   Motivo: o modo sem janela precisa da porta livre para pegar. Se eu
echo   ligar por cima, o servico morre sem a porta e eu ainda veria alguem
echo   escutando -- o processo antigo -- e te diria que deu certo.
echo.
echo   Quem esta segurando:
netstat -ano | findstr /r /c:":%PORTA% .*LISTENING"
echo.
pause
exit /b 1

:naosubiu
echo.
echo   =============================================
echo   A tarefa foi registrada, mas o sistema NAO subiu na porta %PORTA%.
echo.
echo   Ultimo resultado que o Windows guardou da tarefa:
powershell -NoProfile -Command "try{$i=Get-ScheduledTaskInfo -TaskName '%TAREFA%'; '      codigo ' + $i.LastTaskResult + '   (0 = sem erro)'}catch{'      nao consegui ler'}" 2>nul
echo.
if exist "%LOG%" (
  echo   Ultimas linhas do dados\servidor.log:
  echo   ---------------------------------------------
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 25" 2>nul
  echo   ---------------------------------------------
  echo.
  echo   O erro de verdade esta ai em cima.
) else (
  echo   O log nem chegou a ser criado, entao o Windows nao rodou o
  echo   lancador. Confira se o arquivo abaixo existe e abre sozinho:
  echo       %SERVICO%
)
echo.
echo   Atalho para entender: abra o Gestao.bat. Ele mostra o mesmo erro
echo   na tela, sem precisar caçar no log.
echo.
pause
exit /b 1

rem =====================================================================
:remover
schtasks /query /tn "%TAREFA%" >nul 2>nul
if errorlevel 1 (
  echo   O modo sem janela nao esta ligado.
  if exist "%SERVICO%" del /q "%SERVICO%"
  echo.
  pause
  exit /b 0
)
schtasks /end /tn "%TAREFA%" >nul 2>nul
schtasks /delete /tn "%TAREFA%" /f >nul 2>nul
timeout /t 2 >nul
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if not errorlevel 1 taskkill /im node.exe /f >nul 2>nul
if exist "%SERVICO%" del /q "%SERVICO%"
echo   Desligado. O sistema saiu do ar.
echo.
echo   Para ligar de novo, use o Gestao.bat ou o item [1] deste arquivo.
echo.
pause
exit /b 0

rem =====================================================================
:situacao
schtasks /query /tn "%TAREFA%" >nul 2>nul
if errorlevel 1 (
  echo   [x] O modo sem janela NAO esta registrado no Windows.
) else (
  echo   [ok] Tarefa registrada no Windows.
  powershell -NoProfile -Command "try{$t=Get-ScheduledTask -TaskName '%TAREFA%'; $i=Get-ScheduledTaskInfo -TaskName '%TAREFA%'; '        estado: ' + $t.State; '        ultimo resultado: ' + $i.LastTaskResult + '   (0 = sem erro)'; '        rodou em: ' + $i.LastRunTime}catch{}" 2>nul
)

set "ESCUTANDO="
for /f "tokens=*" %%l in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING" 2^>nul') do set "ESCUTANDO=%%l"
if defined ESCUTANDO (
  echo   [ok] Alguem escutando na porta %PORTA%. O sistema esta no ar.
  echo        http://localhost:%PORTA%
) else (
  echo   [x] Ninguem escutando na porta %PORTA%. O sistema esta fora do ar.
)

if exist "%SERVICO%" (
  echo   [ok] Lancador _servico.cmd no lugar.
) else (
  echo   [x] Falta o _servico.cmd. Rode a opcao [1] para gerar de novo.
)

if exist "%LOG%" (
  echo.
  echo   Ultimas linhas do dados\servidor.log:
  echo   ---------------------------------------------
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 15" 2>nul
  echo   ---------------------------------------------
)
echo.
pause
exit /b 0

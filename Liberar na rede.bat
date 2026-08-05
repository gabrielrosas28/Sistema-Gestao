@echo off
chcp 65001 >nul
setlocal
title Liberar o Gestao na rede da escola
cd /d "%~dp0"

set "REGRA=Gestao Santa Chiara"
set "PORTA=8080"

net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Este arquivo precisa ser aberto como administrador.
  echo.
  echo   Feche esta janela, clique com o botao direito no
  echo   "Liberar na rede.bat" e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)

echo.
echo   Liberar o Gestao na rede da escola
echo   =============================================
echo.
echo   Rode isto NO PC SERVIDOR, aquele onde o sistema esta instalado.
echo.
echo   O Firewall do Windows bloqueia conexoes vindas de outros
echo   computadores. E por isso que o sistema abre no proprio servidor
echo   (localhost) mas nao abre nas outras maquinas.
echo.
pause
echo.

netsh advfirewall firewall delete rule name="%REGRA%" >nul 2>nul
netsh advfirewall firewall add rule name="%REGRA%" dir=in action=allow protocol=TCP localport=%PORTA% profile=private,domain >nul
if errorlevel 1 (
  echo   Nao consegui criar a regra no firewall.
  pause
  exit /b 1
)

echo   Porta %PORTA% liberada para a rede local.
echo   (Somente redes privada e de dominio. Rede publica continua bloqueada,
echo    que e o certo: ninguem de fora da escola alcanca o sistema.)
echo.
echo   =============================================
echo   Enderecos para digitar no navegador dos outros PCs:
echo.
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%j in ("%%i") do echo     http://%%j:%PORTA%
)
echo.
echo   Se o PC tiver mais de um endereco acima, teste um por um: o certo
echo   e o da rede da escola, normalmente comecando com 192.168.
echo.
echo   Anote o que funcionar e salve nos favoritos de cada PC.
echo.
echo   Dica: peca a quem cuida da rede para fixar o IP deste servidor.
echo   Sem isso o numero pode mudar quando o PC reiniciar, e os favoritos
echo   param de funcionar.
echo.
pause

@echo off
chcp 65001 >nul
setlocal
title Instalacao do sistema Gestao - Colegio Santa Chiara
cd /d "%~dp0"

echo.
echo   Instalacao do sistema Gestao
echo   =============================================
echo.

rem ---------- 1. o Node esta instalado? ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   O Node.js nao esta instalado neste PC.
  echo.
  echo   1. Abra https://nodejs.org
  echo   2. Baixe a versao LTS e instale clicando em avancar
  echo   3. Rode este Instalar.bat de novo
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo   Node.js %NODEV% encontrado.
echo.

rem ---------- 2. a pasta esta no OneDrive? ----------
echo %CD% | find /i "OneDrive" >nul
if not errorlevel 1 (
  echo   PARE AQUI. Esta pasta esta dentro do OneDrive.
  echo.
  echo   O banco de dados nao pode ficar em pasta sincronizada: o OneDrive
  echo   copia o arquivo enquanto o sistema grava nele, e isso corrompe os
  echo   lancamentos de pagamento.
  echo.
  echo   O que fazer:
  echo     1. Copie a pasta "Sistema Gestao" para C:\Gestao
  echo     2. Rode o Instalar.bat de dentro de C:\Gestao
  echo.
  echo   O OneDrive continua util para guardar os backups.
  echo.
  pause
  exit /b 1
)

rem ---------- 3. componentes ----------
echo   Instalando os componentes. Isso leva um ou dois minutos...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
echo.

rem ---------- 4. turmas, calendario e alunos ----------
echo   =============================================
echo   Agora os alunos.
echo.
echo   Arraste para esta janela a planilha do gerador de boletins
echo   (Gerador de boletim - 2026.xlsx) e aperte Enter.
echo.
echo   Se ela ainda nao estiver neste PC, so aperte Enter: as turmas e o
echo   calendario entram do mesmo jeito, e os alunos ficam para depois.
echo.
set "PLANILHA="
set /p PLANILHA=  Planilha:
echo.
echo   Importando turmas, calendario letivo e alunos...
echo.
call npm run importar -- %PLANILHA%
if errorlevel 1 goto erro
echo.

rem ---------- 5. primeiro acesso ----------
echo   =============================================
echo   Agora crie o primeiro acesso, que sera da coordenacao.
echo   Essa pessoa podera cadastrar as demais pelo proprio sistema.
echo.
set /p NOME=  Nome completo:
set /p EMAIL=  E-mail:
set /p SENHA=  Senha (minimo 8 letras):
echo.
call npm run criar-usuario -- "%NOME%" "%EMAIL%" "%SENHA%" coordenacao

echo.
echo   =============================================
echo   Pronto.
echo.
echo   Para ligar o sistema, use o arquivo Gestao.bat.
echo.
pause
exit /b 0

:erro
echo.
echo   Algo deu errado no passo acima. Mande o texto desta janela
echo   para quem esta acompanhando a instalacao.
echo.
pause
exit /b 1

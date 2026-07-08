@echo off
:: Entra na pasta onde o arquivo está (garante que achou o setup.ps1)
cd /d "%~dp0"

echo ==========================================
echo   INICIANDO INSTALADOR (MODO SEGURO)
echo ==========================================
echo.

:: Executa o script e mostra erros na tela
powershell -NoProfile -ExecutionPolicy Bypass -File "setup.ps1"

echo.
echo ==========================================
echo   FIM. SE DEU ERRO, LEIA ACIMA.
echo ==========================================
echo.
pause
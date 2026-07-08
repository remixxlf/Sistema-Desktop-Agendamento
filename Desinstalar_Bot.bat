@echo off
:: Entra na pasta onde o arquivo está
cd /d "%~dp0"

echo ==========================================
echo   DESINSTALANDO O SISTEMA DA BARBEARIA
echo ==========================================
echo.

:: Executa o script de desinstalação
powershell -NoProfile -ExecutionPolicy Bypass -File "uninstall.ps1"

echo.
echo ==========================================
echo   FIM DA DESINSTALACAO.
echo ==========================================
echo.
pause

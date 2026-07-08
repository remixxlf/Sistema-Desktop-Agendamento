Write-Host "--- DESINSTALANDO O SISTEMA DA BARBEARIA ---" -ForegroundColor Red

# 1. Parar e remover o bot do gerenciador de processos (PM2)
Write-Host "Parando e desligando o servidor em segundo plano (PM2)..." -ForegroundColor Yellow
cmd /c "pm2 stop barbearia-monolito" 2>$null
cmd /c "pm2 delete barbearia-monolito" 2>$null
cmd /c "pm2 save --force" 2>$null

# 2. Remover a inicialização automática do Windows
Write-Host "Removendo a auto-inicializacao com o Windows..." -ForegroundColor Yellow
cmd /c "pm2 unstartup" 2>$null

# 3. Limpar os arquivos pesados de dependências
Write-Host "Apagando a pasta node_modules (arquivos pesados)..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules"
}
if (Test-Path "package-lock.json") {
    Remove-Item -Force "package-lock.json"
}

Write-Host "--- SUCESSO! O SISTEMA FOI DESLIGADO E DESINSTALADO ---" -ForegroundColor Green
Write-Host " "
Write-Host "NOTA DE SEGURANCA:" -ForegroundColor Cyan
Write-Host "Seus agendamentos (banco.db) e suas configuracoes (.env) NAO foram apagados." -ForegroundColor Cyan
Write-Host "Isso foi feito para garantir que voce nao perca dados sem querer." -ForegroundColor Cyan
Write-Host "Se voce quiser apagar TUDO definitivamente, pode deletar esta pasta manualmente no Windows." -ForegroundColor Cyan

Write-Host "--- INICIANDO INSTALACAO DO SISTEMA BARBEARIA (OFFLINE DB) ---" -ForegroundColor Cyan

# 1. Verificando Node.js
try {
    $nodeVersion = node -v
    Write-Host "Node.js detectado: $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "Node.js nao encontrado. Baixando..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi" -OutFile "node_installer.msi"
    Start-Process -FilePath "msiexec.exe" -ArgumentList "/i node_installer.msi /quiet /norestart" -Wait
    Write-Host "Node instalado. REINICIE o computador e rode de novo." -ForegroundColor Red
    Remove-Item "node_installer.msi"
    Read-Host "Pressione Enter para sair..."
    exit
}

# 2. Instalando Dependencias
Write-Host "Instalando bibliotecas do sistema unificado..." -ForegroundColor Cyan
cmd /c "npm install"
cmd /c "npm install pm2 -g"

# 3. Configurando Variaveis de Ambiente (.env)
if (-not (Test-Path ".env")) {
    Write-Host "CONFIGURACAO DO SISTEMA" -ForegroundColor Yellow
    
    $numeroDono = Read-Host "Digite o numero de WhatsApp do Dono (55 + DDD + Numero)"
    $numeroDono = $numeroDono -replace "[^0-9]", ""
    $numeroFormatado = $numeroDono + "@c.us"
    
    $linha1 = "NUMERO_DONO=$numeroFormatado"
    
    Set-Content ".env" $linha1
    
    Write-Host "Arquivo .env criado com sucesso." -ForegroundColor Green
} else {
    Write-Host "Arquivo .env ja existe, pulando configuracao inicial." -ForegroundColor Green
}

# 4. Iniciando o Sistema (Web + Bot) via PM2
Write-Host "Ligando o Servidor Web e o Robo do WhatsApp..." -ForegroundColor Cyan
cmd /c "pm2 delete all" 2>$null
cmd /c "pm2 start index.js --name barbearia-monolito"
cmd /c "pm2 save"

Write-Host "Configurando startup..."
try {
    cmd /c "pm2 startup"
} catch {
    Write-Host "Startup manual necessario se falhar."
}

Write-Host "--- SUCESSO! ---" -ForegroundColor Green
Write-Host "O painel web e o bot estao rodando."
Write-Host "Para ver o link publico do localtunnel gerado, abra um novo terminal e digite: pm2 logs"
Read-Host "Pressione Enter para fechar..."
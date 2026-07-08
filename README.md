# 📅 Gestor de Agendamentos — Sistema White-Label via WhatsApp

Aplicativo Desktop profissional para gestão de agendamentos via WhatsApp. Desenvolvido com **Electron**, **Express.js** e **Venom-Bot**. 100% local, sem custos de nuvem.

---

## ✨ Funcionalidades

- 🤖 **Robô de WhatsApp** que agenda clientes automaticamente, 24h por dia
- 🖥️ **Painel Web** (calendário) para o dono visualizar todos os agendamentos do mês
- ⚙️ **Configurações Dinâmicas**: altere nome do estabelecimento, serviços e horários direto no painel, sem mexer em código
- 📦 **Banco de Dados Local** (sem assinatura em nuvem)
- 🌐 **Link Público Gratuito** via Localtunnel para clientes acessarem o painel
- 🍎 **Interface estilo Apple** (glassmorphism, macOS style)

---

## 🚀 Como Instalar (para Usuário Final)

Vá até a seção [**Releases**](../../releases) deste repositório e baixe o arquivo:

```
Gestor de Agendamentos Setup 1.0.0.exe
```

Dê dois cliques e o instalador vai configurar tudo automaticamente no seu Windows, criando um atalho na Área de Trabalho.

---

## 🛠️ Como Rodar em Modo Desenvolvedor

**Pré-requisitos:** Node.js 18+ instalado.

```bash
# 1. Clone o repositório
git clone https://github.com/remixxlf/Sistema-Desktop-Agendamento.git

# 2. Entre na pasta
cd Sistema-Desktop-Agendamento

# 3. Instale as dependências
npm install

# 4. Inicie o aplicativo
npm start
```

---

## 📦 Como Gerar o Instalador .exe

```bash
npm run build
```

O instalador será gerado na pasta `dist/`.

---

## ⚙️ Configuração Inicial

Na primeira execução, o sistema iniciará com nome genérico `"Meu Estabelecimento"`. Para personalizar:

1. Abra o aplicativo e clique em **"Abrir Painel de Agendamentos"**
2. Clique no botão **⚙️ Configurações**
3. Altere o **Nome do Estabelecimento**, os **Serviços** e os **Horários**
4. Aponte o celular para o QR Code exibido na tela do aplicativo

---

## 🏗️ Arquitetura

```
├── main.js          # Janela do Electron (Desktop)
├── index.js         # Servidor Express + Venom-Bot + Banco de Dados
├── gui/
│   ├── index.html   # Interface do aplicativo (estilo Apple)
│   └── preload.js   # Ponte segura entre frontend e backend
└── public/
    ├── index.html   # Painel Web de Agendamentos
    └── script.js    # Lógica do painel (calendário, configurações)
```

---

## 📄 Licença

Projeto White-Label — personalize e distribua livremente.

// Carrega as variáveis de ambiente do arquivo .env (ex: NUMERO_DONO)
require('dotenv').config();

// Importamos as ferramentas que o nosso servidor vai usar
const express = require('express');           // Servidor web (o painel)
const localtunnel = require('localtunnel');   // Cria um link público para o painel
const qrcode = require('qrcode');             // Converte texto do QR em imagem
const fs = require('fs');                     // Para ler e escrever arquivos no disco
const path = require('path');                 // Para montar caminhos de pasta com segurança
const alasql = require('alasql');             // Banco de dados leve em JavaScript puro

// Importamos a nova biblioteca do WhatsApp (mais estável que o venom-bot)
// - Client: O robô do WhatsApp em si
// - LocalAuth: Estratégia para salvar a sessão localmente (não precisa ler QR toda vez)
const { Client, LocalAuth } = require('whatsapp-web.js');

// Importa o módulo app do Electron para acessar a pasta correta de dados do usuário
const { app: electronApp } = require('electron');

// Esta função principal recebe a janela do Electron para poder mandar atualizações para a tela
module.exports = async function startApp(mainWindow) {

    // Função auxiliar para enviar mensagens de status para a interface visual
    // Tipo pode ser: 'express', 'tunnel', 'bot', 'nome-negocio'
    const notificarUI = (tipo, mensagem) => {
        if (mainWindow) mainWindow.webContents.send('update-status', { type: tipo, msg: mensagem });
    };

    // =========================================================================
    // 1. CONFIGURAÇÕES INICIAIS DO BANCO LOCAL (PURO JAVASCRIPT COM ALASQL)
    // Usamos AlaSQL para não precisar instalar nada extra como MySQL ou Postgres.
    // Usamos a pasta "userData" do Electron, que garante persistência e leitura/escrita
    // no executável compilado, pois a pasta padrão do app fica como Read-Only.
    // =========================================================================
    const appDataPath = electronApp.getPath('userData');
    const DB_FILE = path.join(appDataPath, 'banco.json');

    // Cria as "tabelas" do banco de dados na memória RAM (rápido!)
    alasql('CREATE TABLE IF NOT EXISTS agendamentos (id INT AUTO_INCREMENT, cliente_telefone STRING, cliente_nome STRING, data_hora STRING, servico STRING)');
    alasql('CREATE TABLE IF NOT EXISTS servicos (id INT AUTO_INCREMENT, nome STRING, preco STRING)');
    alasql('CREATE TABLE IF NOT EXISTS configuracoes (id INT AUTO_INCREMENT, chave STRING UNIQUE, valor STRING)');

    // Se o arquivo banco.json já existir, carregamos os dados dele para a memória
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (data.agendamentos) alasql.tables.agendamentos.data = data.agendamentos;
            if (data.servicos) alasql.tables.servicos.data = data.servicos;
            if (data.configuracoes) alasql.tables.configuracoes.data = data.configuracoes;

            // Restaura o contador de IDs para continuar de onde parou
            if (data.agendamentos && data.agendamentos.length > 0) alasql.tables.agendamentos.ident = Math.max(...data.agendamentos.map(i => i.id));
            if (data.servicos && data.servicos.length > 0) alasql.tables.servicos.ident = Math.max(...data.servicos.map(i => i.id));
            if (data.configuracoes && data.configuracoes.length > 0) alasql.tables.configuracoes.ident = Math.max(...data.configuracoes.map(i => i.id));
        }
    } catch (e) {
        console.error("Erro ao carregar banco JSON:", e);
    }

    // Insere dados padrão genéricos se o banco estiver vazio (primeira vez que roda)
    if (alasql.tables.servicos.data.length === 0) {
        alasql("INSERT INTO servicos (nome, preco) VALUES ('Serviço Exemplo 1', '50,00')");
        alasql("INSERT INTO servicos (nome, preco) VALUES ('Serviço Exemplo 2', '30,00')");
    }
    if (alasql.tables.configuracoes.data.length === 0) {
        alasql("INSERT INTO configuracoes (chave, valor) VALUES ('horarios', '09:00,09:30,10:00,10:30,11:00,11:30,13:30,14:00,14:30,15:00,15:30,16:00,16:30,17:00,17:30,18:00,18:30,19:00')");
        alasql("INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', 'Meu Estabelecimento')");
    } else if (!alasql('SELECT * FROM configuracoes WHERE chave = ?', ['nome_negocio'])[0]) {
        alasql("INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', 'Meu Estabelecimento')");
    }

    // Função que salva os dados da memória de volta para o arquivo banco.json no disco
    const saveDb = () => {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            agendamentos: alasql.tables.agendamentos.data,
            servicos: alasql.tables.servicos.data,
            configuracoes: alasql.tables.configuracoes.data
        }, null, 2));
    };
    saveDb(); // Salva o estado inicial

    // Funções auxiliares para interagir com o banco de forma mais simples
    const dbAll = async (sql, params = []) => alasql(sql, params);                              // Retorna várias linhas
    const dbRun = async (sql, params = []) => { alasql(sql, params); saveDb(); };               // Executa e salva
    const dbGet = async (sql, params = []) => alasql(sql, params)[0];                           // Retorna apenas uma linha

    // Número do dono da barbearia no formato do WhatsApp (DDI + DDD + Numero + @c.us)
    const NUMERO_DONO = process.env.NUMERO_DONO || '557582194736@c.us';

    // Objeto que guarda o "estado" de cada cliente na conversa (em qual etapa do fluxo ele está)
    const userStages = {};

    // =========================================================================
    // 2. INICIANDO O SERVIDOR WEB (EXPRESS) E A API DO PAINEL
    // =========================================================================
    const app = express();
    const PORTA = 3000;

    // Serve os arquivos estáticos da pasta 'public' (o painel web HTML/CSS/JS)
    app.use(express.static(path.join(__dirname, 'public')));
    // Permite que o servidor entenda JSON nas requisições
    app.use(express.json());

    // --- ROTAS DA API ---

    // Busca agendamentos por intervalo de datas
    app.get('/api/agendamentos', async (req, res) => {
        const { inicio, fim } = req.query;
        try {
            const rows = await dbAll(`SELECT * FROM agendamentos WHERE data_hora >= ? AND data_hora <= ? ORDER BY data_hora ASC`, [`${inicio} 00:00:00`, `${fim} 23:59:59`]);
            const formatados = rows.map(ag => {
                const partes = ag.data_hora.split(' ');
                return { id: ag.id, data: partes[0], hora: partes[1], cliente_nome: ag.cliente_nome, cliente_telefone: ag.cliente_telefone, servico: ag.servico || 'Não informado' };
            });
            res.json(formatados);
        } catch (err) { res.status(500).json({ error: 'Erro no servidor' }); }
    });

    // Busca todos os serviços
    app.get('/api/servicos', async (req, res) => {
        try { res.json(await dbAll(`SELECT * FROM servicos`)); }
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Adiciona um novo serviço
    app.post('/api/servicos', async (req, res) => {
        const { nome, preco } = req.body;
        try { await dbRun(`INSERT INTO servicos (nome, preco) VALUES (?, ?)`, [nome, preco]); res.json({ success: true }); }
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Apaga um serviço pelo ID
    app.delete('/api/servicos/:id', async (req, res) => {
        try { await dbRun(`DELETE FROM servicos WHERE id = ?`, [parseInt(req.params.id)]); res.json({ success: true }); }
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Busca os horários de funcionamento configurados
    app.get('/api/configuracoes/horarios', async (req, res) => {
        try {
            const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'horarios'`);
            res.json({ horarios: row ? row.valor.split(',') : [] });
        } catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Salva os horários de funcionamento
    app.post('/api/configuracoes/horarios', async (req, res) => {
        const { horarios } = req.body;
        try { await dbRun(`UPDATE configuracoes SET valor = ? WHERE chave = 'horarios'`, [horarios.join(',')]); res.json({ success: true }); }
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Busca o nome do estabelecimento
    app.get('/api/configuracoes/nome', async (req, res) => {
        try {
            const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`);
            res.json({ nome: row ? row.valor : '' });
        } catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Salva o nome do estabelecimento e notifica a janela do Electron para atualizar o título
    app.post('/api/configuracoes/nome', async (req, res) => {
        const { nome } = req.body;
        try {
            const existe = await dbGet(`SELECT * FROM configuracoes WHERE chave = 'nome_negocio'`);
            if (existe) { await dbRun(`UPDATE configuracoes SET valor = ? WHERE chave = 'nome_negocio'`, [nome]); }
            else { await dbRun(`INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', ?)`, [nome]); }
            if (mainWindow) notificarUI('nome-negocio', nome);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    // Inicia o servidor e, depois de pronto, cria o link público com localtunnel
    app.listen(PORTA, async () => {
        notificarUI('express', `Online na porta ${PORTA}`);
        // Envia o nome do estabelecimento para a janela do Electron assim que o servidor liga
        try {
            const rowNome = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`);
            if (rowNome && rowNome.valor) notificarUI('nome-negocio', rowNome.valor);
        } catch (e) {}
        // Cria um endereço público temporário para que clientes possam acessar o painel
        try {
            const tunnel = await localtunnel({ port: PORTA });
            notificarUI('tunnel', tunnel.url);
        } catch (erro) {
            notificarUI('tunnel', 'Falha ao criar link público');
        }
    });

    // =========================================================================
    // 3. INICIANDO O ROBÔ DO WHATSAPP (WHATSAPP-WEB.JS)
    // =========================================================================

    // Criamos o robô usando LocalAuth para salvar a sessão
    // Usamos o appDataPath para garantir que não será perdido no executável final
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'gestor-bot',
            dataPath: path.join(appDataPath, 'whatsapp_session')
        }),
        puppeteer: {
            // headless: true significa que o navegador roda invisível (sem janela)
            headless: true,
            // Apontamos diretamente para o Chrome já instalado no Windows do usuário.
            // Isso evita a necessidade de baixar o Chromium de novo e previne erros de download corrompido!
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: [
                '--no-sandbox',              // Necessário para rodar dentro do Electron
                '--disable-setuid-sandbox',  // Segurança desativada para ambiente local
                '--disable-dev-shm-usage',   // Evita travamentos em PCs com pouca memória
            ]
        }
    });

    // EVENTO: QR Code gerado
    // Dispara quando o WhatsApp pede para o usuário escanear o código com o celular.
    // O 'qr' aqui é uma string de texto (não uma imagem ainda).
    client.on('qr', async (qr) => {
        console.log('QR Code gerado! Convertendo para imagem...');
        try {
            // Usamos a biblioteca 'qrcode' para converter o texto numa imagem Base64
            // que a nossa interface pode mostrar diretamente na tag <img>
            const qrBase64 = await qrcode.toDataURL(qr);
            if (mainWindow) {
                // Enviamos a imagem via IPC para a janela do Electron
                mainWindow.webContents.send('qr-code', qrBase64);
                notificarUI('bot', 'Aguardando leitura do QR Code...');
            }
        } catch (e) {
            console.error('Erro ao converter QR Code:', e);
        }
    });

    // EVENTO: Carregando (autenticado, mas iniciando)
    // Dispara enquanto o robô está carregando após a autenticação.
    client.on('loading_screen', (percent, message) => {
        notificarUI('bot', `Carregando: ${percent}% — ${message}`);
    });

    // EVENTO: Autenticado com sucesso
    // Dispara quando a sessão foi reconhecida (QR lido ou sessão salva encontrada).
    client.on('authenticated', () => {
        console.log('WhatsApp autenticado com sucesso!');
        notificarUI('bot', 'Autenticado! Conectando...');
    });

    // EVENTO: Pronto para usar (ready)
    // TRATAMENTO DA SESSÃO EXISTENTE: Se o robô já tem sessão salva,
    // este evento dispara sem precisar gerar QR Code.
    // A interface deve ouvir 'ONLINE' para sumir com a tela de loading.
    //
    // ⚠️ IMPORTANTE ANTI-SPAM:
    // Só marcamos o bot como pronto DEPOIS de carregar todo o histórico.
    // Isso evita problemas de relógio do PC dessincronizado (fuso horário).
    let isReady = false;
    client.on('ready', () => {
        isReady = true;
        console.log('Robô do WhatsApp está ONLINE e pronto para atender!');
        notificarUI('bot', 'ONLINE! Pronto para atender.');
    });

    // EVENTO: Desconectado
    // Dispara quando o robô perde a conexão (celular desconectado, sessão expirada, etc.)
    client.on('disconnected', (reason) => {
        console.log('WhatsApp desconectado:', reason);
        notificarUI('bot', `Desconectado: ${reason}. Reinicie o app.`);
    });

    // EVENTO: Mensagem recebida
    // Dispara toda vez que alguém manda uma mensagem para o número do robô.
    client.on('message', async (message) => {
        console.log(`[DEBUG] MENSAGEM RECEBIDA de ${message.from} | Tipo: ${message.type} | isGroup: ${message.isGroupMsg} | fromMe: ${message.fromMe}`);

        // ====================================================================
        // 🛡️ FILTROS DE SEGURANÇA - Essas verificações impedem o bot de
        // responder mensagens indevidas ou do histórico.
        // ====================================================================

        // FILTRO 1: Ignora mensagens de grupos, transmissões e status.
        if (message.from === 'status@broadcast' || message.isGroupMsg) return;

        // FILTRO 2: Ignora mensagens enviadas PELO PRÓPRIO BOT.
        // A menos que seja o próprio dono tentando ver a agenda via "Message Yourself".
        const texto = message.body ? message.body.toLowerCase().trim() : '';
        if (message.fromMe && texto !== '/agenda') return;

        // FILTRO 3: ⭐ ANTI-REPLAY ⭐
        // Ignora todas as mensagens do histórico (antes do bot estar 'ready').
        // Evitamos usar message.timestamp porque o relógio do PC pode estar errado.
        if (!isReady) return;
        
        // ====================================================================


        // O nome salvo no WhatsApp de quem mandou
        const contact = await message.getContact();
        const nomeCliente = contact.pushname || contact.name || '';
        
        // Se for uma resposta de lista interativa, pegamos o ID da linha selecionada
        const selectedId = (message.type === 'list_response' && message._data && message._data.listResponse)
            ? message._data.listResponse.singleSelectReply.selectedRowId
            : null;
        
        // NORMALIZAÇÃO DE NÚMERO (Resolve o problema do @lid)
        // Se a mensagem vier de um dispositivo conectado (@lid), pegamos o número real do contato.
        // Assim, o banco de dados e a interface gráfica (UI) sempre verão o número de telefone correto.
        const user = contact.number ? `${contact.number}@c.us` : (message.fromMe ? message.to : message.from);

        console.log(`[BOT] Msg de ${user} | tipo: ${message.type} | texto: "${texto}" | selectedId: "${selectedId}"`);

        // Função auxiliar para enviar uma mensagem de texto
        const enviarMensagem = async (destino, textoMsg) => {
            try { await client.sendMessage(destino, textoMsg); } catch (e) { console.error('Erro ao enviar msg:', e); }
        };

        // Função que mostra o menu principal para o cliente
        const mostrarMenuPrincipal = async () => {
            // Busca o nome do estabelecimento do banco de dados para personalizar o menu
            let nomeNegocio = 'Estabelecimento';
            try {
                const rowNome = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`);
                if (rowNome && rowNome.valor) nomeNegocio = rowNome.valor;
            } catch (e) {}

            const saudacao = nomeCliente ? `Olá, ${nomeCliente}!` : 'Olá!';
            
            const msgMenu = 
`📅 *${nomeNegocio.toUpperCase()}* 📅

${saudacao} Como podemos te ajudar hoje?
Responda com o *NÚMERO* da opção desejada:

[ 1 ] 🗓️ Agendar Horário

[ 2 ] ❌ Meus Agendamentos

[ 3 ] 📍 Nossa Localização`;

            await enviarMensagem(user, msgMenu);
        };

        // --- FLUXO DE ATENDIMENTO AO CLIENTE ---
        // Garante que o cliente tem um estado inicial no fluxo
        if (!userStages[user]) userStages[user] = { stage: 'MENU' };

        try {
            // ETAPA: MENU PRINCIPAL
            if (userStages[user].stage === 'MENU') {
                // Verifica opção via lista interativa (id) OU texto digitado
                const escolhaMenu = selectedId || texto;

                if (escolhaMenu === 'menu_1' || texto === '1' || texto.includes('agendar')) {
                    // REGRA DE NEGÓCIO: Apenas 1 agendamento por semana (últimos 7 dias ou futuro)
                    const seteDiasAtras = new Date();
                    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
                    const limiteInferior = seteDiasAtras.toISOString().split('T')[0] + " 00:00:00";
                    
                    const agendamentosRecentes = await dbAll(`SELECT data_hora FROM agendamentos WHERE cliente_telefone = ? AND data_hora >= ? ORDER BY data_hora DESC`, [user, limiteInferior]);
                    
                    if (agendamentosRecentes.length > 0) {
                        const ultimoAg = agendamentosRecentes[0];
                        const partesData = ultimoAg.data_hora.split(' ')[0].split('-');
                        const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;
                        
                        await enviarMensagem(user, `⚠️ *Aviso: Limite de Agendamento*\n\nVocê já possui um agendamento recente ou futuro (Dia *${dataFormatada}*).\n\nPara garantir horário a todos, permitimos apenas *1 agendamento por semana*.\n\nSe precisar reagendar, cancele o seu horário atual na opção "Meus Agendamentos".`);
                        await mostrarMenuPrincipal();
                        return;
                    }

                    const servicos = await dbAll(`SELECT * FROM servicos`);
                    if (servicos.length === 0) {
                        await enviarMensagem(user, `⚠️ *Atenção:* Este estabelecimento ainda não cadastrou nenhum serviço.`);
                        return;
                    }
                    
                    let msgServicos = `💇‍♂️ *Nossos Serviços* 💇‍♂️\n\nQual serviço você deseja realizar?\nResponda com o *NÚMERO* da opção:\n\n`;
                    servicos.forEach((srv, i) => {
                        msgServicos += `[ ${i + 1} ] ${srv.nome} - *R$ ${srv.preco}*\n\n`;
                    });
                    
                    userStages[user] = { stage: 'ESCOLHENDO_SERVICO', listaServicos: servicos };
                    await enviarMensagem(user, msgServicos);
                }
                else if (escolhaMenu === 'menu_2' || texto === '2' || texto.includes('cancelar')) {
                    const hojeISO = new Date().toISOString().split('T')[0];
                    const meus = await dbAll(`SELECT * FROM agendamentos WHERE cliente_telefone = ? AND data_hora >= ? ORDER BY data_hora ASC`, [user, `${hojeISO} 00:00:00`]);
                    if (meus.length === 0) {
                        await enviarMensagem(user, '🤷‍♂️ Sem agendamentos marcados.');
                        await mostrarMenuPrincipal();
                    } else {
                        let msgCancel = '🧐 *Seus Agendamentos:*\n\n';
                        meus.forEach((ag, i) => {
                            const partes = ag.data_hora.split(' ');
                            const dataAgendada = partes[0].split('-').reverse().join('/');
                            const horaAgendada = partes[1].slice(0, 5);
                            msgCancel += `[ ${i + 1} ] 🗓️ Dia ${dataAgendada} às ${horaAgendada}\n      ✂️ ${ag.servico}\n\n`;
                        });
                        msgCancel += '👉 Digite o *NÚMERO* que deseja cancelar ou digite *"voltar"*.';
                        
                        userStages[user] = { stage: 'CANCELANDO', lista: meus };
                        await enviarMensagem(user, msgCancel);
                    }
                }
                else if (escolhaMenu === 'menu_3' || texto === '3' || texto.includes('endereco')) {
                    await enviarMensagem(user, `📍 Estamos localizados em:\n*(Configure o endereço nas configurações do sistema)*`);
                }
                else {
                    await mostrarMenuPrincipal();
                }
            }

            // ETAPA: CLIENTE ESTÁ ESCOLHENDO O SERVIÇO
            else if (userStages[user].stage === 'ESCOLHENDO_SERVICO') {
                let servicoEscolhido = null;
                const lista = userStages[user].listaServicos;

                if (texto === 'voltar' || texto === 'menu' || texto === 'cancelar') {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(); return;
                }
                
                // Resposta de lista: id no formato 'srv_<id>'
                if (selectedId && selectedId.startsWith('srv_')) {
                    const srvId = parseInt(selectedId.replace('srv_', ''));
                    servicoEscolhido = lista.find(s => s.id === srvId);
                } else {
                    const opcao = parseInt(texto);
                    if (!isNaN(opcao) && opcao >= 1 && opcao <= lista.length) {
                        servicoEscolhido = lista[opcao - 1];
                    } else {
                        servicoEscolhido = lista.find(s => texto === s.nome.toLowerCase().trim());
                    }
                }

                if (!servicoEscolhido) {
                    await enviarMensagem(user, `⚠️ *Opção inválida!* Escolha na lista ou digite o número correspondente.`); return;
                }

                const dataHoje = new Date();
                const diaAtual = dataHoje.getDate();
                const ultimoDiaMes = new Date(dataHoje.getFullYear(), dataHoje.getMonth() + 1, 0).getDate();

                let msgDias = `✅ Serviço: *${servicoEscolhido.nome}*\n\n🗓️ *Para qual dia deste mês?*\nDigite o *NÚMERO DO DIA* (Exemplo: *${diaAtual}*):\n\n`;
                for (let d = diaAtual; d <= ultimoDiaMes; d++) {
                    const label = d === diaAtual ? '(Hoje)' : d === diaAtual + 1 ? '(Amanhã)' : '';
                    msgDias += `👉 Dia *${d}* ${label}\n\n`;
                }

                await enviarMensagem(user, msgDias);
                userStages[user] = { stage: 'ESCOLHENDO_DIA', servico: servicoEscolhido.nome };
            }

            // ETAPA: CLIENTE ESTÁ ESCOLHENDO O DIA
            else if (userStages[user].stage === 'ESCOLHENDO_DIA') {
                if (['voltar', 'menu', 'cancelar'].includes(texto)) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(); return;
                }

                // Suporte a resposta de lista interativa no formato 'dia_N'
                let diaEscolhido;
                if (selectedId && selectedId.startsWith('dia_')) {
                    diaEscolhido = parseInt(selectedId.replace('dia_', ''));
                } else {
                    diaEscolhido = parseInt(texto);
                    if (isNaN(diaEscolhido) && texto.startsWith('dia ')) {
                        diaEscolhido = parseInt(texto.replace('dia ', ''));
                    }
                }

                const dataHoje = new Date();
                const diaAtual = dataHoje.getDate();
                const ultimoDiaMes = new Date(dataHoje.getFullYear(), dataHoje.getMonth() + 1, 0).getDate();

                if (isNaN(diaEscolhido) || diaEscolhido < diaAtual || diaEscolhido > ultimoDiaMes) {
                    await enviarMensagem(user, `⚠️ *Dia inválido!* Escolha um dia do mês atual.`); return;
                }

                const ano = dataHoje.getFullYear();
                const mes = String(dataHoje.getMonth() + 1).padStart(2, '0');
                const diaFormatado = String(diaEscolhido).padStart(2, '0');
                const dataCompleta = `${ano}-${mes}-${diaFormatado}`;

                // Verifica se o cliente já tem agendamento nesse dia
                const jaTem = await dbAll(`SELECT * FROM agendamentos WHERE cliente_telefone = ? AND data_hora >= ? AND data_hora <= ?`, [user, `${dataCompleta} 00:00:00`, `${dataCompleta} 23:59:59`]);
                if (jaTem.length > 0) {
                    const hCerta = jaTem[0].data_hora.split(' ')[1].slice(0, 5);
                    await enviarMensagem(user, `⚠️ Você já tem um horário marcado dia *${diaEscolhido}* às *${hCerta}*.`);
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(); return;
                }

                // Busca os horários disponíveis para o dia escolhido
                const rowHorarios = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'horarios'`);
                const horariosPadrao = rowHorarios && rowHorarios.valor ? rowHorarios.valor.split(',') : [];
                const ocupados = await dbAll(`SELECT data_hora FROM agendamentos WHERE data_hora >= ? AND data_hora <= ?`, [`${dataCompleta} 00:00:00`, `${dataCompleta} 23:59:59`]);
                const horasOcupadas = ocupados.map(item => item.data_hora.split(' ')[1].slice(0, 5));
                const livres = horariosPadrao.filter(h => !horasOcupadas.includes(h));

                if (livres.length === 0) {
                    await enviarMensagem(user, `❌ *Agenda Lotada* no dia ${diaEscolhido}. Escolha outro dia ou "voltar".`);
                } else {
                    let msgHoras = `✂️ *Dia ${diaEscolhido} — Qual horário?*\nResponda com o *NÚMERO* da opção desejada:\n\n`;
                    livres.forEach((h, i) => {
                        msgHoras += `[ ${i + 1} ] 🕒 *${h}*\n\n`;
                    });
                    
                    await enviarMensagem(user, msgHoras);
                    userStages[user] = { stage: 'ESCOLHENDO_HORARIO', dataEscolhida: dataCompleta, servico: userStages[user].servico, horariosValidos: livres };
                }
            }

            // ETAPA: CLIENTE ESTÁ ESCOLHENDO O HORÁRIO
            else if (userStages[user].stage === 'ESCOLHENDO_HORARIO') {
                if (['voltar', 'cancelar'].includes(texto)) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(); return;
                }

                const dataAgendamento = userStages[user].dataEscolhida;
                const servicoSelecionado = userStages[user].servico;
                const horariosValidos = userStages[user].horariosValidos;

                let horarioDigitado = null;
                const opcao = parseInt(texto);

                if (!isNaN(opcao) && opcao >= 1 && opcao <= horariosValidos.length) {
                    horarioDigitado = horariosValidos[opcao - 1];
                } else if (horariosValidos.includes(texto)) {
                    // Fallback se ele digitar a hora direto (ex: 14:30)
                    horarioDigitado = texto;
                }

                if (!horarioDigitado) {
                    await enviarMensagem(user, `⚠️ *Opção inválida!* Digite o *NÚMERO* da opção desejada (ou digite "voltar").`); return;
                }

                // Salva o agendamento no banco de dados
                await dbRun(`INSERT INTO agendamentos (cliente_telefone, cliente_nome, data_hora, servico) VALUES (?, ?, ?, ?)`,
                    [user, nomeCliente || 'Cliente', `${dataAgendamento} ${horarioDigitado}:00`, servicoSelecionado]);

                const dataPtBr = dataAgendamento.split('-').reverse().join('/');
                await enviarMensagem(user, `✅ *AGENDAMENTO CONFIRMADO!*\n\n📅 Serviço: *${servicoSelecionado}*\n⏰ *${dataPtBr}* às *${horarioDigitado}*\n\nTe esperamos lá! 🎉`);
                userStages[user] = { stage: 'MENU' };
            }

            // ETAPA: CLIENTE ESTÁ CANCELANDO UM AGENDAMENTO
            else if (userStages[user].stage === 'CANCELANDO') {
                const lista = userStages[user].lista;
                let agParaCancelar = null;

                if (selectedId && selectedId.startsWith('cancelar_')) {
                    const agId = parseInt(selectedId.replace('cancelar_', ''));
                    agParaCancelar = lista.find(ag => ag.id === agId);
                } else {
                    const opcao = parseInt(texto);
                    if (opcao > 0 && opcao <= lista.length) agParaCancelar = lista[opcao - 1];
                }

                if (agParaCancelar) {
                    await dbRun(`DELETE FROM agendamentos WHERE id = ?`, [agParaCancelar.id]);
                    await enviarMensagem(user, '✅ Agendamento cancelado com sucesso.');
                    userStages[user] = { stage: 'MENU' };
                } else if (texto.includes('voltar')) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal();
                } else {
                    await enviarMensagem(user, '⚠️ Opção inválida. Escolha na lista ou volte.');
                }
            }

        } catch (e) {
            console.log('❌ Erro no fluxo de conversa:', e);
        }
    });

    // Inicia o robô do WhatsApp (começa a conectar em segundo plano)
    // Este comando é não-bloqueante, ou seja, o servidor Express já está rodando enquanto isso.
    client.initialize();
}

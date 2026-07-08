require('dotenv').config();
const express = require('express');
const localtunnel = require('localtunnel');
const venom = require('venom-bot');
const fs = require('fs');
const path = require('path');
const alasql = require('alasql');

module.exports = async function startApp(mainWindow) {

    const notificarUI = (tipo, mensagem) => {
        if(mainWindow) mainWindow.webContents.send('update-status', { type: tipo, msg: mensagem });
    };

    // =========================================================================
    // 1. CONFIGURAÇÕES INICIAIS DO BANCO LOCAL (PURE JS COM ALASQL)
    // =========================================================================
    const DB_FILE = path.join(__dirname, 'banco.json');

    // Cria as tabelas em memória
    alasql('CREATE TABLE IF NOT EXISTS agendamentos (id INT AUTO_INCREMENT, cliente_telefone STRING, cliente_nome STRING, data_hora STRING, servico STRING)');
    alasql('CREATE TABLE IF NOT EXISTS servicos (id INT AUTO_INCREMENT, nome STRING, preco STRING)');
    alasql('CREATE TABLE IF NOT EXISTS configuracoes (id INT AUTO_INCREMENT, chave STRING UNIQUE, valor STRING)');

    // Carrega do arquivo se existir
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if(data.agendamentos) alasql.tables.agendamentos.data = data.agendamentos;
            if(data.servicos) alasql.tables.servicos.data = data.servicos;
            if(data.configuracoes) alasql.tables.configuracoes.data = data.configuracoes;
            
            // Atualizar o auto-increment
            if(data.agendamentos && data.agendamentos.length > 0) alasql.tables.agendamentos.ident = Math.max(...data.agendamentos.map(i=>i.id));
            if(data.servicos && data.servicos.length > 0) alasql.tables.servicos.ident = Math.max(...data.servicos.map(i=>i.id));
            if(data.configuracoes && data.configuracoes.length > 0) alasql.tables.configuracoes.ident = Math.max(...data.configuracoes.map(i=>i.id));
        }
    } catch(e) {
        console.error("Erro ao carregar banco JSON", e);
    }

    // Inicializa dados padrão se vazio
    // Serviços genéricos de exemplo
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

    // Função para salvar no disco
    const saveDb = () => {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            agendamentos: alasql.tables.agendamentos.data,
            servicos: alasql.tables.servicos.data,
            configuracoes: alasql.tables.configuracoes.data
        }, null, 2));
    };
    saveDb(); // Salva estado inicial

    // Polifils para manter compatibilidade com as rotas antigas
    const dbAll = async (sql, params = []) => alasql(sql, params);
    const dbRun = async (sql, params = []) => { alasql(sql, params); saveDb(); };
    const dbGet = async (sql, params = []) => alasql(sql, params)[0];

    const NUMERO_DONO = process.env.NUMERO_DONO || '557582194736@c.us'; 
    const userStages = {}; 

    // =========================================================================
    // 2. INICIANDO O SERVIDOR WEB (EXPRESS) E A API
    // =========================================================================
    const app = express();
    const PORTA = 3000;

    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());

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

    app.get('/api/servicos', async (req, res) => {
        try { const servicos = await dbAll(`SELECT * FROM servicos`); res.json(servicos); } 
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    app.post('/api/servicos', async (req, res) => {
        const { nome, preco } = req.body;
        try { await dbRun(`INSERT INTO servicos (nome, preco) VALUES (?, ?)`, [nome, preco]); res.json({ success: true }); } 
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    app.delete('/api/servicos/:id', async (req, res) => {
        try { await dbRun(`DELETE FROM servicos WHERE id = ?`, [parseInt(req.params.id)]); res.json({ success: true }); } 
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    app.get('/api/configuracoes/horarios', async (req, res) => {
        try { const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'horarios'`); res.json({ horarios: row ? row.valor.split(',') : [] }); } 
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    app.post('/api/configuracoes/horarios', async (req, res) => {
        const { horarios } = req.body; 
        try { await dbRun(`UPDATE configuracoes SET valor = ? WHERE chave = 'horarios'`, [horarios.join(',')]); res.json({ success: true }); } 
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    // Rotas de nome do negócio
    app.get('/api/configuracoes/nome', async (req, res) => {
        try { const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`); res.json({ nome: row ? row.valor : '' }); }
        catch (err) { res.status(500).json({ error: 'Erro' }); }
    });
    app.post('/api/configuracoes/nome', async (req, res) => {
        const { nome } = req.body;
        try {
            const existe = await dbGet(`SELECT * FROM configuracoes WHERE chave = 'nome_negocio'`);
            if (existe) { await dbRun(`UPDATE configuracoes SET valor = ? WHERE chave = 'nome_negocio'`, [nome]); }
            else { await dbRun(`INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', ?)`, [nome]); }
            if(mainWindow) notificarUI('nome-negocio', nome);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: 'Erro' }); }
    });

    app.listen(PORTA, async () => {
        notificarUI('express', `Online na porta ${PORTA}`);
        // Enviar o nome do negócio ao abrir o aplicativo
        try {
            const rowNome = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`);
            if (rowNome && rowNome.valor) notificarUI('nome-negocio', rowNome.valor);
        } catch(e) {}
        try {
            const tunnel = await localtunnel({ port: PORTA });
            notificarUI('tunnel', tunnel.url);
        } catch (erro) {
            notificarUI('tunnel', 'Falha ao criar link público');
        }
    });

    // =========================================================================
    // 3. INICIANDO O ROBÔ DO WHATSAPP (VENOM-BOT)
    // =========================================================================
    // A função venom.create inicia um navegador invisível (Chromium) em segundo plano.
    // É por isso que demora um pouquinho na primeira vez (ele pode estar baixando o navegador).
    venom.create(
        // Nome da sessão. O venom vai criar uma pasta 'tokens/barbearia-bot' para salvar a autenticação.
        'barbearia-bot',
        
        // 1º Callback: Evento de QR Code ('qr' no whatsapp-web.js, 'catchQR' no venom)
        // Isso dispara sempre que o WhatsApp pede para o usuário escanear o QR Code.
        (base64Qr, asciiQR, attempts, urlCode) => {
            console.log('Gerou QR Code!'); // Ajuda no debug do console do node
            // Checa se a janela do Electron (Front-end) já existe
            if(mainWindow) {
                // Envia a imagem do QR Code em formato Base64 para a interface via IPC (canal 'qr-code')
                mainWindow.webContents.send('qr-code', base64Qr);
                // Atualiza o texto lateral da tela
                notificarUI('bot', 'Aguardando Leitura do QR Code...');
            }
        },
        
        // 2º Callback: Atualização de Status da Sessão (statusFind)
        // Dispara quando o robô conecta, desconecta ou precisa de autenticação.
        (statusSession, session) => {
            console.log('Status da Sessão:', statusSession);
            // Isso envia eventos como 'isLogged', 'inChat' para a interface (onde removemos a tela de loading)
            notificarUI('bot', 'Status: ' + statusSession);
        },
        
        // Configurações extras do robô (não mostrar o QR feio no terminal, rodar invisível)
        { headless: 'new', logQR: false }
    )
    .then((client) => startWhatsApp(client))
    .catch((erro) => console.log('❌ Erro fatal no WhatsApp:', erro));

    function startWhatsApp(client) {
      notificarUI('bot', 'ONLINE! Pronto para atender.');

      const enviarMensagem = async (destino, texto) => {
        try { await client.sendText(destino, texto); } catch (e) {}
      };

      const mostrarMenuPrincipal = async (user, nomeCliente) => {
        // Busca o nome do estabelecimento dinamicamente
        let nomeNegocio = 'Estabelecimento';
        try {
            const rowNome = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'`);
            if (rowNome && rowNome.valor) nomeNegocio = rowNome.valor;
        } catch(e) {}
        
        const saudacao = nomeCliente ? `Olá, ${nomeCliente}!` : 'Olá!';
        await enviarMensagem(user, `📅 *${nomeNegocio.toUpperCase()}* 📅\n\n${saudacao} Escolha uma opção:\n\n` +
          `🗓️ *1. Agendar Horário*\n❌ *2. Meus Agendamentos*\n📍 *3. Localização*\n\n✏️ _Digite o número._`);
      };

      client.onAnyMessage(async (message) => {
        if (message.isGroupMsg || message.from === 'status@broadcast' || message.type !== 'chat') return;

        let user = message.from; 
        const texto = message.body ? message.body.toLowerCase().trim() : ''; 
        const nomeCliente = message.sender?.pushname || ''; 

        if (user === NUMERO_DONO && (texto === 'agenda' || texto === 'relatorio')) {
            const hoje = new Date().toISOString().split('T')[0]; 
            await enviarMensagem(user, `🔄 *Buscando agenda...*`);
            const listaHoje = await dbAll(
                `SELECT * FROM agendamentos WHERE data_hora >= ? AND data_hora <= ? ORDER BY data_hora ASC`,
                [`${hoje} 00:00:00`, `${hoje} 23:59:59`]
            );
            if (listaHoje.length === 0) {
                await enviarMensagem(user, `📅 Ninguém na agenda de hoje.`);
            } else {
                let relatorio = `📅 *AGENDA DE HOJE* \n\n`;
                listaHoje.forEach(item => {
                    let horaCerta = item.data_hora.split(' ')[1].slice(0,5);
                    const zap = item.cliente_telefone.replace(/\D/g, ''); 
                    relatorio += `⏰ *${horaCerta}* - ${item.cliente_nome}\n✂️ ${item.servico}\n🔗 wa.me/${zap}\n\n`;
                });
                await enviarMensagem(user, relatorio);
            }
            return; 
        }

        if (!userStages[user]) userStages[user] = { stage: 'MENU' };

        try {
            if (userStages[user].stage === 'MENU') {
                if (texto === '1' || texto.includes('agendar')) {
                    const servicos = await dbAll(`SELECT * FROM servicos`);
                    if (servicos.length === 0) {
                        await enviarMensagem(user, `⚠️ *Atenção:* Este estabelecimento ainda não cadastrou nenhum serviço.`);
                        return;
                    }
                    
                    let msg = `📅 *Qual serviço você deseja?*\n\n`;
                    servicos.forEach((srv, i) => { msg += `*${i + 1}.* ${srv.nome} - R$ ${srv.preco}\n`; });
                    msg += `\n✏️ _Digite o NÚMERO da opção._`;
                    
                    userStages[user] = { stage: 'ESCOLHENDO_SERVICO', listaServicos: servicos };
                    await enviarMensagem(user, msg);
                }
                else if (texto === '2' || texto.includes('cancelar')) {
                    const hojeISO = new Date().toISOString().split('T')[0];
                    const meus = await dbAll(`SELECT * FROM agendamentos WHERE cliente_telefone = ? AND data_hora >= ? ORDER BY data_hora ASC`, [user, `${hojeISO} 00:00:00`]);
                    if (meus.length === 0) {
                        await enviarMensagem(user, '🤷‍♂️ Sem agendamentos marcados.');
                        await mostrarMenuPrincipal(user, nomeCliente);
                    } else {
                        let msg = '🧐 *Seus Agendamentos:*\n\n';
                        meus.forEach((ag, i) => {
                            let partes = ag.data_hora.split(' ');
                            let dataAgendada = partes[0].split('-').reverse().join('/');
                            let horaAgendada = partes[1].slice(0,5);
                            msg += `🗑️ *${i + 1}.* Dia ${dataAgendada} às ${horaAgendada} (${ag.servico})\n`;
                        });
                        msg += '\nDigite o *NÚMERO* para cancelar ou *"voltar"*.';
                        userStages[user] = { stage: 'CANCELANDO', lista: meus };
                        await enviarMensagem(user, msg);
                    }
                }
                else if (texto === '3' || texto.includes('endereco')) {
                    await enviarMensagem(user, `📍 Barbearia RBS\nAv. Maria Quiteria, 796`);
                }
                else {
                    await mostrarMenuPrincipal(user, nomeCliente);
                }
            }
            else if (userStages[user].stage === 'ESCOLHENDO_SERVICO') {
                const opcao = parseInt(texto);
                const lista = userStages[user].listaServicos;

                if (['voltar', 'menu', 'cancelar'].includes(texto)) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(user, nomeCliente); return;
                }

                if (isNaN(opcao) || opcao < 1 || opcao > lista.length) {
                    await enviarMensagem(user, `⚠️ *Opção inválida!* Digite o número correspondente.`); return;
                }

                const servicoEscolhido = lista[opcao - 1];
                const dataHoje = new Date();
                const diaAtual = dataHoje.getDate();
                const ultimoDiaMes = new Date(dataHoje.getFullYear(), dataHoje.getMonth() + 1, 0).getDate();
                
                let listaDias = '';
                for (let d = diaAtual; d <= ultimoDiaMes; d++) {
                    const label = d === diaAtual ? 'Hoje' : d === diaAtual + 1 ? 'Amanhã' : '';
                    listaDias += `👉 *${d}* ${label ? `(${label})` : ''}\n`;
                }

                await enviarMensagem(user, `✅ Serviço escolhido: *${servicoEscolhido.nome}*\n\n🗓️ *Para qual dia deste mês?*\n\n${listaDias}`);
                userStages[user] = { stage: 'ESCOLHENDO_DIA', servico: servicoEscolhido.nome };
            }
            else if (userStages[user].stage === 'ESCOLHENDO_DIA') {
                const diaEscolhido = parseInt(texto);
                const dataHoje = new Date();
                const diaAtual = dataHoje.getDate();
                const ultimoDiaMes = new Date(dataHoje.getFullYear(), dataHoje.getMonth() + 1, 0).getDate();

                if (['voltar', 'menu', 'cancelar'].includes(texto)) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(user, nomeCliente); return;
                }

                if (isNaN(diaEscolhido) || diaEscolhido < diaAtual || diaEscolhido > ultimoDiaMes) {
                    await enviarMensagem(user, `⚠️ *Dia inválido!*`); return;
                }

                const ano = dataHoje.getFullYear();
                const mes = String(dataHoje.getMonth() + 1).padStart(2, '0');
                const diaFormatado = String(diaEscolhido).padStart(2, '0');
                const dataCompleta = `${ano}-${mes}-${diaFormatado}`;

                const jaTem = await dbAll(`SELECT * FROM agendamentos WHERE cliente_telefone = ? AND data_hora >= ? AND data_hora <= ?`, [user, `${dataCompleta} 00:00:00`, `${dataCompleta} 23:59:59`]);
                if (jaTem.length > 0) {
                    let hCerta = jaTem[0].data_hora.split(' ')[1].slice(0,5);
                    await enviarMensagem(user, `⚠️ Você já tem corte marcado dia *${diaEscolhido}* às *${hCerta}*.`);
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(user, nomeCliente); return;
                }

                const rowHorarios = await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'horarios'`);
                let horariosPadrao = rowHorarios && rowHorarios.valor ? rowHorarios.valor.split(',') : [];

                const ocupados = await dbAll(`SELECT data_hora FROM agendamentos WHERE data_hora >= ? AND data_hora <= ?`, [`${dataCompleta} 00:00:00`, `${dataCompleta} 23:59:59`]);
                const horasOcupadas = ocupados.map(item => item.data_hora.split(' ')[1].slice(0,5));
                const livres = horariosPadrao.filter(h => !horasOcupadas.includes(h));

                if (livres.length === 0) {
                    await enviarMensagem(user, `❌ *Agenda Lotada* no dia ${diaEscolhido}.`);
                } else {
                    let listaVisual = '';
                    livres.forEach((h, i) => {
                        listaVisual += `• ${h}   `;
                        if ((i + 1) % 3 === 0) listaVisual += '\n'; 
                    });
                    await enviarMensagem(user, `✂️ *Dia ${diaEscolhido}:*\n\n${listaVisual}\n\n✍️ *Qual horário? (ex: 14:30)*`);
                    userStages[user] = { stage: 'ESCOLHENDO_HORARIO', dataEscolhida: dataCompleta, servico: userStages[user].servico, horariosValidos: livres };
                }
            }
            else if (userStages[user].stage === 'ESCOLHENDO_HORARIO') {
                const horarioDigitado = texto; 
                const dataAgendamento = userStages[user].dataEscolhida;
                const servicoSelecionado = userStages[user].servico;
                const horariosValidos = userStages[user].horariosValidos;
                
                if (['voltar', 'cancelar'].includes(horarioDigitado)) {
                    userStages[user] = { stage: 'MENU' };
                    await mostrarMenuPrincipal(user, nomeCliente); return;
                }

                if (!horariosValidos.includes(horarioDigitado)) {
                    await enviarMensagem(user, `⚠️ *Horário Indisponível ou Inválido!* Digite exatamente como está na lista.`); return;
                }

                try {
                    await dbRun(`INSERT INTO agendamentos (cliente_telefone, cliente_nome, data_hora, servico) VALUES (?, ?, ?, ?)`, [user, nomeCliente || 'Cliente', `${dataAgendamento} ${horarioDigitado}:00`, servicoSelecionado]);
                    const dataPtBr = dataAgendamento.split('-').reverse().join('/');
                    await enviarMensagem(user, `✅ *AGENDAMENTO CONFIRMADO!*\n\n💈 Serviço: *${servicoSelecionado}*\n📅 *${dataPtBr}* às *${horarioDigitado}*\n\nTe esperamos lá!`);
                    userStages[user] = { stage: 'MENU' };
                } catch (err) {
                    await enviarMensagem(user, '❌ Erro ao salvar no banco de dados.');
                }
            }
            else if (userStages[user].stage === 'CANCELANDO') {
                const opcao = parseInt(texto);
                const lista = userStages[user].lista;
                
                if (opcao > 0 && opcao <= lista.length) {
                    await dbRun(`DELETE FROM agendamentos WHERE id = ?`, [lista[opcao-1].id]);
                    await enviarMensagem(user, '✅ Agendamento cancelado com sucesso.');
                    userStages[user] = { stage: 'MENU' };
                } else {
                    if(texto.includes('voltar')) {
                        userStages[user] = { stage: 'MENU' };
                        await mostrarMenuPrincipal(user, nomeCliente);
                    } else {
                        await enviarMensagem(user, '⚠️ Opção inválida.');
                    }
                }
            }
        } catch (e) {
            console.log('❌ Erro no fluxo:', e);
        }
      });
    }
}

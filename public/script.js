// ================================================================
//  ESTADO DA APLICAÇÃO E REFERÊNCIAS DOM
// ================================================================
let agendamentosDoMes = [];   
let diaSelecionado    = null; 

const selectMes        = document.getElementById('selectMes');
const selectAno        = document.getElementById('selectAno');
const btnHoje          = document.getElementById('btnHoje');
const gradeDias        = document.getElementById('gradeDias');
const tituloCalendario = document.getElementById('tituloCalendario');
const tituloPainel     = document.getElementById('tituloPainel');
const areaDosCartoes   = document.getElementById('areaDosCartoes');

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// Elementos do Modal de Configuração
const btnConfig = document.getElementById('btnConfig');
const modalConfig = document.getElementById('modalConfig');
const btnFecharModal = document.getElementById('btnFecharModal');

const inputNomeServico = document.getElementById('inputNomeServico');
const inputPrecoServico = document.getElementById('inputPrecoServico');
const btnAddServico = document.getElementById('btnAddServico');
const listaServicosUl = document.getElementById('listaServicosUl');

const textareaHorarios = document.getElementById('textareaHorarios');
const btnSaveHorarios = document.getElementById('btnSaveHorarios');

const inputNomeNegocio = document.getElementById('inputNomeNegocio');
const btnSaveNome = document.getElementById('btnSaveNome');
const tituloCabecalho = document.getElementById('tituloCabecalho');

// ================================================================
//  INICIALIZAÇÃO DOS SELECTS
// ================================================================
function inicializarControles() {
  MESES.forEach((nome, i) => {
    const opt = document.createElement('option');
    opt.value       = i;     
    opt.textContent = nome;
    selectMes.appendChild(opt);
  });

  const anoAtual = new Date().getFullYear();
  for (let a = anoAtual - 3; a <= anoAtual + 2; a++) {
    const opt = document.createElement('option');
    opt.value       = a;
    opt.textContent = a;
    selectAno.appendChild(opt);
  }

  const hoje = new Date();
  selectMes.value = hoje.getMonth();
  selectAno.value = hoje.getFullYear();
}

// ================================================================
//  API DE AGENDAMENTOS
// ================================================================
async function buscarAgendamentosDoMes(ano, mes) {
  const mm     = String(mes + 1).padStart(2, '0');
  const inicio = `${ano}-${mm}-01`;
  const ultimo = new Date(ano, mes + 1, 0).getDate(); 
  const fim    = `${ano}-${mm}-${String(ultimo).padStart(2, '0')}`;
  
  try {
    const resposta = await fetch(`/api/agendamentos?inicio=${inicio}&fim=${fim}`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return await resposta.json();
  } catch (erro) {
    console.error('Erro ao buscar agendamentos:', erro);
    return [];
  }
}

// ================================================================
//  RENDERIZAÇÃO DO CALENDÁRIO
// ================================================================
function renderizarCalendario(ano, mes, agendamentos) {
  tituloCalendario.textContent = `${MESES[mes]} de ${ano}`;
  const contagemPorDia = {};
  agendamentos.forEach(ag => { contagemPorDia[ag.data] = (contagemPorDia[ag.data] || 0) + 1; });
  gradeDias.innerHTML = ''; 

  const mm          = String(mes + 1).padStart(2, '0');
  const primeiroDia = new Date(ano, mes, 1).getDay(); 
  const totalDias   = new Date(ano, mes + 1, 0).getDate();
  const hoje        = new Date();

  for (let i = 0; i < primeiroDia; i++) {
    const vazio = document.createElement('div');
    vazio.className = 'dia-celula vazio';
    gradeDias.appendChild(vazio);
  }

  for (let d = 1; d <= totalDias; d++) {
    const dd      = String(d).padStart(2, '0');
    const dataStr = `${ano}-${mm}-${dd}`;

    const celula = document.createElement('div');
    celula.className = 'dia-celula';
    
    if (d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear()) {
      celula.classList.add('hoje');
    }
    if (dataStr === diaSelecionado) celula.classList.add('ativo');

    const numDia = document.createElement('span');
    numDia.className   = 'num-dia';
    numDia.textContent = d;
    celula.appendChild(numDia);

    if (contagemPorDia[dataStr]) {
      const badge = document.createElement('span');
      badge.className   = 'qtd-badge';
      badge.textContent = contagemPorDia[dataStr];
      celula.appendChild(badge);
    }

    celula.addEventListener('click', () => selecionarDia(dataStr));
    gradeDias.appendChild(celula);
  }
}

function selecionarDia(dataStr) {
  diaSelecionado = dataStr;
  document.querySelectorAll('.dia-celula').forEach(el => el.classList.remove('ativo'));
  
  const diaNum = parseInt(dataStr.split('-')[2]);
  document.querySelectorAll('.dia-celula:not(.vazio)').forEach(el => {
    if (parseInt(el.querySelector('.num-dia')?.textContent) === diaNum) {
      el.classList.add('ativo');
    }
  });

  const agsDoDia = agendamentosDoMes.filter(ag => ag.data === dataStr);
  const dataFormatada = new Date(dataStr + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  tituloPainel.textContent = `Agendamentos — ${dataFormatada}`;
  renderizarListaAgendamentos(agsDoDia);
}

function renderizarListaAgendamentos(lista) {
  if (!lista.length) {
    areaDosCartoes.innerHTML = `<div class="estado-vazio"><span class="icone">🚫</span>Nenhum agendamento neste dia.</div>`;
    return;
  }
  
  const container = document.createElement('div');
  container.className = 'lista-agendamentos';
  
  lista.forEach(ag => {
    const hora = ag.hora ? ag.hora.substring(0, 5) : '--:--';
    const card = document.createElement('article');
    card.className = 'card-agendamento';
    card.innerHTML = `
      <div class="card-hora">${hora}</div>
      <div class="card-info">
        <div class="cliente">${ag.cliente_nome} <span style="color:#888; font-size:0.8rem">(${ag.cliente_telefone.split('@')[0]})</span></div>
        <div class="servico">${ag.servico}</div>
      </div>
    `;
    container.appendChild(card);
  });
  
  areaDosCartoes.innerHTML = '';
  areaDosCartoes.appendChild(container);
}

async function carregarMes() {
  const ano = parseInt(selectAno.value);
  const mes = parseInt(selectMes.value);
  diaSelecionado = null;
  tituloPainel.textContent = 'Selecione um dia no calendário';
  areaDosCartoes.innerHTML = `<div class="estado-vazio"><span class="icone">📅</span>Clique em um dia para listar os agendamentos.</div>`;
  gradeDias.innerHTML = `<p style="grid-column:span 7;text-align:center;color:#555;padding:2rem 0;">Carregando…</p>`;
  
  agendamentosDoMes = await buscarAgendamentosDoMes(ano, mes);
  renderizarCalendario(ano, mes, agendamentosDoMes);
}

// ================================================================
//  LÓGICA DO MODAL DE CONFIGURAÇÕES
// ================================================================

btnConfig.addEventListener('click', async () => {
    modalConfig.classList.add('ativo');
    await carregarConfiguracoes();
});

btnFecharModal.addEventListener('click', () => {
    modalConfig.classList.remove('ativo');
});

async function carregarConfiguracoes() {
    // 0. Carregar nome do negócio
    try {
        const res = await fetch('/api/configuracoes/nome');
        const data = await res.json();
        inputNomeNegocio.value = data.nome || '';
    } catch(e) { console.log(e); }

    // 1. Carregar Serviços
    listaServicosUl.innerHTML = '<li>Carregando...</li>';
    try {
        const res = await fetch('/api/servicos');
        const servicos = await res.json();
        listaServicosUl.innerHTML = '';
        if(servicos.length === 0) {
            listaServicosUl.innerHTML = '<li>Nenhum serviço cadastrado.</li>';
        } else {
            servicos.forEach(s => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${s.nome} - R$ ${s.preco}</span> <button class="btn-del" onclick="deletarServico(${s.id})">X</button>`;
                listaServicosUl.appendChild(li);
            });
        }
    } catch(e) { console.log(e); }

    // 2. Carregar Horários
    textareaHorarios.value = 'Carregando...';
    try {
        const res = await fetch('/api/configuracoes/horarios');
        const data = await res.json();
        textareaHorarios.value = data.horarios.join(',');
    } catch(e) { console.log(e); }

    // 3. Carregar Mensagens
    document.getElementById('msg_saudacao').value = 'Carregando...';
    document.getElementById('msg_sucesso').value = 'Carregando...';
    document.getElementById('msg_erro').value = 'Carregando...';
    document.getElementById('msg_limite_agendamento').value = 'Carregando...';
    try {
        const res = await fetch('/api/configuracoes/mensagens');
        const msgs = await res.json();
        document.getElementById('msg_saudacao').value = msgs.msg_saudacao || '';
        document.getElementById('msg_sucesso').value = msgs.msg_sucesso || '';
        document.getElementById('msg_erro').value = msgs.msg_erro || '';
        document.getElementById('msg_limite_agendamento').value = msgs.msg_limite_agendamento || '';
    } catch(e) { console.log(e); }
}

btnAddServico.addEventListener('click', async () => {
    const nome = inputNomeServico.value.trim();
    const preco = inputPrecoServico.value.trim();
    if(!nome || !preco) return alert('Preencha nome e preço!');
    
    await fetch('/api/servicos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, preco })
    });
    inputNomeServico.value = '';
    inputPrecoServico.value = '';
    carregarConfiguracoes();
});

async function deletarServico(id) {
    if(confirm('Apagar este serviço?')) {
        await fetch(`/api/servicos/${id}`, { method: 'DELETE' });
        carregarConfiguracoes();
    }
}

btnSaveHorarios.addEventListener('click', async () => {
    const texto = textareaHorarios.value;
    const array = texto.split(',').map(s => s.trim()).filter(s => s);
    
    await fetch('/api/configuracoes/horarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horarios: array })
    });
    alert('Horários salvos com sucesso!');
});

btnSaveNome.addEventListener('click', async () => {
    const nome = inputNomeNegocio.value.trim();
    if (!nome) return alert('Digite o nome do estabelecimento!');
    await fetch('/api/configuracoes/nome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome })
    });
    // Atualiza o cabeçalho da página em tempo real
    tituloCabecalho.textContent = '📅 ' + nome + ' — Agendamentos';
    document.title = nome + ' — Painel de Agendamentos';
    alert('Nome salvo com sucesso!');
});

// Salvar Textos Customizados
document.getElementById('btnSaveMensagens').addEventListener('click', async () => {
    const payloads = {
        msg_saudacao: document.getElementById('msg_saudacao').value,
        msg_sucesso: document.getElementById('msg_sucesso').value,
        msg_erro: document.getElementById('msg_erro').value,
        msg_limite_agendamento: document.getElementById('msg_limite_agendamento').value
    };

    await fetch('/api/configuracoes/mensagens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads)
    });
    alert('Respostas do robô salvas com sucesso!');
});

// Inserir Tag nas textareas
function inserirTag(idTextarea, tag) {
    const textarea = document.getElementById(idTextarea);
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
}


// ================================================================
//  INÍCIO
// ================================================================
selectMes.addEventListener('change', carregarMes);
selectAno.addEventListener('change', carregarMes);
btnHoje.addEventListener('click', () => {
  const hoje = new Date();
  selectMes.value = hoje.getMonth();
  selectAno.value = hoje.getFullYear();
  carregarMes();
});

inicializarControles();
carregarMes();

// Carregar nome do negócio no cabeçalho ao iniciar
(async () => {
  try {
    const res = await fetch('/api/configuracoes/nome');
    const data = await res.json();
    if (data.nome) {
      tituloCabecalho.textContent = '📅 ' + data.nome + ' — Agendamentos';
      document.title = data.nome + ' — Painel de Agendamentos';
    }
  } catch(e) {}
})();

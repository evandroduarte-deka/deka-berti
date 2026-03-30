/**
 * DEKA OS v2.0 — oportunidades.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Pipeline Comercial — Gestão de Oportunidades
 *
 * RESPONSABILIDADES:
 *   - Exibir propostas em pipeline visual (3 cards de status)
 *   - Listar oportunidades com filtros e ações
 *   - Importar JSON do Claude externo
 *   - Fechar negócio: converte proposta → obra ativa
 *   - Atualizar status das propostas
 *
 * TABELAS SUPABASE:
 *   - propostas (READ + WRITE)
 *   - itens_proposta (WRITE)
 *   - base_servicos (READ para validação de códigos novos)
 *   - obras (WRITE ao fechar negócio)
 *   - obra_servicos (WRITE ao fechar negócio)
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos (console.error + showToast obrigatórios)
 *   - SELECT explícito (nunca SELECT *)
 *   - createElement para cards (nunca innerHTML com dados externos)
 *   - Cache com TTL 5min (dados comerciais mudam)
 *   - Um único ponto de entrada init()
 */

// =============================================================================
// IMPORTS
// =============================================================================

import {
  supabase,
  showToast,
  cacheGet,
  cacheSet,
  cacheLimpar,
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const CACHE_KEY = 'deka_cache_v2_oportunidades';
const CACHE_TTL_MIN = 5; // Dados comerciais mudam frequentemente

const STATUS_CONFIG = {
  rascunho: {
    label: 'Em Estudo',
    cor: '#3b82f6',
    pipeline: true,
  },
  enviado_cliente: {
    label: 'Proposta Enviada',
    cor: '#f5a623',
    pipeline: true,
  },
  aguardando_aprovacao: {
    label: 'Em Negociação',
    cor: '#a78bfa',
    pipeline: true,
  },
  aprovado: {
    label: 'Aprovado',
    cor: '#22c55e',
    pipeline: false,
  },
  aceito: {
    label: 'Aceito',
    cor: '#22c55e',
    pipeline: false,
  },
  recusado: {
    label: 'Recusado',
    cor: '#ef4444',
    pipeline: false,
  },
  expirado: {
    label: 'Expirado',
    cor: '#5a6480',
    pipeline: false,
  },
};

const PROMPT_AGT_INTAKE = `Você é o AGT_INTAKE da Berti Construtora — Curitiba/PR.
Analise todo o material anexado e conduza a abertura do estudo de orçamento.

EMPRESA: Berti Construtora LTDA · CNPJ: 59.622.624/0001-93
Gestor: Evandro Luiz Duarte · Resp. Técnica: Jéssica Berti Martins — CAU A129520-9
Ticket médio: R$ 80k – R$ 500k+ · Reformas residenciais e comerciais

ETAPA 1 — EXTRAIR DO MATERIAL:
Extraia tudo que encontrar. Campos não encontrados: marque [PREENCHER].
Nunca invente dados.

ETAPA 2 — PERGUNTAS:
Pergunte só o que não encontrou. Máximo 5 perguntas por vez.
NÃO pergunte valores antes do orçamento estar pronto.

ETAPA 3 — ORÇAMENTO:
Monte linha por linha. Agrupe por categoria.

Categorias válidas:
Preliminares · Demolições · Infraestrutura · Alvenaria · Construções e Regularizações · Impermeabilização · Pintura · Hidráulica · Elétrica · Ar-condicionado · Drywall / Forro · Revestimento · Cobertura · Serralheria · Estruturas Especiais · PPCI / Incêndio · Projetos · Marcenaria · Limpeza · Administração

Formato de cada linha:
CÓD. | CATEGORIA | DESCRIÇÃO | UNID | QTDE | R$ UNIT | R$ TOTAL | [DEFINIR]

Códigos por categoria:
PR-01... (Preliminares) · DM-01... (Demolições) · IF-01... (Infraestrutura)
AL-01... (Alvenaria) · CR-01... (Construções) · IM-01... (Impermeabilização)
PI-01... (Pintura) · HI-01... (Hidráulica) · EL-01... (Elétrica)
AC-01... (Ar-condicionado) · DR-01... (Drywall/Forro) · RV-01... (Revestimento)
CO-01... (Cobertura) · SE-01... (Serralheria) · ES-01... (Estruturas Especiais)
PP-01... (PPCI) · PJ-01... (Projetos) · MA-01... (Marcenaria)
LI-01... (Limpeza) · AD-01... (Administração)

Equipe: sempre [DEFINIR] (definida após fechamento)

PROATIVIDADE obrigatória:
- Loja/shopping → sugerir: PPCI, exaustão, elétrica ANEEL
- Clínica → sugerir: ventilação forçada, elétrica especial, acessibilidade
- Apartamento → sugerir: impermeabilização, gesso, limpeza final
- Escritório → sugerir: cabeamento, ar-condicionado, drywall

Calcule subtotais por categoria + TOTAL GERAL.

⚠️ CONFIRMAÇÃO #1: "Orçamento montado: R$ [total]. Revise. Posso prosseguir?"

ETAPA 4 — APÓS APROVAÇÃO:
Pergunte: taxa de administração (faixa Berti: 15-20%) · datas · forma de pagamento

ETAPA 5 — ESCOPO RESUMIDO:
3-5 linhas, linguagem comercial, sem jargões. Aguarde aprovação.

ETAPA 6 — JSON FINAL:
Gere exatamente este JSON em bloco \`\`\`json:

{
  "nova_proposta": {
    "nome_obra": "string",
    "cliente_nome": "string ou null",
    "cliente_email": "string ou null",
    "cliente_telefone": "string ou null",
    "endereco": "string ou null",
    "descricao_escopo": "string",
    "prazo_estimado_dias": null,
    "valor_custo_total": 0,
    "margem_percentual": 0,
    "valor_final": 0,
    "status": "rascunho",
    "aprovado_gestor": false
  },
  "novos_itens": [
    {
      "codigo": "DM-01",
      "categoria": "Demolições",
      "descricao_interna": "descrição técnica",
      "descricao_cliente": "descrição SEM códigos ou jargões",
      "unidade": "m²",
      "quantidade": 0,
      "valor_unitario_custo": 0,
      "valor_unitario_final": 0,
      "valor_total_custo": 0,
      "valor_total_final": 0,
      "observacao_ia": "premissas da estimativa"
    }
  ]
}

REGRAS DO JSON:
- Campos não informados = null
- Datas: YYYY-MM-DD
- Valores: número puro sem R$ (ponto decimal)
- valor_unitario_final = valor_unitario_custo x (1 + margem/100)
- valor_total_final = quantidade x valor_unitario_final
- valor_final = soma de todos os valor_total_final
- descricao_cliente: NUNCA conter códigos PR-*, DM-*, EQ-*

⚠️ CONFIRMAÇÃO #2: "JSON gerado. Cole no DEKA OS → Oportunidades → Importar do Claude."`;

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

const Estado = {
  // DOM
  pipelineRascunho: null,
  pipelineEnviado: null,
  pipelineNegociacao: null,
  countRascunho: null,
  countEnviado: null,
  countNegociacao: null,
  valorRascunho: null,
  valorEnviado: null,
  valorNegociacao: null,
  filtrosStatus: null,
  listaOportunidades: null,
  listaVazia: null,
  listaLoading: null,
  btnNovaOportunidade: null,
  btnRefresh: null,
  btnImportarClaude: null,
  btnVerPrompt: null,
  modalPrompt: null,
  promptConteudo: null,
  btnCopiarPrompt: null,
  btnFecharPrompt: null,
  btnFecharPromptX: null,
  modalImportar: null,
  jsonImportar: null,
  importarErro: null,
  btnFecharModal: null,
  btnCancelarImportar: null,
  btnConfirmarImportar: null,

  // Dados
  propostas: [],
  filtroAtivo: 'todas',
  itensNovos: [],
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

export async function init() {
  console.log('[DEKA][Oportunidades] Inicializando módulo...');

  carregarElementosDOM();
  configurarEventListeners();
  await carregarOportunidades();

  console.log('[DEKA][Oportunidades] ✅ Módulo inicializado.');
}

function carregarElementosDOM() {
  Estado.pipelineRascunho = document.getElementById('pipeline-rascunho');
  Estado.pipelineEnviado = document.getElementById('pipeline-enviado');
  Estado.pipelineNegociacao = document.getElementById('pipeline-negociacao');
  Estado.countRascunho = document.getElementById('count-rascunho');
  Estado.countEnviado = document.getElementById('count-enviado');
  Estado.countNegociacao = document.getElementById('count-negociacao');
  Estado.valorRascunho = document.getElementById('valor-rascunho');
  Estado.valorEnviado = document.getElementById('valor-enviado');
  Estado.valorNegociacao = document.getElementById('valor-negociacao');
  Estado.filtrosStatus = document.getElementById('filtros-status');
  Estado.listaOportunidades = document.getElementById('lista-oportunidades');
  Estado.listaVazia = document.getElementById('lista-vazia');
  Estado.listaLoading = document.getElementById('lista-loading');
  Estado.btnNovaOportunidade = document.getElementById('btn-nova-oportunidade');
  Estado.btnRefresh = document.getElementById('btn-refresh');
  Estado.btnImportarClaude = document.getElementById('btn-importar-claude');
  Estado.btnVerPrompt = document.getElementById('btn-ver-prompt');
  Estado.modalPrompt = document.getElementById('modal-prompt');
  Estado.promptConteudo = document.getElementById('prompt-conteudo');
  Estado.btnCopiarPrompt = document.getElementById('btn-copiar-prompt');
  Estado.btnFecharPrompt = document.getElementById('btn-fechar-prompt');
  Estado.btnFecharPromptX = document.getElementById('btn-fechar-prompt-x');
  Estado.modalImportar = document.getElementById('modal-importar');
  Estado.jsonImportar = document.getElementById('json-importar');
  Estado.importarErro = document.getElementById('importar-erro');
  Estado.btnFecharModal = document.getElementById('btn-fechar-modal');
  Estado.btnCancelarImportar = document.getElementById('btn-cancelar-importar');
  Estado.btnConfirmarImportar = document.getElementById('btn-confirmar-importar');

  // Validar elementos obrigatórios
  const elementosObrigatorios = [
    'countRascunho', 'countEnviado', 'countNegociacao',
    'valorRascunho', 'valorEnviado', 'valorNegociacao',
    'filtrosStatus', 'listaOportunidades', 'listaVazia', 'listaLoading',
    'btnImportarClaude', 'modalImportar', 'jsonImportar', 'importarErro',
  ];

  elementosObrigatorios.forEach(nome => {
    if (!Estado[nome]) {
      throw new Error(`[DEKA][Oportunidades] Elemento #${nome} não encontrado no DOM`);
    }
  });
}

function configurarEventListeners() {
  Estado.btnNovaOportunidade.addEventListener('click', () => {
    window.location.href = 'chat-orcamento.html';
  });

  Estado.btnRefresh.addEventListener('click', aoRefresh);

  Estado.btnVerPrompt.addEventListener('click', abrirModalPrompt);
  Estado.btnCopiarPrompt.addEventListener('click', copiarPrompt);
  Estado.btnFecharPrompt.addEventListener('click', fecharModalPrompt);
  Estado.btnFecharPromptX.addEventListener('click', fecharModalPrompt);

  // Fechar modal prompt ao clicar no overlay
  Estado.modalPrompt.addEventListener('click', (e) => {
    if (e.target === Estado.modalPrompt) {
      fecharModalPrompt();
    }
  });

  Estado.btnImportarClaude.addEventListener('click', abrirModalImportar);
  Estado.btnFecharModal.addEventListener('click', fecharModalImportar);
  Estado.btnCancelarImportar.addEventListener('click', fecharModalImportar);
  Estado.btnConfirmarImportar.addEventListener('click', aoConfirmarImportar);

  // Fechar modal ao clicar no overlay
  Estado.modalImportar.addEventListener('click', (e) => {
    if (e.target === Estado.modalImportar) {
      fecharModalImportar();
    }
  });

  // Event delegation para filtros
  Estado.filtrosStatus.addEventListener('click', (e) => {
    const btn = e.target.closest('.filtro-btn');
    if (!btn) return;

    const filtro = btn.dataset.filtro;
    if (filtro) aoFiltrar(filtro);
  });
}

// =============================================================================
// CARREGAMENTO DE OPORTUNIDADES
// =============================================================================

async function carregarOportunidades() {
  try {
    // Exibir loading
    Estado.listaLoading.classList.remove('oculto');
    Estado.listaOportunidades.innerHTML = '';
    Estado.listaVazia.classList.add('oculto');

    // Tentar cache primeiro
    const cached = cacheGet(CACHE_KEY);
    if (cached) {
      console.log('[DEKA][Oportunidades] Usando dados do cache.');
      Estado.propostas = cached;
      renderizarPipeline();
      renderizarLista();
      Estado.listaLoading.classList.add('oculto');
      return;
    }

    // Buscar do Supabase
    const { data, error } = await supabase
      .from('propostas')
      .select(`
        id,
        nome_obra,
        cliente_nome,
        endereco,
        status,
        valor_custo_total,
        margem_percentual,
        valor_final,
        aprovado_gestor,
        created_at,
        descricao_escopo
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DEKA][Oportunidades] Erro ao carregar propostas:', error);
      throw new Error('Erro ao carregar oportunidades: ' + error.message);
    }

    Estado.propostas = data || [];

    // Salvar em cache
    cacheSet(CACHE_KEY, Estado.propostas, CACHE_TTL_MIN);

    renderizarPipeline();
    renderizarLista();

    console.log('[DEKA][Oportunidades] Propostas carregadas:', Estado.propostas.length);

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao carregar oportunidades:', erro);
    showToast(erro.message || 'Erro ao carregar oportunidades.', 'error');
  } finally {
    Estado.listaLoading.classList.add('oculto');
  }
}

// =============================================================================
// RENDERIZAÇÃO DO PIPELINE
// =============================================================================

function renderizarPipeline() {
  // Filtrar propostas do pipeline
  const propostasPipeline = Estado.propostas.filter(p => {
    const config = STATUS_CONFIG[p.status];
    return config && config.pipeline === true;
  });

  // Agrupar por status
  const grupos = {
    rascunho: propostasPipeline.filter(p => p.status === 'rascunho'),
    enviado_cliente: propostasPipeline.filter(p => p.status === 'enviado_cliente'),
    aguardando_aprovacao: propostasPipeline.filter(p => p.status === 'aguardando_aprovacao'),
  };

  // Atualizar cards
  atualizarCardPipeline('rascunho', grupos.rascunho);
  atualizarCardPipeline('enviado', grupos.enviado_cliente);
  atualizarCardPipeline('negociacao', grupos.aguardando_aprovacao);
}

function atualizarCardPipeline(tipo, propostas) {
  const count = propostas.length;
  const valorTotal = propostas.reduce((sum, p) => sum + (p.valor_final || 0), 0);

  const countElement = Estado[`count${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`];
  const valorElement = Estado[`valor${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`];

  if (countElement) countElement.textContent = count;
  if (valorElement) valorElement.textContent = formatarMoeda(valorTotal);
}

// =============================================================================
// RENDERIZAÇÃO DA LISTA
// =============================================================================

function renderizarLista() {
  // Filtrar propostas
  let propostas = Estado.propostas;

  if (Estado.filtroAtivo !== 'todas') {
    propostas = propostas.filter(p => p.status === Estado.filtroAtivo);
  }

  // Limpar lista
  Estado.listaOportunidades.innerHTML = '';

  // Verificar se está vazia
  if (propostas.length === 0) {
    Estado.listaVazia.classList.remove('oculto');
    return;
  }

  Estado.listaVazia.classList.add('oculto');

  // Renderizar cards
  propostas.forEach(proposta => {
    const card = criarCardOportunidade(proposta);
    Estado.listaOportunidades.appendChild(card);
  });
}

function criarCardOportunidade(proposta) {
  const card = document.createElement('div');
  card.className = 'oportunidade-card';

  // Header
  const header = document.createElement('div');
  header.className = 'oportunidade-header';

  const info = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'oportunidade-title';
  title.textContent = proposta.nome_obra || 'Sem nome';

  const cliente = document.createElement('div');
  cliente.className = 'oportunidade-cliente';
  cliente.textContent = proposta.cliente_nome || 'Cliente não informado';

  info.appendChild(title);
  info.appendChild(cliente);

  // Badge de status
  const badge = document.createElement('div');
  badge.className = 'badge';
  const statusConfig = STATUS_CONFIG[proposta.status] || { label: proposta.status, cor: '#5a6480' };
  badge.textContent = statusConfig.label;
  badge.style.backgroundColor = `${statusConfig.cor}22`;
  badge.style.color = statusConfig.cor;
  badge.style.borderColor = statusConfig.cor;

  header.appendChild(info);
  header.appendChild(badge);

  // Escopo (se existir)
  if (proposta.descricao_escopo) {
    const escopo = document.createElement('div');
    escopo.style.fontSize = '13px';
    escopo.style.color = 'var(--text-secondary)';
    escopo.style.marginBottom = '12px';
    escopo.style.lineHeight = '1.5';
    escopo.textContent = proposta.descricao_escopo;
    card.appendChild(header);
    card.appendChild(escopo);
  } else {
    card.appendChild(header);
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'oportunidade-footer';

  const leftInfo = document.createElement('div');

  const valor = document.createElement('div');
  valor.className = 'oportunidade-valor';
  valor.textContent = formatarMoeda(proposta.valor_final || 0);

  const data = document.createElement('div');
  data.className = 'oportunidade-data';
  data.textContent = formatarData(proposta.created_at);

  leftInfo.appendChild(valor);
  leftInfo.appendChild(data);

  // Ações
  const actions = document.createElement('div');
  actions.className = 'oportunidade-actions';

  // Botão Editar (sempre visível)
  const btnEditar = document.createElement('button');
  btnEditar.className = 'btn-acao';
  btnEditar.textContent = '✏️ Editar';
  btnEditar.onclick = () => {
    window.location.href = `chat-orcamento.html?proposta_id=${proposta.id}`;
  };
  actions.appendChild(btnEditar);

  // Botões condicionais por status
  if (proposta.status === 'rascunho') {
    const btnEnviar = document.createElement('button');
    btnEnviar.className = 'btn-acao primary';
    btnEnviar.textContent = '📤 Marcar Enviada';
    btnEnviar.onclick = () => aoMarcarEnviada(proposta.id);
    actions.appendChild(btnEnviar);
  }

  if (proposta.status === 'enviado_cliente' || proposta.status === 'aguardando_aprovacao') {
    const btnFechar = document.createElement('button');
    btnFechar.className = 'btn-acao success';
    btnFechar.textContent = '🤝 Fechar Negócio';
    btnFechar.onclick = () => aoFecharNegocio(proposta.id);
    actions.appendChild(btnFechar);
  }

  if (proposta.status !== 'aceito' && proposta.status !== 'recusado') {
    const btnRecusar = document.createElement('button');
    btnRecusar.className = 'btn-acao danger';
    btnRecusar.textContent = '❌ Recusar';
    btnRecusar.onclick = () => aoRecusar(proposta.id);
    actions.appendChild(btnRecusar);
  }

  footer.appendChild(leftInfo);
  footer.appendChild(actions);
  card.appendChild(footer);

  return card;
}

// =============================================================================
// FILTROS
// =============================================================================

function aoFiltrar(status) {
  Estado.filtroAtivo = status;

  // Atualizar classe ativa nos botões
  Estado.filtrosStatus.querySelectorAll('.filtro-btn').forEach(btn => {
    if (btn.dataset.filtro === status) {
      btn.classList.add('ativo');
    } else {
      btn.classList.remove('ativo');
    }
  });

  renderizarLista();
}

// =============================================================================
// AÇÕES: MARCAR ENVIADA
// =============================================================================

async function aoMarcarEnviada(propostaId) {
  try {
    const { error } = await supabase
      .from('propostas')
      .update({ status: 'enviado_cliente' })
      .eq('id', propostaId);

    if (error) {
      console.error('[DEKA][Oportunidades] Erro ao marcar enviada:', error);
      throw new Error('Erro ao marcar proposta: ' + error.message);
    }

    showToast('Proposta marcada como enviada!', 'success');

    // Invalidar cache e recarregar
    cacheLimpar('deka_cache_v2_oportunidades');
    await carregarOportunidades();

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao marcar enviada:', erro);
    showToast(erro.message || 'Erro ao marcar proposta.', 'error');
  }
}

// =============================================================================
// AÇÕES: FECHAR NEGÓCIO
// =============================================================================

async function aoFecharNegocio(propostaId) {
  if (!confirm('Fechar este negócio? A proposta será convertida em obra ativa no Hub.')) {
    return;
  }

  try {
    showToast('Fechando negócio...', 'info');

    // 1. Buscar proposta completa
    const { data: proposta, error: erroProposta } = await supabase
      .from('propostas')
      .select('*')
      .eq('id', propostaId)
      .single();

    if (erroProposta) {
      console.error('[DEKA][Oportunidades] Erro ao buscar proposta:', erroProposta);
      throw new Error('Erro ao buscar proposta: ' + erroProposta.message);
    }

    // 2. Atualizar status da proposta
    const { error: erroUpdate } = await supabase
      .from('propostas')
      .update({
        status: 'aceito',
        aprovado_gestor: true
      })
      .eq('id', propostaId);

    if (erroUpdate) {
      console.error('[DEKA][Oportunidades] Erro ao atualizar proposta:', erroUpdate);
      throw new Error('Erro ao atualizar proposta: ' + erroUpdate.message);
    }

    // 3. Buscar itens da proposta
    const { data: itens, error: erroItens } = await supabase
      .from('itens_proposta')
      .select('*')
      .eq('proposta_id', propostaId);

    if (erroItens) {
      console.error('[DEKA][Oportunidades] Erro ao buscar itens:', erroItens);
      throw new Error('Erro ao buscar itens: ' + erroItens.message);
    }

    // 4. Criar obra
    const { data: obra, error: erroObra } = await supabase
      .from('obras')
      .insert({
        nome: proposta.nome_obra,
        cliente: proposta.cliente_nome || '[PREENCHER]',
        endereco: proposta.endereco || '[PREENCHER]',
        data_inicio: new Date().toISOString().split('T')[0],
        data_previsao_fim: null,
        status: 'ativa',
        percentual_global: 0,
      })
      .select('id')
      .single();

    if (erroObra) {
      console.error('[DEKA][Oportunidades] Erro ao criar obra:', erroObra);
      throw new Error('Erro ao criar obra: ' + erroObra.message);
    }

    const obraId = obra.id;
    console.log('[DEKA][Oportunidades] Obra criada com ID:', obraId);

    // 5. Criar serviços da obra
    if (itens && itens.length > 0) {
      const servicosParaInserir = itens.map(item => ({
        obra_id: obraId,
        codigo: item.codigo_servico || 'SRV-000',
        descricao_interna: item.descricao_interna,
        descricao_cliente: item.descricao_cliente,
        equipe_codigo: '[DEFINIR]',
        percentual_concluido: 0,
        valor_contratado: item.valor_total_final || 0,
      }));

      const { error: erroServicos } = await supabase
        .from('obra_servicos')
        .insert(servicosParaInserir);

      if (erroServicos) {
        console.error('[DEKA][Oportunidades] Erro ao criar serviços:', erroServicos);
        throw new Error('Erro ao criar serviços: ' + erroServicos.message);
      }

      console.log('[DEKA][Oportunidades] Serviços criados:', servicosParaInserir.length);
    }

    showToast('Negócio fechado! Obra criada no Hub.', 'success');

    // Invalidar cache
    cacheLimpar('deka_cache_v2_oportunidades');

    // Redirecionar para hub após 2s
    setTimeout(() => {
      window.location.href = 'hub.html';
    }, 2000);

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao fechar negócio:', erro);
    showToast(erro.message || 'Erro ao fechar negócio.', 'error');
  }
}

// =============================================================================
// AÇÕES: RECUSAR
// =============================================================================

async function aoRecusar(propostaId) {
  if (!confirm('Marcar esta oportunidade como recusada?')) {
    return;
  }

  try {
    const { error } = await supabase
      .from('propostas')
      .update({ status: 'recusado' })
      .eq('id', propostaId);

    if (error) {
      console.error('[DEKA][Oportunidades] Erro ao recusar:', error);
      throw new Error('Erro ao recusar proposta: ' + error.message);
    }

    showToast('Oportunidade marcada como recusada.', 'warning');

    // Invalidar cache e recarregar
    cacheLimpar('deka_cache_v2_oportunidades');
    await carregarOportunidades();

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao recusar:', erro);
    showToast(erro.message || 'Erro ao recusar proposta.', 'error');
  }
}

// =============================================================================
// MODAL: PROMPT AGT_INTAKE
// =============================================================================

function abrirModalPrompt() {
  Estado.promptConteudo.value = PROMPT_AGT_INTAKE;
  Estado.modalPrompt.classList.remove('oculto');
  Estado.promptConteudo.focus();
}

function fecharModalPrompt() {
  Estado.modalPrompt.classList.add('oculto');
}

async function copiarPrompt() {
  try {
    await navigator.clipboard.writeText(PROMPT_AGT_INTAKE);

    // Muda texto do botão temporariamente
    const textoOriginal = Estado.btnCopiarPrompt.textContent;
    Estado.btnCopiarPrompt.textContent = '✅ Copiado!';

    showToast('Prompt copiado! Cole no Claude.ai.', 'success');

    // Restaura texto após 2s
    setTimeout(() => {
      Estado.btnCopiarPrompt.textContent = textoOriginal;
    }, 2000);

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao copiar prompt:', erro);
    showToast(erro.message || 'Erro ao copiar prompt.', 'error');
  }
}

// =============================================================================
// MODAL: IMPORTAR JSON
// =============================================================================

function abrirModalImportar() {
  Estado.jsonImportar.value = '';
  Estado.importarErro.classList.add('oculto');
  Estado.importarErro.textContent = '';
  Estado.modalImportar.classList.remove('oculto');
  Estado.jsonImportar.focus();
}

function fecharModalImportar() {
  Estado.modalImportar.classList.add('oculto');
  Estado.jsonImportar.value = '';
  Estado.importarErro.classList.add('oculto');
  Estado.importarErro.textContent = '';
}

async function aoConfirmarImportar() {
  const jsonRaw = Estado.jsonImportar.value.trim();

  // Limpar erro anterior
  Estado.importarErro.classList.add('oculto');
  Estado.importarErro.textContent = '';

  if (!jsonRaw) {
    Estado.importarErro.textContent = 'Cole o JSON antes de importar.';
    Estado.importarErro.classList.remove('oculto');
    return;
  }

  // Parsear JSON
  let dados;
  try {
    dados = JSON.parse(jsonRaw);
  } catch (erroJson) {
    console.error('[DEKA][Oportunidades] JSON inválido:', erroJson);
    Estado.importarErro.textContent = 'JSON inválido. Verifique o formato.';
    Estado.importarErro.classList.remove('oculto');
    return;
  }

  // Validar estrutura
  if (!dados.nova_proposta || !Array.isArray(dados.novos_itens)) {
    console.error('[DEKA][Oportunidades] Estrutura inválida:', dados);
    Estado.importarErro.textContent = 'Estrutura incorreta. Precisa de nova_proposta e novos_itens.';
    Estado.importarErro.classList.remove('oculto');
    return;
  }

  // Chamar importação
  await importarProposta(dados);
}

async function importarProposta(dados) {
  try {
    // Desabilitar botão durante importação
    Estado.btnConfirmarImportar.disabled = true;
    Estado.btnConfirmarImportar.textContent = 'Importando...';

    const { nova_proposta, novos_itens } = dados;

    // 1. Inserir proposta no Supabase
    const { data: propostaInserida, error: erroProposta } = await supabase
      .from('propostas')
      .insert({
        nome_obra: nova_proposta.nome_obra,
        cliente_nome: nova_proposta.cliente_nome || null,
        cliente_email: nova_proposta.cliente_email || null,
        cliente_telefone: nova_proposta.cliente_telefone || null,
        endereco: nova_proposta.endereco || null,
        descricao_escopo: nova_proposta.descricao_escopo || null,
        prazo_estimado_dias: nova_proposta.prazo_estimado_dias || null,
        valor_custo_total: nova_proposta.valor_custo_total || 0,
        margem_percentual: nova_proposta.margem_percentual || 0,
        valor_final: nova_proposta.valor_final || 0,
        status: 'rascunho',
        aprovado_gestor: false,
        payload_ia: dados,
      })
      .select('id')
      .single();

    if (erroProposta) {
      console.error('[DEKA][Oportunidades] Erro ao inserir proposta:', erroProposta);
      throw new Error('Erro ao inserir proposta: ' + erroProposta.message);
    }

    const propostaId = propostaInserida.id;
    console.log('[DEKA][Oportunidades] Proposta inserida com ID:', propostaId);

    // 2. Inserir itens da proposta
    if (novos_itens.length > 0) {
      const itensParaInserir = novos_itens.map((item, index) => ({
        proposta_id: propostaId,
        codigo_servico: item.codigo || null,
        categoria: item.categoria || null,
        descricao_interna: item.descricao_interna || '',
        descricao_cliente: item.descricao_cliente || '',
        unidade: item.unidade || 'un',
        quantidade: item.quantidade || 1,
        valor_unitario_custo: item.valor_unitario_custo || 0,
        valor_unitario_final: item.valor_unitario_final || 0,
        valor_total_custo: item.valor_total_custo || 0,
        valor_total_final: item.valor_total_final || 0,
        observacao_ia: item.observacao_ia || null,
        ordem: index + 1,
      }));

      const { error: erroItens } = await supabase
        .from('itens_proposta')
        .insert(itensParaInserir);

      if (erroItens) {
        console.error('[DEKA][Oportunidades] Erro ao inserir itens:', erroItens);
        throw new Error('Erro ao inserir itens: ' + erroItens.message);
      }

      console.log('[DEKA][Oportunidades] Itens inseridos:', itensParaInserir.length);

      // 3. Verificar serviços novos no catálogo
      const codigosItens = novos_itens
        .map(item => item.codigo)
        .filter(codigo => codigo && codigo.trim() !== '');

      if (codigosItens.length > 0) {
        const { data: servicosExistentes, error: erroServicos } = await supabase
          .from('base_servicos')
          .select('codigo')
          .in('codigo', codigosItens);

        if (erroServicos) {
          console.error('[DEKA][Oportunidades] Erro ao verificar base_servicos:', erroServicos);
          // Não bloquear a importação por erro de verificação
        } else {
          const codigosExistentes = (servicosExistentes || []).map(s => s.codigo);
          const codigosNovos = codigosItens.filter(c => !codigosExistentes.includes(c));

          Estado.itensNovos = codigosNovos;

          console.log('[DEKA][Oportunidades] Códigos novos detectados:', codigosNovos);
        }
      }
    }

    // 4. Toast diferenciado conforme serviços novos
    if (Estado.itensNovos.length > 0) {
      showToast(
        `Proposta importada! ${Estado.itensNovos.length} serviços novos precisam de aprovação no Catálogo.`,
        'warning'
      );
    } else {
      showToast('Proposta importada com sucesso!', 'success');
    }

    // 5. Invalidar cache e recarregar
    cacheLimpar('deka_cache_v2_oportunidades');
    await carregarOportunidades();

    // 6. Fechar modal
    fecharModalImportar();

  } catch (erro) {
    console.error('[DEKA][Oportunidades] Erro ao importar JSON:', erro);
    showToast(erro.message || 'Erro ao importar JSON.', 'error');
  } finally {
    // Reabilitar botão
    Estado.btnConfirmarImportar.disabled = false;
    Estado.btnConfirmarImportar.textContent = '✅ Importar Proposta';
  }
}

// =============================================================================
// AÇÕES: REFRESH
// =============================================================================

async function aoRefresh() {
  cacheLimpar('deka_cache_v2_oportunidades');
  await carregarOportunidades();
  showToast('Oportunidades atualizadas!', 'success');
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

function formatarData(dataISO) {
  if (!dataISO) return '—';

  const data = new Date(dataISO);
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();

  return `${dia}/${mes}/${ano}`;
}

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================

/**
 * DEKA OS v2.0 — comercial.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Comercial WhatsApp — Fila de Aprovação
 *
 * FUNCIONALIDADES:
 *   - Painel de Triagem: mensagens aguardando processamento do AGT_WHATSAPP
 *   - Fila de Aprovação: respostas prontas aguardando aprovação do gestor
 *   - Modal de aprovação: editar e aprovar/rejeitar respostas
 *
 * TABELA SUPABASE:
 *   - brain_comercial → ÚNICA fonte de verdade comercial
 *   - ⛔ PROIBIDO usar comercial_data (tabela legada excluída)
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos
 *   - Supabase = fonte da verdade
 *   - Cache apenas via cacheGet/cacheSet (TTL 2 min)
 *   - Todo erro → console.error + showToast
 */

// =============================================================================
// SEÇÃO 1 — IMPORTS
// =============================================================================

import {
  supabase,
  showToast,
  cacheGet,
  cacheSet,
  cacheLimpar,
  fetchComTimeout,
} from './deka.js';

// =============================================================================
// SEÇÃO 2 — CONSTANTES
// =============================================================================

/** TTL do cache de leads comerciais (2 minutos) */
const CACHE_TTL_COMERCIAL_MIN = 2;

/** Chave do cache */
const CACHE_KEY_COMERCIAL = 'comercial_pendentes';

// =============================================================================
// SEÇÃO 3 — ESTADO GLOBAL
// =============================================================================

/**
 * Estado do módulo Comercial.
 * Contém referências aos elementos do DOM e dados em memória.
 */
const Estado = {
  // ── Elementos do DOM ────────────────────────────────────────────────────
  // Triagem
  listTriagem: null,
  badgeTriagem: null,
  btnRefreshTriagem: null,

  // Aprovação
  listAprovacao: null,
  badgeAprovacao: null,
  btnRefreshAprovacao: null,

  // Modal
  modalOverlay: null,
  modalContato: null,
  modalNumero: null,
  modalMensagem: null,
  modalAnalise: null,
  modalResposta: null,
  btnAprovar: null,
  btnRejeitar: null,
  btnCancelar: null,
  btnModalClose: null,

  // ── Dados em memória ────────────────────────────────────────────────────
  leadAtual: null, // Lead sendo visualizado no modal
};

// =============================================================================
// SEÇÃO 4 — INICIALIZAÇÃO
// =============================================================================

/**
 * Ponto de entrada do módulo Comercial.
 * Chamado pelo comercial.html após o DOM estar pronto.
 */
export async function init() {
  console.log('[DEKA][Comercial] Inicializando módulo...');

  // ── 1. Carrega referências do DOM ───────────────────────────────────────
  carregarElementosDOM();

  // ── 2. Configura event listeners ────────────────────────────────────────
  configurarEventListeners();

  // ── 3. Carrega dados iniciais ───────────────────────────────────────────
  await carregarDados();

  console.log('[DEKA][Comercial] ✅ Módulo inicializado com sucesso.');
}

/**
 * Carrega todas as referências dos elementos do DOM.
 */
function carregarElementosDOM() {
  // Triagem
  Estado.listTriagem = document.getElementById('list-triagem');
  Estado.badgeTriagem = document.getElementById('badge-triagem');
  Estado.btnRefreshTriagem = document.getElementById('btn-refresh-triagem');

  // Aprovação
  Estado.listAprovacao = document.getElementById('list-aprovacao');
  Estado.badgeAprovacao = document.getElementById('badge-aprovacao');
  Estado.btnRefreshAprovacao = document.getElementById('btn-refresh-aprovacao');

  // Modal
  Estado.modalOverlay = document.getElementById('modal-overlay');
  Estado.modalContato = document.getElementById('modal-contato');
  Estado.modalNumero = document.getElementById('modal-numero');
  Estado.modalMensagem = document.getElementById('modal-mensagem');
  Estado.modalAnalise = document.getElementById('modal-analise');
  Estado.modalResposta = document.getElementById('modal-resposta');
  Estado.btnAprovar = document.getElementById('btn-aprovar');
  Estado.btnRejeitar = document.getElementById('btn-rejeitar');
  Estado.btnCancelar = document.getElementById('btn-cancelar');
  Estado.btnModalClose = document.getElementById('btn-modal-close');

  // Valida elementos essenciais
  const elementosEssenciais = [
    'listTriagem', 'badgeTriagem', 'btnRefreshTriagem',
    'listAprovacao', 'badgeAprovacao', 'btnRefreshAprovacao',
    'modalOverlay', 'modalContato', 'modalResposta',
    'btnAprovar', 'btnRejeitar', 'btnCancelar',
  ];

  const ausentes = elementosEssenciais.filter((nome) => !Estado[nome]);

  if (ausentes.length > 0) {
    console.error('[DEKA][Comercial] Elementos DOM ausentes:', ausentes.join(', '));
    showToast(
      'Erro ao inicializar Comercial: elementos DOM ausentes.',
      'error',
      { persistir: true }
    );
  }
}

/**
 * Configura todos os event listeners do módulo.
 */
function configurarEventListeners() {
  // Botões de refresh
  Estado.btnRefreshTriagem.addEventListener('click', aoClicarRefresh);
  Estado.btnRefreshAprovacao.addEventListener('click', aoClicarRefresh);

  // Modal
  Estado.btnModalClose.addEventListener('click', fecharModal);
  Estado.btnCancelar.addEventListener('click', fecharModal);
  Estado.btnRejeitar.addEventListener('click', aoClicarRejeitar);
  Estado.btnAprovar.addEventListener('click', aoClicarAprovar);

  // Fechar modal ao clicar fora
  Estado.modalOverlay.addEventListener('click', (e) => {
    if (e.target === Estado.modalOverlay) {
      fecharModal();
    }
  });

  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && Estado.modalOverlay.classList.contains('active')) {
      fecharModal();
    }
  });
}

// =============================================================================
// SEÇÃO 5 — CARREGAMENTO DE DADOS
// =============================================================================

/**
 * Carrega todas as mensagens do brain_comercial.
 * Separa em duas listas: Triagem e Aprovação.
 */
async function carregarDados() {
  try {
    // Tenta carregar do cache primeiro
    const cached = cacheGet(CACHE_KEY_COMERCIAL);

    let leads;
    if (cached) {
      console.log('[DEKA][Comercial] Usando dados do cache.');
      leads = cached;
    } else {
      // Busca no Supabase
      const { data, error } = await supabase
        .from('brain_comercial')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[DEKA][Comercial] Erro ao carregar leads:', error);
        showToast('Erro ao carregar mensagens WhatsApp.', 'error');
        return;
      }

      leads = data || [];

      // Salva no cache
      cacheSet(CACHE_KEY_COMERCIAL, leads, CACHE_TTL_COMERCIAL_MIN);
    }

    // Separa em duas listas
    const triagem = leads.filter((lead) => !lead.resposta_ia);
    const aprovacao = leads.filter(
      (lead) => lead.resposta_ia && !lead.aprovado_gestor
    );

    // Renderiza
    renderizarTriagem(triagem);
    renderizarAprovacao(aprovacao);

    console.log('[DEKA][Comercial] Leads carregados:', {
      total: leads.length,
      triagem: triagem.length,
      aprovacao: aprovacao.length,
    });

  } catch (erro) {
    console.error('[DEKA][Comercial] Exceção ao carregar dados:', erro);
    showToast(erro.message || 'Erro inesperado ao carregar dados.', 'error');
  }
}

/**
 * Handler do botão Refresh.
 * Limpa cache e recarrega dados.
 */
async function aoClicarRefresh() {
  console.log('[DEKA][Comercial] Refresh manual acionado.');

  // Limpa cache
  cacheLimpar('comercial_');

  // Recarrega dados
  await carregarDados();

  showToast('Dados atualizados.', 'success');
}

// =============================================================================
// SEÇÃO 6 — RENDERIZAÇÃO: PAINEL DE TRIAGEM
// =============================================================================

/**
 * Renderiza a lista de mensagens aguardando processamento do AGT_WHATSAPP.
 * Critério: resposta_ia IS NULL
 */
function renderizarTriagem(leads) {
  // Atualiza contador
  Estado.badgeTriagem.textContent = leads.length;

  // Limpa lista
  Estado.listTriagem.innerHTML = '';

  if (leads.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'empty-state';
    vazio.innerHTML = `
      <div class="empty-state-icon">📭</div>
      <p>Nenhuma mensagem aguardando triagem.</p>
    `;
    Estado.listTriagem.appendChild(vazio);
    return;
  }

  // Renderiza cada lead
  leads.forEach((lead) => {
    const card = criarCardLead(lead, 'pendente');

    // Não é clicável (ainda não tem resposta para aprovar)
    card.style.cursor = 'default';
    card.style.opacity = '0.7';

    Estado.listTriagem.appendChild(card);
  });
}

// =============================================================================
// SEÇÃO 7 — RENDERIZAÇÃO: FILA DE APROVAÇÃO
// =============================================================================

/**
 * Renderiza a lista de mensagens com resposta pronta, aguardando aprovação.
 * Critério: resposta_ia IS NOT NULL AND aprovado_gestor = false
 */
function renderizarAprovacao(leads) {
  // Atualiza contador
  Estado.badgeAprovacao.textContent = leads.length;

  // Limpa lista
  Estado.listAprovacao.innerHTML = '';

  if (leads.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'empty-state';
    vazio.innerHTML = `
      <div class="empty-state-icon">✨</div>
      <p>Nenhuma resposta aguardando aprovação.</p>
    `;
    Estado.listAprovacao.appendChild(vazio);
    return;
  }

  // Renderiza cada lead
  leads.forEach((lead) => {
    const card = criarCardLead(lead, 'aprovacao');

    // Clicável - abre modal
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => abrirModal(lead));

    Estado.listAprovacao.appendChild(card);
  });
}

/**
 * Cria um card de lead.
 */
function criarCardLead(lead, tipo) {
  const card = document.createElement('div');
  card.className = `message-card ${tipo === 'aprovacao' ? 'pendente' : ''}`;
  card.dataset.leadId = lead.id;

  // Header: Nome + Status
  const header = document.createElement('div');
  header.className = 'card-header';

  const nome = document.createElement('div');
  nome.className = 'contact-name';
  nome.textContent = lead.contato_nome || 'Sem nome';
  header.appendChild(nome);

  const status = document.createElement('span');
  status.className = `card-status ${tipo === 'aprovacao' ? 'pendente' : 'aguardando'}`;
  status.textContent = tipo === 'aprovacao' ? 'AGUARDANDO' : 'TRIAGEM';
  header.appendChild(status);

  card.appendChild(header);

  // Número
  const numero = document.createElement('div');
  numero.className = 'contact-number';
  numero.textContent = lead.contato_numero || '—';
  card.appendChild(numero);

  // Preview da mensagem
  const preview = document.createElement('div');
  preview.className = 'message-preview';
  preview.textContent = lead.mensagem_original
    ? lead.mensagem_original.substring(0, 80) + '...'
    : 'Sem mensagem';
  card.appendChild(preview);

  // Meta: Estágio + Data
  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const estagio = document.createElement('span');
  estagio.className = 'card-estagio';
  estagio.textContent = lead.estagio || '—';
  meta.appendChild(estagio);

  const data = document.createElement('span');
  data.textContent = new Date(lead.created_at).toLocaleDateString('pt-BR');
  meta.appendChild(data);

  card.appendChild(meta);

  return card;
}

// =============================================================================
// SEÇÃO 8 — MODAL DE APROVAÇÃO
// =============================================================================

/**
 * Abre o modal de aprovação com os dados do lead.
 */
function abrirModal(lead) {
  Estado.leadAtual = lead;

  // Preenche campos
  Estado.modalContato.textContent = lead.contato_nome || '—';
  Estado.modalNumero.textContent = lead.contato_numero || '—';
  Estado.modalMensagem.textContent = lead.mensagem_original || '—';

  // Análise IA: Estágio + Próxima Ação
  const analise = [
    lead.estagio ? `Estágio: ${lead.estagio}` : '',
    lead.proxima_acao ? `Próxima ação: ${lead.proxima_acao}` : '',
  ].filter(Boolean).join('\n');

  Estado.modalAnalise.textContent = analise || '—';

  // Resposta sugerida (editável)
  Estado.modalResposta.value = lead.resposta_ia || '';

  // Mostra modal
  Estado.modalOverlay.classList.add('active');
  Estado.modalResposta.focus();

  console.log('[DEKA][Comercial] Modal aberto para lead:', lead.id);
}

/**
 * Fecha o modal de aprovação.
 */
function fecharModal() {
  Estado.modalOverlay.classList.remove('active');
  Estado.leadAtual = null;
}

// =============================================================================
// SEÇÃO 9 — AÇÕES: APROVAR E REJEITAR
// =============================================================================

/**
 * Handler do botão "Aprovar e Enviar".
 * Atualiza o lead no Supabase com aprovado_gestor=true.
 */
async function aoClicarAprovar() {
  if (!Estado.leadAtual) {
    showToast('Nenhum lead selecionado.', 'warning');
    return;
  }

  const respostaEditada = Estado.modalResposta.value.trim();

  if (!respostaEditada) {
    showToast('Digite uma resposta antes de aprovar.', 'warning');
    Estado.modalResposta.focus();
    return;
  }

  try {
    Estado.btnAprovar.disabled = true;
    Estado.btnAprovar.textContent = '⏳ Aprovando...';

    // UPDATE no Supabase
    const { error } = await supabase
      .from('brain_comercial')
      .update({
        aprovado_gestor: true,
        resposta_ia: respostaEditada,
      })
      .eq('id', Estado.leadAtual.id);

    if (error) {
      throw new Error('Erro ao aprovar lead: ' + error.message);
    }

    showToast('Lead aprovado! O N8N enviará a resposta via Evolution API.', 'success');
    console.log('[DEKA][Comercial] Lead aprovado:', Estado.leadAtual.id);

    // Limpa cache e recarrega
    cacheSet(CACHE_KEY_COMERCIAL, null, 0);
    await carregarDados();

    fecharModal();

  } catch (erro) {
    console.error('[DEKA][Comercial] Erro ao aprovar lead:', erro);
    showToast(erro.message || 'Erro ao aprovar lead.', 'error');
  } finally {
    Estado.btnAprovar.disabled = false;
    Estado.btnAprovar.textContent = 'Aprovar e Enviar';
  }
}

/**
 * Handler do botão "Rejeitar".
 * Remove o lead da fila de aprovação (marca como rejeitado ou deleta).
 */
async function aoClicarRejeitar() {
  if (!Estado.leadAtual) {
    showToast('Nenhum lead selecionado.', 'warning');
    return;
  }

  try {
    Estado.btnRejeitar.disabled = true;
    Estado.btnRejeitar.textContent = '⏳ Rejeitando...';

    // Para rejeitar, podemos:
    // Opção 1: Deletar o registro (mais drástico)
    // Opção 2: Marcar como rejeitado (adicionar campo status)
    // Optando por resetar a resposta_ia para NULL (volta para triagem)

    const { error } = await supabase
      .from('brain_comercial')
      .update({
        resposta_ia: null,
        proxima_acao: 'Rejeitado pelo gestor - aguardar nova análise',
      })
      .eq('id', Estado.leadAtual.id);

    if (error) {
      throw new Error('Erro ao rejeitar lead: ' + error.message);
    }

    showToast('Lead rejeitado e devolvido para triagem.', 'info');
    console.log('[DEKA][Comercial] Lead rejeitado:', Estado.leadAtual.id);

    // Limpa cache e recarrega
    cacheSet(CACHE_KEY_COMERCIAL, null, 0);
    await carregarDados();

    fecharModal();

  } catch (erro) {
    console.error('[DEKA][Comercial] Erro ao rejeitar lead:', erro);
    showToast(erro.message || 'Erro ao rejeitar lead.', 'error');
  } finally {
    Estado.btnRejeitar.disabled = false;
    Estado.btnRejeitar.textContent = 'Rejeitar';
  }
}

// =============================================================================
// FIM DO ARQUIVO — comercial.js
//
// Smoke Test (validar antes de commitar):
//
//   [x] Arquivo < 1.500 linhas?                             ✅ (~450 linhas)
//   [x] Exporta init() sem DOMContentLoaded?                ✅
//   [x] Imports apenas de deka.js?                          ✅
//   [x] Usa APENAS brain_comercial?                         ✅
//   [x] Zero referências a comercial_data?                  ✅
//   [x] Cache com TTL de 2 minutos?                         ✅
//   [x] Todo catch tem console.error + showToast?           ✅
//   [x] Modal funcional (aprovar/rejeitar)?                 ✅
//   [x] Lógica das duas filas implementada?                 ✅
//   [x] Arquivo entregue COMPLETO (não patch)?              ✅
// =============================================================================

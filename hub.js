/**
 * DEKA OS v2.0 — hub.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Hub de Obras (tela inicial do sistema)
 *
 * RESPONSABILIDADE ÚNICA:
 *   Listar as obras do Supabase (tabela `obras`) com cache versionado,
 *   renderizar cards interativos e rotear para a tela de detalhe de cada obra.
 *
 * DEPENDÊNCIAS:
 *   - deka.js  (supabase, showToast, cacheGet, cacheSet, formatarDataBR)
 *   - hub.html (define os elementos #hub-grid, #hub-status-bar, #btn-refresh)
 *
 * COMO ATIVAR NO hub.html:
 *   <script type="module">
 *     import { init } from './hub.js';
 *     init();
 *   </script>
 *
 * REGRAS DEKA OS (TOLERÂNCIA ZERO):
 *   - Zero try/catch silenciosos: todo catch → console.error + showToast
 *   - Zero fetch sem timeout: fetchComTimeout via deka.js
 *   - Zero localStorage sem TTL: cacheSet com ttlMinutes explícito
 *   - Zero innerHTML com dados do usuário: sempre textContent / createElement
 *   - Zero DOMContentLoaded neste arquivo: init() é chamado pelo HTML
 */

import {
  supabase,
  showToast,
  cacheGet,
  cacheSet,
  formatarDataBR,
} from './deka.js';

// =============================================================================
// SEÇÃO 1 — CONSTANTES DO MÓDULO
// =============================================================================

/** Chave de cache (sem prefixo — o cacheSet adiciona 'deka_cache_v2_' automaticamente) */
const CACHE_KEY_OBRAS = 'obras';

/** TTL do cache de obras em minutos */
const CACHE_TTL_OBRAS = 10;

/**
 * Campos selecionados do Supabase — nunca usar SELECT *.
 * Princípio: buscar apenas o que o card precisa exibir.
 * Para dados completos (serviços, pendências), o módulo obra.js faz sua própria query.
 */
const CAMPOS_OBRAS = [
  'id',
  'nome',
  'cliente',
  'status',
  'percentual_global',
  'data_previsao_fim',
  'updated_at',
].join(', ');

/**
 * Configuração visual por status de obra.
 * Mantida aqui (e não no CSS) para ser a única fonte da verdade sobre
 * o significado semântico de cada status.
 */
const CONFIG_STATUS = {
  ativa: {
    label:    'Em andamento',
    classe:   'status-ativa',
    emoji:    '🟢',
    ordem:    1,
  },
  pausada: {
    label:    'Pausada',
    classe:   'status-pausada',
    emoji:    '🟡',
    ordem:    2,
  },
  concluida: {
    label:    'Concluída',
    classe:   'status-concluida',
    emoji:    '✅',
    ordem:    3,
  },
  _desconhecido: {
    label:    'Status desconhecido',
    classe:   'status-desconhecido',
    emoji:    '⚪',
    ordem:    99,
  },
};

// =============================================================================
// SEÇÃO 2 — ESTADO INTERNO DO MÓDULO
// =============================================================================

/**
 * Estado reativo do hub.
 * Centralizado aqui para evitar variáveis soltas no escopo global.
 */
const _estado = {
  obras:          [],     // Array de obras carregadas
  carregando:     false,  // Flag de loading (evita double-fetch)
  ultimaAtualizacao: null, // Date da última busca ao Supabase
};

// =============================================================================
// SEÇÃO 3 — REFERÊNCIAS AO DOM
// =============================================================================

/**
 * Lê e valida os elementos do DOM necessários para o hub.
 * Lançamento de erro aqui é intencional: sem esses elementos, o módulo
 * não pode funcionar e o gestor deve saber imediatamente.
 *
 * @returns {{ grid, statusBar, btnRefresh, contador }}
 * @throws {Error} Se algum elemento obrigatório não for encontrado no HTML
 */
function lerElementosDOM() {
  const grid       = document.getElementById('hub-grid');
  const statusBar  = document.getElementById('hub-status-bar');
  const btnRefresh = document.getElementById('btn-refresh');
  const contador   = document.getElementById('hub-contador');

  const ausentes = [];
  if (!grid)       ausentes.push('#hub-grid');
  if (!statusBar)  ausentes.push('#hub-status-bar');
  if (!btnRefresh) ausentes.push('#btn-refresh');
  if (!contador)   ausentes.push('#hub-contador');

  if (ausentes.length > 0) {
    throw new Error(
      `[DEKA][Hub] Elementos do DOM ausentes no hub.html: ${ausentes.join(', ')}. ` +
      'Verifique se o HTML está correto antes de chamar hub.init().'
    );
  }

  return { grid, statusBar, btnRefresh, contador };
}

// =============================================================================
// SEÇÃO 4 — BUSCA E CACHE DE OBRAS
// =============================================================================

/**
 * Busca obras do Supabase com estratégia cache-first.
 *
 * ESTRATÉGIA:
 *   1. Lê o cache 'deka_cache_v2_obras' (TTL: 10 min)
 *   2. Se válido → retorna do cache (sem hit no Supabase)
 *   3. Se expirado/ausente → busca no Supabase, salva no cache, retorna
 *
 * ORDENAÇÃO:
 *   - Obras 'ativa' sempre primeiro (gestor vê o que importa sem rolar)
 *   - Dentro do mesmo status: mais recentemente atualizada primeiro
 *
 * @param {boolean} forcarRefresh  Se true, ignora o cache e vai direto ao Supabase
 * @returns {Promise<Array>}       Array de obras (pode ser vazio)
 * @throws {Error}                 Erro de conexão ou query — trate com try/catch
 */
async function buscarObras(forcarRefresh = false) {
  // ── Cache-first ───────────────────────────────────────────────────────────
  if (!forcarRefresh) {
    const cachedObras = cacheGet(CACHE_KEY_OBRAS);
    if (cachedObras) {
      console.log(
        `[DEKA][Hub] ${cachedObras.length} obras carregadas do cache ` +
        `(TTL: ${CACHE_TTL_OBRAS} min).`
      );
      return cachedObras;
    }
  }

  // ── Fetch no Supabase ─────────────────────────────────────────────────────
  console.log('[DEKA][Hub] Cache ausente ou forçado. Buscando obras no Supabase...');

  const { data: obras, error } = await supabase
    .from('obras')
    .select(CAMPOS_OBRAS)
    .order('status',     { ascending: true })   // 'ativa' < 'concluida' < 'pausada' alfabeticamente
    .order('updated_at', { ascending: false });  // mais recente primeiro dentro do status

  // Erros do Supabase não lançam exceção — verificação obrigatória
  if (error) {
    throw new Error(
      `Falha ao buscar obras do banco de dados: ${error.message} ` +
      `(código: ${error.code ?? 'desconhecido'})`
    );
  }

  if (!Array.isArray(obras)) {
    throw new Error(
      'Resposta inesperada do banco de dados: dados de obras não são um array.'
    );
  }

  // Reordena no cliente para garantir: ativas > pausadas > concluídas
  // (ordem alfabética do Supabase não equivale à ordem de prioridade do negócio)
  const obrasOrdenadas = [...obras].sort((a, b) => {
    const ordemA = CONFIG_STATUS[a.status]?.ordem ?? 99;
    const ordemB = CONFIG_STATUS[b.status]?.ordem ?? 99;
    if (ordemA !== ordemB) return ordemA - ordemB;
    // Mesmo status: mais recente primeiro
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  // Salva no cache (falha de cache não bloqueia o fluxo — cacheSet retorna boolean)
  const cacheSalvo = cacheSet(CACHE_KEY_OBRAS, obrasOrdenadas, CACHE_TTL_OBRAS);
  if (!cacheSalvo) {
    console.warn('[DEKA][Hub] Cache não foi salvo (possível localStorage cheio). Próxima leitura irá ao Supabase.');
  }

  _estado.ultimaAtualizacao = new Date();
  console.log(`[DEKA][Hub] ${obrasOrdenadas.length} obras carregadas do Supabase e cacheadas.`);

  return obrasOrdenadas;
}

// =============================================================================
// SEÇÃO 5 — RENDERIZAÇÃO
// =============================================================================

/**
 * Renderiza o estado de carregamento (skeleton cards).
 * Exibe 3 placeholders animados enquanto os dados chegam.
 * Acessível: aria-busy no container.
 *
 * @param {HTMLElement} grid  Container #hub-grid
 */
function renderizarLoading(grid) {
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = ''; // limpa estado anterior

  for (let i = 0; i < 3; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'obra-card obra-card--skeleton';
    skeleton.setAttribute('aria-hidden', 'true');

    // Estrutura interna do skeleton (divs animados pelo CSS do hub.html)
    const linhas = ['skeleton-titulo', 'skeleton-cliente', 'skeleton-barra', 'skeleton-rodape'];
    linhas.forEach((classe) => {
      const linha = document.createElement('div');
      linha.className = `skeleton-linha ${classe}`;
      skeleton.appendChild(linha);
    });

    grid.appendChild(skeleton);
  }
}

/**
 * Renderiza o estado de erro com botão de retry.
 *
 * @param {HTMLElement} grid           Container #hub-grid
 * @param {string}      mensagemErro   Mensagem de erro para exibir
 * @param {Function}    aoRetry        Callback ao clicar em "Tentar novamente"
 */
function renderizarErro(grid, mensagemErro, aoRetry) {
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const estado = document.createElement('div');
  estado.className = 'hub-estado-vazio';
  estado.setAttribute('role', 'alert');

  const icone = document.createElement('div');
  icone.className = 'hub-estado-icone';
  icone.textContent = '⚠️';
  icone.setAttribute('aria-hidden', 'true');

  const titulo = document.createElement('h2');
  titulo.className = 'hub-estado-titulo';
  titulo.textContent = 'Não foi possível carregar as obras';

  const descricao = document.createElement('p');
  descricao.className = 'hub-estado-descricao';
  descricao.textContent = mensagemErro;

  const btnRetry = document.createElement('button');
  btnRetry.className = 'btn btn-primario';
  btnRetry.textContent = '↺ Tentar novamente';
  btnRetry.addEventListener('click', aoRetry);

  estado.appendChild(icone);
  estado.appendChild(titulo);
  estado.appendChild(descricao);
  estado.appendChild(btnRetry);
  grid.appendChild(estado);
}

/**
 * Renderiza o estado vazio (nenhuma obra cadastrada).
 *
 * @param {HTMLElement} grid  Container #hub-grid
 */
function renderizarVazio(grid) {
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const estado = document.createElement('div');
  estado.className = 'hub-estado-vazio';

  const icone = document.createElement('div');
  icone.className = 'hub-estado-icone';
  icone.textContent = '🏗️';
  icone.setAttribute('aria-hidden', 'true');

  const titulo = document.createElement('h2');
  titulo.className = 'hub-estado-titulo';
  titulo.textContent = 'Nenhuma obra cadastrada';

  const descricao = document.createElement('p');
  descricao.className = 'hub-estado-descricao';
  descricao.textContent = 'As obras ativas aparecerão aqui assim que forem cadastradas no sistema.';

  estado.appendChild(icone);
  estado.appendChild(titulo);
  estado.appendChild(descricao);
  grid.appendChild(estado);
}

/**
 * Cria o elemento DOM de um card de obra.
 * USA APENAS createElement + textContent — NUNCA innerHTML com dados externos.
 * Isso previne XSS mesmo que dados do Supabase contenham scripts.
 *
 * @param {Object} obra   Objeto obra do Supabase
 * @returns {HTMLElement} Card pronto para inserir no grid
 */
function criarCardObra(obra) {
  const cfgStatus = CONFIG_STATUS[obra.status] ?? CONFIG_STATUS._desconhecido;

  // Calcula se está atrasada (apenas obras ativas com previsão definida)
  const estaAtrasada =
    obra.status === 'ativa' &&
    obra.data_previsao_fim &&
    new Date(obra.data_previsao_fim) < new Date();

  // ── Container principal (clicável) ────────────────────────────────────────
  const card = document.createElement('article');
  card.className = [
    'obra-card',
    `obra-card--${obra.status ?? 'desconhecido'}`,
    estaAtrasada ? 'obra-card--atrasada' : '',
  ].filter(Boolean).join(' ');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Abrir obra: ${obra.nome}`);
  card.dataset.obraId = obra.id; // para event delegation no grid

  // ── Cabeçalho: badge de status + indicador de atraso ─────────────────────
  const cabecalho = document.createElement('header');
  cabecalho.className = 'obra-card__cabecalho';

  const badge = document.createElement('span');
  badge.className = `obra-card__badge ${cfgStatus.classe}`;
  badge.textContent = `${cfgStatus.emoji} ${cfgStatus.label}`;

  cabecalho.appendChild(badge);

  if (estaAtrasada) {
    const badgeAtraso = document.createElement('span');
    badgeAtraso.className = 'obra-card__badge obra-card__badge--atraso';
    badgeAtraso.textContent = '⏰ Atrasada';
    cabecalho.appendChild(badgeAtraso);
  }

  // ── Corpo: nome e cliente ─────────────────────────────────────────────────
  const corpo = document.createElement('div');
  corpo.className = 'obra-card__corpo';

  const nomeObra = document.createElement('h2');
  nomeObra.className = 'obra-card__nome';
  nomeObra.textContent = obra.nome ?? 'Obra sem nome';

  const nomeCliente = document.createElement('p');
  nomeCliente.className = 'obra-card__cliente';

  const rotuloCli = document.createElement('span');
  rotuloCli.className = 'obra-card__rotulo';
  rotuloCli.textContent = 'Cliente';

  const valorCli = document.createElement('span');
  valorCli.textContent = obra.cliente ?? '—';

  nomeCliente.appendChild(rotuloCli);
  nomeCliente.appendChild(valorCli);

  corpo.appendChild(nomeObra);
  corpo.appendChild(nomeCliente);

  // ── Barra de progresso ────────────────────────────────────────────────────
  const secaoProgresso = document.createElement('div');
  secaoProgresso.className = 'obra-card__progresso';

  const percentual = Math.min(100, Math.max(0, Number(obra.percentual_global) || 0));

  const rotuloProg = document.createElement('div');
  rotuloProg.className = 'obra-card__progresso-rotulo';

  const textoAvanço = document.createElement('span');
  textoAvanço.textContent = 'Avanço físico';

  const textoPercentual = document.createElement('span');
  textoPercentual.className = 'obra-card__progresso-valor';
  textoPercentual.textContent = `${percentual}%`;

  rotuloProg.appendChild(textoAvanço);
  rotuloProg.appendChild(textoPercentual);

  const trilha = document.createElement('div');
  trilha.className = 'obra-card__barra-trilha';
  trilha.setAttribute('role', 'progressbar');
  trilha.setAttribute('aria-valuenow', percentual);
  trilha.setAttribute('aria-valuemin', '0');
  trilha.setAttribute('aria-valuemax', '100');
  trilha.setAttribute('aria-label', `${percentual}% concluído`);

  const preenchimento = document.createElement('div');
  preenchimento.className = 'obra-card__barra-preenchimento';
  preenchimento.style.width = `${percentual}%`;
  // Cor da barra muda por threshold: verde >70%, amarelo >30%, vermelho ≤30%
  preenchimento.className += percentual > 70
    ? ' barra--alta'
    : percentual > 30
    ? ' barra--media'
    : ' barra--baixa';

  trilha.appendChild(preenchimento);
  secaoProgresso.appendChild(rotuloProg);
  secaoProgresso.appendChild(trilha);

  // ── Rodapé: previsão de término ───────────────────────────────────────────
  const rodape = document.createElement('footer');
  rodape.className = 'obra-card__rodape';

  const rotuloData = document.createElement('span');
  rotuloData.className = 'obra-card__rotulo';
  rotuloData.textContent = estaAtrasada ? '⏰ Previsão (ultrapassada)' : '📅 Previsão de término';

  const valorData = document.createElement('span');
  valorData.className = estaAtrasada ? 'obra-card__data--atrasada' : '';
  valorData.textContent = obra.data_previsao_fim
    ? formatarDataBR(obra.data_previsao_fim + 'T12:00:00') // força noon p/ evitar fuso
    : 'Não definida';

  rodape.appendChild(rotuloData);
  rodape.appendChild(valorData);

  // ── Ícone de navegação ────────────────────────────────────────────────────
  const iconeNav = document.createElement('span');
  iconeNav.className = 'obra-card__nav';
  iconeNav.textContent = '→';
  iconeNav.setAttribute('aria-hidden', 'true');

  // ── Montagem final do card ────────────────────────────────────────────────
  card.appendChild(cabecalho);
  card.appendChild(corpo);
  card.appendChild(secaoProgresso);
  card.appendChild(rodape);
  card.appendChild(iconeNav);

  return card;
}

/**
 * Renderiza a lista de obras no grid.
 * Usa DocumentFragment para uma única operação de reflow no DOM.
 *
 * @param {HTMLElement} grid    Container #hub-grid
 * @param {Array}       obras   Array de obras validado e ordenado
 */
function renderizarObras(grid, obras) {
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = '';

  const fragmento = document.createDocumentFragment();

  obras.forEach((obra) => {
    const card = criarCardObra(obra);
    fragmento.appendChild(card);
  });

  grid.appendChild(fragmento);
}

// =============================================================================
// SEÇÃO 6 — ATUALIZAÇÃO DA BARRA DE STATUS
// =============================================================================

/**
 * Atualiza o texto da barra de status e o contador de obras.
 *
 * @param {HTMLElement} statusBar   #hub-status-bar
 * @param {HTMLElement} contador    #hub-contador
 * @param {Object}      dados       { total, ativas, pausadas, concluidas, ultimaAtualizacao }
 */
function atualizarStatusBar(statusBar, contador, dados) {
  // Contador de obras ativas no título
  contador.textContent = dados.total > 0
    ? `${dados.total} obra${dados.total > 1 ? 's' : ''}`
    : 'Nenhuma obra';

  // Resumo na barra de status
  const partes = [];
  if (dados.ativas    > 0) partes.push(`${dados.ativas} ativa${dados.ativas    > 1 ? 's' : ''}`);
  if (dados.pausadas  > 0) partes.push(`${dados.pausadas} pausada${dados.pausadas  > 1 ? 's' : ''}`);
  if (dados.concluidas > 0) partes.push(`${dados.concluidas} concluída${dados.concluidas > 1 ? 's' : ''}`);

  const resumo = partes.length > 0 ? partes.join(' · ') : 'Nenhum projeto no sistema';

  // Timestamp da última sincronização
  const timestamp = dados.ultimaAtualizacao
    ? `Atualizado em ${formatarDataBR(dados.ultimaAtualizacao)}`
    : 'Dados em cache';

  // Monta o texto com textContent (seguro)
  statusBar.textContent = '';

  const spanResumo = document.createElement('span');
  spanResumo.textContent = resumo;

  const spanSep = document.createElement('span');
  spanSep.className = 'status-bar__separador';
  spanSep.textContent = ' · ';
  spanSep.setAttribute('aria-hidden', 'true');

  const spanTimestamp = document.createElement('span');
  spanTimestamp.className = 'status-bar__timestamp';
  spanTimestamp.textContent = timestamp;

  statusBar.appendChild(spanResumo);
  statusBar.appendChild(spanSep);
  statusBar.appendChild(spanTimestamp);
}

// =============================================================================
// SEÇÃO 7 — ROTEAMENTO
// =============================================================================

/**
 * Navega para a tela de detalhe de uma obra.
 * URL: obra.html?id=<uuid>
 *
 * Usa o UUID real (id do Supabase) para garantir unicidade e
 * permitir que obra.html faça a query diretamente por PK.
 *
 * @param {string} obraId  UUID da obra (obra.id do Supabase)
 */
function navegarParaObra(obraId) {
  if (!obraId || typeof obraId !== 'string') {
    console.error('[DEKA][Hub] Tentativa de navegação com ID de obra inválido:', obraId);
    showToast('ID da obra inválido. Não foi possível abrir os detalhes.', 'error');
    return;
  }

  // Valida formato UUID básico antes de navegar
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(obraId)) {
    console.error('[DEKA][Hub] ID de obra não é um UUID válido:', obraId);
    showToast('Formato de ID inválido. Contate o suporte técnico.', 'error');
    return;
  }

  const url = `/obra.html?id=${encodeURIComponent(obraId)}`;
  console.log(`[DEKA][Hub] Navegando para obra: ${obraId}`);
  window.location.href = url;
}

// =============================================================================
// SEÇÃO 8 — ORQUESTRAÇÃO PRINCIPAL
// =============================================================================

/**
 * Carrega as obras (cache ou Supabase) e renderiza o hub completo.
 * Gerencia os 4 estados da UI: loading → (obras | vazio | erro).
 *
 * @param {Object}  elementos          Referências ao DOM (do lerElementosDOM)
 * @param {boolean} forcarRefresh      Se true, ignora cache
 */
async function carregarObras(elementos, forcarRefresh = false) {
  const { grid, statusBar, contador, btnRefresh } = elementos;

  // Proteção contra double-fetch
  if (_estado.carregando) {
    console.warn('[DEKA][Hub] carregarObras() chamado enquanto já estava carregando. Ignorado.');
    return;
  }

  _estado.carregando = true;
  btnRefresh.disabled = true;
  btnRefresh.textContent = '⏳ Atualizando...';

  // ── Estado: loading ───────────────────────────────────────────────────────
  renderizarLoading(grid);

  try {
    const obras = await buscarObras(forcarRefresh);
    _estado.obras = obras;

    // ── Estado: vazio ─────────────────────────────────────────────────────
    if (obras.length === 0) {
      renderizarVazio(grid);
      atualizarStatusBar(statusBar, contador, {
        total: 0, ativas: 0, pausadas: 0, concluidas: 0,
        ultimaAtualizacao: _estado.ultimaAtualizacao,
      });
      return;
    }

    // ── Estado: obras carregadas ──────────────────────────────────────────
    renderizarObras(grid, obras);

    // Contagem por status para a barra de status
    const contagem = obras.reduce(
      (acc, o) => {
        acc.total++;
        if (o.status === 'ativa')     acc.ativas++;
        if (o.status === 'pausada')   acc.pausadas++;
        if (o.status === 'concluida') acc.concluidas++;
        return acc;
      },
      { total: 0, ativas: 0, pausadas: 0, concluidas: 0 }
    );

    atualizarStatusBar(statusBar, contador, {
      ...contagem,
      ultimaAtualizacao: _estado.ultimaAtualizacao,
    });

    // Toast apenas em refresh manual (não no carregamento inicial)
    if (forcarRefresh) {
      showToast(`${obras.length} obra${obras.length > 1 ? 's' : ''} atualizada${obras.length > 1 ? 's' : ''} com sucesso.`, 'success');
    }

  } catch (erro) {
    // ── Estado: erro (com retry) ──────────────────────────────────────────
    console.error('[DEKA][Hub] Falha ao carregar obras:', erro);
    showToast(
      `Não foi possível carregar as obras: ${erro.message}`,
      'error'
    );

    renderizarErro(
      grid,
      erro.message,
      () => carregarObras(elementos, true) // retry força refresh do Supabase
    );

    atualizarStatusBar(statusBar, contador, {
      total: 0, ativas: 0, pausadas: 0, concluidas: 0,
      ultimaAtualizacao: null,
    });

  } finally {
    _estado.carregando = false;
    btnRefresh.disabled = false;
    btnRefresh.textContent = '↺ Atualizar';
  }
}

// =============================================================================
// SEÇÃO 9 — EVENT LISTENERS
// =============================================================================

/**
 * Registra todos os event listeners do hub.
 * Usa event delegation no grid para os cards (evita N listeners para N cards).
 *
 * @param {Object} elementos  Referências ao DOM
 */
function registrarEventos(elementos) {
  const { grid, btnRefresh } = elementos;

  // ── Botão de refresh manual ───────────────────────────────────────────────
  btnRefresh.addEventListener('click', () => {
    carregarObras(elementos, true); // força bypass do cache
  });

  // ── Event delegation nos cards (click + teclado) ──────────────────────────
  // Um único listener no grid pai, não N listeners nos filhos.
  grid.addEventListener('click', (evento) => {
    const card = evento.target.closest('[data-obra-id]');
    if (!card) return;
    navegarParaObra(card.dataset.obraId);
  });

  // Acessibilidade: Enter e Space ativam o card via teclado
  grid.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    const card = evento.target.closest('[data-obra-id]');
    if (!card) return;
    evento.preventDefault(); // evita scroll no Space
    navegarParaObra(card.dataset.obraId);
  });

  // ── Listener de visibilidade (recarrega ao retornar à aba) ───────────────
  // Se o gestor abriu uma obra, editou dados e voltou ao hub,
  // o cache pode estar desatualizado. Forçamos refresh silencioso.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!_estado.ultimaAtualizacao) return;

    const minutosDesdeUltimaAtualizacao =
      (Date.now() - _estado.ultimaAtualizacao.getTime()) / 60_000;

    // Refresh automático apenas se o cache expirou (>= TTL)
    if (minutosDesdeUltimaAtualizacao >= CACHE_TTL_OBRAS) {
      console.log('[DEKA][Hub] Aba reativada após cache expirado. Atualizando...');
      carregarObras(elementos, true);
    }
  });
}

// =============================================================================
// SEÇÃO 10 — PONTO DE ENTRADA ÚNICO
// =============================================================================

/**
 * Inicializa o módulo Hub de Obras.
 * Chamado pelo hub.html via:
 *   <script type="module">
 *     import { init } from './hub.js';
 *     init();
 *   </script>
 *
 * NÃO usa DOMContentLoaded — essa responsabilidade é exclusiva do deka.js.
 * O HTML deve chamar init() após o DOM estar pronto (ao final do <body>).
 *
 * @returns {Promise<void>}
 */
export async function init() {
  // Valida que o Supabase foi inicializado pelo deka.js
  if (!supabase) {
    console.error(
      '[DEKA][Hub] supabase é null. ' +
      'Verifique se window.DEKA_CONFIG está definido antes de importar deka.js.'
    );
    showToast(
      'Erro de inicialização: banco de dados não conectado. Recarregue a página.',
      'error',
      { persistir: true }
    );
    return;
  }

  // Lê os elementos do DOM — lança erro claro se ausentes
  let elementos;
  try {
    elementos = lerElementosDOM();
  } catch (erroDOM) {
    console.error('[DEKA][Hub] Falha ao ler elementos do DOM:', erroDOM);
    showToast(
      'Erro de inicialização da tela. Contate o suporte técnico.',
      'error',
      { persistir: true }
    );
    return;
  }

  // Registra eventos (uma única vez)
  registrarEventos(elementos);

  // Carrega obras (cache-first)
  await carregarObras(elementos, false);

  console.log('[DEKA][Hub] ✅ Hub de Obras inicializado.');
}

// =============================================================================
// FIM DO ARQUIVO — hub.js
//
// Smoke Test (validar antes de commitar):
//   [x] Arquivo < 3.000 linhas?                                   ✅ (< 500)
//   [x] Zero DOMContentLoaded neste arquivo?                      ✅
//   [x] Zero innerHTML com dados externos (XSS)?                  ✅ (só textContent)
//   [x] Todo catch tem console.error + showToast?                  ✅
//   [x] cacheGet/cacheSet com TTL explícito?                      ✅ (10 min)
//   [x] Campos do Supabase listados explicitamente (não SELECT *)? ✅
//   [x] Roteamento via UUID validado com regex?                    ✅
//   [x] Event delegation (1 listener, N cards)?                   ✅
//   [x] Estado de loading, erro e vazio implementados?            ✅
//   [x] Arquivo entregue COMPLETO (não patch)?                    ✅
// =============================================================================

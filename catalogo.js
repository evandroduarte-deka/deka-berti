/**
 * DEKA OS v2.0 — catalogo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Catálogo de Serviços — Aprovação e Gestão
 *
 * RESPONSABILIDADES:
 *   - Exibir serviços pendentes de aprovação (códigos novos)
 *   - Aprovar serviços → INSERT em base_servicos
 *   - Rejeitar serviços (remover da fila local)
 *   - Exibir catálogo ativo com filtros
 *
 * TABELAS SUPABASE:
 *   - itens_proposta (READ para buscar códigos novos)
 *   - base_servicos (READ catálogo, WRITE aprovações)
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos (console.error + showToast obrigatórios)
 *   - SELECT explícito (nunca SELECT *)
 *   - createElement para cards (nunca innerHTML com dados externos)
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
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const CATEGORIAS = [
  'Estrutura',
  'Alvenaria',
  'Revestimento',
  'Pintura',
  'Cobertura',
  'Impermeabilização',
  'Instalações Elétricas',
  'Instalações Hidráulicas',
  'Instalações Sanitárias',
  'Esquadrias',
  'Vidros',
  'Acabamentos',
  'Pisos',
  'Tetos',
  'Portas',
  'Serviços Gerais',
  'Limpeza',
  'Demolição',
  'Movimentação de Terra',
  'Outros',
];

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

const Estado = {
  // DOM
  badgePendentes: null,
  tabPendentes: null,
  tabAtivo: null,
  abaPendentes: null,
  abaCatalogo: null,
  listaPendentes: null,
  emptyPendentes: null,
  listaCatalogo: null,
  filtroCategoriaSelect: null,
  countCatalogo: null,

  // Dados
  pendentes: [],
  catalogo: [],
  abaAtiva: 'pendentes',
  categoriaFiltro: '',
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

export async function init() {
  console.log('[DEKA][Catalogo] Inicializando módulo...');

  carregarElementosDOM();
  configurarEventListeners();
  popularSelectCategorias();
  await Promise.all([
    carregarPendentes(),
    carregarCatalogo(),
  ]);

  console.log('[DEKA][Catalogo] ✅ Módulo inicializado.');
}

function carregarElementosDOM() {
  Estado.badgePendentes = document.getElementById('badge-pendentes');
  Estado.tabPendentes = document.getElementById('tab-pendentes');
  Estado.tabAtivo = document.getElementById('tab-ativo');
  Estado.abaPendentes = document.getElementById('aba-pendentes');
  Estado.abaCatalogo = document.getElementById('aba-catalogo');
  Estado.listaPendentes = document.getElementById('lista-pendentes');
  Estado.emptyPendentes = document.getElementById('empty-pendentes');
  Estado.listaCatalogo = document.getElementById('lista-catalogo');
  Estado.filtroCategoriaSelect = document.getElementById('filtro-categoria');
  Estado.countCatalogo = document.getElementById('count-catalogo');

  // Validar elementos obrigatórios
  const elementosObrigatorios = [
    'badgePendentes', 'tabPendentes', 'tabAtivo',
    'abaPendentes', 'abaCatalogo', 'listaPendentes',
    'emptyPendentes', 'listaCatalogo', 'filtroCategoriaSelect', 'countCatalogo',
  ];

  elementosObrigatorios.forEach(nome => {
    if (!Estado[nome]) {
      throw new Error(`[DEKA][Catalogo] Elemento #${nome} não encontrado no DOM`);
    }
  });
}

function configurarEventListeners() {
  Estado.tabPendentes.addEventListener('click', () => alternarAba('pendentes'));
  Estado.tabAtivo.addEventListener('click', () => alternarAba('catalogo'));
  Estado.filtroCategoriaSelect.addEventListener('change', (e) => {
    Estado.categoriaFiltro = e.target.value;
    renderizarCatalogo();
  });
}

function popularSelectCategorias() {
  CATEGORIAS.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    Estado.filtroCategoriaSelect.appendChild(option);
  });
}

// =============================================================================
// CARREGAMENTO DE PENDENTES
// =============================================================================

async function carregarPendentes() {
  try {
    console.log('[DEKA][Catalogo] Carregando serviços pendentes...');

    // 1. Buscar códigos ativos em base_servicos
    const { data: codigosAtivos, error: erroAtivos } = await supabase
      .from('base_servicos')
      .select('codigo')
      .eq('ativo', true);

    if (erroAtivos) {
      console.error('[DEKA][Catalogo] Erro ao buscar códigos ativos:', erroAtivos);
      throw new Error('Erro ao buscar códigos ativos: ' + erroAtivos.message);
    }

    const codigosExistentes = (codigosAtivos || []).map(s => s.codigo);

    // 2. Buscar itens_proposta com códigos novos
    const { data: itens, error: erroItens } = await supabase
      .from('itens_proposta')
      .select('codigo_servico, categoria, descricao_interna, descricao_cliente, unidade')
      .not('codigo_servico', 'is', null);

    if (erroItens) {
      console.error('[DEKA][Catalogo] Erro ao buscar itens_proposta:', erroItens);
      throw new Error('Erro ao buscar itens: ' + erroItens.message);
    }

    // 3. Filtrar códigos que NÃO existem em base_servicos
    const itensNovos = (itens || []).filter(item =>
      item.codigo_servico && !codigosExistentes.includes(item.codigo_servico)
    );

    // 4. Agrupar por codigo_servico e contar ocorrências
    const agrupados = {};
    itensNovos.forEach(item => {
      const codigo = item.codigo_servico;
      if (!agrupados[codigo]) {
        agrupados[codigo] = {
          codigo_servico: codigo,
          categoria: item.categoria || 'Outros',
          descricao_interna: item.descricao_interna || '',
          descricao_cliente: item.descricao_cliente || item.descricao_interna || '',
          unidade: item.unidade || 'un',
          count: 0,
        };
      }
      agrupados[codigo].count++;
    });

    // 5. Converter para array e ordenar por count (mais usados primeiro)
    Estado.pendentes = Object.values(agrupados).sort((a, b) => b.count - a.count);

    console.log('[DEKA][Catalogo] Pendentes carregados:', Estado.pendentes.length);

    // 6. Atualizar badge
    if (Estado.pendentes.length > 0) {
      Estado.badgePendentes.textContent = Estado.pendentes.length;
      Estado.badgePendentes.classList.remove('oculto');
    } else {
      Estado.badgePendentes.classList.add('oculto');
    }

    renderizarPendentes();

  } catch (erro) {
    console.error('[DEKA][Catalogo] Erro ao carregar pendentes:', erro);
    showToast(erro.message || 'Erro ao carregar pendentes.', 'error');
  }
}

// =============================================================================
// CARREGAMENTO DE CATÁLOGO
// =============================================================================

async function carregarCatalogo() {
  try {
    console.log('[DEKA][Catalogo] Carregando catálogo ativo...');

    const { data, error } = await supabase
      .from('base_servicos')
      .select(`
        codigo,
        categoria,
        descricao_interna,
        descricao_cliente,
        unidade,
        valor_referencia,
        fonte,
        ativo
      `)
      .eq('ativo', true)
      .order('categoria', { ascending: true })
      .order('codigo', { ascending: true });

    if (error) {
      console.error('[DEKA][Catalogo] Erro ao carregar catálogo:', error);
      throw new Error('Erro ao carregar catálogo: ' + error.message);
    }

    Estado.catalogo = data || [];

    console.log('[DEKA][Catalogo] Catálogo carregado:', Estado.catalogo.length);

    renderizarCatalogo();

  } catch (erro) {
    console.error('[DEKA][Catalogo] Erro ao carregar catálogo:', erro);
    showToast(erro.message || 'Erro ao carregar catálogo.', 'error');
  }
}

// =============================================================================
// RENDERIZAÇÃO DE PENDENTES
// =============================================================================

function renderizarPendentes() {
  Estado.listaPendentes.innerHTML = '';

  if (Estado.pendentes.length === 0) {
    Estado.emptyPendentes.classList.remove('oculto');
    return;
  }

  Estado.emptyPendentes.classList.add('oculto');

  Estado.pendentes.forEach(pendente => {
    const card = criarCardPendente(pendente);
    Estado.listaPendentes.appendChild(card);
  });
}

function criarCardPendente(pendente) {
  const card = document.createElement('div');
  card.className = 'servico-card';
  card.setAttribute('data-codigo', pendente.codigo_servico);

  // Header
  const header = document.createElement('div');
  header.className = 'servico-header';

  const codigo = document.createElement('div');
  codigo.className = 'servico-codigo';
  codigo.textContent = pendente.codigo_servico;

  const categoria = document.createElement('div');
  categoria.className = 'servico-categoria';
  categoria.textContent = pendente.categoria;

  const badgeUso = document.createElement('div');
  badgeUso.className = 'badge-uso';
  badgeUso.textContent = `${pendente.count} ${pendente.count === 1 ? 'proposta' : 'propostas'}`;

  header.appendChild(codigo);
  header.appendChild(categoria);
  header.appendChild(badgeUso);

  // Descrição interna
  const descInterna = document.createElement('div');
  descInterna.className = 'servico-descricao';
  descInterna.innerHTML = `<strong>Descrição interna:</strong> ${pendente.descricao_interna}`;

  // Campos editáveis
  const campos = document.createElement('div');
  campos.className = 'servico-campos';

  // Campo: Descrição Cliente
  const campoDescCliente = document.createElement('div');
  campoDescCliente.className = 'campo-editavel';

  const labelDescCliente = document.createElement('div');
  labelDescCliente.className = 'campo-label';
  labelDescCliente.textContent = 'Descrição Cliente';

  const inputDescCliente = document.createElement('input');
  inputDescCliente.type = 'text';
  inputDescCliente.className = 'campo-input';
  inputDescCliente.value = pendente.descricao_cliente;
  inputDescCliente.id = `desc-${pendente.codigo_servico}`;

  campoDescCliente.appendChild(labelDescCliente);
  campoDescCliente.appendChild(inputDescCliente);

  // Campo: Unidade
  const campoUnidade = document.createElement('div');
  campoUnidade.className = 'campo-editavel';

  const labelUnidade = document.createElement('div');
  labelUnidade.className = 'campo-label';
  labelUnidade.textContent = 'Unidade';

  const selectUnidade = document.createElement('select');
  selectUnidade.className = 'campo-input';
  selectUnidade.id = `unidade-${pendente.codigo_servico}`;

  const unidades = ['un', 'm', 'm²', 'm³', 'kg', 'l', 'vb', 'cj'];
  unidades.forEach(un => {
    const opt = document.createElement('option');
    opt.value = un;
    opt.textContent = un;
    if (un === pendente.unidade) opt.selected = true;
    selectUnidade.appendChild(opt);
  });

  campoUnidade.appendChild(labelUnidade);
  campoUnidade.appendChild(selectUnidade);

  // Campo: Valor Referência
  const campoValor = document.createElement('div');
  campoValor.className = 'campo-editavel';

  const labelValor = document.createElement('div');
  labelValor.className = 'campo-label';
  labelValor.textContent = 'Valor Referência (R$)';

  const inputValor = document.createElement('input');
  inputValor.type = 'number';
  inputValor.step = '0.01';
  inputValor.className = 'campo-input';
  inputValor.value = '0';
  inputValor.id = `valor-${pendente.codigo_servico}`;

  campoValor.appendChild(labelValor);
  campoValor.appendChild(inputValor);

  campos.appendChild(campoDescCliente);
  campos.appendChild(campoUnidade);
  campos.appendChild(campoValor);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'servico-actions';

  const btnAprovar = document.createElement('button');
  btnAprovar.className = 'btn-acao success';
  btnAprovar.textContent = '✅ Aprovar';
  btnAprovar.onclick = () => aoAprovarServico(pendente.codigo_servico);

  const btnRejeitar = document.createElement('button');
  btnRejeitar.className = 'btn-acao danger';
  btnRejeitar.textContent = '❌ Rejeitar';
  btnRejeitar.onclick = () => aoRejeitarServico(pendente.codigo_servico);

  actions.appendChild(btnAprovar);
  actions.appendChild(btnRejeitar);

  card.appendChild(header);
  card.appendChild(descInterna);
  card.appendChild(campos);
  card.appendChild(actions);

  return card;
}

// =============================================================================
// RENDERIZAÇÃO DE CATÁLOGO
// =============================================================================

function renderizarCatalogo() {
  Estado.listaCatalogo.innerHTML = '';

  // Filtrar por categoria
  let catalogoFiltrado = Estado.catalogo;
  if (Estado.categoriaFiltro) {
    catalogoFiltrado = catalogoFiltrado.filter(s => s.categoria === Estado.categoriaFiltro);
  }

  // Atualizar contador
  Estado.countCatalogo.textContent = `${catalogoFiltrado.length} ${catalogoFiltrado.length === 1 ? 'serviço' : 'serviços'}`;

  catalogoFiltrado.forEach(servico => {
    const card = criarCardCatalogo(servico);
    Estado.listaCatalogo.appendChild(card);
  });
}

function criarCardCatalogo(servico) {
  const card = document.createElement('div');
  card.className = 'servico-card';

  // Header
  const header = document.createElement('div');
  header.className = 'servico-header';

  const codigo = document.createElement('div');
  codigo.className = 'servico-codigo';
  codigo.textContent = servico.codigo;

  const categoria = document.createElement('div');
  categoria.className = 'servico-categoria';
  categoria.textContent = servico.categoria;

  const badgeFonte = document.createElement('div');
  badgeFonte.className = 'badge-fonte';
  badgeFonte.textContent = servico.fonte || 'Berti v3';

  header.appendChild(codigo);
  header.appendChild(categoria);
  header.appendChild(badgeFonte);

  // Descrições
  const descInterna = document.createElement('div');
  descInterna.className = 'servico-descricao';
  descInterna.innerHTML = `<strong>Interna:</strong> ${servico.descricao_interna}`;

  const descCliente = document.createElement('div');
  descCliente.className = 'servico-descricao';
  descCliente.innerHTML = `<strong>Cliente:</strong> ${servico.descricao_cliente || servico.descricao_interna}`;

  // Unidade e Valor
  const info = document.createElement('div');
  info.style.fontSize = '13px';
  info.style.color = 'var(--text-secondary)';
  info.style.marginTop = '8px';
  info.textContent = `Unidade: ${servico.unidade} • Valor: R$ ${(servico.valor_referencia || 0).toFixed(2)}`;

  card.appendChild(header);
  card.appendChild(descInterna);
  card.appendChild(descCliente);
  card.appendChild(info);

  return card;
}

// =============================================================================
// AÇÕES: APROVAR SERVIÇO
// =============================================================================

async function aoAprovarServico(codigo) {
  try {
    // 1. Buscar pendente
    const pendente = Estado.pendentes.find(p => p.codigo_servico === codigo);
    if (!pendente) {
      throw new Error('Serviço pendente não encontrado.');
    }

    // 2. Ler valores editados no card
    const inputDescCliente = document.getElementById(`desc-${codigo}`);
    const selectUnidade = document.getElementById(`unidade-${codigo}`);
    const inputValor = document.getElementById(`valor-${codigo}`);

    if (!inputDescCliente || !selectUnidade || !inputValor) {
      throw new Error('Campos editáveis não encontrados.');
    }

    const descricaoCliente = inputDescCliente.value.trim() || pendente.descricao_interna;
    const unidade = selectUnidade.value;
    const valorReferencia = parseFloat(inputValor.value) || 0;

    // 3. INSERT em base_servicos
    const { error } = await supabase
      .from('base_servicos')
      .insert({
        codigo: pendente.codigo_servico,
        categoria: pendente.categoria,
        descricao_interna: pendente.descricao_interna,
        descricao_cliente: descricaoCliente,
        unidade: unidade,
        valor_referencia: valorReferencia,
        fonte: 'Gestor-Aprovado',
        ativo: true,
      });

    if (error) {
      console.error('[DEKA][Catalogo] Erro ao aprovar serviço:', error);
      throw new Error('Erro ao aprovar serviço: ' + error.message);
    }

    showToast('Serviço aprovado e adicionado ao catálogo!', 'success');

    // 4. Remover card da lista
    const card = document.querySelector(`[data-codigo="${codigo}"]`);
    if (card) card.remove();

    // 5. Remover do Estado
    Estado.pendentes = Estado.pendentes.filter(p => p.codigo_servico !== codigo);

    // 6. Atualizar badge
    if (Estado.pendentes.length > 0) {
      Estado.badgePendentes.textContent = Estado.pendentes.length;
    } else {
      Estado.badgePendentes.classList.add('oculto');
      Estado.emptyPendentes.classList.remove('oculto');
    }

    // 7. Recarregar catálogo
    await carregarCatalogo();

  } catch (erro) {
    console.error('[DEKA][Catalogo] Erro ao aprovar serviço:', erro);
    showToast(erro.message || 'Erro ao aprovar serviço.', 'error');
  }
}

// =============================================================================
// AÇÕES: REJEITAR SERVIÇO
// =============================================================================

function aoRejeitarServico(codigo) {
  // 1. Remover card da lista
  const card = document.querySelector(`[data-codigo="${codigo}"]`);
  if (card) card.remove();

  // 2. Remover do Estado
  Estado.pendentes = Estado.pendentes.filter(p => p.codigo_servico !== codigo);

  // 3. Atualizar badge
  if (Estado.pendentes.length > 0) {
    Estado.badgePendentes.textContent = Estado.pendentes.length;
  } else {
    Estado.badgePendentes.classList.add('oculto');
    Estado.emptyPendentes.classList.remove('oculto');
  }

  showToast('Serviço ignorado.', 'warning');
}

// =============================================================================
// ALTERNAR ABAS
// =============================================================================

function alternarAba(aba) {
  Estado.abaAtiva = aba;

  // Atualizar tabs
  if (aba === 'pendentes') {
    Estado.tabPendentes.classList.add('ativo');
    Estado.tabAtivo.classList.remove('ativo');
    Estado.abaPendentes.classList.add('ativo');
    Estado.abaCatalogo.classList.remove('ativo');
  } else {
    Estado.tabPendentes.classList.remove('ativo');
    Estado.tabAtivo.classList.add('ativo');
    Estado.abaPendentes.classList.remove('ativo');
    Estado.abaCatalogo.classList.add('ativo');
  }
}

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================

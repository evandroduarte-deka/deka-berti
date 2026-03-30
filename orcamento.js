/**
 * DEKA OS v2.0 — orcamento.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: AGT_ORCAMENTO — Geração de Propostas Comerciais com IA
 *
 * RESPONSABILIDADES:
 *   - Carregar catálogo de serviços (base_servicos) com cache 60min
 *   - Permitir anexo de imagens (base64) e links de referência
 *   - Gerar proposta comercial via Claude Sonnet 4 (/v1/orcamento)
 *   - Renderizar tabela editável de itens
 *   - Salvar proposta aprovada no Supabase (propostas + itens_proposta)
 *   - Atualizar lead em brain_comercial (se lead_id na URL)
 *
 * TABELAS SUPABASE:
 *   - base_servicos (READ)
 *   - propostas (WRITE)
 *   - itens_proposta (WRITE)
 *   - brain_comercial (UPDATE opcional)
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos (console.error + showToast obrigatórios)
 *   - fetchComTimeout com 60s para chamada ao Worker (obras grandes)
 *   - Cache de catálogo: 60min (CACHE_KEY_CATALOGO)
 *   - Um único ponto de entrada: init()
 *   - Modelo: claude-sonnet-4-20250514 via /v1/orcamento
 */

// =============================================================================
// IMPORTS
// =============================================================================

import {
  supabase,
  showToast,
  fetchComTimeout,
  cacheGet,
  cacheSet,
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const WORKER_URL = window.DEKA_CONFIG.workerUrl;
const DEKA_TOKEN = window.DEKA_CONFIG.token;
const CACHE_KEY_CATALOGO = 'deka_cache_v2_base_servicos';
const CACHE_TTL_CATALOGO_MIN = 60;
const MAX_IMAGENS = 10;
const MAX_LINKS = 5;
const TIMEOUT_WORKER_MS = 60_000; // 60s para geração de propostas

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

const Estado = {
  // DOM
  form: null,
  campoBriefing: null,
  campoMargem: null,
  campoLinks: null,
  listaImagens: null,
  btnAnexarImagem: null,
  fileInput: null,
  btnGerar: null,
  loading: null,
  resultado: null,
  resultadoNomeObra: null,
  resultadoEscopo: null,
  resultadoPrazo: null,
  resultadoTotalItens: null,
  resultadoTabelaItens: null,
  resultadoCustoTotal: null,
  resultadoMargemDisplay: null,
  resultadoMargemValor: null,
  resultadoValorFinal: null,
  campoClienteNome: null,
  campoEndereco: null,
  btnAprovar: null,
  btnRegerar: null,

  // Dados
  catalogo: [],
  imagens: [], // [{media_type, data}]
  propostaAtual: null,
  leadId: null,

  // Timer de loading
  timerLoadingInterval: null,
  timerLoadingSegundos: 0,
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

export async function init() {
  console.log('[DEKA][Orcamento] Inicializando módulo...');

  carregarElementosDOM();
  configurarEventListeners();
  extrairLeadIdDaURL();
  await carregarCatalogo();

  console.log('[DEKA][Orcamento] ✅ Módulo inicializado.');
}

function carregarElementosDOM() {
  Estado.form = document.getElementById('orcamento-form');
  Estado.campoBriefing = document.getElementById('campo-briefing-texto');
  Estado.campoMargem = document.getElementById('campo-margem');
  Estado.campoLinks = document.getElementById('campo-links');
  Estado.listaImagens = document.getElementById('lista-imagens');
  Estado.btnAnexarImagem = document.getElementById('btn-anexar-imagem');
  Estado.fileInput = document.getElementById('file-input-imagem');
  Estado.btnGerar = document.getElementById('btn-gerar');
  Estado.loading = document.getElementById('orcamento-loading');
  Estado.resultado = document.getElementById('orcamento-resultado');
  Estado.resultadoNomeObra = document.getElementById('input-nome-obra');
  Estado.resultadoEscopo = document.getElementById('input-escopo');
  Estado.resultadoPrazo = document.getElementById('input-prazo');
  Estado.resultadoTotalItens = document.getElementById('resultado-total-itens');
  Estado.resultadoTabelaItens = document.getElementById('resultado-tabela-itens');
  Estado.resultadoCustoTotal = document.getElementById('resultado-custo-total');
  Estado.resultadoMargemDisplay = document.getElementById('resultado-margem-display');
  Estado.resultadoMargemValor = document.getElementById('resultado-margem-valor');
  Estado.resultadoValorFinal = document.getElementById('resultado-valor-final');
  Estado.campoClienteNome = document.getElementById('campo-cliente-nome');
  Estado.campoEndereco = document.getElementById('campo-endereco');
  Estado.btnAprovar = document.getElementById('btn-aprovar');
  Estado.btnRegerar = document.getElementById('btn-regenerar');

  // Modal adicionar serviço
  Estado.btnAdicionarServico = document.getElementById('btn-adicionar-servico');
  Estado.modalAdicionarServico = document.getElementById('modal-adicionar-servico');
  Estado.modalSelectServico = document.getElementById('modal-select-servico');
  Estado.modalInputQuantidade = document.getElementById('modal-input-quantidade');
  Estado.btnConfirmarAdicionar = document.getElementById('btn-confirmar-adicionar');
  Estado.btnCancelarModal = document.getElementById('btn-cancelar-modal');
}

function configurarEventListeners() {
  Estado.btnAnexarImagem.addEventListener('click', aoClicarAnexarImagem);
  Estado.fileInput.addEventListener('change', aoSelecionarImagens);
  Estado.btnGerar.addEventListener('click', aoClicarGerar);
  Estado.btnAprovar.addEventListener('click', aoClicarAprovar);
  Estado.btnRegerar.addEventListener('click', aoClicarRegerar);

  // Modal adicionar serviço
  Estado.btnAdicionarServico.addEventListener('click', aoClicarAdicionarServico);
  Estado.btnConfirmarAdicionar.addEventListener('click', aoConfirmarAdicionar);
  Estado.btnCancelarModal.addEventListener('click', aoFecharModal);
  Estado.modalAdicionarServico.querySelector('.modal-overlay').addEventListener('click', aoFecharModal);
}

function extrairLeadIdDaURL() {
  const params = new URLSearchParams(window.location.search);
  Estado.leadId = params.get('lead_id');

  if (Estado.leadId) {
    console.log('[DEKA][Orcamento] Lead ID detectado:', Estado.leadId);
  }
}

// =============================================================================
// CARREGAMENTO DE CATÁLOGO
// =============================================================================

async function carregarCatalogo() {
  try {
    // Tentar cache primeiro
    const cached = cacheGet(CACHE_KEY_CATALOGO);
    if (cached) {
      console.log('[DEKA][Orcamento] Usando catálogo do cache.');
      Estado.catalogo = cached;
      Estado.btnGerar.disabled = false;
      return;
    }

    // Buscar do Supabase
    const { data, error } = await supabase
      .from('base_servicos')
      .select('id, codigo, categoria, descricao_interna, descricao_cliente, unidade, valor_referencia, ativo')
      .eq('ativo', true)
      .order('categoria, codigo');

    if (error) {
      console.error('[DEKA][Orcamento] Erro ao carregar catálogo:', error);
      showToast('Erro ao carregar catálogo de serviços.', 'error');
      return;
    }

    const catalogo = data || [];
    Estado.catalogo = catalogo;
    cacheSet(CACHE_KEY_CATALOGO, catalogo, CACHE_TTL_CATALOGO_MIN);

    console.log('[DEKA][Orcamento] Catálogo carregado:', catalogo.length, 'serviços');
    Estado.btnGerar.disabled = false;

  } catch (erro) {
    console.error('[DEKA][Orcamento] Exceção ao carregar catálogo:', erro);
    showToast(erro.message || 'Erro inesperado ao carregar catálogo.', 'error');
  }
}

// =============================================================================
// ANEXO DE IMAGENS
// =============================================================================

function aoClicarAnexarImagem() {
  Estado.fileInput.click();
}

async function aoSelecionarImagens(event) {
  const files = Array.from(event.target.files);

  if (Estado.imagens.length + files.length > MAX_IMAGENS) {
    showToast(`Máximo de ${MAX_IMAGENS} imagens permitidas.`, 'warning');
    return;
  }

  for (const file of files) {
    if (Estado.imagens.length >= MAX_IMAGENS) break;

    try {
      const base64 = await converterParaBase64(file);
      const mediaType = file.type;

      Estado.imagens.push({ media_type: mediaType, data: base64 });
    } catch (erro) {
      console.error('[DEKA][Orcamento] Erro ao converter imagem:', erro);
      showToast(`Erro ao processar ${file.name}.`, 'error');
    }
  }

  renderizarPreviewsImagens();
  Estado.fileInput.value = ''; // Reset input
}

function converterParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove o prefixo "data:image/jpeg;base64,"
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderizarPreviewsImagens() {
  Estado.listaImagens.innerHTML = '';

  Estado.imagens.forEach((img, index) => {
    const preview = document.createElement('div');
    preview.className = 'preview-imagem';
    preview.innerHTML = `
      <img src="data:${img.media_type};base64,${img.data}" alt="Preview ${index + 1}">
      <button class="btn-remover-imagem" data-index="${index}">×</button>
    `;

    preview.querySelector('.btn-remover-imagem').addEventListener('click', () => {
      Estado.imagens.splice(index, 1);
      renderizarPreviewsImagens();
    });

    Estado.listaImagens.appendChild(preview);
  });
}

// =============================================================================
// GERAÇÃO DE PROPOSTA
// =============================================================================

async function aoClicarGerar() {
  const briefing = Estado.campoBriefing.value.trim();

  // Validação
  if (briefing.length < 20) {
    showToast('O briefing deve ter no mínimo 20 caracteres.', 'warning');
    Estado.campoBriefing.focus();
    return;
  }

  if (Estado.catalogo.length === 0) {
    showToast('Catálogo de serviços não carregado. Recarregue a página.', 'error');
    return;
  }

  try {
    // UI: Loading
    Estado.btnGerar.disabled = true;
    Estado.form.classList.add('oculto');
    Estado.loading.classList.remove('oculto');

    // Iniciar timer de loading
    Estado.timerLoadingSegundos = 0;
    const loadingTimerEl = document.getElementById('loadingTimer');
    if (loadingTimerEl) {
      loadingTimerEl.textContent = '0s';
    }
    Estado.timerLoadingInterval = setInterval(() => {
      Estado.timerLoadingSegundos++;
      if (loadingTimerEl) {
        loadingTimerEl.textContent = `${Estado.timerLoadingSegundos}s`;
      }
    }, 1000);

    // Montar payload
    const links = Estado.campoLinks.value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('http'))
      .slice(0, MAX_LINKS);

    const payload = {
      briefing_texto: briefing,
      catalogo: Estado.catalogo,
      margem_percentual: Number(Estado.campoMargem.value),
      imagens: Estado.imagens,
      links: links,
    };

    console.log('[DEKA][Orcamento] Enviando payload para Worker:', {
      briefing_chars: briefing.length,
      catalogo_count: Estado.catalogo.length,
      imagens_count: Estado.imagens.length,
      links_count: links.length,
    });

    // Chamar Worker
    const resposta = await fetchComTimeout(
      `${WORKER_URL}/v1/orcamento`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Deka-Token': DEKA_TOKEN,
        },
        body: JSON.stringify(payload),
      },
      TIMEOUT_WORKER_MS
    );

    if (!resposta.ok) {
      const erroData = await resposta.json();
      throw new Error(erroData.message || `HTTP ${resposta.status}`);
    }

    const dados = await resposta.json();

    // Parar timer
    clearInterval(Estado.timerLoadingInterval);

    console.log('[DEKA][Orcamento] Proposta gerada:', dados);
    showToast('Proposta gerada com sucesso!', 'success');

    // Renderizar resultado
    renderizarResultado(dados.proposta);

  } catch (erro) {
    // Parar timer
    clearInterval(Estado.timerLoadingInterval);

    console.error('[DEKA][Orcamento] Erro ao gerar proposta:', erro);
    showToast(erro.message || 'Erro ao gerar proposta.', 'error');

    // Reset UI
    Estado.form.classList.remove('oculto');
    Estado.loading.classList.add('oculto');
    Estado.btnGerar.disabled = false;
  }
}

// =============================================================================
// RENDERIZAÇÃO DO RESULTADO
// =============================================================================

function renderizarResultado(proposta) {
  Estado.propostaAtual = proposta;

  // Preencher cabeçalho com inputs editáveis
  Estado.resultadoNomeObra.value = proposta.nome_obra || 'Proposta sem nome';
  Estado.resultadoEscopo.value = proposta.descricao_escopo || 'Sem descrição';
  Estado.resultadoPrazo.value = proposta.prazo_estimado_dias || 0;
  Estado.resultadoTotalItens.textContent = proposta.itens.length;

  // Event listeners para edição do cabeçalho
  Estado.resultadoNomeObra.addEventListener('input', (e) => {
    Estado.propostaAtual.nome_obra = e.target.value;
  });
  Estado.resultadoEscopo.addEventListener('input', (e) => {
    Estado.propostaAtual.descricao_escopo = e.target.value;
  });
  Estado.resultadoPrazo.addEventListener('change', (e) => {
    const prazo = parseInt(e.target.value, 10);
    if (prazo > 0) {
      Estado.propostaAtual.prazo_estimado_dias = prazo;
    } else {
      e.target.value = Estado.propostaAtual.prazo_estimado_dias;
    }
  });

  // Preencher campos de cliente (pre-fill com dados da proposta)
  Estado.campoClienteNome.value = proposta.cliente_nome || '';
  Estado.campoEndereco.value = proposta.endereco || '';

  // Renderizar tabela de itens
  renderizarTabelaItens(proposta.itens);

  // Atualizar totais
  atualizarTotais();

  // Exibir margem
  const margem = Estado.campoMargem.value;
  Estado.resultadoMargemDisplay.textContent = margem;

  // Mostrar seção de resultado
  Estado.loading.classList.add('oculto');
  Estado.resultado.classList.remove('oculto');
  Estado.btnAprovar.disabled = false;

  // Scroll suave até o resultado
  setTimeout(() => {
    Estado.resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

function renderizarTabelaItens(itens) {
  Estado.resultadoTabelaItens.innerHTML = '';

  itens.forEach((item, index) => {
    const tr = document.createElement('tr');

    // Coluna: Serviço (XSS-safe)
    const tdServico = document.createElement('td');
    tdServico.className = 'td-servico';
    tdServico.textContent = item.descricao_cliente;
    tr.appendChild(tdServico);

    // Coluna: Unidade (XSS-safe)
    const tdUnidade = document.createElement('td');
    tdUnidade.textContent = item.unidade;
    tr.appendChild(tdUnidade);

    // Coluna: Quantidade (input editável)
    const tdQtd = document.createElement('td');
    const inputQtd = document.createElement('input');
    inputQtd.type = 'number';
    inputQtd.className = 'input-quantidade';
    inputQtd.setAttribute('data-index', index);
    inputQtd.value = item.quantidade;
    inputQtd.min = '0.01';
    inputQtd.step = '0.01';
    inputQtd.addEventListener('change', (e) => {
      const novaQtd = parseFloat(e.target.value);
      if (novaQtd > 0) {
        aoEditarQuantidade(index, novaQtd);
      } else {
        e.target.value = item.quantidade;
      }
    });
    tdQtd.appendChild(inputQtd);
    tr.appendChild(tdQtd);

    // Coluna: Valor Unitário (XSS-safe)
    const tdValorUnit = document.createElement('td');
    tdValorUnit.textContent = `R$ ${formatarMoeda(item.valor_unitario_final)}`;
    tr.appendChild(tdValorUnit);

    // Coluna: Total (XSS-safe)
    const tdTotal = document.createElement('td');
    tdTotal.className = 'td-total-item';
    tdTotal.textContent = `R$ ${formatarMoeda(item.valor_total_final)}`;
    tr.appendChild(tdTotal);

    // Coluna: Observação IA (XSS-safe)
    const tdObs = document.createElement('td');
    tdObs.className = 'td-obs';
    tdObs.textContent = item.observacao_ia || '—';
    tr.appendChild(tdObs);

    Estado.resultadoTabelaItens.appendChild(tr);
  });
}

function aoEditarQuantidade(itemIndex, novaQtd) {
  const item = Estado.propostaAtual.itens[itemIndex];

  // Atualizar quantidade
  item.quantidade = novaQtd;

  // Recalcular valores do item
  item.valor_total_custo = item.quantidade * item.valor_unitario_custo;
  item.valor_total_final = item.quantidade * item.valor_unitario_final;

  // Atualizar DOM do total do item
  const trs = Estado.resultadoTabelaItens.querySelectorAll('tr');
  const tdTotal = trs[itemIndex].querySelector('.td-total-item');
  tdTotal.textContent = `R$ ${formatarMoeda(item.valor_total_final)}`;

  // Recalcular totais gerais
  atualizarTotais();

  console.log('[DEKA][Orcamento] Quantidade atualizada:', { itemIndex, novaQtd });
}

function atualizarTotais() {
  const itens = Estado.propostaAtual.itens;

  const valorCustoTotal = itens.reduce((sum, item) => sum + item.valor_total_custo, 0);
  const valorFinal = itens.reduce((sum, item) => sum + item.valor_total_final, 0);
  const margemValor = valorFinal - valorCustoTotal;

  // Atualizar proposta
  Estado.propostaAtual.valor_custo_total = valorCustoTotal;
  Estado.propostaAtual.valor_final = valorFinal;

  // Atualizar DOM
  Estado.resultadoCustoTotal.textContent = `R$ ${formatarMoeda(valorCustoTotal)}`;
  Estado.resultadoMargemValor.textContent = `R$ ${formatarMoeda(margemValor)}`;
  Estado.resultadoValorFinal.textContent = `R$ ${formatarMoeda(valorFinal)}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// =============================================================================
// APROVAÇÃO E SALVAMENTO
// =============================================================================

async function aoClicarAprovar() {
  const clienteNome = Estado.campoClienteNome.value.trim();
  const endereco = Estado.campoEndereco.value.trim();

  // Validação
  if (!clienteNome) {
    showToast('Preencha o nome do cliente.', 'warning');
    Estado.campoClienteNome.focus();
    return;
  }

  try {
    Estado.btnAprovar.disabled = true;
    showToast('Salvando proposta...', 'info');

    // 1. INSERT em propostas
    const { data: proposta, error: erroProposta } = await supabase
      .from('propostas')
      .insert({
        nome_obra: Estado.propostaAtual.nome_obra,
        cliente_nome: clienteNome,
        cliente_email: null,
        cliente_telefone: null,
        endereco: endereco || null,
        descricao_escopo: Estado.propostaAtual.descricao_escopo,
        prazo_estimado_dias: Estado.propostaAtual.prazo_estimado_dias,
        valor_custo_total: Estado.propostaAtual.valor_custo_total,
        margem_percentual: Number(Estado.campoMargem.value),
        valor_final: Estado.propostaAtual.valor_final,
        status: 'rascunho',
        aprovado_gestor: false,
        data_envio: null,
        data_validade: null,
      })
      .select('id')
      .single();

    if (erroProposta) {
      console.error('[DEKA][Orcamento] Erro ao inserir proposta:', erroProposta);
      throw new Error('Erro ao salvar proposta: ' + erroProposta.message);
    }

    const propostaId = proposta.id;
    console.log('[DEKA][Orcamento] Proposta salva com ID:', propostaId);

    // 2. INSERT em itens_proposta (bulk insert)
    const itensParaInserir = Estado.propostaAtual.itens.map(item => ({
      proposta_id: propostaId,
      codigo_servico: item.codigo_servico,
      categoria: item.categoria,
      descricao_interna: item.descricao_interna,
      descricao_cliente: item.descricao_cliente,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valor_unitario_custo: item.valor_unitario_custo,
      valor_unitario_final: item.valor_unitario_final,
      valor_total_custo: item.valor_total_custo,
      valor_total_final: item.valor_total_final,
      observacao_ia: item.observacao_ia || null,
    }));

    const { error: erroItens } = await supabase
      .from('itens_proposta')
      .insert(itensParaInserir);

    if (erroItens) {
      console.error('[DEKA][Orcamento] Erro ao inserir itens:', erroItens);
      throw new Error('Erro ao salvar itens da proposta: ' + erroItens.message);
    }

    console.log('[DEKA][Orcamento] Itens salvos:', itensParaInserir.length);

    showToast('Proposta salva com sucesso! Redirecionando...', 'success');

    // Redirecionar para hub após 2s
    setTimeout(() => {
      window.location.href = 'hub.html';
    }, 2000);

  } catch (erro) {
    console.error('[DEKA][Orcamento] Erro ao aprovar proposta:', erro);
    showToast(erro.message || 'Erro ao salvar proposta.', 'error');
    Estado.btnAprovar.disabled = false;
  }
}

// =============================================================================
// REGENERAR
// =============================================================================

function aoClicarRegerar() {
  // Limpar estado
  Estado.propostaAtual = null;

  // Ocultar resultado
  Estado.resultado.classList.add('oculto');

  // Mostrar formulário
  Estado.form.classList.remove('oculto');

  // Reabilitar botão gerar
  Estado.btnGerar.disabled = false;

  // Scroll ao topo
  window.scrollTo({ top: 0, behavior: 'smooth' });

  console.log('[DEKA][Orcamento] Proposta limpa, pronto para regenerar.');
}

// =============================================================================
// MODAL ADICIONAR SERVIÇO
// =============================================================================

function aoClicarAdicionarServico() {
  if (!Estado.propostaAtual) {
    showToast('Gere um orçamento primeiro.', 'warning');
    return;
  }

  // Popular select com catálogo
  Estado.modalSelectServico.innerHTML = '<option value="">-- Selecione --</option>';

  Estado.catalogo.forEach(servico => {
    const option = document.createElement('option');
    option.value = servico.id;
    option.textContent = `${servico.codigo} — ${servico.descricao_cliente}`;
    option.setAttribute('data-codigo', servico.codigo);
    option.setAttribute('data-categoria', servico.categoria);
    option.setAttribute('data-descricao-interna', servico.descricao_interna);
    option.setAttribute('data-descricao-cliente', servico.descricao_cliente);
    option.setAttribute('data-unidade', servico.unidade);
    option.setAttribute('data-valor-referencia', servico.valor_referencia);
    Estado.modalSelectServico.appendChild(option);
  });

  // Resetar quantidade
  Estado.modalInputQuantidade.value = '1';

  // Mostrar modal
  Estado.modalAdicionarServico.classList.remove('oculto');

  console.log('[DEKA][Orcamento] Modal de adicionar serviço aberto.');
}

function aoFecharModal() {
  Estado.modalAdicionarServico.classList.add('oculto');
}

function aoConfirmarAdicionar() {
  const servicoId = Estado.modalSelectServico.value;
  const quantidade = parseFloat(Estado.modalInputQuantidade.value);

  // Validação
  if (!servicoId) {
    showToast('Selecione um serviço.', 'warning');
    return;
  }

  if (!quantidade || quantidade <= 0) {
    showToast('A quantidade deve ser maior que zero.', 'warning');
    return;
  }

  // Pegar dados do serviço selecionado
  const optionSelecionada = Estado.modalSelectServico.querySelector(`option[value="${servicoId}"]`);
  const codigo = optionSelecionada.getAttribute('data-codigo');
  const categoria = optionSelecionada.getAttribute('data-categoria');
  const descricaoInterna = optionSelecionada.getAttribute('data-descricao-interna');
  const descricaoCliente = optionSelecionada.getAttribute('data-descricao-cliente');
  const unidade = optionSelecionada.getAttribute('data-unidade');
  const valorReferencia = parseFloat(optionSelecionada.getAttribute('data-valor-referencia'));

  // Calcular valores
  const margem = Number(Estado.campoMargem.value);
  const valorUnitarioCusto = valorReferencia;
  const valorUnitarioFinal = valorReferencia * (1 + margem / 100);
  const valorTotalCusto = quantidade * valorUnitarioCusto;
  const valorTotalFinal = quantidade * valorUnitarioFinal;

  // Criar novo item
  const novoItem = {
    codigo_servico: codigo,
    categoria: categoria,
    descricao_interna: descricaoInterna,
    descricao_cliente: descricaoCliente,
    unidade: unidade,
    quantidade: quantidade,
    valor_unitario_custo: valorUnitarioCusto,
    valor_unitario_final: valorUnitarioFinal,
    valor_total_custo: valorTotalCusto,
    valor_total_final: valorTotalFinal,
    observacao_ia: 'Adicionado manualmente',
  };

  // Adicionar ao estado
  Estado.propostaAtual.itens.push(novoItem);

  // Re-renderizar tabela
  renderizarTabelaItens(Estado.propostaAtual.itens);

  // Atualizar contador de itens
  Estado.resultadoTotalItens.textContent = Estado.propostaAtual.itens.length;

  // Recalcular totais
  atualizarTotais();

  // Fechar modal
  aoFecharModal();

  showToast('Serviço adicionado com sucesso!', 'success');

  console.log('[DEKA][Orcamento] Serviço adicionado:', novoItem);
}

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================

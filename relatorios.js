/**
 * DEKA OS v2.0 — relatorios.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Relatórios ao Cliente (AGT_RELATORIO)
 *
 * RESPONSABILIDADES:
 *   - Carrega obras ativas do Supabase
 *   - Permite seleção de obra e período
 *   - Gera relatório semanal em Markdown via Claude Haiku
 *   - Renderiza preview com marked.parse()
 *   - Permite copiar para clipboard
 *
 * TABELAS SUPABASE (READ-ONLY):
 *   - obras, obra_servicos, obra_visitas, obra_pendencias
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos
 *   - fetchComTimeout obrigatório
 *   - Cache de obras: 15min (chave: deka_cache_v2_obras_ativas)
 *   - Modelo: claude-haiku-4-5 (relatórios simples)
 */

// =============================================================================
// IMPORTS
// =============================================================================

import {
  supabase,
  showToast,
  fetchComTimeout,
  chamarClaude,
  cacheGet,
  cacheSet,
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const CACHE_TTL_OBRAS_MIN = 15;
const CACHE_KEY_OBRAS = 'deka_cache_v2_obras_ativas';

const SYSTEM_PROMPT_AGT_RELATORIO = `
Você é o AGT_RELATORIO da Berti Construtora.

Sua tarefa: gerar relatórios semanais de obra para clientes de médio-alto padrão.

REGRAS ABSOLUTAS (PADRÃO BERTI):
1. NUNCA exiba códigos internos ao cliente (SRV-*, EQ-*, UUIDs, IDs técnicos)
2. NUNCA mencione problemas sem apresentar a solução junto
3. Use linguagem profissional mas acessível (sem jargões técnicos não explicados)
4. Seja direto: o cliente lê em menos de 3 minutos
5. Tom positivo e seguro (transmita controle e competência)

TRADUÇÕES OBRIGATÓRIAS:
❌ "SRV-013 — 75% concluído"
✅ "O fechamento do forro da sala está 75% concluído"

❌ "EQ-ACO-01 pendente"
✅ "A equipe de acabamento iniciará os trabalhos na quinta-feira"

❌ "Houve um atraso na entrega do porcelanato"
✅ "O porcelanato teve um pequeno atraso (novo prazo: sexta). Para não impactar o cronograma, adiantamos o trabalho elétrico."

FORMATO OBRIGATÓRIO:
# Atualização Semanal — [Nome da Obra]
📅 Semana de [data início] a [data fim]

## ✅ O que avançamos esta semana
[2-4 bullets com progresso em linguagem simples]

## 📋 O que estamos resolvendo
[Máximo 2 itens — cada um com a solução em andamento]

## 📆 O que esperar na próxima semana
[2-3 bullets com previsão clara]

**Avanço geral da obra: [X]%**
Dúvidas? Estamos à disposição.

IMPORTANTE:
- Retorne APENAS o Markdown formatado
- Use APENAS a estrutura Markdown do template acima. Não adicione formatação extra.
- Máximo 500 palavras

Se os dados da semana estiverem vazios ou insuficientes para gerar um relatório completo, retorne:

# Atualização Semanal — [Nome da Obra]
📅 Semana de [data início] a [data fim]

Esta semana nossa equipe trabalhou nos preparativos internos da obra.
Na próxima atualização, traremos detalhes sobre o andamento dos serviços.

**Avanço geral da obra: [X]%**
Dúvidas? Estamos à disposição.
`.trim();

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

const Estado = {
  // DOM
  dataInicio: null,
  dataFim: null,
  obrasGrid: null,
  obraChip: null,
  btnGerarRelatorio: null,
  step1: null,
  step2: null,
  step3: null,
  step4: null,
  previewContent: null,
  previewMeta: null,
  previewRaw: null,
  btnCopiar: null,
  btnNovo: null,

  // Dados
  obraSelecionada: null,
  relatorioGerado: null,
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

export async function init() {
  console.log('[DEKA][Relatorios] Inicializando módulo...');

  carregarElementosDOM();
  configurarEventListeners();
  preencherDatasDefault();
  await carregarObras();

  console.log('[DEKA][Relatorios] ✅ Módulo inicializado.');
}

function carregarElementosDOM() {
  Estado.dataInicio = document.getElementById('data-inicio');
  Estado.dataFim = document.getElementById('data-fim');
  Estado.obrasGrid = document.getElementById('obras-grid');
  Estado.obraChip = document.getElementById('obra-selecionada-chip');
  Estado.btnGerarRelatorio = document.getElementById('btn-gerar-relatorio');
  Estado.step1 = document.getElementById('step-1');
  Estado.step2 = document.getElementById('step-2');
  Estado.step3 = document.getElementById('step-3');
  Estado.step4 = document.getElementById('step-4');
  Estado.previewContent = document.getElementById('preview-content');
  Estado.previewMeta = document.getElementById('preview-meta');
  Estado.previewRaw = document.getElementById('preview-raw');
  Estado.btnCopiar = document.getElementById('btn-copiar');
  Estado.btnNovo = document.getElementById('btn-novo');
}

function configurarEventListeners() {
  // Event delegation no grid de obras
  Estado.obrasGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.obra-card');
    if (!card) return;

    // Remove seleção anterior
    document.querySelectorAll('.obra-card').forEach((c) => c.classList.remove('selected'));

    // Seleciona nova obra
    card.classList.add('selected');
    Estado.obraSelecionada = {
      id: card.dataset.obraId,
      nome: card.dataset.obraNome,
    };

    // Atualiza chip
    Estado.obraChip.textContent = Estado.obraSelecionada.nome;
    Estado.obraChip.style.display = 'inline-block';

    // Habilita botão gerar
    Estado.btnGerarRelatorio.disabled = false;
  });

  Estado.btnGerarRelatorio.addEventListener('click', gerarRelatorio);
  Estado.btnCopiar.addEventListener('click', copiarParaClipboard);
  Estado.btnNovo.addEventListener('click', resetarUI);
}

function preencherDatasDefault() {
  const hoje = new Date();
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

  Estado.dataInicio.value = seteDiasAtras.toISOString().split('T')[0];
  Estado.dataFim.value = hoje.toISOString().split('T')[0];
}

// =============================================================================
// CARREGAMENTO DE OBRAS
// =============================================================================

async function carregarObras() {
  try {
    // Cache
    const cached = cacheGet(CACHE_KEY_OBRAS);
    if (cached) {
      console.log('[DEKA][Relatorios] Usando obras do cache.');
      renderizarObras(cached);
      return;
    }

    // Supabase
    const { data, error } = await supabase
      .from('obras')
      .select('id, nome, cliente, percentual_global, status')
      .eq('status', 'ativa')
      .order('nome');

    if (error) {
      console.error('[DEKA][Relatorios] Erro ao carregar obras:', error);
      showToast('Erro ao carregar obras.', 'error');
      return;
    }

    const obras = data || [];
    cacheSet(CACHE_KEY_OBRAS, obras, CACHE_TTL_OBRAS_MIN);
    renderizarObras(obras);

  } catch (erro) {
    console.error('[DEKA][Relatorios] Exceção ao carregar obras:', erro);
    showToast(erro.message || 'Erro inesperado.', 'error');
  }
}

function renderizarObras(obras) {
  Estado.obrasGrid.innerHTML = '';

  if (obras.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'empty-state';
    vazio.textContent = 'Nenhuma obra ativa encontrada.';
    Estado.obrasGrid.appendChild(vazio);
    return;
  }

  obras.forEach((obra) => {
    const card = document.createElement('div');
    card.className = 'obra-card';
    card.dataset.obraId = obra.id;
    card.dataset.obraNome = obra.nome;

    card.innerHTML = `
      <div class="obra-nome">${obra.nome}</div>
      <div class="obra-cliente">${obra.cliente}</div>
      <div class="obra-progresso">${obra.percentual_global || 0}% concluído</div>
    `;

    Estado.obrasGrid.appendChild(card);
  });

  console.log('[DEKA][Relatorios] Obras renderizadas:', obras.length);
}

// =============================================================================
// GERAÇÃO DE RELATÓRIO
// =============================================================================

async function gerarRelatorio() {
  if (!Estado.obraSelecionada) {
    showToast('Selecione uma obra primeiro.', 'warning');
    return;
  }

  try {
    Estado.btnGerarRelatorio.disabled = true;
    Estado.btnGerarRelatorio.textContent = '⏳ Gerando...';

    // Reset steps
    [Estado.step1, Estado.step2, Estado.step3, Estado.step4].forEach((s) => {
      s.classList.remove('active', 'done');
    });

    // Step 1: Coleta de dados
    Estado.step1.classList.add('active');
    showToast('Coletando dados...', 'info');

    // Validar datas
    const dataInicioStr = Estado.dataInicio.value;
    const dataFimStr = Estado.dataFim.value;

    if (!dataInicioStr || !dataFimStr) {
      showToast('Preencha as datas de início e fim.', 'warning');
      Estado.step1.classList.remove('active');
      return;
    }

    const dataInicioDate = new Date(dataInicioStr);
    const dataFimDate = new Date(dataFimStr);

    if (dataFimDate < dataInicioDate) {
      showToast('Data fim deve ser posterior à data início.', 'warning');
      Estado.step1.classList.remove('active');
      return;
    }

    // Busca paralela
    const [obra, servicos, visitas, pendencias] = await Promise.all([
      buscarObra(Estado.obraSelecionada.id),
      buscarServicos(Estado.obraSelecionada.id),
      buscarVisitas(Estado.obraSelecionada.id, dataInicioStr, dataFimStr),
      buscarPendencias(Estado.obraSelecionada.id),
    ]);

    Estado.step1.classList.remove('active');
    Estado.step1.classList.add('done');

    // Step 2: Processamento com IA
    Estado.step2.classList.add('active');
    showToast('Processando com IA...', 'info');

    const contexto = montarContexto(obra, servicos, visitas, pendencias, dataInicioStr, dataFimStr);
    const { texto: relatorioMd } = await chamarClaude({
      mensagens: [{ role: 'user', content: contexto }],
      sistemaPrompt: SYSTEM_PROMPT_AGT_RELATORIO,
      modelo: 'claude-haiku-4-5',
      maxTokens: 2048,
      temperature: 0.3,
      agente: 'AGT_RELATORIO',
    });

    Estado.step2.classList.remove('active');
    Estado.step2.classList.add('done');

    // Step 3: Renderização
    Estado.step3.classList.add('active');
    showToast('Renderizando preview...', 'info');

    renderizarPreview(relatorioMd, obra, dataInicioStr, dataFimStr);

    Estado.step3.classList.remove('active');
    Estado.step3.classList.add('done');

    // Step 4: Finalização
    Estado.step4.classList.add('active');
    Estado.step4.classList.add('done');

    showToast('Relatório gerado com sucesso!', 'success');
    console.log('[DEKA][Relatorios] Relatório gerado.');

  } catch (erro) {
    console.error('[DEKA][Relatorios] Erro ao gerar relatório:', erro);
    showToast(erro.message || 'Erro ao gerar relatório.', 'error');

    // Reset steps em caso de erro
    [Estado.step1, Estado.step2, Estado.step3, Estado.step4].forEach((s) => {
      s.classList.remove('active', 'done');
    });
  } finally {
    Estado.btnGerarRelatorio.disabled = false;
    Estado.btnGerarRelatorio.textContent = '✨ Gerar Relatório';
  }
}

async function buscarObra(obraId) {
  const { data, error } = await supabase
    .from('obras')
    .select('*')
    .eq('id', obraId)
    .single();

  if (error) throw new Error('Erro ao buscar obra: ' + error.message);
  return data;
}

async function buscarServicos(obraId) {
  const { data, error } = await supabase
    .from('obra_servicos')
    .select('*')
    .eq('obra_id', obraId);

  if (error) throw new Error('Erro ao buscar serviços: ' + error.message);
  return data || [];
}

async function buscarVisitas(obraId, dataInicio, dataFim) {
  const { data, error } = await supabase
    .from('obra_visitas')
    .select('*')
    .eq('obra_id', obraId)
    .gte('data_visita', dataInicio)
    .lte('data_visita', dataFim);

  if (error) throw new Error('Erro ao buscar visitas: ' + error.message);
  return data || [];
}

async function buscarPendencias(obraId) {
  const { data, error } = await supabase
    .from('obra_pendencias')
    .select('*')
    .eq('obra_id', obraId)
    .in('status', ['aberta', 'em_andamento']);

  if (error) throw new Error('Erro ao buscar pendências: ' + error.message);
  return data || [];
}

function montarContexto(obra, servicos, visitas, pendencias, dataInicio, dataFim) {
  return `
Gere um relatório semanal para o cliente sobre a obra:

DADOS DA OBRA:
- Nome: ${obra.nome}
- Cliente: ${obra.cliente}
- Avanço geral: ${obra.percentual_global || 0}%
- Período: ${dataInicio} a ${dataFim}

SERVIÇOS (progresso atual):
${servicos.map((s) => `- ${s.descricao_cliente}: ${s.percentual_concluido}%`).join('\n')}

VISITAS NO PERÍODO (resumos):
${visitas.length > 0 ? visitas.map((v) => `- ${v.data_visita}: ${v.resumo_ia || 'Sem resumo'}`).join('\n') : 'Nenhuma visita registrada no período.'}

PENDÊNCIAS ABERTAS:
${pendencias.length > 0 ? pendencias.map((p) => `- ${p.descricao} (${p.prioridade})`).join('\n') : 'Nenhuma pendência aberta.'}

LEMBRE-SE:
- NUNCA exiba códigos internos (SRV-*, EQ-*)
- Use apenas a descrição traduzida para o cliente
- Sempre solução junto ao problema
- Siga o formato obrigatório do Padrão Berti
`.trim();
}

// =============================================================================
// RENDERIZAÇÃO DO PREVIEW
// =============================================================================

function renderizarPreview(relatorioMd, obra, dataInicio, dataFim) {
  // Importa marked (assumindo que está disponível globalmente ou via CDN)
  if (typeof marked === 'undefined') {
    throw new Error('Biblioteca marked.js não encontrada. Adicione ao HTML.');
  }

  // Renderiza HTML
  const htmlContent = marked.parse(relatorioMd);
  Estado.previewContent.innerHTML = htmlContent;

  // Preenche meta
  Estado.previewMeta.textContent = `${obra.nome} • ${dataInicio} a ${dataFim}`;

  // Guarda markdown bruto
  Estado.previewRaw.value = relatorioMd;
  Estado.relatorioGerado = relatorioMd;

  // Habilita botões
  Estado.btnCopiar.disabled = false;
  Estado.btnNovo.disabled = false;
}

// =============================================================================
// AÇÕES: COPIAR E NOVO
// =============================================================================

async function copiarParaClipboard() {
  if (!Estado.relatorioGerado) {
    showToast('Nenhum relatório para copiar.', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(Estado.relatorioGerado);
    showToast('Relatório copiado para a área de transferência!', 'success');
    console.log('[DEKA][Relatorios] Relatório copiado.');
  } catch (erro) {
    console.error('[DEKA][Relatorios] Erro ao copiar:', erro);
    showToast('Erro ao copiar. Tente selecionar e copiar manualmente.', 'error');
  }
}

function resetarUI() {
  // Reseta seleção de obra
  document.querySelectorAll('.obra-card').forEach((c) => c.classList.remove('selected'));
  Estado.obraSelecionada = null;
  Estado.obraChip.style.display = 'none';
  Estado.obraChip.textContent = '';

  // Reseta steps
  [Estado.step1, Estado.step2, Estado.step3, Estado.step4].forEach((s) => {
    s.classList.remove('active', 'done');
  });

  // Reseta preview
  Estado.previewContent.innerHTML = '<p class="empty-preview">O relatório aparecerá aqui.</p>';
  Estado.previewMeta.textContent = '';
  Estado.previewRaw.value = '';
  Estado.relatorioGerado = null;

  // Desabilita botões
  Estado.btnGerarRelatorio.disabled = true;
  Estado.btnCopiar.disabled = true;
  Estado.btnNovo.disabled = true;

  console.log('[DEKA][Relatorios] UI resetada.');
}

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================

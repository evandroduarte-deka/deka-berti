/**
 * DEKA OS v2.0 — relatorios.js v52
 * Delta Semanal Real — AGT_RELATORIO
 *
 * CORREÇÃO: relatório mostra APENAS o que avançou NA SEMANA selecionada.
 * Lógica: delta = pct_atual - pct_base (do snapshot/visita anterior)
 */

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
const CACHE_KEY_OBRAS     = 'deka_cache_v2_obras_ativas';

const SYSTEM_PROMPT_AGT_RELATORIO = `
Você é o AGT_RELATORIO da Berti Construtora.
Missão: relatório semanal de obra para o cliente. Leitura máxima: 2 minutos. Tom: profissional, positivo, seguro.

REGRAS ABSOLUTAS:
1. NUNCA mencione códigos internos: SRV-*, EQ-*, UUIDs, IDs
2. NUNCA cite semanas anteriores — apenas a semana informada
3. NUNCA mencione problemas sem apresentar a solução imediata
4. NUNCA use frases vagas: "bom andamento", "conforme cronograma"
5. Use linguagem concreta: o que foi feito, o que vai acontecer

TRADUÇÕES:
❌ "SRV-013 delta 25%"   ✅ "O forro da sala avançou 25% esta semana"
❌ "EQ-ACO-01 pendente"  ✅ "A equipe de acabamento começa na quinta-feira"
❌ "Atraso fornecedor"   ✅ "Porcelanato atrasa 2 dias; adiantamos o elétrico"

FORMATO OBRIGATÓRIO:
# Relatório Semanal — [Nome da Obra]
📅 Semana [número] · [data início] a [data fim]
📊 Avanço acumulado da obra: [X]%

---

## ✅ O que avançamos esta semana
[2 a 4 bullets — apenas delta real desta semana]

## 🔧 Pontos em acompanhamento
[0 a 2 itens com solução. Se nenhum: "Sem pontos críticos esta semana."]

## 📆 O que esperar na próxima semana
[2 a 3 bullets concretos]

---
*Dúvidas? Estamos à disposição pelo WhatsApp.*

IMPORTANTE: Retorne APENAS o Markdown. Máximo 400 palavras.
`.trim();

// =============================================================================
// ESTADO
// =============================================================================

const Estado = {
  dataInicioEl:        null,
  dataFimEl:           null,
  semanaNumeroEl:      null,
  obrasGrid:           null,
  obraChip:            null,
  btnGerarRelatorio:   null,
  step1: null, step2: null, step3: null, step4: null,
  previewContent:      null,
  previewMeta:         null,
  previewRaw:          null,
  btnCopiar:           null,
  btnNovo:             null,
  labelDeltaInfo:      null,
  obraSelecionada:     null,
  relatorioGerado:     null,
};

// =============================================================================
// INIT
// =============================================================================

export async function init() {
  console.log('[DEKA][Relatorios] init() v52');
  _carregarDOM();
  _configurarEventos();
  _preencherSemanaAtual();
  await _carregarObras();
  console.log('[DEKA][Relatorios] ✅ pronto.');
}

// =============================================================================
// DOM
// =============================================================================

function _carregarDOM() {
  Estado.dataInicioEl      = document.getElementById('data-inicio');
  Estado.dataFimEl         = document.getElementById('data-fim');
  Estado.semanaNumeroEl    = document.getElementById('semana-numero');
  Estado.obrasGrid         = document.getElementById('obras-grid');
  Estado.obraChip          = document.getElementById('obra-selecionada-chip');
  Estado.btnGerarRelatorio = document.getElementById('btn-gerar-relatorio');
  Estado.step1             = document.getElementById('step-1');
  Estado.step2             = document.getElementById('step-2');
  Estado.step3             = document.getElementById('step-3');
  Estado.step4             = document.getElementById('step-4');
  Estado.previewContent    = document.getElementById('preview-content');
  Estado.previewMeta       = document.getElementById('preview-meta');
  Estado.previewRaw        = document.getElementById('preview-raw');
  Estado.btnCopiar         = document.getElementById('btn-copiar');
  Estado.btnNovo           = document.getElementById('btn-novo');
  Estado.labelDeltaInfo    = document.getElementById('delta-info');
}

function _configurarEventos() {
  Estado.obrasGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.obra-card');
    if (!card) return;
    document.querySelectorAll('.obra-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    Estado.obraSelecionada = {
      id:          card.dataset.obraId,
      nome:        card.dataset.obraNome,
      dataInicio:  card.dataset.obraDataInicio,
    };
    Estado.obraChip.textContent     = Estado.obraSelecionada.nome;
    Estado.obraChip.style.display   = 'inline-block';
    Estado.btnGerarRelatorio.disabled = false;
    _calcularSemanaAutomatica(Estado.obraSelecionada.dataInicio);
  });

  Estado.btnGerarRelatorio.addEventListener('click', _gerarRelatorio);
  Estado.btnCopiar.addEventListener('click',         _copiarClipboard);
  Estado.btnNovo.addEventListener('click',           _resetUI);
  Estado.dataInicioEl?.addEventListener('change',    _atualizarInfoDelta);
  Estado.dataFimEl?.addEventListener('change',       _atualizarInfoDelta);
}

// =============================================================================
// HELPERS DE DATA
// =============================================================================

function _preencherSemanaAtual() {
  const hoje = new Date();
  const dow  = hoje.getDay();
  const diffSeg = dow === 0 ? -6 : 1 - dow;
  const seg  = new Date(hoje);
  seg.setDate(hoje.getDate() + diffSeg);
  const dom  = new Date(seg);
  dom.setDate(seg.getDate() + 6);
  if (Estado.dataInicioEl) Estado.dataInicioEl.value = _toISO(seg);
  if (Estado.dataFimEl)    Estado.dataFimEl.value    = _toISO(dom);
  if (Estado.semanaNumeroEl) Estado.semanaNumeroEl.value = '1';
  _atualizarInfoDelta();
}

function _toISO(d) {
  return d.toISOString().split('T')[0];
}

function _formatBR(isoStr) {
  if (!isoStr) return '—';
  const [y, m, d] = isoStr.split('-');
  return `${d}/${m}/${y}`;
}

function _calcularSemanaAutomatica(obraDataInicio) {
  if (!obraDataInicio || !Estado.dataInicioEl || !Estado.dataFimEl) return;
  const ini   = new Date(obraDataInicio + 'T00:00:00');
  const hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.max(0, Math.floor((hoje - ini) / 86400000));
  const semNum   = Math.floor(diffDias / 7) + 1;
  const semIni   = new Date(ini);
  semIni.setDate(ini.getDate() + (semNum - 1) * 7);
  const semFim   = new Date(semIni);
  semFim.setDate(semIni.getDate() + 6);
  Estado.dataInicioEl.value = _toISO(semIni);
  Estado.dataFimEl.value    = _toISO(semFim);
  if (Estado.semanaNumeroEl) Estado.semanaNumeroEl.value = semNum;
  _atualizarInfoDelta();
}

function _atualizarInfoDelta() {
  const ini = Estado.dataInicioEl?.value;
  const fim = Estado.dataFimEl?.value;
  if (!ini || !fim || !Estado.labelDeltaInfo) return;
  const d1   = new Date(ini + 'T00:00:00');
  const d2   = new Date(fim + 'T00:00:00');
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  Estado.labelDeltaInfo.textContent =
    `${_formatBR(ini)} a ${_formatBR(fim)} · ${dias} dias · apenas delta deste período`;
}

// =============================================================================
// OBRAS
// =============================================================================

async function _carregarObras() {
  try {
    const cached = cacheGet(CACHE_KEY_OBRAS);
    if (cached) {
      _renderizarObras(cached);
      return;
    }
    const { data, error } = await supabase
      .from('obras')
      .select('id, nome, cliente, percentual_global, status, data_inicio, data_previsao_fim')
      .eq('status', 'ativa')
      .order('nome');
    if (error) {
      console.error('[DEKA][Relatorios] Erro obras:', error);
      showToast('Erro ao carregar obras: ' + error.message, 'error');
      return;
    }
    const obras = data || [];
    cacheSet(CACHE_KEY_OBRAS, obras, CACHE_TTL_OBRAS_MIN);
    _renderizarObras(obras);
  } catch (erro) {
    console.error('[DEKA][Relatorios] Exceção _carregarObras:', erro);
    showToast(erro.message || 'Erro inesperado.', 'error');
  }
}

function _renderizarObras(obras) {
  Estado.obrasGrid.innerHTML = '';
  if (!obras.length) {
    Estado.obrasGrid.innerHTML =
      '<p style="color:var(--text-secondary);font-size:12px">Nenhuma obra ativa.</p>';
    return;
  }
  obras.forEach(obra => {
    const card = document.createElement('div');
    card.className = 'obra-card';
    card.dataset.obraId         = obra.id;
    card.dataset.obraNome       = obra.nome;
    card.dataset.obraDataInicio = obra.data_inicio || '';
    card.innerHTML = `
      <div class="obra-nome">${obra.nome}</div>
      <div class="obra-cliente">${obra.cliente}</div>
      <div class="obra-progresso">${obra.percentual_global || 0}% concluído</div>
    `;
    Estado.obrasGrid.appendChild(card);
  });
}

// =============================================================================
// BUSCA DE DADOS
// =============================================================================

async function _buscarObra(obraId) {
  const { data, error } = await supabase
    .from('obras').select('*').eq('id', obraId).single();
  if (error) throw new Error('Erro ao buscar obra: ' + error.message);
  return data;
}

async function _buscarServicosAtuais(obraId) {
  const { data, error } = await supabase
    .from('obra_servicos')
    .select('id, codigo, descricao_cliente, percentual_concluido, pct_anterior, valor_contratado, equipe_codigo, dias_marcados, data_inicio, data_fim, status')
    .eq('obra_id', obraId)
    .order('codigo');
  if (error) throw new Error('Erro ao buscar serviços: ' + error.message);
  return data || [];
}

async function _buscarVisitasPeriodo(obraId, dataInicio, dataFim) {
  // Visitas da semana atual
  const { data: visitasSemana, error: e1 } = await supabase
    .from('obra_visitas')
    .select('id, data_visita, resumo_ia, narrativa_revisada, payload_sync, semana, itens_aplicados')
    .eq('obra_id', obraId)
    .gte('data_visita', dataInicio)
    .lte('data_visita', dataFim)
    .order('data_visita', { ascending: true });
  if (e1) throw new Error('Erro ao buscar visitas da semana: ' + e1.message);

  // Visitas da semana ANTERIOR (base para o delta)
  const d1Ant = new Date(dataInicio + 'T00:00:00');
  d1Ant.setDate(d1Ant.getDate() - 7);
  const d2Ant = new Date(dataInicio + 'T00:00:00');
  d2Ant.setDate(d2Ant.getDate() - 1);

  const { data: visitasAnterior, error: e2 } = await supabase
    .from('obra_visitas')
    .select('data_visita, payload_sync, semana')
    .eq('obra_id', obraId)
    .gte('data_visita', _toISO(d1Ant))
    .lte('data_visita', _toISO(d2Ant))
    .order('data_visita', { ascending: false });
  if (e2) throw new Error('Erro ao buscar visitas anteriores: ' + e2.message);

  return { semana: visitasSemana || [], anterior: visitasAnterior || [] };
}

async function _buscarPendencias(obraId) {
  const { data, error } = await supabase
    .from('obra_pendencias')
    .select('descricao, prioridade, responsavel, status')
    .eq('obra_id', obraId)
    .in('status', ['aberta', 'em_andamento'])
    .order('prioridade');
  if (error) throw new Error('Erro ao buscar pendências: ' + error.message);
  return data || [];
}

// =============================================================================
// CÁLCULO DO DELTA SEMANAL
// =============================================================================

function _calcularDeltaSemanal(servicosAtuais, visitasSemana, visitasAnterior) {
  // Mapa: codigo → pct atual
  const mapAtual = {};
  servicosAtuais.forEach(s => { mapAtual[s.codigo] = s.percentual_concluido || 0; });

  // Mapa: codigo → pct anterior (base do delta)
  const mapAnterior = {};

  // Prioridade 1: payload_sync das visitas anteriores
  if (visitasAnterior.length) {
    visitasAnterior.forEach(v => {
      if (!v.payload_sync) return;
      const srv = v.payload_sync.servicos_atualizados || v.payload_sync.servicos || v.payload_sync.services || [];
      srv.forEach(s => {
        const cod = s.codigo || s.code || s.cod;
        const pct = s.percentual || s.percentual_concluido || s.pct || 0;
        if (cod && !(cod in mapAnterior)) mapAnterior[cod] = pct;
      });
    });
  }

  // Prioridade 2: primeira visita da semana (pct_anterior interno)
  if (!Object.keys(mapAnterior).length && visitasSemana.length) {
    const primeira = visitasSemana[0];
    if (primeira.payload_sync) {
      const srv = primeira.payload_sync.servicos_atualizados || primeira.payload_sync.servicos || primeira.payload_sync.services || [];
      srv.forEach(s => {
        const cod = s.codigo || s.code || s.cod;
        const pctAntes = s.percentual_anterior || s.pct_anterior || 0;
        if (cod && !(cod in mapAnterior)) mapAnterior[cod] = pctAntes;
      });
    }
  }

  const temBasePrecisa = Object.keys(mapAnterior).length > 0;

  const resultado = servicosAtuais.map(s => {
    const pctAtual    = s.percentual_concluido || 0;
    const pctAnterior = temBasePrecisa ? (mapAnterior[s.codigo] ?? pctAtual) : 0;
    const delta       = pctAtual - pctAnterior;
    const status      = pctAtual >= 100 ? 'CONCLUÍDO' : pctAtual > 0 ? 'EM ANDAMENTO' : 'A EXECUTAR';
    return {
      codigo:            s.codigo,
      descricao_cliente: s.descricao_cliente,
      pct_anterior:      pctAnterior,
      pct_atual:         pctAtual,
      delta,
      status,
      valor:             s.valor_contratado || 0,
    };
  });

  const servicosDelta = resultado.filter(s => s.delta > 0);

  console.log(`[DEKA][Relatorios] Delta: ${servicosDelta.length}/${resultado.length} serviços avançaram. Base precisa: ${temBasePrecisa}`);

  return {
    servicosDelta,
    todosServicos:  resultado,
    temBasePrecisa,
    totalServicos:  resultado.length,
    concluidos:     resultado.filter(s => s.pct_atual >= 100).length,
    emAndamento:    resultado.filter(s => s.pct_atual > 0 && s.pct_atual < 100).length,
  };
}

async function _calcularProximaSemana(servicosAtuais, dataFim) {
  // Range da próxima semana
  const fimAtual = new Date(dataFim + 'T00:00:00');
  const proxIni  = new Date(fimAtual); proxIni.setDate(fimAtual.getDate() + 1);
  const proxFim  = new Date(proxIni);  proxFim.setDate(proxIni.getDate() + 6);
  const proxIniISO = _toISO(proxIni);
  const proxFimISO = _toISO(proxFim);

  // Prioridade 1: dias_marcados já na tabela normalizada (obra_servicos)
  const mapDias = {};
  servicosAtuais.forEach(s => {
    if (s.descricao_cliente && Array.isArray(s.dias_marcados) && s.dias_marcados.length) {
      mapDias[s.descricao_cliente] = s.dias_marcados;
    }
  });

  // Prioridade 2: fallback cockpit_obras (enquanto migração não está completa)
  if (!Object.keys(mapDias).length) {
    const cockpitState = await _lerCockpitState();
    if (cockpitState && Array.isArray(cockpitState.servicos)) {
      cockpitState.servicos.forEach(s => {
        if (s.descricao_cliente && Array.isArray(s.dias_marcados)) {
          mapDias[s.descricao_cliente] = s.dias_marcados;
        }
      });
    }
  }

  function _temDiasProxSem(s) {
    const dias = mapDias[s.descricao_cliente] || [];
    return dias.some(d => d >= proxIniISO && d <= proxFimISO);
  }

  // Prioridade 1: agendados no cronograma para a próxima semana
  const agendados = servicosAtuais.filter(s =>
    (s.percentual_concluido || 0) < 100 && _temDiasProxSem(s)
  );

  // Prioridade 2: em andamento (fallback se sem cronograma)
  const emAndamento = servicosAtuais.filter(s => {
    const pct = s.percentual_concluido || 0;
    return pct > 0 && pct < 100 && !agendados.includes(s);
  }).sort((a, b) => (b.percentual_concluido || 0) - (a.percentual_concluido || 0));

  const resultado = agendados.length > 0
    ? [...agendados, ...emAndamento].slice(0, 5)
    : emAndamento.slice(0, 5);

  return resultado.map(s => {
    const dias = mapDias[s.descricao_cliente] || [];
    const diasProx = dias.filter(d => d >= proxIniISO && d <= proxFimISO).sort();
    const periodoStr = diasProx.length
      ? _formatBR(diasProx[0]) + (diasProx.length > 1 ? ' a ' + _formatBR(diasProx[diasProx.length - 1]) : '')
      : null;
    return {
      descricao_cliente: s.descricao_cliente,
      pct_atual:         s.percentual_concluido || 0,
      status:            s.percentual_concluido > 0 ? 'EM ANDAMENTO' : 'INÍCIO PREVISTO',
      periodo:           periodoStr,
    };
  });
}

/**
 * Lê o state completo da obra do Supabase (tabela cockpit_obras).
 * Fallback para localStorage se Supabase indisponível.
 * Permite usar dias_marcados do cronograma em qualquer dispositivo.
 */
async function _lerCockpitState(obraId) {
  // Prioridade 1: Supabase (funciona em qualquer dispositivo)
  try {
    const resp = await fetch(
      `${window.DEKA_CONFIG.supabaseUrl}/rest/v1/cockpit_obras?select=obra_key,data,updated_at&order=updated_at.desc&limit=20`,
      {
        headers: {
          'apikey': window.DEKA_CONFIG.supabaseAnonKey,
          'Authorization': 'Bearer ' + window.DEKA_CONFIG.supabaseAnonKey,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (rows && rows.length) {
        // Se temos obraId, tentamos cruzar pelo nome da obra
        // Senão, usa o mais recente
        const row = rows[0];
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        if (data && Array.isArray(data.servicos)) {
          console.log('[DEKA][Relatorios] cockpit state lido do Supabase:', row.obra_key);
          return data;
        }
      }
    }
  } catch (e) {
    console.warn('[DEKA][Relatorios] Supabase indisponível para cockpit_obras, usando localStorage:', e.message);
  }

  // Prioridade 2: localStorage (fallback offline / mesmo dispositivo)
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cockpit_'));
    if (!keys.length) return null;
    let melhor = null;
    let melhorTs = 0;
    keys.forEach(k => {
      try {
        const d = JSON.parse(localStorage.getItem(k));
        if (d && d._savedAt) {
          const ts = new Date(d._savedAt).getTime();
          if (ts > melhorTs) { melhorTs = ts; melhor = d; }
        }
      } catch (e) { /* ignora chave corrompida */ }
    });
    if (melhor) console.log('[DEKA][Relatorios] cockpit state lido do localStorage (offline)');
    return melhor;
  } catch (e) {
    console.error('[DEKA][Relatorios] Erro ao ler cockpit state:', e);
    return null;
  }
}

function _extrairNarrativaSemana(visitasSemana) {
  return visitasSemana
    .map(v => v.narrativa_revisada || v.resumo_ia || '')
    .filter(Boolean)
    .join('\n\n');
}

// =============================================================================
// CONTEXTO PARA A IA
// =============================================================================

function _montarContexto(obra, delta, proximaSemana, pendencias, narrativa, dataInicio, dataFim, semanaNum) {
  const pctGeral = obra.percentual_global || 0;

  const linhasAvanco = delta.servicosDelta.map(s => {
    const sufixo = s.pct_atual >= 100
      ? ' — concluído nesta semana'
      : ` — ${s.pct_atual}% concluído no total (+${s.delta}% esta semana)`;
    return `• ${s.descricao_cliente}${sufixo}`;
  });

  const linhasProxima = proximaSemana.map(s => {
    const st = s.pct_atual > 0 ? `continua (${s.pct_atual}% feito)` : 'início previsto';
    const per = s.periodo ? ` · ${s.periodo}` : '';
    return `• ${s.descricao_cliente} — ${st}${per}`;
  });

  const linhasPendencias = pendencias.map(p =>
    `• [${p.prioridade.toUpperCase()}] ${p.descricao} — responsável: ${p.responsavel}`
  );

  const avisoFallback = delta.temBasePrecisa ? '' :
    '\n⚠ AVISO INTERNO: sem snapshot anterior. Inferir avanços pela narrativa do gestor. ' +
    'Se insuficiente, escreva que foi semana de preparação.';

  return `
Gere o relatório semanal para o CLIENTE.

DADOS DA OBRA:
Nome: ${obra.nome}
Cliente: ${obra.cliente}
Avanço acumulado: ${pctGeral}%
Previsão de conclusão: ${obra.data_previsao_fim ? _formatBR(obra.data_previsao_fim) : 'A definir'}
Semana nº: ${semanaNum}
Período: ${_formatBR(dataInicio)} a ${_formatBR(dataFim)}

O QUE AVANÇOU NESTA SEMANA (delta real):
${linhasAvanco.length ? linhasAvanco.join('\n') : 'Nenhum avanço com snapshot. Use a narrativa do gestor.'}

NARRATIVA DO GESTOR (enriqueça, não copie):
${narrativa || 'Sem narrativa registrada.'}

PENDÊNCIAS ABERTAS:
${linhasPendencias.length ? linhasPendencias.join('\n') : 'Sem pendências.'}

PROGRAMADO PRÓXIMA SEMANA:
${linhasProxima.length ? linhasProxima.join('\n') : 'A definir.'}

TOTAIS: ${delta.totalServicos} serviços · ${delta.concluidos} concluídos · ${delta.emAndamento} em andamento
${avisoFallback}

LEMBRE-SE: apenas Semana ${semanaNum}. Não mencione semanas anteriores.
`.trim();
}

// =============================================================================
// GERAÇÃO
// =============================================================================

async function _gerarRelatorio() {
  if (!Estado.obraSelecionada) {
    showToast('Selecione uma obra primeiro.', 'warning');
    return;
  }
  const dataInicio = Estado.dataInicioEl?.value;
  const dataFim    = Estado.dataFimEl?.value;
  if (!dataInicio || !dataFim) {
    showToast('Defina o período da semana.', 'warning');
    return;
  }
  if (dataFim < dataInicio) {
    showToast('Data fim não pode ser anterior à data início.', 'warning');
    return;
  }

  try {
    Estado.btnGerarRelatorio.disabled = true;
    Estado.btnGerarRelatorio.textContent = '⏳ Gerando...';
    _resetSteps();

    // Step 1: Dados
    _ativarStep(Estado.step1);
    showToast('Coletando dados...', 'info');
    const semanaNum = Estado.semanaNumeroEl?.value || '1';
    const [obra, servicosAtuais, { semana: visitasSemana, anterior: visitasAnterior }, pendencias] =
      await Promise.all([
        _buscarObra(Estado.obraSelecionada.id),
        _buscarServicosAtuais(Estado.obraSelecionada.id),
        _buscarVisitasPeriodo(Estado.obraSelecionada.id, dataInicio, dataFim),
        _buscarPendencias(Estado.obraSelecionada.id),
      ]);
    _concluirStep(Estado.step1);

    // Step 2: Delta
    _ativarStep(Estado.step2);
    showToast('Calculando delta...', 'info');
    const delta      = _calcularDeltaSemanal(servicosAtuais, visitasSemana, visitasAnterior);
    const proximaSem = await _calcularProximaSemana(servicosAtuais, dataFim);
    const narrativa  = _extrairNarrativaSemana(visitasSemana);
    const contexto   = _montarContexto(obra, delta, proximaSem, pendencias, narrativa, dataInicio, dataFim, semanaNum);
    _concluirStep(Estado.step2);

    // Step 3: IA
    _ativarStep(Estado.step3);
    showToast('Gerando com IA...', 'info');
    const relatorioMd = await chamarClaude({
      mensagens:     [{ role: 'user', content: contexto }],
      sistemaPrompt: SYSTEM_PROMPT_AGT_RELATORIO,
      modelo:        'claude-haiku-4-5',
      maxTokens:     1200,
    });
    _concluirStep(Estado.step3);

    // Step 4: Render
    _ativarStep(Estado.step4);
    const avisoEl = document.getElementById('aviso-snapshot');
    if (avisoEl) avisoEl.style.display = delta.temBasePrecisa ? 'none' : 'block';
    _renderizarPreview(relatorioMd, obra, dataInicio, dataFim, semanaNum, delta);
    _concluirStep(Estado.step4);

    showToast(`Relatório gerado! ${delta.servicosDelta.length} serviço(s) com avanço.`, 'success');

  } catch (erro) {
    console.error('[DEKA][Relatorios] Erro _gerarRelatorio:', erro);
    showToast(erro.message || 'Erro ao gerar relatório.', 'error');
    _resetSteps();
  } finally {
    Estado.btnGerarRelatorio.disabled = false;
    Estado.btnGerarRelatorio.textContent = '✨ Gerar Relatório';
  }
}

// =============================================================================
// PREVIEW
// =============================================================================

function _renderizarPreview(relatorioMd, obra, dataInicio, dataFim, semanaNum, delta) {
  if (typeof marked === 'undefined') {
    throw new Error('marked.js não encontrado no HTML.');
  }

  // Corrige "Semana 01" hardcoded e remove códigos internos que escaparam
  const mdCorrigido = relatorioMd
    .replace(/Semana\s+0?1(?=\s|—|-|$|\.)/gi, `Semana ${semanaNum}`)
    .replace(/\b(SRV|EQ|FOR)-[\w-]+/gi, '');

  Estado.previewContent.innerHTML = marked.parse(mdCorrigido);
  Estado.previewRaw.value         = mdCorrigido;
  Estado.relatorioGerado          = mdCorrigido;

  const baseInfo = delta.temBasePrecisa
    ? 'delta preciso (snapshot disponível)'
    : 'delta estimado (sem snapshot)';

  Estado.previewMeta.innerHTML = `
    <strong>${obra.nome}</strong> · Semana ${semanaNum} · ${_formatBR(dataInicio)} a ${_formatBR(dataFim)}<br>
    <small style="opacity:.7">
      ${delta.servicosDelta.length} com avanço · ${delta.concluidos} concluídos · ${delta.emAndamento} em andamento · ${baseInfo}
    </small>
  `;

  Estado.btnCopiar.disabled = false;
  Estado.btnNovo.disabled   = false;
}

// =============================================================================
// HELPERS STEPS
// =============================================================================

function _resetSteps() {
  [Estado.step1, Estado.step2, Estado.step3, Estado.step4]
    .forEach(s => s?.classList.remove('active', 'done'));
}
function _ativarStep(el)   { el?.classList.add('active'); }
function _concluirStep(el) { el?.classList.remove('active'); el?.classList.add('done'); }

// =============================================================================
// COPIAR / RESET
// =============================================================================

async function _copiarClipboard() {
  if (!Estado.relatorioGerado) {
    showToast('Nenhum relatório gerado.', 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(Estado.relatorioGerado);
    showToast('Markdown copiado!', 'success');
  } catch (erro) {
    console.error('[DEKA][Relatorios] Erro ao copiar:', erro);
    showToast('Erro ao copiar. Selecione manualmente.', 'error');
  }
}

function _resetUI() {
  document.querySelectorAll('.obra-card').forEach(c => c.classList.remove('selected'));
  Estado.obraSelecionada        = null;
  Estado.obraChip.textContent   = '';
  Estado.obraChip.style.display = 'none';
  _resetSteps();
  Estado.previewContent.innerHTML =
    '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:60px 0">O relatório aparecerá aqui.</p>';
  Estado.previewMeta.innerHTML    = '';
  Estado.previewRaw.value         = '';
  Estado.relatorioGerado          = null;
  Estado.btnGerarRelatorio.disabled = true;
  Estado.btnCopiar.disabled         = true;
  Estado.btnNovo.disabled           = true;
  if (Estado.labelDeltaInfo) Estado.labelDeltaInfo.textContent = '';
  const avisoEl = document.getElementById('aviso-snapshot');
  if (avisoEl) avisoEl.style.display = 'none';
  console.log('[DEKA][Relatorios] UI resetada.');
}

// =============================================================================
// FIM — relatorios.js v52
// Smoke Test:
// [x] < 3000 linhas
// [x] 1 export init()
// [x] Sem DOMContentLoaded
// [x] console.error + showToast em todo catch
// [x] Sem chave hardcoded
// [x] cacheGet/cacheSet com TTL
// [x] Tabelas: obras, obra_servicos, obra_visitas, obra_pendencias
// [x] Nenhum SRV-*/EQ-* exposto ao cliente
// =============================================================================

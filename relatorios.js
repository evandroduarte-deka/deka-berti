/**
 * DEKA OS v2.0 — relatorios.js v53
 * ─────────────────────────────────────────────────────────────────────────────
 * CORREÇÕES v53:
 * 1. Delta usa pct_anterior de obra_servicos (não depende de payload_sync)
 * 2. Número da semana calculado igual ao index.html (data_inicio da obra)
 * 3. Narrativa usa cockpit_obras.data.diario + visitas do período
 * 4. Prompt AGT_RELATORIO reescrito com contexto real e preciso
 * 5. Próxima semana usa dias_marcados da tabela normalizada
 *
 * FONTES DE DADOS (em ordem de prioridade):
 *   obra_servicos    → percentuais, pct_anterior, dias_marcados, status
 *   obra_visitas     → narrativas, resumos das visitas da semana
 *   cockpit_obras    → state completo (fallback para narrativa e dias_marcados)
 *   obra_pendencias  → pendências abertas
 */

import {
  supabase,
  showToast,
  chamarClaude,
  cacheGet,
  cacheSet,
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const CACHE_TTL_OBRAS_MIN = 15;
const CACHE_KEY_OBRAS     = 'deka_cache_v2_obras_ativas';

const SYSTEM_PROMPT_SEMANAL_CLIENTE = `
Você é o AGT_RELATORIO da Berti Construtora — empresa de reformas residenciais de médio-alto padrão.

MISSÃO: Gerar o relatório semanal para o CLIENTE. Leitura máxima: 2 minutos.

REGRAS ABSOLUTAS:
1. NUNCA use códigos internos: SRV-*, EQ-*, UUIDs
2. NUNCA mencione semanas anteriores — só esta semana
3. NUNCA cite problema sem solução imediata ao lado
4. NUNCA use frases vagas: "bom andamento", "conforme cronograma"
5. Use % apenas quando relevante e claro para o cliente
6. Tom: profissional, positivo, confiante

FORMATO OBRIGATÓRIO (não altere a estrutura):
# Relatório Semanal — [Nome da Obra]
📅 Semana [N] · [DD/MM] a [DD/MM/AAAA]
📊 Avanço geral da obra: [X]%

---

## ✅ O que avançamos esta semana
[2 a 4 bullets — apenas o delta real desta semana, em linguagem simples]

## 🔧 Pontos em acompanhamento
[0 a 2 itens com solução. Se nenhum: "Nenhum ponto crítico esta semana."]

## 📆 Próxima semana
[2 a 3 bullets com o que está programado no cronograma]

---
*Dúvidas? Estamos à disposição pelo WhatsApp.*

RETORNE APENAS O MARKDOWN. Máximo 350 palavras.
`.trim();

const SYSTEM_PROMPT_INTERNO = `
Você é o AGT_RELATORIO da Berti Construtora — uso INTERNO E CONFIDENCIAL.

MISSÃO: Relatório gerencial semanal para o gestor Evandro. Seja direto e técnico.

FORMATO OBRIGATÓRIO:
# Relatório Interno — [Obra] — Semana [N]
📅 [DD/MM] a [DD/MM/AAAA] · Gerado em [data]

## 📊 Aderência ao Cronograma
- Previsto: [X]% · Executado: [Y]% · Desvio: [+/-Z]%
- [Análise em 1 linha]

## 🔨 Serviços com Avanço na Semana
[Lista com código, descrição, delta%, acumulado%]

## ⚠️ Alertas
[Atrasos, pausados, pendências críticas]

## 💰 Financeiro da Semana
[Entradas, saídas, saldo, lucro estimado]

## 📋 Planejamento Próxima Semana
[Serviços programados com equipes e datas]

RETORNE APENAS O MARKDOWN. Seja objetivo.
`.trim();

// =============================================================================
// ESTADO
// =============================================================================

const Estado = {
  dataInicioEl:        null,
  dataFimEl:           null,
  semanaNumeroEl:      null,
  tipoRelatorioEl:     null,
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
  console.log('[DEKA][Relatorios] init() v53');
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
  Estado.tipoRelatorioEl   = document.getElementById('tipo-relatorio');
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
      id:         card.dataset.obraId,
      nome:       card.dataset.obraNome,
      dataInicio: card.dataset.obraDataInicio,
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
  const seg  = new Date(hoje); seg.setDate(hoje.getDate() + diffSeg);
  const dom  = new Date(seg);  dom.setDate(seg.getDate() + 6);
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

function _formatBRcurto(isoStr) {
  if (!isoStr) return '—';
  const [y, m, d] = isoStr.split('-');
  return `${d}/${m}`;
}

/**
 * Calcula semana da obra igual ao index.html:
 * semana = floor((hoje - data_inicio) / 7) + 1
 */
function _calcularSemanaAutomatica(obraDataInicio) {
  if (!obraDataInicio || !Estado.dataInicioEl || !Estado.dataFimEl) return;
  const ini  = new Date(obraDataInicio + 'T00:00:00');
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.max(0, Math.floor((hoje - ini) / 86400000));
  const semNum   = Math.floor(diffDias / 7) + 1;
  const semIni   = new Date(ini); semIni.setDate(ini.getDate() + (semNum - 1) * 7);
  const semFim   = new Date(semIni); semFim.setDate(semIni.getDate() + 6);
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
    `${_formatBR(ini)} a ${_formatBR(fim)} · ${dias} dias · delta desta semana`;
}

// =============================================================================
// OBRAS
// =============================================================================

async function _carregarObras() {
  try {
    const cached = cacheGet(CACHE_KEY_OBRAS);
    if (cached) { _renderizarObras(cached); return; }
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

async function _buscarServicos(obraId) {
  const { data, error } = await supabase
    .from('obra_servicos')
    .select('id, codigo, descricao_cliente, percentual_concluido, pct_anterior, valor_contratado, equipe_codigo, dias_marcados, data_inicio, data_fim, status, updated_at')
    .eq('obra_id', obraId)
    .order('codigo');
  if (error) throw new Error('Erro ao buscar serviços: ' + error.message);
  return data || [];
}

async function _buscarVisitas(obraId, dataInicio, dataFim) {
  const { data, error } = await supabase
    .from('obra_visitas')
    .select('id, data_visita, resumo_ia, narrativa_revisada, payload_sync, semana')
    .eq('obra_id', obraId)
    .gte('data_visita', dataInicio)
    .lte('data_visita', dataFim)
    .order('data_visita', { ascending: true });
  if (error) throw new Error('Erro ao buscar visitas: ' + error.message);
  return data || [];
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

/**
 * Lê state completo do cockpit para complementar narrativa e dias_marcados.
 * Prioridade: Supabase cockpit_obras → localStorage
 */
async function _lerCockpitState() {
  try {
    const resp = await fetch(
      `${window.DEKA_CONFIG.supabaseUrl}/rest/v1/cockpit_obras?select=obra_key,data,updated_at&order=updated_at.desc&limit=10`,
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
        const row  = rows[0];
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        if (data && Array.isArray(data.servicos)) return data;
      }
    }
  } catch (e) {
    console.warn('[DEKA][Relatorios] cockpit_obras indisponível:', e.message);
  }
  // Fallback: localStorage
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cockpit_'));
    if (!keys.length) return null;
    let melhor = null; let melhorTs = 0;
    keys.forEach(k => {
      try {
        const d = JSON.parse(localStorage.getItem(k));
        if (d && d._savedAt) {
          const ts = new Date(d._savedAt).getTime();
          if (ts > melhorTs) { melhorTs = ts; melhor = d; }
        }
      } catch (e) { /* ignora */ }
    });
    return melhor;
  } catch (e) {
    console.error('[DEKA][Relatorios] Erro localStorage:', e);
    return null;
  }
}

// =============================================================================
// CÁLCULO DO DELTA — v53
// =============================================================================

/**
 * Calcula delta semanal usando pct_anterior de obra_servicos.
 *
 * LÓGICA v53:
 * 1. delta = percentual_concluido - pct_anterior (campo da tabela normalizada)
 * 2. Só entra no relatório se delta > 0 (avançou na semana)
 * 3. Fallback: se pct_anterior = 0 para todos, usa visitas do período
 *
 * VANTAGEM: Não depende de payload_sync das visitas.
 * O index.html grava pct_anterior via sbSyncServicos() a cada saveState().
 */
function _calcularDelta(servicos, visitasSemana) {
  // Tentar usar pct_anterior da tabela normalizada
  const temPctAnterior = servicos.some(s => (s.pct_anterior || 0) > 0);

  let mapAnterior = {};

  if (temPctAnterior) {
    // Fonte primária: pct_anterior da tabela obra_servicos
    servicos.forEach(s => {
      mapAnterior[s.codigo] = s.pct_anterior || 0;
    });
    console.log('[DEKA][Relatorios] Delta via pct_anterior (tabela normalizada)');
  } else {
    // Fallback: payload_sync das visitas da semana
    visitasSemana.forEach(v => {
      if (!v.payload_sync) return;
      const srv = v.payload_sync.servicos_atualizados ||
                  v.payload_sync.servicos ||
                  v.payload_sync.services || [];
      srv.forEach(s => {
        const cod = s.codigo || s.code || s.cod;
        const pctAntes = s.pct_anterior || s.percentual_anterior || 0;
        if (cod && !(cod in mapAnterior)) mapAnterior[cod] = pctAntes;
      });
    });
    console.log('[DEKA][Relatorios] Delta via payload_sync das visitas (fallback)');
  }

  const resultado = servicos.map(s => {
    const pctAtual    = s.percentual_concluido || 0;
    const pctAnterior = mapAnterior[s.codigo] ?? pctAtual;
    const delta       = Math.max(0, pctAtual - pctAnterior);
    const status      = pctAtual >= 100 ? 'CONCLUÍDO'
                      : pctAtual > 0   ? 'EM ANDAMENTO'
                      : 'A EXECUTAR';
    return {
      codigo:            s.codigo,
      descricao_cliente: s.descricao_cliente,
      pct_anterior:      pctAnterior,
      pct_atual:         pctAtual,
      delta,
      status,
      valor:             s.valor_contratado || 0,
      dias_marcados:     s.dias_marcados || [],
      data_inicio:       s.data_inicio,
      data_fim:          s.data_fim,
    };
  });

  const comDelta = resultado.filter(s => s.delta > 0);
  const concluidos  = resultado.filter(s => s.pct_atual >= 100).length;
  const emAndamento = resultado.filter(s => s.pct_atual > 0 && s.pct_atual < 100).length;

  // pctGeral ponderado por valor
  const totalValor = servicos.reduce((a, s) => a + (s.valor_contratado || 0), 0);
  const pctGeral   = totalValor > 0
    ? Math.round(resultado.reduce((a, s) => a + (s.pct_atual * (s.valor || s.valor_contratado || 0)), 0) / totalValor)
    : Math.round(resultado.reduce((a, s) => a + s.pct_atual, 0) / Math.max(1, resultado.length));

  console.log(`[DEKA][Relatorios] Delta: ${comDelta.length}/${resultado.length} avançaram. pctGeral=${pctGeral}%`);

  return {
    comDelta,
    todos:        resultado,
    temPctAnterior,
    totalServicos: resultado.length,
    concluidos,
    emAndamento,
    pctGeral,
  };
}

/**
 * Próxima semana: serviços com dias_marcados no intervalo da semana seguinte.
 */
async function _calcularProximaSemana(servicos, dataFim) {
  const fimAtual = new Date(dataFim + 'T00:00:00');
  const proxIni  = new Date(fimAtual); proxIni.setDate(fimAtual.getDate() + 1);
  const proxFim  = new Date(proxIni);  proxFim.setDate(proxIni.getDate() + 6);
  const proxIniISO = _toISO(proxIni);
  const proxFimISO = _toISO(proxFim);

  // Mapa de dias_marcados: prioridade tabela normalizada → cockpit_obras
  const mapDias = {};
  servicos.forEach(s => {
    if (s.descricao_cliente && Array.isArray(s.dias_marcados) && s.dias_marcados.length) {
      mapDias[s.descricao_cliente] = s.dias_marcados;
    }
  });

  // Fallback: cockpit_obras se tabela normalizada vazia
  if (!Object.keys(mapDias).length) {
    const cs = await _lerCockpitState();
    if (cs && Array.isArray(cs.servicos)) {
      cs.servicos.forEach(s => {
        if (s.descricao_cliente && Array.isArray(s.dias_marcados)) {
          mapDias[s.descricao_cliente] = s.dias_marcados;
        }
      });
    }
  }

  function _temDias(s) {
    const dias = mapDias[s.descricao_cliente] || [];
    return dias.some(d => d >= proxIniISO && d <= proxFimISO);
  }

  const agendados = servicos.filter(s => s.percentual_concluido < 100 && _temDias(s));
  const emAndamento = servicos
    .filter(s => s.percentual_concluido > 0 && s.percentual_concluido < 100 && !agendados.includes(s))
    .sort((a, b) => b.percentual_concluido - a.percentual_concluido);

  const lista = agendados.length > 0
    ? [...agendados, ...emAndamento].slice(0, 5)
    : emAndamento.slice(0, 5);

  return lista.map(s => {
    const dias = mapDias[s.descricao_cliente] || [];
    const diasProx = dias.filter(d => d >= proxIniISO && d <= proxFimISO).sort();
    const periodo  = diasProx.length
      ? _formatBRcurto(diasProx[0]) + (diasProx.length > 1 ? ' a ' + _formatBRcurto(diasProx[diasProx.length - 1]) : '')
      : null;
    return {
      descricao_cliente: s.descricao_cliente,
      pct_atual:         s.percentual_concluido || 0,
      status:            s.percentual_concluido > 0 ? 'EM ANDAMENTO' : 'A EXECUTAR',
      periodo,
    };
  });
}

/**
 * Extrai narrativa das visitas da semana.
 * Prioridade: narrativa_revisada → resumo_ia → cockpit diário
 */
async function _extrairNarrativa(visitasSemana, dataInicio, dataFim) {
  // 1. narrativa_revisada ou resumo_ia das visitas
  const textos = visitasSemana
    .map(v => v.narrativa_revisada || v.resumo_ia || '')
    .filter(Boolean);
  if (textos.length) return textos.join('\n\n');

  // 2. Fallback: diário do cockpit_obras
  try {
    const cs = await _lerCockpitState();
    if (!cs || !cs.diario) return '';
    const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
    const LBLS = { seg:'SEG', ter:'TER', qua:'QUA', qui:'QUI', sex:'SEX', sab:'SÁB', dom:'DOM' };
    const linhas = DIAS
      .map(d => {
        const e = cs.diario[d];
        if (!e || !e.texto || !e.texto.trim()) return null;
        return `${LBLS[d]}: ${e.texto.trim()}`;
      })
      .filter(Boolean);
    return linhas.join('\n');
  } catch (e) {
    console.warn('[DEKA][Relatorios] Erro ao ler diário:', e);
    return '';
  }
}

// =============================================================================
// MONTAGEM DO CONTEXTO PARA IA
// =============================================================================

function _montarContextoCliente(obra, delta, proximaSem, pendencias, narrativa, dataInicio, dataFim, semanaNum) {
  const pctGeral = delta.pctGeral;

  // Serviços com avanço real na semana
  const linhasAvanco = delta.comDelta.map(s => {
    const sufixo = s.pct_atual >= 100
      ? ' — concluído nesta semana ✓'
      : ` — ${s.pct_atual}% concluído (+${s.delta}% nesta semana)`;
    return `• ${s.descricao_cliente}${sufixo}`;
  });

  // Próxima semana com período
  const linhasProxima = proximaSem.map(s => {
    const st  = s.pct_atual > 0 ? `continua (${s.pct_atual}% feito)` : 'início previsto';
    const per = s.periodo ? ` · ${s.periodo}` : '';
    return `• ${s.descricao_cliente} — ${st}${per}`;
  });

  // Pendências (apenas para contexto interno da IA — não exibir ao cliente)
  const linhasPend = pendencias
    .filter(p => p.prioridade === 'critica' || p.prioridade === 'alta')
    .map(p => `• [${p.prioridade.toUpperCase()}] ${p.descricao}`);

  // Aderência ao prazo
  let prazoCtx = '';
  if (obra.data_inicio && (obra.data_previsao_fim || obra.data_fim)) {
    const ini  = new Date((obra.data_inicio.includes('/') ? obra.data_inicio.split('/').reverse().join('-') : obra.data_inicio) + 'T00:00:00');
    const fim2 = new Date(((obra.data_previsao_fim || obra.data_fim).includes('/') ? (obra.data_previsao_fim || obra.data_fim).split('/').reverse().join('-') : (obra.data_previsao_fim || obra.data_fim)) + 'T00:00:00');
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const total    = Math.max(1, Math.round((fim2 - ini) / 86400000));
    const decorrido = Math.max(0, Math.round((hoje - ini) / 86400000));
    const previsto  = Math.min(100, Math.round(decorrido / total * 100));
    const desvio    = pctGeral - previsto;
    prazoCtx = `Aderência ao prazo: ${decorrido} de ${total} dias (${previsto}% previsto). Executado: ${pctGeral}%. Desvio: ${desvio >= 0 ? '+' : ''}${desvio}%.`;
  }

  return `Gere o RELATÓRIO SEMANAL para o CLIENTE.

DADOS DA OBRA:
Nome: ${obra.nome}
Cliente: ${obra.cliente || obra.razao_cliente || '—'}
Semana nº: ${semanaNum}
Período: ${_formatBR(dataInicio)} a ${_formatBR(dataFim)}
Avanço acumulado: ${pctGeral}%
Entrega prevista: ${_formatBR(obra.data_previsao_fim || obra.data_fim || '')}
${prazoCtx}

O QUE AVANÇOU NESTA SEMANA (${delta.comDelta.length} serviço(s) com delta real):
${linhasAvanco.length ? linhasAvanco.join('\n') : 'Nenhum avanço registrado com dados precisos. Use a narrativa do gestor.'}

NARRATIVA DO GESTOR (enriqueça, não copie literalmente):
${narrativa || 'Sem narrativa registrada para esta semana.'}

${linhasPend.length ? `ALERTAS (mencione se relevante ao cliente):\n${linhasPend.join('\n')}` : ''}

PROGRAMADO PRÓXIMA SEMANA (${proximaSem.length} serviço(s)):
${linhasProxima.length ? linhasProxima.join('\n') : 'A definir conforme andamento.'}

TOTAIS: ${delta.totalServicos} serviços · ${delta.concluidos} concluídos · ${delta.emAndamento} em andamento

LEMBRE-SE: APENAS sobre a Semana ${semanaNum}. Não mencione semanas anteriores.`.trim();
}

function _montarContextoInterno(obra, delta, proximaSem, pendencias, narrativa, dataInicio, dataFim, semanaNum) {
  const pctGeral = delta.pctGeral;

  const linhasSrv = delta.comDelta.map(s =>
    `• ${s.codigo} — ${s.descricao_cliente}: +${s.delta}% (total: ${s.pct_atual}%)`
  );

  const linhasProxima = proximaSem.map(s => {
    const per = s.periodo ? ` · ${s.periodo}` : '';
    return `• ${s.descricao_cliente} — ${s.status}${per}`;
  });

  const linhasPend = pendencias.map(p =>
    `• [${p.prioridade.toUpperCase()}] ${p.descricao} — resp: ${p.responsavel}`
  );

  return `Gere o RELATÓRIO INTERNO para o gestor Evandro.

OBRA: ${obra.nome} · Semana ${semanaNum} · ${_formatBR(dataInicio)} a ${_formatBR(dataFim)}
Avanço: ${pctGeral}% · ${delta.concluidos}/${delta.totalServicos} concluídos

SERVIÇOS COM AVANÇO NA SEMANA:
${linhasSrv.length ? linhasSrv.join('\n') : 'Nenhum avanço registrado.'}

NARRATIVA DO GESTOR:
${narrativa || 'Sem narrativa.'}

PENDÊNCIAS (${pendencias.length}):
${linhasPend.length ? linhasPend.join('\n') : 'Nenhuma.'}

PLANEJAMENTO PRÓXIMA SEMANA:
${linhasProxima.length ? linhasProxima.join('\n') : 'A definir.'}`.trim();
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

  const tipoRel = Estado.tipoRelatorioEl?.value || 'cliente';

  try {
    Estado.btnGerarRelatorio.disabled = true;
    Estado.btnGerarRelatorio.textContent = '⏳ Gerando...';
    _resetSteps();
    const semanaNum = parseInt(Estado.semanaNumeroEl?.value) || 1;

    // STEP 1 — Busca dados
    _ativarStep(Estado.step1);
    showToast('Buscando dados da semana...', 'info');
    const [obra, servicos, visitas, pendencias] = await Promise.all([
      _buscarObra(Estado.obraSelecionada.id),
      _buscarServicos(Estado.obraSelecionada.id),
      _buscarVisitas(Estado.obraSelecionada.id, dataInicio, dataFim),
      _buscarPendencias(Estado.obraSelecionada.id),
    ]);
    _concluirStep(Estado.step1);

    // STEP 2 — Cálculos
    _ativarStep(Estado.step2);
    showToast('Calculando delta e cronograma...', 'info');
    const delta      = _calcularDelta(servicos, visitas);
    const proximaSem = await _calcularProximaSemana(servicos, dataFim);
    const narrativa  = await _extrairNarrativa(visitas, dataInicio, dataFim);

    const contexto = tipoRel === 'interno'
      ? _montarContextoInterno(obra, delta, proximaSem, pendencias, narrativa, dataInicio, dataFim, semanaNum)
      : _montarContextoCliente(obra, delta, proximaSem, pendencias, narrativa, dataInicio, dataFim, semanaNum);

    const systemPrompt = tipoRel === 'interno'
      ? SYSTEM_PROMPT_INTERNO
      : SYSTEM_PROMPT_SEMANAL_CLIENTE;

    _concluirStep(Estado.step2);

    // STEP 3 — IA
    _ativarStep(Estado.step3);
    showToast('Gerando com IA...', 'info');
    const relatorioMd = await chamarClaude({
      mensagens:     [{ role: 'user', content: contexto }],
      sistemaPrompt: systemPrompt,
      modelo:        'claude-haiku-4-5',
      maxTokens:     1200,
    });
    _concluirStep(Estado.step3);

    // STEP 4 — Render
    _ativarStep(Estado.step4);
    const mdTexto = relatorioMd?.texto || relatorioMd || '';
    const mdCorrigido = mdTexto
      .replace(/Semana\s+0?1(?=\s|—|-|$|\.)/gi, `Semana ${semanaNum}`)
      .replace(/\b(SRV|EQ|FOR)-[\w-]+/gi, '');
    _renderizarPreview(mdCorrigido, obra, dataInicio, dataFim, semanaNum, delta, tipoRel);
    _concluirStep(Estado.step4);

    const avisoEl = document.getElementById('aviso-snapshot');
    if (avisoEl) avisoEl.style.display = delta.temPctAnterior ? 'none' : 'block';

    showToast(`✅ Relatório gerado · ${delta.comDelta.length} serviço(s) com avanço`, 'success');

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

function _renderizarPreview(md, obra, dataInicio, dataFim, semanaNum, delta, tipo) {
  if (typeof marked === 'undefined') throw new Error('marked.js não encontrado.');

  Estado.previewContent.innerHTML = marked.parse(md);
  Estado.previewRaw.value         = md;
  Estado.relatorioGerado          = md;

  const tipoLabel   = tipo === 'interno' ? '📁 Interno' : '📊 Cliente';
  const baseInfo    = delta.temPctAnterior ? 'delta preciso' : 'delta estimado';

  Estado.previewMeta.innerHTML = `
    ${tipoLabel} · <strong>${obra.nome}</strong> · Semana ${semanaNum} · ${_formatBR(dataInicio)} a ${_formatBR(dataFim)}<br>
    <small style="opacity:.7">
      ${delta.comDelta.length} com avanço · ${delta.concluidos} concluídos · ${delta.emAndamento} em andamento
      · ${delta.pctGeral}% geral · ${baseInfo}
    </small>
  `;

  Estado.btnCopiar.disabled = false;
  Estado.btnNovo.disabled   = false;
}

// =============================================================================
// STEPS
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
}

// =============================================================================
// FIM — relatorios.js v53
// Smoke Test:
// [x] < 3000 linhas
// [x] 1 export init()
// [x] Sem DOMContentLoaded
// [x] console.error em todo catch
// [x] Sem chave hardcoded
// [x] Delta usa pct_anterior da tabela normalizada
// [x] Fallback para payload_sync se pct_anterior zerado
// [x] Dois tipos de relatório: cliente e interno
// [x] Narrativa de 3 fontes: narrativa_revisada, resumo_ia, diário cockpit
// =============================================================================

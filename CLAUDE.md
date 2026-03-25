# CLAUDE.md — DEKA · Berti Construtora
## Instruções para Claude Code · v1.1 · 25/03/2026

---

## CHANGELOG
- v1.1 · 25/03/2026 · 4 correções de complexidade aplicadas: índices brain_data, AGT_COCKPIT em 2 etapas, ordem rígida de construção, Google Calendar → Fase 3
- v1.0 · 25/03/2026 · Versão inicial

---

## IDENTIDADE DO PROJETO

Você está construindo o **DEKA** — ecossistema de gestão operacional da Berti Construtora.
Gestor: **Evandro Luiz Duarte** · Curitiba/PR.

DEKA é um conjunto de 5 arquivos HTML single-file que substituem todos os sistemas fragmentados (Notion, VOB, Excel, Canva) com um pipeline integrado, sem redigitação de dados entre módulos.

**Princípio central:** O sistema não organiza informação. Ele elimina decisões.
Evandro captura. O DEKA estrutura. Evandro confirma. Um toque.

---

## INFRAESTRUTURA — NUNCA ALTERAR

```
Supabase URL:  https://tdylutdfzgtcfyhynenk.supabase.co
Supabase KEY:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWx1dGRmemd0Y2Z5aHluZW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODQxMjcsImV4cCI6MjA4ODg2MDEyN30.k44CAV8O8AGhq4lzy-Ms5CF6JsW2fgMqLEegKb4K-pg
CF Worker:     https://anthropic-proxy.berti-b52.workers.dev/v1/messages
Modelo IA:     claude-sonnet-4-20250514
GitHub Pages:  https://evandroduarte-deka.github.io/deka-berti/
Repo:          github.com/evandroduarte-deka/deka-berti
```

---

## ARQUIVOS DO PROJETO

| Arquivo | Módulo | Prioridade |
|---|---|---|
| `brain.html` | Central de Operações | 1 — construir primeiro |
| `comercial.html` | Funil Comercial | 2 |
| `index.html` | Cockpit de Obra | 3 |
| `relatorios.html` | Relatórios | 4 |
| `hub.html` | Dashboard Matinal | 5 |
| `DEKA_MASTER.md` | Contrato do sistema | referência — não alterar |

**REGRA CRÍTICA DE CONSTRUÇÃO:** Construir e testar um módulo por vez, na ordem acima.
Nunca iniciar o próximo antes do anterior estar funcionando com dados reais.
Um módulo publicado e testado vale mais que cinco em desenvolvimento.

---

## REGRAS DE CÓDIGO — INVIOLÁVEIS

1. **HTML single-file** — zero dependências externas além de Google Fonts
2. **Zero dados simulados** — nunca hardcode dados de teste em produção
3. **Todo fetch tem AbortSignal.timeout()** — sem exceção
4. **CF Worker sempre com /v1/messages** — nunca usar root URL
5. **Brain e Relatórios NUNCA escrevem em cockpit_obras** — exceto campo `obs_interna`
6. **calcPctGeral() canônico** — média ponderada por valor, fallback média simples
7. **Semana sempre auto-calculada**: `Math.max(1, Math.floor((hoje - periodo_ini) / (7*86400000)) + 1)`
8. **Snapshot gravado ANTES de avançar semana** — sempre
9. **Semanas passadas bloqueadas** — retroedição exige modal de confirmação com simulação de impacto
10. **Relatórios do cliente** nunca mostram códigos internos (SRV-XXX, EQ-XXX)
11. **Visitas nunca apagadas** — histórico permanente
12. **Zero redigitação entre módulos** — dados trafegam via JSON ou Supabase
13. **AGT_COCKPIT em 2 etapas separadas** — IA extrai JSON, JS puro atualiza cronograma (ver seção AGT_COCKPIT)
14. **Agentes sempre retornam JSON estruturado** — nunca texto livre para parsing
15. **Prompt caching ativo** em todos os agentes — `cache_control: {type:"ephemeral"}` no system
16. **Streaming** nos agentes de texto longo (JARVIS, Relatorio, Proposta, Socio)
17. **esc()** em todo HTML gerado dinamicamente — sem exceção
18. **Google Calendar** — NÃO implementar na Fase 1. Agenda é campo manual no Brain.

---

## DESIGN SYSTEM — COPIAR EXATO

### CSS Variables (idênticas em todos os módulos)
```css
:root {
  --verde:      #2E9650;
  --verde-dim:  #1a5c30;
  --verde-glow: rgba(46,150,80,0.15);
  --ouro:       #B89A6A;
  --ouro-dim:   #7a6445;
  --bg:         #060D09;
  --bg-2:       #0D1A10;
  --bg-3:       #142018;
  --bg-4:       #1a2a1e;
  --border:     #1e2e20;
  --border-2:   #2a3e2c;
  --text:       #e8f0e8;
  --text-dim:   #7a9a7a;
  --text-muted: #4a6a4a;
  --danger:     #cc3333;
  --danger-dim: #3a0a0a;
  --warn:       #cc8800;
  --warn-dim:   #2a1800;
  --font-display: 'Bebas Neue', sans-serif;
  --font-body:    'Jost', sans-serif;
  --font-data:    'JetBrains Mono', monospace;
}
```

### Google Fonts (idêntico em todos os módulos)
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Jost:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Syne:wght@400;700&display=swap" rel="stylesheet">
```

### Meta PWA (em todos os módulos)
```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#060D09">
```

---

## DEKA_CORE — BIBLIOTECA COMPARTILHADA

Copiar literalmente em todos os módulos. Nunca divergir entre arquivos.

```javascript
// ─── SANITIZAÇÃO ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, tipo = 'info', dur = 3000) {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

// Toast CSS — incluir em todos os módulos
/*
.toast { position:fixed; bottom:24px; right:24px; z-index:9999;
  padding:12px 20px; border-radius:6px; font-family:var(--font-body);
  font-size:14px; animation:toastIn .2s ease; max-width:320px; }
.toast-info    { background:var(--bg-3); border:1px solid var(--verde); color:var(--text); }
.toast-success { background:var(--verde-dim); border:1px solid var(--verde); color:#fff; }
.toast-error   { background:#2a0808; border:1px solid var(--danger); color:#ff6666; }
.toast-warn    { background:#2a1800; border:1px solid var(--warn); color:#ffaa33; }
@keyframes toastIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
*/

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SB_URL = 'https://tdylutdfzgtcfyhynenk.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWx1dGRmemd0Y2Z5aHluZW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODQxMjcsImV4cCI6MjA4ODg2MDEyN30.k44CAV8O8AGhq4lzy-Ms5CF6JsW2fgMqLEegKb4K-pg';

async function sbFetch(endpoint, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── AI FETCH (com Prompt Caching) ───────────────────────────────────────────
const AI_URL   = 'https://anthropic-proxy.berti-b52.workers.dev/v1/messages';
const AI_MODEL = 'claude-sonnet-4-20250514';

async function aiFetch(systemText, userMsg, maxTokens = 1024) {
  const res = await fetch(AI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: [{
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' }  // prompt caching — reduz custo 90%
      }],
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ─── AI STREAM (para textos longos — JARVIS, Relatorio, Proposta, Socio) ──────
async function aiStream(systemText, userMsg, onChunk, maxTokens = 2048) {
  const res = await fetch(AI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      stream: true,
      system: [{
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  if (!res.ok) throw new Error(`AI Stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d.type === 'content_block_delta' && d.delta?.text) onChunk(d.delta.text);
      } catch {}
    }
  }
}

// ─── PARSE SEGURO DE JSON DO AGENTE ──────────────────────────────────────────
function parseAgentJSON(text) {
  try {
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch(e) {
    console.error('Agent JSON parse error:', text);
    return null;
  }
}

// ─── FORMATAÇÃO ───────────────────────────────────────────────────────────────
const fmtDate  = iso => { if(!iso) return '—'; const[y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
const fmtMoney = val => Number(val||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const slugify  = str => String(str).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hoje     = () => new Date().toISOString().split('T')[0];

// ─── CACHE LOCALSTORAGE COM TTL ───────────────────────────────────────────────
function cacheSet(key, data) {
  localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
}
function cacheGet(key, ttlMs = 5 * 60 * 1000) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    if (!raw.ts || Date.now() - raw.ts > ttlMs) return null;
    return raw.data;
  } catch { return null; }
}

// ─── CÁLCULO DE PROGRESSO GERAL ──────────────────────────────────────────────
// CANÔNICO — usar esta função em todos os módulos, nunca reimplementar
function calcPctGeral(servicos) {
  if (!servicos?.length) return 0;
  const totalValor = servicos.reduce((s, v) => s + (Number(v.valor) || 0), 0);
  if (totalValor === 0) {
    // fallback: média simples
    return Math.round(servicos.reduce((s, v) => s + (Number(v.pct_real ?? v.pct_atual) || 0), 0) / servicos.length);
  }
  const ponderado = servicos.reduce((s, v) => s + (Number(v.pct_real ?? v.pct_atual) || 0) * (Number(v.valor) || 0), 0);
  return Math.round(ponderado / totalValor);
}
```

---

## LOCALSTORAGE — KEYS PADRONIZADAS

| Módulo | Key | TTL |
|---|---|---|
| Brain | `brain_v2_berti` | permanente |
| Brain cache obras | `brain_ctxs_cache` | 5 min |
| Cockpit | `cockpit_{slug_obra}` | permanente |
| Comercial | `comercial_berti_v3` | permanente |
| Relatórios | `rel_config` | permanente |
| Hub | `hub_notas` | permanente |

---

## BANCO DE DADOS SUPABASE

### Tabelas existentes

**cockpit_obras**
```
obra_key    text PRIMARY KEY   — slug: "badida_2026"
data        jsonb              — state completo da obra
updated_at  timestamptz
```
Dentro de `data.config`: campos `obs_interna`, `obs_interna_ts`, `obs_interna_autor`
→ únicos campos que Brain pode escrever via PATCH seletivo

**brain_comercial**
```
id, data, tipo, contato, empresa, canal, resumo, acao,
agente, urgencia, prazo, valor_est, importado, obra_key,
notas_socio, created_at
```

### Tabelas a criar — executar no Supabase SQL Editor

```sql
-- brain_data: tarefas, parceiros e config do Brain
CREATE TABLE IF NOT EXISTS brain_data (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo       text NOT NULL,
  -- valores: 'tarefa' | 'parceiro' | 'config'
  data       jsonb NOT NULL,
  obra_key   text,
  status     text DEFAULT 'ativo',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índices para performance — obrigatórios
CREATE INDEX IF NOT EXISTS brain_data_tipo_idx    ON brain_data(tipo);
CREATE INDEX IF NOT EXISTS brain_data_status_idx  ON brain_data((data->>'status'));
CREATE INDEX IF NOT EXISTS brain_data_obra_idx    ON brain_data(obra_key);
CREATE INDEX IF NOT EXISTS brain_data_data_idx    ON brain_data((data->>'data'));

-- base_dados_berti: catálogo de serviços, equipes, fornecedores
CREATE TABLE IF NOT EXISTS base_dados_berti (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  categoria  text NOT NULL,
  -- valores: 'servico' | 'fornecedor' | 'equipe' | 'empresa'
  data       jsonb NOT NULL,
  ativo      boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS base_dados_categoria_idx ON base_dados_berti(categoria);
CREATE INDEX IF NOT EXISTS base_dados_ativo_idx     ON base_dados_berti(ativo);
```

---

## CONTRATOS DE NAVEGAÇÃO ENTRE MÓDULOS

```javascript
// Brain → Cockpit (abre obra específica)
window.open(`index.html?obra_key=badida_2026`, '_blank');

// Cockpit → Relatórios (com obra e semana)
window.open(`relatorios.html?obra_key=badida_2026&semana=3`, '_blank');

// Todo módulo ao iniciar — ler URL params
const params  = new URLSearchParams(window.location.search);
const obraKey = params.get('obra_key');
const semana  = params.get('semana');
if (obraKey) carregarObra(obraKey);
```

---

## SCHEMAS DE DADOS

### Tarefa (brain_data · tipo:'tarefa')
```json
{
  "id": "t-uuid",
  "titulo": "Ligar Joel — aprovar medição S3",
  "contexto": "Badida",
  "categoria": "obra|proposta|comunicacao|administrativo|prospeccao|financeiro|pessoal",
  "data": "2026-03-25",
  "tempo": 10,
  "prioridade": "alta|media|baixa",
  "status": "pendente|concluida|cancelada",
  "whatsapp_para": "Joel",
  "whatsapp_msg": "Mensagem pronta para enviar",
  "recorrente": "null|diario|semanal|mensal",
  "notas": "",
  "criada": "ISO timestamp"
}
```

### Parceiro (brain_data · tipo:'parceiro')
```json
{
  "id": "parc-uuid",
  "nome": "Ana Carolina Pereira",
  "empresa": "Studio AC Arquitetura",
  "funcao": "arquiteta|engenheiro|indicador|construtora|fornecedor_parceiro|outro",
  "contato": "(41) 9xxxx-xxxx",
  "email": "ana@studioac.com",
  "instagram": "@studioac",
  "percentual_parceria": 5,
  "forma_pagamento_parceria": "pix ao fechar contrato",
  "projetos_trazidos": ["badida_2026"],
  "valor_total_gerado": 850000,
  "comissao_total_paga": 42500,
  "comissao_pendente": 0,
  "status": "ativo|inativo|potencial",
  "ultima_interacao": "2026-03-20",
  "proxima_acao": "Ligar — mostrar portfólio atualizado",
  "prazo_proxima_acao": "2026-03-28",
  "notas": "Prefere WhatsApp. Foco em reformas corporativas.",
  "criado_em": "2026-01-15"
}
```

### Cronograma (dentro de cockpit_obras.data)
```json
{
  "id": "crono-001",
  "servico_ref": "SRV-001",
  "descricao": "Alvenaria de vedação — Salão 1",
  "equipe_ref": "EQ-ALV",
  "semana_prevista_ini": 1,
  "semana_prevista_fim": 2,
  "data_prevista_ini": "2026-03-09",
  "data_prevista_fim": "2026-03-22",
  "data_real_ini": "2026-03-10",
  "data_real_fim": null,
  "pct_previsto_semana": { "S1": 50, "S2": 100 },
  "pct_real": 65,
  "status": "planejado|em_andamento|concluido|atrasado|cancelado",
  "valor": 18000,
  "subtarefas": []
}
```

### JSON de obra fechada (Comercial → Brain)
```json
{
  "obra_key": "slug_obra_2026",
  "nome_obra": "Reforma Comercial...",
  "cliente": { "nome": "...", "cnpj": "...", "contato": "..." },
  "endereco": "...",
  "periodo_ini": "2026-04-01",
  "periodo_fim": "2026-06-30",
  "valor_contrato": 350000,
  "servicos": [{ "cod": "...", "descricao": "...", "valor": 0, "semana_prevista": 1 }],
  "equipes": [{ "nome": "...", "especialidade": "...", "contato": "..." }],
  "origem_lead_id": "uuid-do-lead"
}
```

---

## AGENTES DE IA — SYSTEM PROMPTS COMPLETOS

### AGT_JARVIS (Brain · STREAMING)
```
Você é o JARVIS — agente de briefing e planejamento da Berti Construtora.
Gestor: Evandro Luiz Duarte · Curitiba/PR · TDAH.

Seu briefing deve ser direto, concreto, sequencial. Nunca mais que 3 blocos.
Nunca enrolação. Nunca elogio. Nunca "ótima pergunta".

Ao receber dados de obras, agenda e tarefas, gere exatamente:

1. SITUAÇÃO (3 linhas máx): o que está crítico agora
2. PLANO DO DIA (lista sequencial): ☐ HH:MM · [ação] · [cliente] · ~Xmin · [prioridade]
3. ALERTAS (só os que precisam de ação hoje): máx 3 itens

Se não há nada crítico, diga isso em uma linha.
Tom: direto como um sócio experiente, não como assistente.
```

### AGT_WHATSAPP (Brain · JSON obrigatório)
```
Você é o agente de comunicação da Berti Construtora.
Gere mensagens WhatsApp profissionais e próximas ao mesmo tempo.

RESPONDA APENAS COM JSON VÁLIDO. Sem texto antes ou depois. Sem markdown.

Schema obrigatório:
{
  "mensagem": "texto completo pronto para enviar",
  "tipo": "atualizacao|alerta|boletim|aviso|followup|parceiro",
  "destinatario": "nome",
  "urgencia": "alta|media|baixa"
}

Regras:
- Tom: profissional mas próximo
- Máx 5 linhas para atualizações rotineiras
- Boletim semanal: estruturado com emojis para facilitar leitura rápida
- Nunca inventar dados não fornecidos
- Nunca prometer prazos não confirmados
- Para parceiros: tom mais leve e colaborativo
```

### AGT_COCKPIT — ETAPA 1 (Cockpit · JSON obrigatório)
```
Você é o agente de registro de obra da Berti Construtora.
Sua única função: interpretar relatos de visita e extrair dados estruturados.

RESPONDA APENAS COM JSON VÁLIDO. Sem texto antes ou depois. Sem markdown.

Schema obrigatório:
{
  "presencas": ["nome1", "nome2"],
  "servicos": [
    {
      "ref": "SRV-001",
      "descricao_identificada": "alvenaria salão 1",
      "pct_novo": 75,
      "concluido": false,
      "nota": "observação específica se houver"
    }
  ],
  "pendencias": [
    {
      "titulo": "descrição clara",
      "tipo": "decisao|material|aprovacao|outro",
      "urgencia": "alta|media|baixa"
    }
  ],
  "materiais": [
    { "item": "nome", "quantidade": "X unidades", "urgencia": "alta|media|baixa" }
  ],
  "observacao_geral": "resumo do dia em 1-2 frases"
}

Regras de interpretação:
- "quase pronto" → pct_novo: 90
- "metade" → pct_novo: 50
- "começamos" → pct_novo: 15
- "finalizamos" / "concluído" → concluido: true, pct_novo: 100
- Nunca inventar serviços não mencionados
- Arrays vazios [] quando não mencionado — nunca null
- Identificar equipe por nome, apelido ou especialidade mencionada
```

**ETAPA 2 — Atualização do cronograma (JS puro — não IA):**

```javascript
// Esta função é executada APÓS receber o JSON da Etapa 1
// Toda lógica é determinística — sem IA
function aplicarResultadoVisita(jsonAgente, state) {
  if (!jsonAgente) return;

  const hoje = new Date().toISOString().split('T')[0];
  const semAtual = `S${state.config.semana}`;

  // 1. Registrar presenças
  const diaSemana = ['dom','seg','ter','qua','qui','sex','sab'][new Date().getDay()];
  state.diario[diaSemana] = state.diario[diaSemana] || {};
  state.diario[diaSemana].presencas = jsonAgente.presencas;

  // 2. Atualizar serviços
  jsonAgente.servicos.forEach(item => {
    const srv = state.servicos.find(s =>
      s.cod === item.ref ||
      s.descricao.toLowerCase().includes(item.descricao_identificada.toLowerCase())
    );
    if (!srv) return;

    // Nunca regredir % sem flag explícita
    if (item.pct_novo < srv.pct_atual && !item.concluido) return;

    srv.pct_atual = item.pct_novo;
    if (item.concluido) {
      srv.status_atual = 'CONCLUÍDO';
      srv.pct_atual = 100;
      srv.data_fim_real = hoje;
    } else if (srv.pct_atual > 0) {
      srv.status_atual = 'EM ANDAMENTO';
      if (!srv.data_inicio_real) srv.data_inicio_real = hoje;
    }

    // Nota vinculada ao serviço
    if (item.nota) {
      state.notas = state.notas || [];
      state.notas.push({
        tipo: 'campo',
        texto: item.nota,
        servico_ref: srv.cod,
        data: hoje
      });
    }
  });

  // 3. Adicionar pendências
  jsonAgente.pendencias.forEach(p => {
    state.pendencias = state.pendencias || [];
    state.pendencias.push({ ...p, status: 'ABERTO', criada: hoje });
  });

  // 4. Adicionar materiais
  jsonAgente.materiais.forEach(m => {
    state.materiais = state.materiais || [];
    state.materiais.push({ ...m, status: 'solicitado', data: hoje });
  });

  // 5. Recalcular % geral
  state.pct_geral = calcPctGeral(state.servicos);

  // 6. Calcular medição da semana
  const snapshot_anterior = state.snapshots[`S${state.config.semana - 1}`];
  state.servicos.forEach(srv => {
    const pct_anterior = snapshot_anterior?.servicos?.find(s => s.cod === srv.cod)?.pct ?? 0;
    const valor_medido_total    = srv.valor * (srv.pct_atual / 100);
    const valor_medido_anterior = srv.valor * (pct_anterior / 100);
    srv.valor_medido_semana     = valor_medido_total - valor_medido_anterior;
  });

  return state;
}
```

### AGT_SOCIO (Comercial · STREAMING)
```
Você é o Sócio — parceiro comercial estratégico da Berti Construtora.
Analisa leads e prepara Evandro para reuniões e negociações.

Quando receber dados de um lead, entregue em sequência:

1. ANÁLISE (3 linhas): oportunidade real ou não? por quê?
2. PERFIL DO CLIENTE: o que sabemos, o que precisamos descobrir
3. BRIEFING DE REUNIÃO: 5 pontos concretos para levantar
4. OBJEÇÕES PROVÁVEIS: máx 3, com resposta sugerida
5. PRÓXIMA AÇÃO: uma só, específica, com prazo

Tom: direto como um sócio experiente. Nunca elogio. Nunca enrolação.
```

### AGT_PROPOSTA (Comercial · STREAMING)
```
Você é o gerador de propostas comerciais da Berti Construtora.
Empresa: Berti Construtora LTDA · CNPJ 59.622.624/0001-93
Resp. Técnica: Jéssica Berti Martins — CAU A129520-9
Contato: (41) 9183-6651 · berti@curitibaconstrutora.com.br

Gere proposta com estas seções em ordem:
1. Apresentação da empresa (diferenciais reais, 3 parágrafos)
2. Entendimento do escopo (baseado nos dados fornecidos)
3. Metodologia de trabalho (como a Berti opera na prática)
4. Escopo detalhado (serviços com descrição clara para o cliente)
5. Investimento (valor total + forma de pagamento sugerida)
6. Prazo de execução (cronograma macro por fase)
7. Incluído / Não incluído (transparência total)
8. Garantias
9. Próximos passos (CTA claro e direto)

Tom: profissional, confiante, sem excesso. Converte por clareza.
```

### AGT_CONTRATO (Comercial · JSON obrigatório)
```
Você é o gerador de contratos da Berti Construtora.
Empresa: Berti Construtora LTDA · CNPJ 59.622.624/0001-93
Foro: Curitiba/PR

RESPONDA APENAS COM JSON VÁLIDO. Sem texto antes ou depois.

Schema obrigatório:
{
  "tipo": "cliente|equipe|fornecedor",
  "titulo": "CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
  "partes": {
    "contratante": "nome completo + CNPJ/CPF",
    "contratado": "nome completo + CNPJ/CPF"
  },
  "objeto": "descrição do que será executado",
  "valor": 0,
  "forma_pagamento": "descrição completa",
  "prazo_ini": "DD/MM/AAAA",
  "prazo_fim": "DD/MM/AAAA",
  "clausulas": ["cláusula 1", "cláusula 2"],
  "obrigacoes_contratante": ["obrigação 1"],
  "obrigacoes_contratado": ["obrigação 1"],
  "rescisao": "condições de rescisão",
  "foro": "Curitiba/PR"
}

Gere contratos completos, juridicamente claros, em linguagem acessível.
Objetivo: clareza e proteção de ambas as partes.
```

### AGT_RELATORIO (Relatórios · STREAMING)
```
Você é o redator de relatórios da Berti Construtora.

RELATÓRIO DO CLIENTE — regras absolutas:
- NUNCA usar códigos internos (SRV-XXX, EQ-XXX, FOR-XXX)
- NUNCA mencionar valores de custo, margens ou pagamentos de equipe
- Descrever serviços em linguagem do cliente, não técnica
- Tom: profissional, transparente, confiante
- Estrutura: abertura narrativa → destaques → ocorrências → fotos → próxima semana

RELATÓRIO INTERNO — regras:
- Incluir análise de performance (% previsto vs % real por serviço)
- Identificar riscos e recomendar ações
- Incluir análise financeira da semana (medição, pagamentos, saldo)
- Linguagem técnica e direta
```

---

## MÓDULO 1 — BRAIN.HTML (construir primeiro)

### 5 abas obrigatórias
1. **Dashboard** — KPIs + JARVIS briefing (streaming) + Script do Dia
2. **Tarefas** — CRUD, filtros: hoje / amanhã / pendentes / concluídas
3. **Parceiros** — lista, cadastro, alertas de inatividade (15+ dias), comissões
4. **Obras** — visão consolidada de cockpit_obras (READ ONLY)
5. **Mensagens** — AGT_WHATSAPP, lista de mensagens prontas para envio

### Agenda no Brain (Fase 1 — sem Google Calendar)
Campo manual simples: Evandro digita os compromissos do dia.
O JARVIS lê esses compromissos junto com as tarefas para montar o Script do Dia.
Google Calendar é Fase 3 — não implementar agora.

### Regras de negócio
- Lê `cockpit_obras` via Supabase — NUNCA escreve exceto `obs_interna`
- Comissão calculada ao importar obra: `valor_contrato × (percentual_parceria/100)`
- Alerta de parceiro inativo: `ultima_interacao` há 15+ dias
- Tarefa "atrasada": data < hoje e status = 'pendente'
- Script do Dia: tarefas de hoje + agenda manual, ordenados por prioridade alta→baixa
- Cache de obras: `brain_ctxs_cache` com TTL de 5 minutos

---

## MÓDULO 2 — COMERCIAL.HTML

### Pipeline de status
`lead → qualificado → reuniao → proposta → negociacao → fechado | perdido`

### Funcionalidades obrigatórias
- Kanban visual ou lista com filtro por status
- AGT_SOCIO: análise + briefing (streaming)
- AGT_PROPOSTA: proposta completa (streaming)
- AGT_CONTRATO: contratos (JSON → renderizado em HTML para visualização)
- Export do JSON de obra fechada (botão "Criar Obra no Brain")
- Histórico completo com busca por nome/empresa

### Regras
- Escreve em `brain_comercial`, lê `base_dados_berti`
- NUNCA toca `cockpit_obras` ou `brain_data`
- Ao fechar lead: gera JSON completo + exporta para importação no Brain

---

## MÓDULO 3 — INDEX.HTML (COCKPIT)

### 9 abas
1. Obra · 2. Cronograma · 3. Serviços · 4. Equipes · 5. Pagamentos
6. Fotos · 7. Pendências · 8. Materiais · 9. Fechamento/Medição

### AGT_COCKPIT — fluxo de 2 etapas (OBRIGATÓRIO)
```
Etapa 1 — IA (AGT_COCKPIT):
  Input:  áudio transcrito ou texto livre de Evandro
  Output: JSON estruturado (presencas, servicos, pendencias, materiais)

Etapa 2 — JS puro (aplicarResultadoVisita):
  Input:  JSON da Etapa 1 + state atual
  Output: state atualizado (%, cronograma, medição, notas)
  Regra:  toda lógica de negócio é JS determinístico, nunca IA
```

A separação é obrigatória. IA interpreta linguagem. JS calcula.

### Bloqueio de semanas passadas
```
Semana atual S3:
  S1, S2 → somente leitura, edição bloqueada
  S3     → editável (semana corrente)
  S4+    → editável (planejamento futuro)

Ao tentar editar semana bloqueada:
  → Modal: "Semana bloqueada. Simular reprogramação?"
  → Simulação mostra impacto no prazo final
  → Confirmação explícita antes de aplicar
```

### sbSave — salvar no Supabase
```javascript
// Debounced 10 segundos, upsert com merge
async function sbSave(state) {
  const obraKey = slugify(state.config.obra) + '_' + new Date(state.config.periodo_ini).getFullYear();
  await sbFetch(`cockpit_obras`, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      obra_key: obraKey,
      data: state,
      updated_at: new Date().toISOString()
    })
  });
}
```

---

## MÓDULO 4 — RELATORIOS.HTML

### Funcionalidades
- Seletor de obra (lê cockpit_obras do Supabase)
- Seletor de semana (auto-calculado + opção de semanas anteriores via snapshots)
- AGT_RELATORIO: narrativa com streaming
- 5 relatórios: Semanal Cliente · Fotográfico · Interno · Boletim Medição · Gantt PDF
- Preview fullscreen → Copiar / WhatsApp / PDF
- Fallback Supabase se localStorage vazio

### Regras absolutas
- NUNCA escreve em nenhuma tabela
- Relatório cliente: zero códigos internos, zero valores de custo
- Delta com snapshot: compara estado S(n) vs S(n-1)

---

## MÓDULO 5 — HUB.HTML

### Filosofia
Primeira tela do dia. Nada que cause ansiedade. Só o que dá paz.

### O que mostra (nada mais)
- Saudação com hora e data
- Agenda do dia (lida do Brain — campo manual)
- 3 prioridades do dia
- Mensagens prontas para enviar hoje
- Obras ativas: 1 linha cada (nome · % · alerta se crítico)
- Alertas do dia (só os que precisam de ação hoje)
- Parceiros com ação vencida

---

## FLUXOS PRINCIPAIS

### Lead → Obra Ativa
```
Comercial fecha lead → JSON exportado
Brain importa JSON → upsert em cockpit_obras via sbFetch
Cockpit: window.open(`index.html?obra_key=${obraKey}`)
Cockpit carrega do Supabase → pronto para operar
```

### Visita de Campo → Medição (2 etapas)
```
Etapa 1: Evandro fala/digita → AGT_COCKPIT → JSON
Etapa 2: aplicarResultadoVisita(json, state) → state atualizado
sbSave(state) → Supabase
Brain detecta atualização → AGT_WHATSAPP gera mensagem
Hub mostra mensagem em "Prontas para enviar"
Evandro aprova → window.open("https://wa.me/...")
```

### Fechamento de Semana → Relatório
```
Cockpit: gravar snapshots[`S${semana}`] ANTES de qualquer limpeza
Cockpit: arquivar diario_historico, limpar diario, incrementar semana
Relatórios: selecionar obra + semana → AGT_RELATORIO (streaming)
Evandro aprova → PDF ou WhatsApp
```

### Parceiro Esfriando → Ação
```
Brain: detecta ultima_interacao > 15 dias → alerta visual
AGT_WHATSAPP: gera mensagem de follow-up contextualizada
Evandro aprova → envia → Brain atualiza ultima_interacao
```

---

## MELHORES PRÁTICAS DE API (OBRIGATÓRIAS)

### 1. Prompt Caching (todos os agentes)
`cache_control: {type:"ephemeral"}` no system. Já implementado no `aiFetch()` e `aiStream()`.
Reduz custo em 90% nas chamadas repetidas dentro de 5 minutos.

### 2. JSON Estruturado (agentes determinísticos)
AGT_COCKPIT, AGT_WHATSAPP, AGT_CONTRATO: sempre retornam JSON com schema fixo.
System prompt especifica schema e instrui: "APENAS JSON, sem texto antes ou depois."
Sempre usar `parseAgentJSON()` — nunca parsear JSON diretamente.

### 3. Streaming (agentes de texto longo)
AGT_JARVIS, AGT_RELATORIO, AGT_PROPOSTA, AGT_SOCIO: usar `aiStream()`.
`onChunk = (chunk) => { el.textContent += chunk; }`

### 4. Timeout obrigatório em todo fetch
`AbortSignal.timeout(30000)` em aiFetch/aiStream.
`AbortSignal.timeout(15000)` em sbFetch.
Nunca um fetch sem timeout — trava a UI indefinidamente.

### 5. AGT_COCKPIT em 2 etapas (reduz risco de falha)
IA faz o difícil (linguagem natural → JSON). JS faz o determinístico (cálculos, datas, %).
Nunca misturar as duas responsabilidades.

---

## DADOS DA EMPRESA BERTI

```
Razão Social: Berti Construtora LTDA
CNPJ: 59.622.624/0001-93
Responsável Técnica: Jéssica Berti Martins — CAU A129520-9
Telefone: (41) 9183-6651
Email: berti@curitibaconstrutora.com.br
PIX: 59.622.624/0001-93
Banco: NuBank · Ag 0001 · Cc 583989144-1
Cidade: Curitiba/PR
```

---

## OBRA ATUAL — BADIDA (usar para testes)

```
obra_key:       badida_2026
Nome:           Reforma Churrascaria Badida — ParkShopping Barigui
Cliente:        TMK Comércio de Alimentos LTDA
CNPJ cliente:   20.309.703/0001-03
Contato:        Joel
Endereço:       Av. Prof. Pedro Viriato Parigot de Souza, 600 – Loja 303 – Curitiba/PR
Período:        09/03/2026 → 25/04/2026
Semana atual:   3 (auto-calculada)
Total serviços: 51
```

Testar Brain com Badida imediatamente após publicar. Se dados aparecerem → módulo funcional.

---

## ORDEM RÍGIDA DE CONSTRUÇÃO E TESTE

| # | Arquivo | Teste de validação |
|---|---|---|
| 1 | `brain.html` | Badida carrega, JARVIS gera briefing com streaming |
| 2 | `comercial.html` | Lead criado, AGT_SOCIO gera análise, JSON exportado |
| 3 | `index.html` | AGT_COCKPIT processa relato, % atualiza, sbSave funciona |
| 4 | `relatorios.html` | Relatório semanal da Badida gerado com narrativa real |
| 5 | `hub.html` | Dashboard abre, mostra dados reais de todos os módulos |

**Nunca avançar para o próximo sem o anterior validado com dados reais.**

---

## COMO ENTREGAR CADA MÓDULO

1. Ler CLAUDE.md e DEKA_MASTER.md antes de escrever qualquer linha
2. Incluir DEKA_CORE completo — todas as funções, literalmente
3. Incluir todos os CSS variables e imports de fonte
4. Zero dados hardcoded — tudo vem do Supabase ou localStorage
5. Testar fluxo mentalmente: abrir → conectar → renderizar → interagir → salvar
6. Verificar sintaxe: `node --check arquivo.html` antes de salvar
7. Entregar arquivo completo — nunca trechos ou diffs

---

## REGRAS DE SNAPSHOTS E HISTÓRICO

### Comportamento padrão — imutável
- Snapshots de semanas fechadas são somente leitura
- Edição dos dados de semana passada: permitida com modal de impacto + confirmação
- Visitas nunca apagadas — histórico permanente
- Relatórios de semanas anteriores: gerados a qualquer momento a partir do snapshot

### Deleção de snapshot — ato extraordinário
Existe, mas protegida por duas confirmações obrigatórias em sequência:

**Confirmação 1 — alerta de impacto:**
```
⚠ AÇÃO IRREVERSÍVEL

Você está prestes a apagar o snapshot da Semana [N].

Isso significa:
• O histórico dessa semana será perdido permanentemente
• O relatório dessa semana não poderá mais ser gerado
• Os dados de medição dessa semana serão removidos
• Esta ação NÃO pode ser desfeita

Digite "CONFIRMAR" para continuar ou clique em Cancelar.
```

**Confirmação 2 — após digitar CONFIRMAR:**
```
Última confirmação.

Apagar Semana [N] de "[Nome da Obra]"?
Esta é sua última chance de cancelar.

[Apagar definitivamente] [Cancelar]
```

Só após as duas confirmações o snapshot é deletado do state e o Supabase é atualizado.

### Acesso a relatórios de semanas anteriores
- Seletor de semana no módulo Relatórios lista todas as semanas com snapshot
- Relatório gerado a partir do snapshot da semana selecionada
- Geração disponível a qualquer momento — não há prazo ou expiração
- PDF não é salvo automaticamente — Evandro gera e salva quando quiser

### Implementação no Cockpit
```javascript
async function deletarSnapshot(semana) {
  // Confirmação 1
  const input = prompt(
    `⚠ AÇÃO IRREVERSÍVEL\n\nDigite "CONFIRMAR" para apagar o snapshot da Semana ${semana}.\n\nEsta ação não pode ser desfeita.`
  );
  if (input !== 'CONFIRMAR') {
    toast('Operação cancelada.', 'info');
    return;
  }

  // Confirmação 2
  const ok = confirm(
    `Última confirmação.\n\nApagar PERMANENTEMENTE o snapshot da Semana ${semana} de "${state.config.obra}"?\n\nClique em OK para confirmar ou Cancelar para abortar.`
  );
  if (!ok) {
    toast('Operação cancelada.', 'info');
    return;
  }

  // Deletar
  delete state.snapshots[`S${semana}`];
  saveState();
  await sbSave(state);
  toast(`Snapshot da Semana ${semana} removido.`, 'warn');
  render();
}
```

---

## DESCARTADO — NÃO IMPLEMENTAR

- ~~AGT_ENGENHEIRO~~ — orçamento é externo, importado via JSON
- ~~Extended Thinking~~ — sem agente que precise
- ~~Histórico de conversa com cliente~~ — relatórios e WhatsApp suficientes
- ~~Google Calendar Fase 1~~ — agenda é campo manual no Brain (Fase 3)
- ~~Autenticação/login~~ — uso pessoal, sem multi-usuário

---

*CLAUDE.md · v1.1 · 25/03/2026 · Berti Construtora · DEKA*
*Lido automaticamente pelo Claude Code ao iniciar no repositório.*

# DEKA — MAPA COMPLETO DO SISTEMA
## Berti Construtora · Gestor: Evandro Luiz Duarte
### Versão 1.2 · 25/03/2026 · Documento vivo

---

## CHANGELOG
- v1.2 · 25/03/2026 · Brain: módulo Parceiros/Networking adicionado · Cockpit: Cronograma inteligente expandido + regra de bloqueio de semanas passadas + medição automática por serviço + bloqueio de retroedição com aviso de reprogramação
- v1.1 · 25/03/2026 · AGT_COCKPIT para AGORA · AGT_ENGENHEIRO · AGT_PROPOSTA · AGT_CONTRATO · Base de Dados · Hub como dashboard matinal
- v1.0 · 25/03/2026 · Versão inicial

---

## 0. PRINCÍPIO CENTRAL

> O sistema não organiza informação. Ele elimina decisões.
> Evandro captura. O DEKA estrutura. Evandro confirma. Um toque.

---

## 1. O PIPELINE REAL DA OPERAÇÃO

```
┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌────────────┐
│ PROSPECÇÃO │─►│  ORÇAMENTO  │─►│  PROPOSTA  │─►│  CONTRATO  │
│ Comercial  │  │  Comercial  │  │ Comercial  │  │ Comercial  │
│ AGT_SOCIO  │  │AGT_ENGENHEIRO│ │AGT_PROPOSTA│  │AGT_CONTRATO│
└────────────┘  └─────────────┘  └────────────┘  └─────┬──────┘
                                                        │ JSON exportado
┌────────────┐  ┌─────────────┐  ┌──────────────────────┘
│  ENTREGA   │◄─│   MEDIÇÃO   │◄─│      OBRA ATIVA        │
│ Relatórios │  │  Relatórios │  │  Cockpit + Brain       │
└────────────┘  └─────────────┘  └────────────────────────┘
```

Regra: Lead nasce no Comercial. Fecha com contrato. JSON exportado → Brain importa → Cockpit configurado. Zero redigitação.

---

## 2. OS MÓDULOS

---

### 2.1 COMERCIAL (comercial.html)
**Função:** Funil comercial completo — do lead ao contrato assinado.

**Fluxo:**
```
Lead → AGT_SOCIO qualifica → Reunião → Diagnóstico
    ↓ AGT_ENGENHEIRO lê projeto + base de dados
Orçamento → Evandro aprova → AGT_PROPOSTA gera proposta
    ↓ Fechamento → AGT_CONTRATO gera contratos
JSON exportado → Brain → Cockpit configurado
```

**Agentes:** AGT_SOCIO · AGT_ENGENHEIRO · AGT_PROPOSTA · AGT_CONTRATO

**JSON ao fechar:**
```json
{
  "obra_key": "slug_2026",
  "nome_obra": "...",
  "cliente": { "nome":"...", "cnpj":"...", "contato":"..." },
  "endereco": "...",
  "periodo_ini": "2026-04-01",
  "periodo_fim": "2026-06-30",
  "valor_contrato": 350000,
  "servicos": [{ "cod":"...", "descricao":"...", "valor":0, "semana_prevista":1 }],
  "equipes": [{ "nome":"...", "especialidade":"...", "contato":"..." }],
  "origem_lead_id": "uuid"
}
```

**Lê:** `brain_comercial`, `base_dados_berti`
**Escreve:** `brain_comercial`, `base_dados_berti`
**NUNCA toca:** `cockpit_obras`, `brain_data`

---

### 2.2 BRAIN (brain.html)
**Função:** Central de comando. Visão total da operação.

**O que faz:**
- Dashboard: obras ativas, pipeline, tarefas do dia, alertas
- Agenda integrada com Google Calendar (leitura)
- Captura de tarefas por áudio/texto → AGT_JARVIS extrai, classifica, agenda
- Script do Dia: sequencial, sem ambiguidade, sem decisão
- Alertas: pendências de obra, tarefas atrasadas, follow-ups vencidos
- Importa JSON de obra fechada → cria `cockpit_obras`
- Mensagens WhatsApp prontas (AGT_WHATSAPP)
- Fluxo de caixa macro
- **Módulo Parceiros** (novo — ver seção 2.2.1)

**Lê:** `cockpit_obras` (READ ONLY), `brain_comercial`, `brain_data`
**Escreve:** `brain_data`, `cockpit_obras.obs_interna` (único campo permitido)

---

#### 2.2.1 BRAIN — MÓDULO PARCEIROS

**Função:** Gestão do networking estratégico da Berti. Parceiros são pessoas que geram negócio ou participam da operação de forma recorrente — arquitetas, engenheiros, indicadores, construtoras parceiras.

**Por que existe:** A saúde da empresa depende da saúde do relacionamento com parceiros. Sem rastreamento, parceiros esfria, indicação para, comissão fica mal controlada. Com o módulo, cada parceiro tem histórico, status e próxima ação definida.

**O que registra por parceiro:**
```json
{
  "id": "parc-uuid",
  "nome": "Ana Carolina Pereira",
  "empresa": "Studio AC Arquitetura",
  "funcao": "arquiteta",          // arquiteta | engenheiro | indicador | construtora | fornecedor_parceiro | outro
  "contato": "(41) 9xxxx-xxxx",
  "email": "ana@studioac.com",
  "instagram": "@studioac",
  "percentual_parceria": 5,       // % de comissão sobre obra indicada
  "forma_pagamento_parceria": "pix ao fechar contrato",
  "projetos_trazidos": ["badida_2026", "obra_xyz"],
  "valor_total_gerado": 850000,
  "comissao_total_paga": 42500,
  "comissao_pendente": 0,
  "status": "ativo",              // ativo | inativo | potencial
  "ultima_interacao": "2026-03-20",
  "proxima_acao": "Ligar — mostrar portfólio atualizado",
  "prazo_proxima_acao": "2026-03-28",
  "notas": "Prefere WhatsApp. Foco em reformas corporativas. Indicou Joel.",
  "criado_em": "2026-01-15"
}
```

**Visão no Brain:**
- Lista de parceiros ativos com status de relacionamento
- Alerta quando parceiro está sem interação há X dias
- Comissões pendentes em destaque
- Próximas ações agendadas (integradas ao Script do Dia)
- Histórico de projetos trazidos com valor gerado

**Mensagens via AGT_WHATSAPP:**
- Follow-up de relacionamento ("passando para atualizar, temos projeto novo...")
- Confirmação de comissão ("seu pagamento de R$ X foi processado...")
- Convite para visita de obra ou apresentação de portfólio

**Regra de comissão:**
- Ao criar obra via JSON importado, se `origem_lead_id` tem parceiro vinculado
- Brain calcula comissão = `valor_contrato × percentual_parceria / 100`
- Registra em `comissao_pendente` do parceiro
- Ao confirmar pagamento: move para `comissao_total_paga`

---

### 2.3 COCKPIT (index.html)
**Função:** Operação diária em campo. Mobile-first.

**Abas:**
1. Obra (config + resumo)
2. Cronograma (planejamento + execução real)
3. Serviços (lista completa com %)
4. Equipes (presença + contatos)
5. Pagamentos
6. Fotos (vinculadas ao dia e serviço)
7. Pendências
8. Materiais
9. Fechamento / Medição

---

#### 2.3.1 COCKPIT — CRONOGRAMA INTELIGENTE

**Função:** Planejamento das semanas da obra + atualização automática via AGT_COCKPIT.

**Estrutura do cronograma:**
```json
{
  "cronograma": [
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
      "status": "em_andamento",    // planejado | em_andamento | concluido | atrasado | cancelado
      "valor": 18000,
      "subtarefas": []             // se serviço foi dividido em partes
    }
  ]
}
```

**O que o AGT_COCKPIT faz ao processar uma visita:**

1. **Marca presença** — identifica quem estava pelo nome/apelido no relato
2. **Identifica serviços** — extrai quais serviços foram executados
3. **Atualiza % real** — aplica o avanço relatado em cada serviço
4. **Compara com cronograma:**
   - Se % real > % previsto → obra adiantada (destaca em verde)
   - Se % real < % previsto → obra atrasada (alerta + recalcula previsão)
5. **Se serviço concluído antes do previsto:**
   - Atualiza `data_real_fim` com a data de hoje
   - Recalcula folga disponível no cronograma
6. **Se serviço precisa ser dividido:**
   - Cria subtarefa com descritivo derivado do relato
   - Mantém serviço original, adiciona entrada em `subtarefas[]`
7. **Atualiza medição automática:**
   - `valor_medido = valor_servico × pct_real / 100`
   - Acumula em `medicao_semana_atual`

**Regra de bloqueio de semanas passadas:**

```
Semana atual: S3

S1 → BLOQUEADO (somente leitura)
S2 → BLOQUEADO (somente leitura)
S3 → EDITÁVEL (semana corrente)
S4+ → EDITÁVEL (planejamento futuro)
```

Se Evandro tenta editar dado de semana passada:
```
⚠ SEMANA BLOQUEADA

Esta semana já foi fechada com snapshot.
Editar dados históricos afeta o cronograma inteiro.

Você quer reprogramar toda a obra?
Se sim, o sistema irá:
• Recalcular todas as datas previstas a partir desta alteração
• Mostrar o impacto no prazo final
• Pedir confirmação antes de aplicar

[Simular reprogramação] [Cancelar]
```

Se Evandro confirma "Simular reprogramação":
- Sistema calcula como a obra ficaria com a alteração
- Mostra: novo prazo final, serviços afetados, semanas impactadas
- Evandro vê o impacto completo antes de decidir
- Só então: [Confirmar e reprogramar] ou [Cancelar]

**Medição automática:**

A cada visita processada pelo AGT_COCKPIT:
```
Para cada serviço executado:
  valor_medido_acumulado = valor_servico × pct_real / 100
  valor_medido_esta_semana = valor_medido_acumulado - valor_medido_semana_anterior

Total da semana = Σ valor_medido_esta_semana de todos os serviços
```

Esse total alimenta diretamente o Boletim de Medição do módulo Relatórios.

**Fotos vinculadas:**
- Cada foto registrada tem: data, serviço_ref, ambiente, legenda
- Ao gerar relatório: fotos organizadas por ordem cronológica do dia e semana

**Fechamento de semana — o que o AGT_RELATORIO recebe:**
```json
{
  "semana": 3,
  "periodo": "17/03 a 23/03/2026",
  "servicos_executados": [...],
  "servicos_concluidos": [...],
  "servicos_iniciados": [...],
  "pct_geral_ini": 32,
  "pct_geral_fim": 48,
  "delta_pct": 16,
  "medicao_valor": 28400,
  "presencas": { "seg": ["João", "Pedro"], "ter": [...] },
  "pendencias_abertas": [...],
  "pendencias_resolvidas": [...],
  "fotos": [...],
  "diario": { "seg":"...", "ter":"...", ... },
  "servicos_proxima_semana": [...],
  "narrativa_campo": "texto livre registrado durante a semana"
}
```

**AGT_RELATORIO processa e gera:**
1. Texto narrativo de abertura (o que foi executado, tom profissional)
2. Destaques da semana (o que avançou, o que foi concluído)
3. Ocorrências (pendências abertas, problemas identificados)
4. Fotos na ordem cronológica com legenda
5. Medição da semana (valor por serviço + total)
6. Previsão da próxima semana (serviços planejados)
7. Cronograma atualizado (Gantt visual)

**Cada semana tem snapshot imutável** — ao avançar semana:
- Grava `snapshots['S3']` com o estado completo
- Arquiva diário em `diario_historico['S3']`
- Zera campos da semana corrente
- Semana anterior passa para BLOQUEADO

**Lê/Escreve:** `cockpit_obras`
**NUNCA lê:** `brain_data`, `brain_comercial`

---

### 2.4 RELATÓRIOS (relatorios.html)
**Função:** Documentos para cliente e gestão interna.

Recebe dados processados do Cockpit e gera:
- Relatório Semanal Cliente (narrativa + fotos + progresso + previsão próxima semana)
- Relatório Fotográfico
- Relatório Interno (com custos e códigos)
- Boletim de Medição com aceite do cliente
- Gantt PDF

**Lê:** `cockpit_obras` via Supabase (fallback se localStorage vazio)
**NUNCA escreve** em nenhuma tabela

---

### 2.5 HUB (hub.html)
**Função:** Dashboard matinal + painel de navegação. A primeira tela do dia.

**Filosofia:** Nada que cause ansiedade. Só o que dá paz e clareza.

**O que mostra:**
- Agenda do dia (Google Calendar integrado)
- 3 prioridades do dia (do Brain)
- Mensagens prontas para enviar hoje
- Obras ativas: status em 1 linha cada
- Alertas críticos (só os de hoje)
- Parceiros com ação pendente hoje

**O que NÃO mostra:** nada que não precisa de atenção agora.

---

## 3. AGENTES DE IA — TODOS AGORA

CF Worker: `anthropic-proxy.berti-b52.workers.dev/v1/messages`
Modelo: `claude-sonnet-4-20250514`
Obrigatório: `AbortSignal.timeout(30000)` em todo fetch.

| Agente | Módulo | Função principal |
|---|---|---|
| AGT_SOCIO | Comercial | Qualificação, briefing de reunião, objeções |
| AGT_ENGENHEIRO | Comercial | Leitura de projeto, orçamento, base de dados |
| AGT_PROPOSTA | Comercial | Proposta visual Berti, exporta PDF |
| AGT_CONTRATO | Comercial | Contratos (cliente, equipe, fornecedor) |
| AGT_JARVIS | Brain | Briefing diário, Script do Dia, extrai tarefas |
| AGT_WHATSAPP | Brain | Mensagens prontas (clientes + parceiros) |
| AGT_RELATORIO | Relatórios | Narrativa profissional, análise semanal |
| AGT_COCKPIT | Cockpit | Processa visita → atualiza cronograma + medição |

---

### AGT_COCKPIT — Detalhamento (mais crítico)

Input: áudio transcrito ou texto livre do campo
Output: formulário pré-preenchido para confirmação de Evandro

**Extrai e preenche:**
- Quem estava presente (por nome ou apelido)
- Serviços executados e % de avanço de cada um
- Se serviço foi concluído: atualiza `data_real_fim`
- Se serviço foi dividido: cria subtarefa no cronograma
- Pendências identificadas (com tipo e vinculação ao serviço)
- Observações e notas vinculadas ao serviço e ambiente
- Material solicitado (se mencionado)

**Valida:**
- % não pode regredir sem justificativa explícita
- Serviço marcado como concluído não reabre sem flag de revisão
- Consistência entre equipe presente e serviços executados

**Atualiza cronograma automaticamente:**
- Compara pct_real vs pct_previsto → status (adiantado/atrasado)
- Recalcula previsão de conclusão se há atraso
- Gera alerta se impacto no prazo final for detectado

**Calcula medição da semana:**
- Para cada serviço com % atualizado, recalcula valor medido
- Acumula total da semana para o Boletim de Medição

---

## 4. BASE DE DADOS BERTI

Repositório central. Alimentado continuamente pelas obras executadas.

**Serviço:**
```json
{
  "cod": "SRV-ALV-001",
  "descricao": "Alvenaria de vedação",
  "unidade": "m²",
  "valor_min": 45, "valor_max": 80, "valor_medio": 62,
  "custo_material_medio": 28, "custo_mao_obra_medio": 34,
  "historico_obras": ["badida_2026"],
  "tempo_medio_dias": 5
}
```

**Fornecedor:**
```json
{
  "nome": "...", "cnpj": "...", "contato": "...",
  "especialidade": ["cerâmica", "porcelanato"],
  "prazo_entrega_dias": 3, "avaliacao": 4
}
```

**Equipe/Terceiro:**
```json
{
  "nome": "...", "especialidade": "alvenaria",
  "contato": "...", "pix": "...",
  "valor_diaria": 280, "avaliacao": 4,
  "notas": "Supervisionar acabamentos"
}
```

**Atualização pós-obra:** ao fechar obra, AGT_ENGENHEIRO extrai custos reais por serviço e atualiza `valor_medio`, `custo_material_medio`, `custo_mao_obra_medio`.

---

## 5. BANCO DE DADOS SUPABASE

```
URL: https://tdylutdfzgtcfyhynenk.supabase.co
KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWx1dGRmemd0Y2Z5aHluZW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODQxMjcsImV4cCI6MjA4ODg2MDEyN30.k44CAV8O8AGhq4lzy-Ms5CF6JsW2fgMqLEegKb4K-pg
```

| Tabela | Status | Escreve | Lê |
|---|---|---|---|
| `cockpit_obras` | ✅ Existe | Cockpit | Brain (READ), Relatórios (READ) |
| `brain_comercial` | ✅ Existe | Comercial | Brain |
| `brain_data` | 🔴 Criar | Brain | Brain |
| `base_dados_berti` | 🔴 Criar | Comercial, AGT_ENGENHEIRO | Comercial |
| `financeiro_berti` | 🟡 Fase 2 | Brain, Cockpit | Brain, Relatórios |

```sql
-- brain_data
CREATE TABLE brain_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL,  -- 'tarefa' | 'parceiro' | 'cliente' | 'config'
  data jsonb NOT NULL,
  obra_key text,
  status text DEFAULT 'ativo',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- base_dados_berti
CREATE TABLE base_dados_berti (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  categoria text NOT NULL,  -- 'servico' | 'fornecedor' | 'equipe' | 'empresa'
  data jsonb NOT NULL,
  ativo boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
```

Nota: Parceiros ficam em `brain_data` com `tipo = 'parceiro'`.

---

## 6. CONTRATOS DE NAVEGAÇÃO

```javascript
// Brain → Cockpit com obra
window.open(`index.html?obra_key=badida_2026`, '_blank');

// Cockpit → Relatórios com contexto
window.open(`relatorios.html?obra_key=badida_2026&semana=3`, '_blank');

// Cada módulo ao iniciar
const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra_key');
if (obraKey) carregarObra(obraKey);
```

---

## 7. BIBLIOTECA COMPARTILHADA (DEKA_CORE)

Idêntica em todos os módulos. Nunca divergir.

```javascript
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, tipo = 'info', dur = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), dur);
}

const SB_URL = 'https://tdylutdfzgtcfyhynenk.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWx1dGRmemd0Y2Z5aHluZW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODQxMjcsImV4cCI6MjA4ODg2MDEyN30.k44CAV8O8AGhq4lzy-Ms5CF6JsW2fgMqLEegKb4K-pg';

async function sbFetch(endpoint, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    signal: AbortSignal.timeout(15000), ...options,
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', ...options.headers }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const AI_URL = 'https://anthropic-proxy.berti-b52.workers.dev/v1/messages';
const AI_MODEL = 'claude-sonnet-4-20250514';

async function aiFetch(system, userMsg, maxTokens = 1024) {
  const res = await fetch(AI_URL, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens,
      system, messages: [{ role: 'user', content: userMsg }] })
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  return (await res.json()).content?.[0]?.text ?? '';
}

const fmtDate = iso => { if(!iso) return '—'; const[y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
const fmtMoney = val => Number(val||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const slugify = str => String(str).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hoje = () => new Date().toISOString().split('T')[0];
```

---

## 8. DESIGN SYSTEM

```css
:root {
  --verde: #2E9650; --verde-dim: #1a5c30;
  --ouro: #B89A6A;  --ouro-dim: #7a6445;
  --bg: #060D09; --bg-2: #0D1A10; --bg-3: #142018;
  --border: #1e2e20; --text: #e8f0e8; --text-dim: #7a9a7a;
  --danger: #cc3333; --warn: #cc8800;
  --font-display: 'Bebas Neue', sans-serif;
  --font-body: 'Jost', sans-serif;
  --font-data: 'JetBrains Mono', monospace;
}
```

```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Jost:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&family=Syne:wght@400;700&display=swap" rel="stylesheet">
```

---

## 9. LOCALSTORAGE — KEYS

| Módulo | Key |
|---|---|
| Cockpit | `cockpit_{slug_obra}` |
| Brain | `brain_v2_berti` |
| Brain cache | `brain_ctxs_cache` (TTL 5min) |
| Comercial | `comercial_berti_v3` |
| Relatórios | `rel_config` |
| Hub | `hub_notas` |

---

## 10. OBSIDIAN — CAMADA DE MEMÓRIA

Não integra tecnicamente. A integração é humana e intencional.

**Quando alimentar:** sexta-feira, 15 minutos.
**Quando consultar:** antes de iniciar obra, ao contratar equipe, quando serviço trava.

```
📁 DEKA_VAULT/
├── 00_MASTER/       ← DEKA_MASTER.md + decisões técnicas
├── 01_OBRAS/        ← uma nota por obra
├── 02_CLIENTES/     ← perfil comportamental + histórico
├── 03_EQUIPES/      ← performance + pontos de atenção
├── 04_FORNECEDORES/
├── 05_PADROES/      ← ERROS_RECORRENTES · SEQUENCIA_SERVICOS
└── 06_FINANCEIRO/   ← MARGENS_REFERENCIA
```

---

## 11. FLUXOS PRINCIPAIS

**Lead → Obra:**
Comercial fecha → JSON exportado → Brain importa → cria `cockpit_obras` → Cockpit abre configurado

**Visita de Campo → Medição:**
Evandro fala áudio → AGT_COCKPIT processa → atualiza cronograma + % + medição → Brain detecta → AGT_WHATSAPP gera mensagem para cliente

**Fechamento de Semana → Relatório:**
Cockpit grava snapshot → AGT_RELATORIO recebe dados estruturados → gera narrativa + fotos + medição + previsão → Relatórios apresenta → Evandro aprova → envia

**Obra Concluída → Base de Dados:**
Cockpit finaliza → custos reais exportados → AGT_ENGENHEIRO atualiza `base_dados_berti` → próximo orçamento mais preciso

**Parceiro → Relacionamento ativo:**
Brain mostra parceiros sem interação → AGT_WHATSAPP gera mensagem de follow-up → Evandro aprova → envia → atualiza `ultima_interacao`

**Retroedição de semana passada:**
Tentativa de editar S1 ou S2 com obra em S3 → modal de bloqueio → simulação de impacto → confirmação explícita → reprogramação

---

## 12. ORDEM DE CONSTRUÇÃO

| Fase | Entrega | Status |
|---|---|---|
| 0 | DEKA_MASTER.md | ✅ |
| 1 | brain.html v2 (com módulo Parceiros) | 🔴 Próximo |
| 2 | comercial.html — todos os agentes | 🔴 |
| 3 | index.html — cronograma inteligente + AGT_COCKPIT | 🔴 |
| 4 | relatorios.html — audit + align | 🔴 |
| 5 | hub.html — dashboard matinal | 🔴 |
| 6 | Criar tabelas Supabase (brain_data + base_dados_berti) | 🔴 |
| 7 | GitHub — repositório atualizado | 🔴 |
| 8 | financeiro_berti — tabela + módulo | 🟡 Fase 2 |
| 9 | Google Calendar no Brain | 🟡 Fase 2 |

---

## 13. REGRAS INVIOLÁVEIS

1. Brain e Relatórios NUNCA escrevem em `cockpit_obras` exceto `obs_interna`
2. `calcPctGeral()` canônico — média ponderada por valor
3. Semana: `Math.max(1, Math.floor((hoje - periodo_ini) / (7*86400000)) + 1)`
4. Snapshot gravado ANTES de avançar semana — sempre
5. Semanas passadas são bloqueadas para edição — retroedição exige confirmação explícita com simulação de impacto
6. Todo fetch tem `AbortSignal.timeout()` — sem exceção
7. Dados simulados JAMAIS em produção
8. Relatórios do cliente nunca mostram SRV-XXX, EQ-XXX
9. Visitas nunca apagadas — histórico permanente
10. CF Worker: sempre `/v1/messages` — nunca root URL
11. Zero redigitação entre módulos — dados via JSON ou Supabase
12. Hub não causa ansiedade — só o que precisa de atenção agora
13. Comissão de parceiro calculada automaticamente ao criar obra — nunca manual

---

## 14. DESCARTADO

- ~~Histórico de conversa com cliente~~ — sem necessidade
- ~~AGT_COCKPIT como futuro~~ — é AGORA, já testado em campo

---

## 15. INFRAESTRUTURA

| Recurso | Endereço |
|---|---|
| Supabase | `tdylutdfzgtcfyhynenk.supabase.co` |
| CF Worker | `anthropic-proxy.berti-b52.workers.dev/v1/messages` |
| GitHub Pages | `berti-design.github.io/mestre-obra-berti/` |
| Repo | `github.com/berti-design/mestre-obra-berti` |
| Modelo IA | `claude-sonnet-4-20250514` |

---

*DEKA_MASTER.md · v1.2 · 25/03/2026 · Berti Construtora*
*Documento vivo — atualizar a cada decisão de arquitetura*

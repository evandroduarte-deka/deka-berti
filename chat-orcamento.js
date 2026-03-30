/**
 * DEKA OS v2.0 — chat-orcamento.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: AGT_INTAKE — Elaboração de Propostas Comerciais via Chat
 *
 * RESPONSABILIDADES:
 *   - Interface de chat com Claude para elaboração de estudos de orçamento
 *   - Suporte a PDF do projeto (multimodal)
 *   - Extração de dados estruturados (proposta + itens) via JSON final
 *   - Inserção em propostas + itens_proposta
 *
 * TABELAS SUPABASE:
 *   - propostas (WRITE)
 *   - itens_proposta (WRITE)
 *   - obras (WRITE opcional - após fechamento)
 *   - obra_servicos (WRITE opcional - após fechamento)
 *
 * REGRAS DEKA OS:
 *   - Zero try/catch silenciosos (console.error + showToast obrigatórios)
 *   - chamarClaude() do deka.js com max_tokens: 4096
 *   - PDF: validar tipo e tamanho (máx 20MB) antes de base64
 *   - JSON final DEVE ter: nova_proposta + novos_itens
 */

// =============================================================================
// IMPORTS
// =============================================================================

import {
  supabase,
  showToast,
  chamarClaude,
} from './deka.js';

// =============================================================================
// CONSTANTES
// =============================================================================

const MAX_PDF_SIZE_MB = 20;
const MAX_PDF_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

const SYSTEM_PROMPT_INTAKE = `Você é o AGT_INTAKE da Berti Construtora.
Sua missão: elaborar PROPOSTAS COMERCIAIS (estudos de orçamento).
O gestor tem poucas informações no início — às vezes só nome do cliente + PDF.
Seja FLEXÍVEL, não rígido. Nunca exija dados que não foram fornecidos.

Ticket médio: R$ 80k–500k+
Reformas residenciais e comerciais de médio-alto padrão em Curitiba/PR.

════════════════════════════════════════════
ETAPA 1 — RECEBER MATERIAL
════════════════════════════════════════════

Mensagem de abertura (diga exatamente):
"Olá! Vou montar o estudo de orçamento. Me manda o que você tiver:
 PDF do projeto, narrativa de visita, fotos ou só o nome do cliente.
 Começamos com o que você tem. 🏗️"

Aceite QUALQUER combinação de inputs (PDF sozinho, só texto, ambos).
Extraia o máximo possível do material fornecido.
Campos não encontrados: marque [PREENCHER]. NUNCA invente dados.

════════════════════════════════════════════
ETAPA 2 — CONFIRMAR DADOS BÁSICOS
════════════════════════════════════════════

Pergunte APENAS o que NÃO conseguiu extrair do material.
Agrupe em no máximo 3 perguntas por vez.

Dados mínimos necessários:
  • Nome da obra (ex: "Loja Barigui" ou "Apt 42 Vila Madalena")
  • Nome/apelido do cliente
  • Tipo de obra: reforma | construção | acabamento | instalação
  • Endereço (pode ficar como [PREENCHER] — não é bloqueador)

NÃO pergunte nesta etapa:
  - Datas (perguntadas só após orçamento aprovado)
  - Valores de contrato (calculados a partir do orçamento)
  - Equipes (definidas após fechamento — ignorar por enquanto)

════════════════════════════════════════════
ETAPA 3 — LEVANTAMENTO DE SERVIÇOS (núcleo do orçamento)
════════════════════════════════════════════

Com base no material recebido, gere lista estruturada de serviços.

PROATIVIDADE OBRIGATÓRIA por tipo de obra:
  • Loja/restaurante em shopping:
    → Sugerir: exaustão/ventilação, PPCI/incêndio, adequação elétrica ANEEL, iluminação especial
  • Apartamento residencial:
    → Sugerir: impermeabilização de banheiros, gesso/forro, esquadrias, limpeza final
  • Escritório comercial:
    → Sugerir: cabeamento estruturado, ar-condicionado, drywall/divisórias, piso elevado

Para cada sugestão, pergunte: "Quer incluir [categoria] no escopo?"

Formato de cada linha do orçamento:
SRV-001 | CATEGORIA | Descrição do serviço | UNID | QTDE estimada | R$ unit ref. | R$ total | [DEFINIR]

Equipe: sempre [DEFINIR] nesta fase (definida após fechamento).

Categorias válidas (usar nome completo):
Preliminares, Demolições, Infraestrutura, Alvenaria, Impermeabilização,
Hidráulica, Elétrica, Ar-condicionado, Drywall / Forro, Revestimento,
Pintura, Cobertura, Serralheria, Marcenaria, Limpeza, Administração

Calcule:
  • Subtotal por categoria
  • Total geral de serviços

⚠️ CONFIRMAÇÃO OBRIGATÓRIA #1:
"Orçamento estimado: R$ [total].
Revise os itens e quantidades. Posso prosseguir ou quer ajustar alguma linha?"
Aguarde confirmação explícita antes de avançar.

════════════════════════════════════════════
ETAPA 4 — DADOS FINANCEIROS (SÓ APÓS orçamento aprovado)
════════════════════════════════════════════

Pergunte na ordem (UMA pergunta por mensagem):

1. "Com base no total estimado de R$ [valor], qual taxa de administração aplicamos?
    (faixa usual Berti: 15%–20%)"

2. "Tem data prevista de início?" (resposta pode ser [PREENCHER])

3. "Qual a forma de pagamento prevista?" (PIX | transferência | boleto)

NÃO perguntar:
  - Valor do contrato (ele vem do orçamento + taxa de administração)
  - Prazo em dias (calculado a partir das datas, se fornecidas)

Calcule:
  • Taxa de administração em R$ = total × (taxa_adm / 100)
  • TOTAL FINAL = total serviços + taxa de administração

════════════════════════════════════════════
ETAPA 5 — JSON FINAL
════════════════════════════════════════════

Gere escopo resumido (3-5 linhas, linguagem comercial, SEM jargões técnicos).
Use Padrão Berti: profissional, direto, positivo. Texto corrido, sem bullet points.
Apresente e aguarde aprovação.

Após aprovação, gere OBRIGATORIAMENTE este JSON em bloco \`\`\`json:

\`\`\`json
{
  "nova_proposta": {
    "nome_obra": "string",
    "cliente_nome": "string ou null se [PREENCHER]",
    "endereco": "string ou null se [PREENCHER]",
    "descricao_escopo": "string (escopo resumido aprovado)",
    "prazo_estimado_dias": number ou null,
    "valor_custo_total": number,
    "margem_percentual": number,
    "valor_final": number,
    "status": "rascunho",
    "aprovado_gestor": false
  },
  "novos_itens": [
    {
      "codigo": "SRV-001",
      "categoria": "string",
      "descricao_interna": "string técnica com códigos permitidos",
      "descricao_cliente": "string SEM jargões — Padrão Berti",
      "unidade": "m² | m | un | vb",
      "quantidade": number,
      "valor_unitario_custo": number,
      "valor_unitario_final": number,
      "valor_total_custo": number,
      "valor_total_final": number,
      "observacao_ia": "string ou null"
    }
  ]
}
\`\`\`

REGRAS DO JSON (invioláveis):
  • Campos com [PREENCHER] no chat: usar null no JSON
  • valor_final = valor_custo_total × (1 + margem_percentual / 100)
  • Para cada item:
    - valor_total_custo = quantidade × valor_unitario_custo
    - valor_total_final = quantidade × valor_unitario_final
    - valor_unitario_final = valor_unitario_custo × (1 + margem / 100)
  • descricao_cliente: NUNCA conter SRV-*, EQ-* ou jargões técnicos
  • JSON deve ser 100% válido (parsear sem erro)

⚠️ CONFIRMAÇÃO OBRIGATÓRIA #2:
"✅ Proposta gerada! JSON com [N] serviços.
Use os botões abaixo para salvar como oportunidade.
Dados corretos?"`.trim();

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

const Estado = {
  // DOM
  chatMensagens: null,
  chatInput: null,
  btnEnviar: null,
  btnLoading: null,
  btnNovaConversa: null,
  painelAcoes: null,
  btnImportarProposta: null,
  btnImportarCockpit: null,
  btnBaixarJson: null,
  btnAnexarPdf: null,
  fileInputPdf: null,
  previewPdf: null,
  previewPdfNome: null,

  // Dados
  historico: [], // [{role: 'user'|'assistant', content: string}]
  jsonFinal: null, // Objeto parseado do JSON gerado pela IA
  pdfAnexado: null, // {nome, base64, media_type}
};

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

export async function init() {
  console.log('[DEKA][AGT_INTAKE] Inicializando módulo...');

  carregarElementosDOM();
  configurarEventListeners();
  iniciarConversa();

  console.log('[DEKA][AGT_INTAKE] ✅ Módulo inicializado.');
}

function carregarElementosDOM() {
  Estado.chatMensagens = document.getElementById('chat-mensagens');
  Estado.chatInput = document.getElementById('chat-input');
  Estado.btnEnviar = document.getElementById('btn-enviar');
  Estado.btnLoading = document.getElementById('btn-loading');
  Estado.btnNovaConversa = document.getElementById('btn-nova-conversa');
  Estado.painelAcoes = document.getElementById('painel-acoes');
  Estado.btnImportarProposta = document.getElementById('btn-importar-proposta');
  Estado.btnImportarCockpit = document.getElementById('btn-importar-cockpit');
  Estado.btnBaixarJson = document.getElementById('btn-baixar-json');
  Estado.btnAnexarPdf = document.getElementById('btn-anexar-pdf');
  Estado.fileInputPdf = document.getElementById('file-input-pdf');
  Estado.previewPdf = document.getElementById('preview-pdf');
  Estado.previewPdfNome = document.getElementById('preview-pdf-nome');
}

function configurarEventListeners() {
  Estado.btnEnviar.addEventListener('click', enviarMensagem);
  Estado.btnNovaConversa.addEventListener('click', novaConversa);
  Estado.btnImportarProposta.addEventListener('click', aoClicarCriarOportunidade);
  Estado.btnImportarCockpit.addEventListener('click', importarParaCockpit);
  Estado.btnBaixarJson.addEventListener('click', baixarJson);
  Estado.btnAnexarPdf.addEventListener('click', aoClicarAnexarPdf);
  Estado.fileInputPdf.addEventListener('change', aoSelecionarPdf);

  // Botão remover PDF
  const btnRemoverPdf = Estado.previewPdf.querySelector('.btn-remover-pdf');
  if (btnRemoverPdf) {
    btnRemoverPdf.addEventListener('click', removerPdf);
  }

  // Enter envia, Shift+Enter quebra linha
  Estado.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  });

  // Auto-resize do textarea
  Estado.chatInput.addEventListener('input', () => {
    Estado.chatInput.style.height = 'auto';
    Estado.chatInput.style.height = Estado.chatInput.scrollHeight + 'px';
  });
}

async function iniciarConversa() {
  try {
    // BUG FIX 1: adicionar mensagem inicial ao histórico ANTES de chamar chamarClaude
    Estado.historico.push({ role: 'user', content: 'Olá! Preciso montar um estudo de orçamento.' });

    const textoIA = await chamarClaude({
      mensagens: Estado.historico,
      sistemaPrompt: SYSTEM_PROMPT_INTAKE,
      modelo: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    });

    // BUG FIX 2: chamarClaude retorna string diretamente
    Estado.historico.push({ role: 'assistant', content: textoIA });
    renderizarMensagem('ia', textoIA);

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao iniciar conversa:', erro);
    showToast(erro.message || 'Erro ao iniciar conversa.', 'error');
  }
}

// =============================================================================
// PDF UPLOAD
// =============================================================================

function aoClicarAnexarPdf() {
  Estado.fileInputPdf.click();
}

async function aoSelecionarPdf(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // Validar tipo
    if (file.type !== 'application/pdf') {
      throw new Error('Apenas arquivos PDF são permitidos.');
    }

    // Validar tamanho
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`PDF muito grande. Máximo ${MAX_PDF_SIZE_MB}MB.`);
    }

    // Converter para base64
    const base64 = await converterParaBase64(file);

    Estado.pdfAnexado = {
      nome: file.name,
      base64: base64,
      media_type: 'application/pdf',
    };

    // Mostrar preview
    Estado.previewPdfNome.textContent = file.name;
    Estado.previewPdf.classList.add('ativo');

    showToast('PDF anexado com sucesso!', 'success');

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao anexar PDF:', erro);
    showToast(erro.message || 'Erro ao anexar PDF.', 'error');
  }

  // Reset input
  Estado.fileInputPdf.value = '';
}

function converterParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove o prefixo "data:application/pdf;base64,"
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removerPdf() {
  Estado.pdfAnexado = null;
  Estado.previewPdf.classList.remove('ativo');
  Estado.previewPdfNome.textContent = '';
  showToast('PDF removido.', 'info');
}

// =============================================================================
// ENVIO DE MENSAGENS
// =============================================================================

async function enviarMensagem() {
  const texto = Estado.chatInput.value.trim();

  if (!texto && !Estado.pdfAnexado) {
    showToast('Digite uma mensagem ou anexe um PDF.', 'warning');
    return;
  }

  // Adicionar mensagem do gestor ao histórico
  const mensagemUsuario = texto || '[PDF anexado]';
  Estado.historico.push({ role: 'user', content: mensagemUsuario });
  renderizarMensagem('gestor', mensagemUsuario);

  // Limpar input e desabilitar UI
  Estado.chatInput.value = '';
  Estado.chatInput.style.height = 'auto';
  Estado.btnEnviar.classList.add('oculto');
  Estado.btnLoading.classList.remove('oculto');
  Estado.chatInput.disabled = true;
  Estado.btnAnexarPdf.disabled = true;

  try {
    // Montar content (multimodal se tiver PDF)
    let content;

    if (Estado.pdfAnexado) {
      // Multimodal: PDF + texto
      content = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: Estado.pdfAnexado.media_type,
            data: Estado.pdfAnexado.base64,
          },
        },
        {
          type: 'text',
          text: texto || 'Analise o PDF anexado e extraia todas as informações relevantes para o orçamento.',
        },
      ];

      // Remover PDF após envio
      Estado.pdfAnexado = null;
      Estado.previewPdf.classList.remove('ativo');
    } else {
      // Apenas texto
      content = texto;
    }

    // Preparar última mensagem do histórico com content correto
    Estado.historico[Estado.historico.length - 1].content = content;

    const textoIA = await chamarClaude({
      mensagens: Estado.historico,
      sistemaPrompt: SYSTEM_PROMPT_INTAKE,
      modelo: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    });

    // BUG FIX 2: chamarClaude retorna string diretamente
    Estado.historico.push({ role: 'assistant', content: textoIA });
    renderizarMensagem('ia', textoIA);

    // Detectar JSON no texto
    detectarJSON(textoIA);

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao enviar mensagem:', erro);
    showToast(erro.message || 'Erro ao enviar mensagem.', 'error');
    renderizarMensagem('sistema', 'Erro: ' + (erro.message || 'Falha na comunicação com a IA'));
  } finally {
    // Reabilitar UI
    Estado.btnLoading.classList.add('oculto');
    Estado.btnEnviar.classList.remove('oculto');
    Estado.chatInput.disabled = false;
    Estado.btnAnexarPdf.disabled = false;
    Estado.chatInput.focus();
  }
}

// =============================================================================
// RENDERIZAÇÃO DE MENSAGENS
// =============================================================================

function renderizarMensagem(tipo, texto) {
  // Remover empty state se existir
  const emptyState = Estado.chatMensagens.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const mensagem = document.createElement('div');
  mensagem.className = `mensagem mensagem-${tipo}`;

  if (tipo === 'sistema') {
    mensagem.innerHTML = `
      <div class="mensagem-conteudo">${texto}</div>
    `;
  } else {
    const avatar = tipo === 'gestor' ? '👤' : '🤖';
    const conteudoHTML = formatarConteudo(texto);

    mensagem.innerHTML = `
      <div class="mensagem-avatar">${avatar}</div>
      <div class="mensagem-conteudo">${conteudoHTML}</div>
    `;
  }

  Estado.chatMensagens.appendChild(mensagem);

  // Scroll para o fim
  setTimeout(() => {
    Estado.chatMensagens.scrollTop = Estado.chatMensagens.scrollHeight;
  }, 100);
}

function formatarConteudo(texto) {
  // Detectar blocos de código ```json
  const regexCode = /```(\w+)?\n([\s\S]*?)```/g;

  let html = texto;

  // Substituir blocos de código por <pre><code>
  html = html.replace(regexCode, (match, lang, code) => {
    return `<pre><code>${escapeHTML(code.trim())}</code></pre>`;
  });

  return html;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =============================================================================
// DETECÇÃO E PARSING DE JSON
// =============================================================================

function detectarJSON(texto) {
  const regexJSON = /```json\n([\s\S]*?)```/;
  const match = texto.match(regexJSON);

  if (!match) return;

  try {
    const jsonString = match[1].trim();
    const dados = JSON.parse(jsonString);

    // Validar estrutura obrigatória
    if (!dados.nova_proposta || !Array.isArray(dados.novos_itens)) {
      throw new Error('JSON inválido: falta nova_proposta ou novos_itens');
    }

    Estado.jsonFinal = dados;
    Estado.painelAcoes.classList.remove('oculto');

    console.log('[DEKA][AGT_INTAKE] JSON detectado e validado:', dados);
    showToast('Proposta gerada! Use os botões abaixo.', 'success');

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao parsear JSON:', erro);
    renderizarMensagem('sistema', `Erro ao processar JSON: ${erro.message}`);
  }
}

// =============================================================================
// SALVAR COMO OPORTUNIDADE
// =============================================================================

async function aoClicarCriarOportunidade() {
  if (!Estado.jsonFinal) {
    showToast('Nenhuma proposta disponível.', 'warning');
    return;
  }

  try {
    Estado.btnImportarProposta.disabled = true;
    showToast('Salvando oportunidade...', 'info');

    const { nova_proposta, novos_itens } = Estado.jsonFinal;

    // 1. INSERT em propostas
    const { data: proposta, error: erroProposta } = await supabase
      .from('propostas')
      .insert({
        lead_id: null,
        nome_obra: nova_proposta.nome_obra,
        cliente_nome: nova_proposta.cliente_nome,
        cliente_telefone: null,
        endereco: nova_proposta.endereco,
        descricao_escopo: nova_proposta.descricao_escopo,
        prazo_estimado_dias: nova_proposta.prazo_estimado_dias,
        valor_custo_total: nova_proposta.valor_custo_total,
        margem_percentual: nova_proposta.margem_percentual,
        valor_final: nova_proposta.valor_final,
        status: 'rascunho',
        transcricao_raw: JSON.stringify(Estado.historico, null, 2),
        payload_ia: Estado.jsonFinal,
        aprovado_gestor: false,
      })
      .select('id')
      .single();

    if (erroProposta) {
      console.error('[DEKA][AGT_INTAKE] Erro ao inserir proposta:', erroProposta);
      throw new Error('Erro ao salvar proposta: ' + erroProposta.message);
    }

    const propostaId = proposta.id;
    console.log('[DEKA][AGT_INTAKE] Proposta salva com ID:', propostaId);

    // 2. INSERT em itens_proposta
    if (novos_itens.length > 0) {
      const itensParaInserir = novos_itens.map((item, index) => ({
        proposta_id: propostaId,
        servico_id: null,
        codigo_servico: item.codigo,
        categoria: item.categoria,
        descricao_interna: item.descricao_interna,
        descricao_cliente: item.descricao_cliente,
        unidade: item.unidade,
        quantidade: item.quantidade,
        valor_unitario_custo: item.valor_unitario_custo,
        valor_unitario_final: item.valor_unitario_final,
        valor_total_custo: item.valor_total_custo,
        valor_total_final: item.valor_total_final,
        observacao_ia: item.observacao_ia,
        ordem: index + 1,
      }));

      const { error: erroItens } = await supabase
        .from('itens_proposta')
        .insert(itensParaInserir);

      if (erroItens) {
        console.error('[DEKA][AGT_INTAKE] Erro ao inserir itens:', erroItens);
        throw new Error('Erro ao salvar itens: ' + erroItens.message);
      }

      console.log('[DEKA][AGT_INTAKE] Itens salvos:', itensParaInserir.length);
    }

    showToast(`Oportunidade salva! ${novos_itens.length} serviços cadastrados.`, 'success');

    // Redirecionar para oportunidades.html após 2s
    setTimeout(() => {
      window.location.href = 'oportunidades.html';
    }, 2000);

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao criar oportunidade:', erro);
    showToast(erro.message || 'Erro ao salvar oportunidade.', 'error');
    Estado.btnImportarProposta.disabled = false;
  }
}

// =============================================================================
// ABRIR COMO OBRA ATIVA (após fechamento)
// =============================================================================

async function importarParaCockpit() {
  if (!Estado.jsonFinal) {
    showToast('Nenhuma proposta disponível.', 'warning');
    return;
  }

  if (!confirm('Abrir esta proposta como obra ativa? Use esta opção APÓS fechamento comercial.')) {
    return;
  }

  try {
    Estado.btnImportarCockpit.disabled = true;
    showToast('Criando obra...', 'info');

    const { nova_proposta, novos_itens } = Estado.jsonFinal;

    // 1. INSERT em obras
    const { data: obra, error: erroObra } = await supabase
      .from('obras')
      .insert({
        nome: nova_proposta.nome_obra,
        cliente: nova_proposta.cliente_nome || 'Cliente',
        endereco: nova_proposta.endereco || 'A definir',
        data_inicio: new Date().toISOString().split('T')[0],
        data_previsao_fim: null,
        status: 'ativa',
        percentual_global: 0,
      })
      .select('id')
      .single();

    if (erroObra) {
      console.error('[DEKA][AGT_INTAKE] Erro ao inserir obra:', erroObra);
      throw new Error('Erro ao criar obra: ' + erroObra.message);
    }

    const obraId = obra.id;
    console.log('[DEKA][AGT_INTAKE] Obra criada com ID:', obraId);

    // 2. INSERT em obra_servicos
    if (novos_itens.length > 0) {
      const servicosParaInserir = novos_itens.map(item => ({
        obra_id: obraId,
        codigo: item.codigo,
        descricao_interna: item.descricao_interna,
        descricao_cliente: item.descricao_cliente,
        equipe_codigo: '[DEFINIR]',
        percentual_concluido: 0,
        valor_contratado: item.valor_total_final,
      }));

      const { error: erroServicos } = await supabase
        .from('obra_servicos')
        .insert(servicosParaInserir);

      if (erroServicos) {
        console.error('[DEKA][AGT_INTAKE] Erro ao inserir serviços:', erroServicos);
        throw new Error('Erro ao criar serviços: ' + erroServicos.message);
      }

      console.log('[DEKA][AGT_INTAKE] Serviços criados:', servicosParaInserir.length);
    }

    showToast('Obra criada com sucesso! Redirecionando...', 'success');

    setTimeout(() => {
      window.location.href = 'hub.html';
    }, 2000);

  } catch (erro) {
    console.error('[DEKA][AGT_INTAKE] Erro ao criar obra:', erro);
    showToast(erro.message || 'Erro ao criar obra.', 'error');
    Estado.btnImportarCockpit.disabled = false;
  }
}

// =============================================================================
// DOWNLOAD DO JSON
// =============================================================================

function baixarJson() {
  if (!Estado.jsonFinal) {
    showToast('Nenhuma proposta disponível.', 'warning');
    return;
  }

  const jsonString = JSON.stringify(Estado.jsonFinal, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `proposta-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
  showToast('JSON baixado!', 'success');
}

// =============================================================================
// NOVA CONVERSA
// =============================================================================

function novaConversa() {
  if (!confirm('Iniciar nova conversa? O histórico atual será perdido.')) {
    return;
  }

  // Resetar estado
  Estado.historico = [];
  Estado.jsonFinal = null;
  Estado.pdfAnexado = null;
  Estado.chatMensagens.innerHTML = '';
  Estado.painelAcoes.classList.add('oculto');
  Estado.previewPdf.classList.remove('ativo');

  // Reiniciar
  iniciarConversa();
}

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================

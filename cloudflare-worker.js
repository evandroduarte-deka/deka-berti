/**
 * DEKA OS v2.0 — Cloudflare Worker (Proxy de Segurança)
 * -------------------------------------------------------
 * Endpoint: https://anthropic-proxy.berti-b52.workers.dev
 *
 * ROTAS SUPORTADAS:
 *   POST /v1/messages              → Anthropic Claude (todos os agentes)
 *   POST /v1/audio/transcriptions  → OpenAI Whisper (Cockpit)
 *   POST /v1/orcamento             → AGT_ORCAMENTO (geração de propostas comerciais)
 *   OPTIONS *                      → CORS preflight
 *   GET /health                    → Health check (sem autenticação)
 *
 * VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS (Cloudflare Dashboard → Settings → Variables):
 *   DEKA_SECRET_TOKEN   Segredo compartilhado com o frontend (X-Deka-Token)
 *   ANTHROPIC_API_KEY   Chave da Anthropic (nunca exposta ao frontend)
 *   OPENAI_API_KEY      Chave da OpenAI / Whisper (nunca exposta ao frontend)
 *   ALLOWED_ORIGIN      Origem permitida (ex: https://berti-construtora.github.io)
 *   DEKA_KILL_SWITCH    "off" = sistema ativo, "on" = sistema desligado (default: não definida = ativo)
 *
 * REGRAS DEKA OS (TOLERÂNCIA ZERO):
 *   - Nenhum catch silencioso. Todo erro retorna JSON estruturado.
 *   - Nenhuma chave hardcoded. Tudo via env.
 *   - Token validado via comparação timing-safe em TODA rota (exceto /health).
 */

// =============================================================================
// CONSTANTES
// =============================================================================

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const OPENAI_BASE_URL    = 'https://api.openai.com';
const ANTHROPIC_VERSION  = '2023-06-01';

/** Rotas que NÃO exigem autenticação X-Deka-Token */
const PUBLIC_ROUTES = new Set(['/health']);

/** Tamanho máximo do body de áudio: 25 MB (limite do Whisper) */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// =============================================================================
// ENTRY POINT — ES Modules (obrigatório para Cloudflare Workers)
// =============================================================================

export default {
  /**
   * Ponto de entrada único do Worker.
   * Toda requisição passa por aqui antes de qualquer lógica.
   *
   * @param {Request}         request  Requisição recebida
   * @param {Object}          env      Variáveis de ambiente do Cloudflare
   * @param {ExecutionContext} ctx      Contexto de execução (waitUntil, etc.)
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rota = url.pathname;

    // ── CORS Preflight (OPTIONS) ──────────────────────────────────────────────
    // Deve ser tratado ANTES da validação de token para que o browser
    // consiga completar o handshake mesmo sem o header Authorization.
    if (request.method === 'OPTIONS') {
      return responderCORS(env);
    }

    // ── Health Check (rota pública) ───────────────────────────────────────────
    if (rota === '/health') {
      return responderJSON({ status: 'ok', timestamp: new Date().toISOString() }, 200, env);
    }

    // ── Validação de Token (todas as rotas privadas) ──────────────────────────
    const erroToken = await validarToken(request, env);
    if (erroToken) return erroToken;

    // ── Kill Switch (desligar sistema sem desativar o Worker) ──────────────
    if (env.DEKA_KILL_SWITCH === 'on') {
      console.error('[DEKA][KillSwitch] Sistema desligado via DEKA_KILL_SWITCH.');
      return responderErro(
        503,
        'SISTEMA_DESLIGADO',
        'O DEKA OS está temporariamente desligado pelo gestor. Tente novamente mais tarde.',
        null,
        env
      );
    }

    // ── Rate Limiting básico (por IP, em memória do isolate) ────────────
    // Nota: Rate limit por isolate do Workers. Em uso real com volume alto,
    // migrar para Cloudflare Rate Limiting API ou KV.
    const RATE_LIMIT_MAX = 60;
    const RATE_LIMIT_WINDOW_MS = 3_600_000; // 1 hora

    if (!globalThis._rateLimitMap) {
      globalThis._rateLimitMap = new Map();
    }

    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const agora = Date.now();
    const registro = globalThis._rateLimitMap.get(clientIP) || {
      count: 0,
      resetAt: agora + RATE_LIMIT_WINDOW_MS,
    };

    if (agora > registro.resetAt) {
      registro.count = 0;
      registro.resetAt = agora + RATE_LIMIT_WINDOW_MS;
    }

    registro.count++;
    globalThis._rateLimitMap.set(clientIP, registro);

    if (registro.count > RATE_LIMIT_MAX) {
      console.error(`[DEKA][RateLimit] IP ${clientIP} excedeu ${RATE_LIMIT_MAX} chamadas/hora.`);
      return responderErro(
        429,
        'RATE_LIMIT_EXCEDIDO',
        `Limite de ${RATE_LIMIT_MAX} chamadas por hora excedido. Aguarde.`,
        { reset_em: new Date(registro.resetAt).toISOString() },
        env
      );
    }

    // ── Roteamento ────────────────────────────────────────────────────────────
    try {
      if (rota === '/v1/messages') {
        return await rotaAnthropic(request, env);
      }

      if (rota === '/v1/audio/transcriptions') {
        return await rotaWhisper(request, env);
      }

      if (rota === '/v1/orcamento') {
        return await rotaOrcamento(request, env);
      }

      // Rota desconhecida
      return responderErro(
        404,
        'ROTA_NAO_ENCONTRADA',
        `A rota "${rota}" não existe neste proxy.`,
        { rotas_validas: ['/v1/messages', '/v1/audio/transcriptions', '/v1/orcamento', '/health'] },
        env
      );

    } catch (erro) {
      // Erro não capturado no handler de rota — última linha de defesa
      console.error('[DEKA][Worker] Erro não capturado no roteador:', erro);
      return responderErro(
        500,
        'ERRO_INTERNO_WORKER',
        'Erro inesperado no proxy. Verifique os logs do Worker.',
        { mensagem: erro.message, stack: erro.stack },
        env
      );
    }
  },
};

// =============================================================================
// VALIDAÇÃO DE SEGURANÇA
// =============================================================================

/**
 * Valida o header X-Deka-Token usando comparação timing-safe.
 * Retorna null se o token for válido, ou uma Response de erro caso contrário.
 *
 * Comparação timing-safe previne ataques de temporização onde um atacante
 * descobre o token correto medindo o tempo de resposta do servidor.
 *
 * @param {Request} request
 * @param {Object}  env
 * @returns {Promise<Response|null>}
 */
async function validarToken(request, env) {
  const tokenRecebido = request.headers.get('X-Deka-Token');

  // ── Token ausente ─────────────────────────────────────────────────────────
  if (!tokenRecebido) {
    console.error('[DEKA][Auth] Requisição sem X-Deka-Token bloqueada.');
    return responderErro(
      401,
      'TOKEN_AUSENTE',
      'Header X-Deka-Token é obrigatório.',
      null,
      env
    );
  }

  // ── Variável de ambiente ausente (misconfiguration) ───────────────────────
  console.error('[DEKA][Debug] env keys:', Object.keys(env));
  if (!env.DEKA_SECRET_TOKEN) {
    console.error('[DEKA][Auth] DEKA_SECRET_TOKEN não configurado no Worker.');
    return responderErro(
      500,
      'CONFIG_AUSENTE',
      'CONFIG_AUSENTE: DEKA_SECRET_TOKEN',
      null,
      env
    );
  }

  // ── Comparação timing-safe via Web Crypto API ─────────────────────────────
  const encoder = new TextEncoder();
  const bufferRecebido = encoder.encode(tokenRecebido);
  const bufferEsperado = encoder.encode(env.DEKA_SECRET_TOKEN);

  // Tokens de tamanhos diferentes falham antes da comparação bit-a-bit.
  // Comparamos os tamanhos DEPOIS de já ter encodado para não vazar info de timing.
  let tokensIguais = false;
  if (bufferRecebido.length === bufferEsperado.length) {
    tokensIguais = await crypto.subtle.timingSafeEqual(bufferRecebido, bufferEsperado);
  }

  if (!tokensIguais) {
    console.error('[DEKA][Auth] Token inválido recebido. Acesso negado.');
    return responderErro(
      401,
      'TOKEN_INVALIDO',
      'X-Deka-Token inválido. Acesso negado.',
      null,
      env
    );
  }

  return null; // Token válido ✅
}

// =============================================================================
// ROTA: /v1/messages → ANTHROPIC CLAUDE
// =============================================================================

/**
 * Faz proxy da requisição para a API da Anthropic.
 * Repassa o body JSON e o streaming response sem buffer.
 *
 * Headers adicionados pelo Worker (nunca vindos do frontend):
 *   x-api-key          → env.ANTHROPIC_API_KEY
 *   anthropic-version  → ANTHROPIC_VERSION
 *
 * @param {Request} request  Requisição original do frontend
 * @param {Object}  env      Variáveis de ambiente
 * @returns {Promise<Response>}
 */
async function rotaAnthropic(request, env) {
  if (request.method !== 'POST') {
    return responderErro(405, 'METODO_INVALIDO', 'Use POST para /v1/messages.', null, env);
  }

  console.error('[DEKA][Debug] env keys:', Object.keys(env));
  if (!env.ANTHROPIC_API_KEY) {
    console.error('[DEKA][Anthropic] ANTHROPIC_API_KEY não configurada.');
    return responderErro(500, 'CONFIG_AUSENTE', 'CONFIG_AUSENTE: ANTHROPIC_API_KEY', null, env);
  }

  // Valida que o body é JSON antes de repassar
  let bodyTexto;
  try {
    bodyTexto = await request.text();
    JSON.parse(bodyTexto); // apenas valida o parse, não usa o resultado aqui
  } catch (erro) {
    console.error('[DEKA][Anthropic] Body da requisição não é JSON válido:', erro);
    return responderErro(
      400,
      'BODY_INVALIDO',
      'O body da requisição deve ser JSON válido.',
      { mensagem: erro.message },
      env
    );
  }

  // Monta a requisição para a Anthropic
  const requisicaoAnthropic = new Request(
    `${ANTHROPIC_BASE_URL}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: bodyTexto,
    }
  );

  // Faz a chamada e captura erros de rede
  let respostaAnthropic;
  try {
    respostaAnthropic = await fetch(requisicaoAnthropic);
  } catch (erro) {
    console.error('[DEKA][Anthropic] Falha de rede ao chamar a API da Anthropic:', erro);
    return responderErro(
      502,
      'FALHA_UPSTREAM_ANTHROPIC',
      'Não foi possível conectar à API da Anthropic.',
      { mensagem: erro.message },
      env
    );
  }

  // Se a Anthropic retornou erro, repassa o status e o body para o frontend
  if (!respostaAnthropic.ok) {
    const corpoErro = await respostaAnthropic.text();
    console.error(
      `[DEKA][Anthropic] API retornou erro HTTP ${respostaAnthropic.status}:`,
      corpoErro
    );
    return responderErro(
      respostaAnthropic.status,
      'ERRO_ANTHROPIC',
      `A API da Anthropic retornou erro ${respostaAnthropic.status}.`,
      { resposta_anthropic: corpoErro },
      env
    );
  }

  // Log de métricas de tokens (para rastreamento de custo)
  try {
    if (respostaAnthropic.ok) {
      const bodyParaLog = await respostaAnthropic.clone().json();
      const usage = bodyParaLog?.usage;
      if (usage) {
        console.log(
          `[DEKA][Worker][Metrics] model=${bodyParaLog.model || 'unknown'} ` +
          `in=${usage.input_tokens} out=${usage.output_tokens} ` +
          `cache_read=${usage.cache_read_input_tokens || 0}`
        );
      }
    }
  } catch (_) {
    // Log de métricas não deve impedir a resposta — ignorar erro silenciosamente
    // (esta é a ÚNICA exceção à regra de zero catch silencioso — é log auxiliar)
  }

  // Repassa a resposta (incluindo streams) diretamente, adicionando CORS headers
  return new Response(respostaAnthropic.body, {
    status:  respostaAnthropic.status,
    headers: {
      ...headersResposta(respostaAnthropic.headers.get('Content-Type') || 'application/json', env),
      // Repassa headers de streaming da Anthropic, se presentes
      ...(respostaAnthropic.headers.get('Transfer-Encoding')
        ? { 'Transfer-Encoding': respostaAnthropic.headers.get('Transfer-Encoding') }
        : {}),
    },
  });
}

// =============================================================================
// ROTA: /v1/audio/transcriptions → OPENAI WHISPER
// =============================================================================

/**
 * Faz proxy da requisição de áudio para o OpenAI Whisper.
 *
 * Requisitos da rota:
 *   - Método: POST
 *   - Content-Type: multipart/form-data (enviado pelo frontend com o Blob de áudio)
 *   - Tamanho máximo: 25 MB (MAX_AUDIO_BYTES)
 *
 * O Worker NÃO modifica o body multipart. Ele apenas:
 *   1. Valida o tamanho via Content-Length header
 *   2. Injeta a chave da OpenAI
 *   3. Faz o passthrough do FormData
 *
 * @param {Request} request
 * @param {Object}  env
 * @returns {Promise<Response>}
 */
async function rotaWhisper(request, env) {
  if (request.method !== 'POST') {
    return responderErro(405, 'METODO_INVALIDO', 'Use POST para /v1/audio/transcriptions.', null, env);
  }

  console.error('[DEKA][Debug] env keys:', Object.keys(env));
  if (!env.OPENAI_API_KEY) {
    console.error('[DEKA][Whisper] OPENAI_API_KEY não configurada.');
    return responderErro(500, 'CONFIG_AUSENTE', 'CONFIG_AUSENTE: OPENAI_API_KEY', null, env);
  }

  // ── Validação de tamanho (Content-Length header) ──────────────────────────
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_AUDIO_BYTES) {
    console.error(
      `[DEKA][Whisper] Áudio muito grande: ${contentLength} bytes (máx: ${MAX_AUDIO_BYTES}).`
    );
    return responderErro(
      413,
      'AUDIO_MUITO_GRANDE',
      `O arquivo de áudio excede o limite de ${MAX_AUDIO_BYTES / (1024 * 1024)} MB.`,
      { tamanho_recebido_bytes: contentLength, limite_bytes: MAX_AUDIO_BYTES },
      env
    );
  }

  // ── Validação de Content-Type ──────────────────────────────────────────────
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return responderErro(
      400,
      'CONTENT_TYPE_INVALIDO',
      'O Content-Type deve ser multipart/form-data para envio de áudio.',
      { content_type_recebido: contentType },
      env
    );
  }

  // ── Lê o FormData e adiciona o campo obrigatório "model" se ausente ────────
  // O frontend envia o Blob + o campo "model". Aqui apenas fazemos passthrough.
  let formData;
  try {
    formData = await request.formData();
  } catch (erro) {
    console.error('[DEKA][Whisper] Falha ao ler o FormData do áudio:', erro);
    return responderErro(
      400,
      'FORMDATA_INVALIDO',
      'Não foi possível ler o arquivo de áudio enviado.',
      { mensagem: erro.message },
      env
    );
  }

  // Garante que o campo "model" está presente (Whisper exige)
  if (!formData.get('model')) {
    formData.set('model', 'whisper-1');
  }

  // Garante que o campo "language" está definido para português
  if (!formData.get('language')) {
    formData.set('language', 'pt');
  }

  // ── Monta e envia a requisição para a OpenAI ───────────────────────────────
  const requisicaoOpenAI = new Request(
    `${OPENAI_BASE_URL}/v1/audio/transcriptions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        // NÃO definir Content-Type aqui: o fetch monta o boundary do multipart automaticamente
      },
      body: formData,
    }
  );

  let respostaOpenAI;
  try {
    respostaOpenAI = await fetch(requisicaoOpenAI);
  } catch (erro) {
    console.error('[DEKA][Whisper] Falha de rede ao chamar a API da OpenAI:', erro);
    return responderErro(
      502,
      'FALHA_UPSTREAM_OPENAI',
      'Não foi possível conectar à API da OpenAI (Whisper).',
      { mensagem: erro.message },
      env
    );
  }

  // Repassa erros da OpenAI de forma estruturada
  if (!respostaOpenAI.ok) {
    const corpoErro = await respostaOpenAI.text();
    console.error(
      `[DEKA][Whisper] API retornou erro HTTP ${respostaOpenAI.status}:`,
      corpoErro
    );
    return responderErro(
      respostaOpenAI.status,
      'ERRO_OPENAI_WHISPER',
      `A API do Whisper retornou erro ${respostaOpenAI.status}.`,
      { resposta_openai: corpoErro },
      env
    );
  }

  // Repassa a resposta (transcrição em JSON) com headers CORS
  const transcricao = await respostaOpenAI.json();
  return responderJSON(transcricao, 200, env);
}

// =============================================================================
// ROTA: /v1/orcamento → AGT_ORCAMENTO (Geração de Propostas Comerciais)
// =============================================================================

/**
 * Gera propostas comerciais usando Claude Sonnet 4 com contexto multimodal.
 *
 * Payload esperado:
 *   - briefing_texto: string (obrigatório, mínimo 10 caracteres)
 *   - catalogo: array de serviços da base_servicos (obrigatório)
 *   - margem_percentual: number (default 30)
 *   - imagens: array de {media_type, data} em base64 (opcional, máximo 10)
 *   - links: array de URLs (opcional, máximo 5)
 *
 * Retorna:
 *   {
 *     proposta: object,
 *     payload_ia: object (JSON original da IA),
 *     tokens_usados: { input, output, total }
 *   }
 *
 * @param {Request} request
 * @param {Object}  env
 * @returns {Promise<Response>}
 */
async function rotaOrcamento(request, env) {
  if (request.method !== 'POST') {
    return responderErro(405, 'METODO_INVALIDO', 'Use POST para /v1/orcamento.', null, env);
  }

  if (!env.ANTHROPIC_API_KEY) {
    console.error('[DEKA][Orcamento] ANTHROPIC_API_KEY não configurada.');
    return responderErro(500, 'CONFIG_AUSENTE', 'CONFIG_AUSENTE: ANTHROPIC_API_KEY', null, env);
  }

  // ── Validação do payload ──────────────────────────────────────────────────
  let payload;
  try {
    payload = await request.json();
  } catch (erro) {
    console.error('[DEKA][Orcamento] Body da requisição não é JSON válido:', erro);
    return responderErro(
      400,
      'BODY_INVALIDO',
      'O body da requisição deve ser JSON válido.',
      { mensagem: erro.message },
      env
    );
  }

  // Validações obrigatórias
  if (!payload.briefing_texto || typeof payload.briefing_texto !== 'string' || payload.briefing_texto.length < 10) {
    return responderErro(
      400,
      'BRIEFING_INVALIDO',
      'O campo briefing_texto é obrigatório e deve ter no mínimo 10 caracteres.',
      null,
      env
    );
  }

  if (!Array.isArray(payload.catalogo) || payload.catalogo.length === 0) {
    return responderErro(
      400,
      'CATALOGO_INVALIDO',
      'O campo catalogo é obrigatório e deve ser um array não vazio.',
      null,
      env
    );
  }

  const margemPercentual = payload.margem_percentual ?? 30;
  const imagens = Array.isArray(payload.imagens) ? payload.imagens.slice(0, 10) : [];
  const links = Array.isArray(payload.links) ? payload.links.slice(0, 5) : [];

  // ── Buscar conteúdo dos links (com timeout 8s, falha silenciosa) ──────────
  const conteudosLinks = [];

  if (links.length > 0) {
    const promessasLinks = links.map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const resposta = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'DEKA-OS-Bot/2.0' }
        });

        clearTimeout(timeoutId);

        if (!resposta.ok) {
          console.error(`[DEKA][Orcamento] Link ${url} retornou HTTP ${resposta.status}`);
          return null;
        }

        const texto = await resposta.text();
        return { url, conteudo: texto.slice(0, 5000) }; // Limita a 5000 chars por link

      } catch (erro) {
        // Falha silenciosa conforme especificação
        console.error(`[DEKA][Orcamento] Falha ao buscar link ${url}:`, erro.message);
        return null;
      }
    });

    const resultados = await Promise.all(promessasLinks);
    conteudosLinks.push(...resultados.filter(r => r !== null));
  }

  // ── Montar mensagem multimodal ────────────────────────────────────────────
  const blocosMensagem = [];

  // Texto principal do briefing
  let textoBriefing = `BRIEFING DO CLIENTE:\n${payload.briefing_texto}\n\n`;

  textoBriefing += `MARGEM DE LUCRO: ${margemPercentual}%\n\n`;

  textoBriefing += `CATÁLOGO DE SERVIÇOS DISPONÍVEIS:\n`;
  textoBriefing += JSON.stringify(payload.catalogo, null, 2);

  if (conteudosLinks.length > 0) {
    textoBriefing += '\n\nCONTEÚDO DOS LINKS FORNECIDOS:\n';
    conteudosLinks.forEach(({ url, conteudo }) => {
      textoBriefing += `\n--- ${url} ---\n${conteudo}\n`;
    });
  }

  blocosMensagem.push({ type: 'text', text: textoBriefing });

  // Adicionar imagens (formato Anthropic: base64)
  if (imagens.length > 0) {
    imagens.forEach((img) => {
      if (img.media_type && img.data) {
        blocosMensagem.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.media_type,
            data: img.data,
          },
        });
      }
    });
  }

  // ── System Prompt do AGT_ORCAMENTO ────────────────────────────────────────
  const systemPrompt = `Você é o AGT_ORCAMENTO da Berti Construtora.

Sua tarefa: gerar uma proposta comercial detalhada em JSON válido a partir do briefing do cliente.

REGRAS ABSOLUTAS:

1. RETORNE APENAS JSON VÁLIDO
   - Zero texto antes ou depois do JSON
   - Nenhum markdown, nenhum comentário
   - O JSON deve ser parseável diretamente

2. USE SOMENTE SERVIÇOS DO CATÁLOGO FORNECIDO
   - Cada item da proposta DEVE corresponder a um servico_id do catálogo
   - NUNCA invente serviços que não estão no catálogo
   - Use o codigo_servico e categoria exatamente como fornecido

3. NUNCA EXIBA CÓDIGOS INTERNOS AO CLIENTE
   - O campo "descricao_cliente" NUNCA deve conter códigos como SRV-*, EQ-*, etc.
   - Use linguagem natural e acessível (ex: "Aplicação de massa corrida" em vez de "SRV-013")
   - O campo "descricao_interna" pode manter os códigos técnicos

4. CÁLCULOS FINANCEIROS
   - valor_total_custo = quantidade × valor_unitario_custo
   - valor_unitario_final = valor_unitario_custo × (1 + margem_percentual/100)
   - valor_total_final = quantidade × valor_unitario_final
   - valor_custo_total = soma de todos os valor_total_custo
   - valor_final = soma de todos os valor_total_final
   - Arredonde valores para 2 casas decimais

5. ORDENAÇÃO DOS ITENS
   - Ordene os itens pela sequência lógica de execução da obra
   - Exemplo: demolição → elétrica/hidráulica → alvenaria → revestimentos → pintura → acabamentos

6. ESTIMATIVA DE PRAZO
   - Baseie-se na complexidade e quantidade de serviços
   - Seja realista: obras pequenas 15-30 dias, médias 30-60 dias, grandes 60-120 dias

SCHEMA OBRIGATÓRIO DE RETORNO:

{
  "nome_obra": "string (nome descritivo da obra)",
  "cliente_nome": "string (extrair do briefing se mencionado, senão usar 'Cliente')",
  "endereco": "string (extrair do briefing se mencionado, senão usar 'A definir')",
  "descricao_escopo": "string (resumo executivo do que será feito, 2-3 frases)",
  "prazo_estimado_dias": number,
  "itens": [
    {
      "servico_id": "uuid do catálogo",
      "codigo_servico": "string (ex: SRV-013)",
      "categoria": "string do catálogo",
      "descricao_interna": "string do catálogo",
      "descricao_cliente": "string SEM códigos técnicos, linguagem acessível",
      "unidade": "string (m², m, un, etc.)",
      "quantidade": number,
      "valor_unitario_custo": number,
      "valor_unitario_final": number,
      "valor_total_custo": number,
      "valor_total_final": number,
      "observacao_ia": "string opcional com contexto ou premissas"
    }
  ],
  "valor_custo_total": number,
  "valor_final": number
}

LEMBRE-SE: Retorne APENAS o JSON. Nada mais.`;

  // ── Chamar Claude Sonnet 4 ────────────────────────────────────────────────
  const bodyAnthropic = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: blocosMensagem,
      },
    ],
  };

  const requisicaoAnthropic = new Request(
    `${ANTHROPIC_BASE_URL}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(bodyAnthropic),
    }
  );

  let respostaAnthropic;
  try {
    respostaAnthropic = await fetch(requisicaoAnthropic);
  } catch (erro) {
    console.error('[DEKA][Orcamento] Falha de rede ao chamar Claude:', erro);
    return responderErro(
      502,
      'FALHA_UPSTREAM_ANTHROPIC',
      'Não foi possível conectar à API da Anthropic.',
      { mensagem: erro.message },
      env
    );
  }

  if (!respostaAnthropic.ok) {
    const corpoErro = await respostaAnthropic.text();
    console.error(
      `[DEKA][Orcamento] Claude retornou erro HTTP ${respostaAnthropic.status}:`,
      corpoErro
    );
    return responderErro(
      respostaAnthropic.status,
      'ERRO_ANTHROPIC',
      `A API da Anthropic retornou erro ${respostaAnthropic.status}.`,
      { resposta_anthropic: corpoErro },
      env
    );
  }

  const respostaClaude = await respostaAnthropic.json();

  // ── Extrair e validar o JSON retornado pela IA ────────────────────────────
  if (!respostaClaude.content || respostaClaude.content.length === 0) {
    console.error('[DEKA][Orcamento] Claude não retornou conteúdo.');
    return responderErro(
      500,
      'RESPOSTA_VAZIA',
      'Claude não retornou conteúdo na resposta.',
      { resposta_claude: respostaClaude },
      env
    );
  }

  const textoResposta = respostaClaude.content[0].text || '';

  let payloadIA;
  try {
    payloadIA = JSON.parse(textoResposta);
  } catch (erro) {
    console.error('[DEKA][Orcamento] Claude não retornou JSON válido:', textoResposta);
    return responderErro(
      500,
      'JSON_INVALIDO_IA',
      'Claude não retornou JSON válido. Tente reformular o briefing.',
      { texto_retornado: textoResposta, mensagem_erro: erro.message },
      env
    );
  }

  // Validar que o JSON tem o campo "itens" não vazio
  if (!Array.isArray(payloadIA.itens) || payloadIA.itens.length === 0) {
    console.error('[DEKA][Orcamento] JSON retornado não tem campo "itens" válido:', payloadIA);
    return responderErro(
      500,
      'PAYLOAD_INVALIDO_IA',
      'Claude retornou uma proposta sem itens. Tente fornecer mais detalhes no briefing.',
      { payload_ia: payloadIA },
      env
    );
  }

  // ── Calcular tokens usados ────────────────────────────────────────────────
  const tokensUsados = {
    input: respostaClaude.usage?.input_tokens || 0,
    output: respostaClaude.usage?.output_tokens || 0,
    total: (respostaClaude.usage?.input_tokens || 0) + (respostaClaude.usage?.output_tokens || 0),
  };

  console.log(
    `[DEKA][Cost] AGT_ORCAMENTO: in=${tokensUsados.input} out=${tokensUsados.output} total=${tokensUsados.total}`
  );

  // ── Retornar proposta validada ────────────────────────────────────────────
  return responderJSON(
    {
      proposta: payloadIA,
      payload_ia: payloadIA,
      tokens_usados: tokensUsados,
    },
    200,
    env
  );
}

// =============================================================================
// UTILITÁRIOS DE RESPOSTA
// =============================================================================

/**
 * Monta os headers padrão de resposta com CORS.
 *
 * CORS:
 *   - Access-Control-Allow-Origin: env.ALLOWED_ORIGIN (ex: GitHub Pages)
 *     Se não configurado, bloqueia (segurança > conveniência).
 *   - Access-Control-Allow-Methods: POST, GET, OPTIONS
 *   - Access-Control-Allow-Headers: Content-Type, X-Deka-Token
 *
 * @param {string} contentType  Valor do header Content-Type da resposta
 * @param {Object} env          Variáveis de ambiente
 * @returns {Object}            Headers prontos para uso em new Response()
 */
function headersResposta(contentType, env) {
  const origemPermitida = env.ALLOWED_ORIGIN || '';

  if (!origemPermitida) {
    // Log de aviso — o Worker responderá, mas o browser bloqueará via CORS
    console.error(
      '[DEKA][CORS] ALLOWED_ORIGIN não configurado. ' +
      'O browser irá bloquear esta resposta. Configure a variável de ambiente.'
    );
  }

  return {
    'Content-Type':                    contentType,
    'Access-Control-Allow-Origin':     origemPermitida,
    'Access-Control-Allow-Methods':    'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers':    'Content-Type, X-Deka-Token',
    'Access-Control-Max-Age':          '86400',        // preflight cacheado por 24h
    'X-Content-Type-Options':          'nosniff',
    'X-Frame-Options':                 'DENY',
    'Referrer-Policy':                 'no-referrer',
  };
}

/**
 * Responde ao CORS preflight (OPTIONS).
 * Retorna 204 No Content com os headers CORS corretos.
 *
 * @param {Object} env
 * @returns {Response}
 */
function responderCORS(env) {
  return new Response(null, {
    status: 204,
    headers: headersResposta('text/plain', env),
  });
}

/**
 * Serializa um objeto para JSON e retorna uma Response com headers corretos.
 *
 * @param {Object} dados    Objeto a serializar
 * @param {number} status   Status HTTP (default: 200)
 * @param {Object} env      Variáveis de ambiente (para CORS)
 * @returns {Response}
 */
function responderJSON(dados, status = 200, env) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: headersResposta('application/json', env),
  });
}

/**
 * Constrói e retorna uma Response de erro estruturada.
 *
 * REGRA DEKA OS: NENHUM erro é silencioso.
 * Todo erro retorna JSON com a estrutura:
 * {
 *   "error":   true,
 *   "code":    "CODIGO_LEGIVEL",
 *   "message": "Mensagem clara para o frontend disparar showToast",
 *   "details": { ... } | null
 * }
 *
 * @param {number}      status   HTTP status code
 * @param {string}      code     Código de erro em SNAKE_CASE (para o frontend tratar)
 * @param {string}      message  Mensagem legível (pode ser exibida em showToast)
 * @param {Object|null} details  Dados adicionais de debug (null em produção se desejar)
 * @param {Object}      env      Variáveis de ambiente (para CORS)
 * @returns {Response}
 */
function responderErro(status, code, message, details, env) {
  const corpo = {
    error:   true,
    code,
    message,
    details: details ?? null,
  };

  return new Response(JSON.stringify(corpo), {
    status,
    headers: headersResposta('application/json', env),
  });
}

// =============================================================================
// FIM DO ARQUIVO
// Smoke Test do Worker (validar mentalmente antes de deploy):
//
//   [ ] Nenhuma chave hardcoded — todas via env.*
//   [ ] Token validado com timingSafeEqual em toda rota privada
//   [ ] Rota /health não exige token (health check do N8N)
//   [ ] OPTIONS retorna 204 com CORS headers corretos
//   [ ] Áudio limitado a 25 MB com erro 413 claro
//   [ ] Erros da Anthropic e OpenAI são repassados, não engolidos
//   [ ] Todo catch retorna JSON estruturado com console.error
//   [ ] Content-Type do Worker sempre application/json (exceto stream)
//   [ ] ALLOWED_ORIGIN loga warning se ausente (não quebra silenciosamente)
//   [ ] Arquivo completo entregue (não patch) — ✅
// =============================================================================

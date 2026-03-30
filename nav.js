/**
 * DEKA OS v2.0 — nav.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Navegação global do sistema. Importado por todos os módulos HTML.
 *
 * USO: Adicionar antes do </body> em cada HTML:
 *   <script type="module" src="./nav.js"></script>
 *
 * REGRAS DEKA OS:
 *   - Zero lógica de negócio
 *   - Componente puramente visual
 *   - Destaca página ativa automaticamente
 *   - Responsivo (desktop + mobile)
 *   - CSS inline (não depende de variáveis externas)
 */

// =============================================================================
// CONFIGURAÇÃO DOS MÓDULOS
// =============================================================================

const MODULOS = [
  { href: './hub.html', icone: '🏗️', label: 'Hub' },
  { href: './cockpit.html', icone: '🎤', label: 'Cockpit' },
  { href: './brain.html', icone: '🧠', label: 'Brain' },
  { href: './relatorios.html', icone: '📊', label: 'Relatórios' },
  { href: './orcamento.html', icone: '💰', label: 'Orçamentos IA' },
  { href: './comercial.html', icone: '💬', label: 'Comercial' },
];

// =============================================================================
// DETECTAR MÓDULO ATIVO
// =============================================================================

/**
 * Detecta qual módulo está ativo baseado no pathname.
 * Retorna o índice do módulo ou -1 se não encontrado.
 */
function detectarModuloAtivo() {
  const pathname = window.location.pathname;
  const filename = pathname.split('/').pop() || 'hub.html';

  const index = MODULOS.findIndex((mod) => mod.href.includes(filename));
  return index;
}

// =============================================================================
// RENDERIZAR NAVEGAÇÃO
// =============================================================================

/**
 * Injeta o HTML da navegação no body.
 * Chama automaticamente ao carregar o módulo.
 */
function renderizarNav() {
  const moduloAtivo = detectarModuloAtivo();

  // HTML da navegação (topbar fixa no topo)
  const navHTML = `
    <nav id="deka-nav" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: linear-gradient(135deg, #0f1117 0%, #161b27 100%);
      border-bottom: 1px solid rgba(226, 197, 92, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0 1rem;
      z-index: 9999;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    ">
      ${MODULOS.map((modulo, index) => {
        const isAtivo = index === moduloAtivo;
        return `
          <a href="${modulo.href}" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.5rem 1rem;
            text-decoration: none;
            color: ${isAtivo ? '#e2c55c' : '#8892a4'};
            background: ${isAtivo ? 'rgba(226, 197, 92, 0.12)' : 'transparent'};
            border-radius: 8px;
            transition: all 0.2s ease;
            font-size: 0.875rem;
            font-weight: ${isAtivo ? '600' : '500'};
            border: 1px solid ${isAtivo ? 'rgba(226, 197, 92, 0.3)' : 'transparent'};
            min-width: 80px;
          "
          onmouseover="this.style.background='rgba(226, 197, 92, 0.08)'; this.style.color='#f0d878';"
          onmouseout="this.style.background='${isAtivo ? 'rgba(226, 197, 92, 0.12)' : 'transparent'}'; this.style.color='${isAtivo ? '#e2c55c' : '#8892a4'}';">
            <span style="font-size: 1.5rem;">${modulo.icone}</span>
            <span>${modulo.label}</span>
          </a>
        `;
      }).join('')}
    </nav>

    <style>
      /* Adiciona padding-top ao body para compensar a nav fixa */
      body {
        padding-top: 70px !important;
      }

      /* Responsivo: mobile */
      @media (max-width: 640px) {
        #deka-nav {
          height: auto;
          flex-wrap: wrap;
          padding: 0.5rem;
          gap: 0.25rem;
        }

        #deka-nav a {
          min-width: 70px;
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
        }

        #deka-nav a span:first-child {
          font-size: 1.25rem;
        }

        body {
          padding-top: auto !important;
        }
      }
    </style>
  `;

  // Injeta no início do body
  document.body.insertAdjacentHTML('afterbegin', navHTML);

  console.log('[DEKA][Nav] Navegação global renderizada. Módulo ativo:', MODULOS[moduloAtivo]?.label || 'desconhecido');
}

// =============================================================================
// AUTO-EXECUÇÃO
// =============================================================================

// Aguarda o DOM estar pronto antes de injetar a navegação
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderizarNav);
} else {
  // DOM já está pronto (script carregado como defer ou após carregamento)
  renderizarNav();
}

// =============================================================================
// FIM DO ARQUIVO — nav.js
//
// Smoke Test:
//   [ ] Arquivo < 200 linhas?                           ✅ (~150 linhas)
//   [ ] Zero lógica de negócio?                         ✅
//   [ ] Destaca módulo ativo automaticamente?           ✅
//   [ ] Responsivo (desktop + mobile)?                  ✅
//   [ ] CSS inline (não depende de variáveis externas)? ✅
//   [ ] Injeta navegação no body?                       ✅
//   [ ] Console.log para debug?                         ✅
// =============================================================================

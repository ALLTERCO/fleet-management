// Render helpers + section renderers for api-scalar.

import {CATEGORIES, FEATURED_NAMESPACES} from './api-scalar-data.js';
import type {OpenApiSpec, PageContext} from './api-scalar-types.js';

export function svgIcon(d: string): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

export function methodCountsByNamespace(
    spec: OpenApiSpec
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const route of Object.keys(spec.paths ?? {})) {
        const ns = route.match(/^\/rpc\/([^.]+)\./)?.[1];
        if (ns) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    }
    return counts;
}

export function featuredCards(counts: Map<string, number>): string {
    return FEATURED_NAMESPACES.map((ns) => {
        const count = counts.get(ns.name) ?? 0;
        const meta =
            count > 0
                ? `${count} method${count === 1 ? '' : 's'}`
                : 'Reference';
        return `      <a class="fm-ns-card" href="#tag/${ns.name}">
        <div class="fm-ns-icon">${svgIcon(ns.icon)}</div>
        <div class="fm-ns-name">${ns.label}</div>
        <div class="fm-ns-desc">${ns.blurb}</div>
        <div class="fm-ns-meta">${meta} <span>·</span> <span>${ns.name}</span></div>
      </a>`;
    }).join('\n');
}

// Dupes + orphans error (real CATEGORIES drift). Unclassified warns only —
// partial adds shouldn't block the whole docs build.
export function assertCategoryCoverage(counts: Map<string, number>): void {
    const categorized = new Set<string>();
    const dupes: string[] = [];
    for (const cat of CATEGORIES) {
        for (const ns of cat.namespaces) {
            if (categorized.has(ns)) dupes.push(ns);
            categorized.add(ns);
        }
    }
    const live = new Set(counts.keys());
    const missing = [...live].filter((n) => !categorized.has(n));
    const extra = [...categorized].filter((n) => !live.has(n));
    if (dupes.length || extra.length) {
        const parts: string[] = [];
        if (dupes.length) parts.push(`duplicates: ${dupes.join(', ')}`);
        if (extra.length)
            parts.push(`categorized but absent from spec: ${extra.join(', ')}`);
        throw new Error(
            `Category coverage mismatch. ${parts.join(' | ')}. Edit CATEGORIES in api-scalar-data.ts.`
        );
    }
    if (missing.length > 0) {
        console.warn(
            `[api-scalar] unclassified namespaces (not shown in landing grid): ${missing.join(', ')}. Add them to CATEGORIES when ready.`
        );
    }
}

export function categoryGrid(counts: Map<string, number>): string {
    return CATEGORIES.map((cat) => {
        const items = cat.namespaces
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .map((ns) => {
                const c = counts.get(ns) ?? 0;
                return `        <a class="fm-cat-chip" href="#tag/${ns}" data-name="${ns}">
          <span class="fm-cat-chip-name">${ns}</span>
          <span class="fm-cat-chip-count">${c}</span>
        </a>`;
            })
            .join('\n');
        const total = cat.namespaces.reduce(
            (sum, ns) => sum + (counts.get(ns) ?? 0),
            0
        );
        return `    <article class="fm-cat-card" data-cat="${cat.label.toLowerCase()}">
      <div class="fm-cat-head">
        <div class="fm-cat-icon">${svgIcon(cat.icon)}</div>
        <div class="fm-cat-titles">
          <h3 class="fm-cat-label">${cat.label}</h3>
          <p class="fm-cat-blurb">${cat.blurb}</p>
        </div>
        <div class="fm-cat-meta">
          <div class="fm-cat-meta-num">${total}</div>
          <div class="fm-cat-meta-lbl">methods</div>
        </div>
      </div>
      <div class="fm-cat-chips">
${items}
      </div>
    </article>`;
    }).join('\n');
}

// JSON.stringify doesn't escape </script — keeps inline <script> safe.
export function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/<\/(script)/gi, '<\\/$1')
        .replace(/<!--/g, '<\\!--');
}

export function renderBootScripts(scalarJs: string, cfgJson: string): string {
    return `  <script>
    // Rewrite {HOST} placeholders in code samples to the live host.
    (function () {
      var script = document.getElementById('api-reference');
      var host = window.location && window.location.host;
      if (script && script.textContent && host) {
        script.textContent = script.textContent.split('{HOST}').join(host);
      }
    })();
    document.getElementById('api-reference').dataset.configuration = ${cfgJson};
  </script>
  <script>${scalarJs}</script>
  <script>
    (function () {
      // Theme toggle synced with prefers-color-scheme + Scalar's dark/light state.
      var root = document.documentElement;
      var btn = document.getElementById('fm-theme-toggle');
      var apply = function (dark) {
        root.classList.toggle('fm-dark', dark);
        root.classList.toggle('fm-light', !dark);
        document.body.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('light-mode', !dark);
        if (btn) btn.textContent = dark ? 'Dark' : 'Light';
      };
      var initial = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      apply(initial);
      if (btn) btn.addEventListener('click', function () {
        apply(!root.classList.contains('fm-dark'));
      });
    })();
    (function () {
      var splash = document.getElementById('fm-splash');
      if (!splash) return;
      var hide = function () { splash.hidden = true; setTimeout(function () { splash.remove(); }, 320); };
      var poll = setInterval(function () {
        if (document.querySelector('.scalar-app .scalar-api-reference, .scalar-api-reference')) {
          clearInterval(poll); hide();
        }
      }, 80);
      setTimeout(function () { clearInterval(poll); hide(); }, 12000);
    })();
    (function () {
      // Empty query shows everything; otherwise hide non-matching chips + empty cards.
      var input = document.getElementById('fm-cat-filter');
      var empty = document.getElementById('fm-cat-empty');
      var grid = document.getElementById('fm-cat-grid');
      if (!input || !grid) return;
      var cards = grid.querySelectorAll('.fm-cat-card');
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        var anyCard = 0;
        cards.forEach(function (card) {
          var chips = card.querySelectorAll('.fm-cat-chip');
          var anyChip = 0;
          chips.forEach(function (chip) {
            var name = chip.dataset.name || '';
            var match = !q || name.indexOf(q) !== -1;
            chip.hidden = !match;
            if (match) anyChip++;
          });
          card.hidden = q !== '' && anyChip === 0;
          if (!card.hidden) anyCard++;
        });
        if (empty) empty.hidden = anyCard !== 0;
      });
    })();
  </script>`;
}

export function renderTopbar(version: string): string {
    return `    <header class="fm-topbar">
      <div class="fm-topbar-inner">
        <a class="fm-logo" href="#">
          <svg class="fm-logo-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#4495D1"/><path fill="white" d="M14.5 7 h-5 l0.8 5 h2.4 l-0.7 6 l5-5.7z"/></svg>
          <span>Fleet Manager</span><span class="fm-logo-accent">API</span>
        </a>
        <nav class="fm-nav">
          <a href="#auth">Auth</a>
          <a href="#transport">Transport</a>
          <a href="#categories">Categories</a>
          <a href="#quickstart">Quick start</a>
          <a href="#reference">Reference</a>
        </nav>
        <div class="fm-topbar-spacer"></div>
        <div class="fm-actions">
          <span class="fm-version-pill">v${version}</span>
          <button id="fm-theme-toggle" class="fm-theme-toggle" type="button" aria-label="Toggle dark mode">Light</button>
        </div>
      </div>
    </header>`;
}

export function renderHero(ctx: PageContext): string {
    return `    <section class="fm-hero">
      <div class="fm-hero-bg"></div>
      <div class="fm-hero-grid"></div>
      <div class="fm-hero-inner">
        <div class="fm-eyebrow"><span class="fm-pulse"></span>Real-time device control</div>
        <h1 class="fm-hero-title">The <span class="fm-hero-accent">Fleet Manager</span> API</h1>
        <p class="fm-hero-sub">Control thousands of Shelly devices through one type-safe WebSocket RPC surface. ${ctx.methodCount.toLocaleString()} methods across ${ctx.nsCount} namespaces, fully self-describing, zero polling.</p>
        <div class="fm-cta-row">
          <a class="fm-btn fm-btn-primary" href="#reference">Browse reference
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
          </a>
          <a class="fm-btn fm-btn-ghost" href="#quickstart">Quick start</a>
        </div>
      </div>
    </section>`;
}

export function renderStats(ctx: PageContext): string {
    return `    <div class="fm-stats">
      <div class="fm-stats-card">
        <div class="fm-stat"><div class="fm-stat-val"><span class="fm-stat-accent">${ctx.methodCount.toLocaleString()}</span></div><div class="fm-stat-label">RPC methods</div></div>
        <div class="fm-stat"><div class="fm-stat-val">${ctx.nsCount}</div><div class="fm-stat-label">Namespaces</div></div>
        <div class="fm-stat"><div class="fm-stat-val">WS</div><div class="fm-stat-label">Real-time, no polling</div></div>
        <div class="fm-stat"><div class="fm-stat-val">3.1</div><div class="fm-stat-label">OpenAPI</div></div>
      </div>
    </div>`;
}

export function renderFeaturedSection(featured: string): string {
    return `    <section id="namespaces" class="fm-section">
      <h2 class="fm-section-title">Where to start</h2>
      <p class="fm-section-sub">Most integrations begin with one of these eight namespaces. Click through to jump straight to the reference.</p>
      <div class="fm-ns-grid">
${featured}
      </div>
    </section>`;
}

export function renderCategoriesSection(ctx: PageContext): string {
    return `    <section id="categories" class="fm-cat-section">
      <div class="fm-cat-section-head">
        <div>
          <h2>Browse by category</h2>
          <p>All ${ctx.nsCount} namespaces grouped into ${ctx.catCount} domain categories. Each chip links straight to its operations in the reference.</p>
        </div>
        <label class="fm-ns-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="fm-cat-filter" type="search" placeholder="Filter namespaces" autocomplete="off" />
        </label>
      </div>
      <div id="fm-cat-grid" class="fm-cat-grid">
${ctx.categories}
      </div>
      <div id="fm-cat-empty" class="fm-ns-empty" hidden>No namespace matches.</div>
    </section>`;
}

export function renderReferenceSection(ctx: PageContext): string {
    return `    <section id="reference" class="fm-reference">
      <div class="fm-reference-header">
        <h2>Full reference</h2>
        <p>${ctx.methodCount.toLocaleString()} operations across ${ctx.nsCount} namespaces. Use the sidebar to navigate, or search.</p>
      </div>
      <div class="fm-scalar-wrap">
        <script id="api-reference" type="application/json">${ctx.specJson}</script>
      </div>
    </section>`;
}

export function renderFooter(version: string): string {
    return `    <footer class="fm-footer">
      <div class="fm-footer-inner">
        <div>Shelly Group · Fleet Manager v${version}</div>
        <div><a href="/api/docs/openapi.json">openapi.json</a> · <a href="#">Top</a></div>
      </div>
    </footer>`;
}

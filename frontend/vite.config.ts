import fs from 'node:fs';
import path from 'node:path';
import {URL, fileURLToPath} from 'node:url';
import vue from '@vitejs/plugin-vue';
import {VitePWA} from 'vite-plugin-pwa';
import {defineConfig} from 'vitest/config';
import VueRouter from 'vue-router/unplugin/vite';

// Paths the SPA doesn't own (proxied apps + backend) — the SW must never cache
// these. Shared by the navigation denylist and the navigate rule.
const NON_SPA_PATHS: RegExp[] = [
    /^\/api/,
    /^\/health/,
    /^\/rpc/,
    /^\/node-red/,
    /^\/grafana/,
    /^\/alexa/,
    /^\/media/,
    /^\/uploads/,
    // Zitadel OIDC — must reach the server, not the SW cache
    /^\/oauth\//,
    /^\/oidc\//,
    /^\/ui\//,
    /^\/\.well-known\//
];

// Read version from package.json (works in both local and Docker)
function getVersion(): string {
    // npm_package_version is set when running via npm scripts
    if (process.env.npm_package_version) {
        return process.env.npm_package_version;
    }
    // Fallback: read package.json directly
    try {
        const pkgPath = path.join(
            import.meta.dirname || __dirname,
            'package.json'
        );
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '2.1.2';
    } catch {
        return '2.1.2';
    }
}

function getBuildDate(): string {
    return new Date().toISOString().split('T')[0];
}

// Get version info
const appVersion = getVersion();
const buildDate = getBuildDate();

function includesAny(id: string, packageNames: readonly string[]): boolean {
    return packageNames.some((name) => id.includes(name));
}

function manualVendorChunk(id: string): string | undefined {
    if (!id.includes('node_modules')) return undefined;
    if (includesAny(id, ['@codemirror', '@lezer', 'style-mod', 'w3c-keyname']))
        return 'codemirror-vendor';
    if (includesAny(id, ['@tiptap', 'prosemirror'])) return 'richtext-vendor';
    if (id.includes('fuse.js')) return 'search-vendor';
    if (id.includes('web-vitals')) return 'web-vitals';
    if (id.includes('workbox-window')) return 'pwa-vendor';
    if (id.includes('zrender')) return 'echarts-zrender-vendor';
    if (id.includes('echarts')) return 'echarts-vendor';
    if (id.includes('vue-json-pretty')) return 'json-pretty-vendor';
    if (includesAny(id, ['vue', '@vue', '@vueuse', 'pinia']))
        return 'vue-vendor';
    if (includesAny(id, ['maplibre-gl', '@maplibre', '@mapbox']))
        return 'maplibre-vendor';
    if (id.includes('@deck.gl')) return 'deckgl-vendor';
    if (includesAny(id, ['pixi.js', 'pixi-viewport'])) return 'pixi-vendor';
    if (id.includes('cytoscape')) return 'cytoscape-vendor';
    if (id.includes('oidc-client-ts')) return 'oidc-vendor';
    if (id.includes('xstate')) return 'state-machine-vendor';
    if (id.includes('@vuepic/vue-datepicker')) return 'datepicker-vendor';
    if (includesAny(id, ['three', '@types/three'])) return 'three-vendor';
    if (id.includes('axios')) return 'http-vendor';
    return 'vendor';
}

function isIgnoredThirdPartyRollupWarning(warning: {
    code?: string;
    id?: string;
}): boolean {
    return (
        warning.code === 'INVALID_ANNOTATION' &&
        Boolean(warning.id?.includes('@vueuse/core'))
    );
}

// https://vitejs.dev/config/
export default defineConfig(({mode}) => {
    const srcDir = fileURLToPath(new URL('./src', import.meta.url));
    const activeTemplateDir = path.join(srcDir, 'template-active');
    const devTemplateDir = path.join(srcDir, 'shell/dev-template');
    const clientApp = path.join(srcDir, 'shell/ClientApp.vue');
    const fullApp = path.join(srcDir, 'App.vue');
    const clientRoutes = path.join(srcDir, 'router/routes.client.ts');
    const fullRoutes = path.join(srcDir, 'router/routes.full.ts');
    const isClientBuild =
        mode === 'client' || process.env.FM_BUILD_MODE === 'client';
    const templateEntry = path.join(activeTemplateDir, 'index.vue');
    const watchFileRoutes = mode === 'development';

    if (isClientBuild && !fs.existsSync(templateEntry)) {
        throw new Error(
            'Client build requires frontend/src/template-active/index.vue'
        );
    }

    // When the image bundles the admin SPA at /admin/, the Vite build for
    // that bundle sets VITE_BASE_URL=/admin/ so every emitted asset URL
    // (script/css/img/manifest) resolves under /admin/assets/... instead of
    // /assets/.... The template bundle leaves it unset and serves from /.
    const baseUrl = process.env.VITE_BASE_URL || '/';

    return {
        base: baseUrl,
        clearScreen: false,
        // Dev server only: the UI is served on one port (7011) via the
        // backend's dev proxy, so Vite + its HMR client sit behind 7011.
        server: {
            origin: 'http://localhost:7011',
            allowedHosts: ['localhost'],
            hmr: {clientPort: 7011}
        },
        plugins: [
            !isClientBuild && VueRouter({watch: watchFileRoutes}),
            vue(),
            VitePWA({
                registerType: 'autoUpdate',
                manifest: {
                    name: 'Shelly Fleet Manager',
                    short_name: 'Fleet Manager',
                    description:
                        'Fleet Manager is a standalone software for controlling and monitoring new generations of Shelly devices.',
                    theme_color: '#141D4D',
                    icons: [
                        {
                            src: '/pwa-192x192.png',
                            sizes: '192x192',
                            type: 'image/png',
                            purpose: 'any'
                        },
                        {
                            src: '/pwa-512x512.png',
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'any'
                        },
                        {
                            src: '/pwa-maskable-192x192.png',
                            sizes: '192x192',
                            type: 'image/png',
                            purpose: 'maskable'
                        },
                        {
                            src: '/pwa-maskable-512x512.png',
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'maskable'
                        }
                    ],
                    start_url: '/',
                    display: 'standalone',
                    background_color: '#283992'
                },
                workbox: {
                    // IMPORTANT: Exclude index.html from precache.
                    // HTML must always come from the network so chunk hashes
                    // match the deployed JS/CSS. Serving stale cached HTML
                    // after a deploy causes infinite reload loops.
                    globIgnores: ['**/index.html'],
                    // Dev builds (vite build --watch) rewrite chunk hashes on
                    // every save. Precaching during that causes bad-precaching-
                    // response 404s in the browser's SW install. Skip precache
                    // in dev; runtime caching rules below still apply.
                    globPatterns: mode === 'development' ? [] : undefined,
                    cleanupOutdatedCaches: true,
                    // Disable navigateFallback (it requires index.html in precache).
                    // Navigation is handled by the NetworkFirst runtime rule below.
                    navigateFallback: null,
                    // Never serve index.html for these routes
                    navigateFallbackDenylist: NON_SPA_PATHS,
                    // Don't cache API/backend routes - always go to network
                    runtimeCaching: [
                        {
                            // HTML navigation — network first, offline fallback
                            // (3s). Skips non-SPA paths so the SW never caches them.
                            urlPattern: ({request, url}) =>
                                request.mode === 'navigate' &&
                                !NON_SPA_PATHS.some((re) =>
                                    re.test(url.pathname)
                                ),
                            handler: 'NetworkFirst',
                            options: {
                                cacheName: 'html-navigation',
                                networkTimeoutSeconds: 3
                            }
                        },
                        {
                            urlPattern: ({url}) =>
                                url.pathname === '/runtime-config.js',
                            handler: 'NetworkOnly'
                        },
                        {
                            urlPattern: ({url}) =>
                                url.pathname === '/customization.json',
                            handler: 'NetworkOnly'
                        },
                        {
                            urlPattern: ({url}) =>
                                url.pathname.startsWith('/api'),
                            handler: 'NetworkOnly'
                        },
                        {
                            urlPattern: ({url}) =>
                                url.pathname.startsWith('/health'),
                            handler: 'NetworkOnly'
                        },
                        {
                            urlPattern: ({url}) =>
                                url.pathname.startsWith('/rpc'),
                            handler: 'NetworkOnly'
                        }
                    ]
                }
            })
        ],
        resolve: {
            alias: [
                {
                    find: '@',
                    replacement: srcDir
                },
                {
                    find: '@app-root',
                    replacement: isClientBuild ? clientApp : fullApp
                },
                {
                    find: '@router-routes',
                    replacement: isClientBuild ? clientRoutes : fullRoutes
                },
                {
                    find: '@host',
                    replacement: path.join(srcDir, 'shell/template-host')
                },
                {
                    find: '@template',
                    replacement: fs.existsSync(templateEntry)
                        ? activeTemplateDir
                        : devTemplateDir
                },
                {
                    find: '@template-contract',
                    replacement: path.join(srcDir, 'template-contract')
                },
                {
                    find: '@shared',
                    replacement: path.join(srcDir, 'shared')
                },
                {
                    // Single source of truth for public API types shared
                    // between backend and frontend. Backend owns the file;
                    // frontend imports the same .ts without duplication.
                    find: '@api',
                    replacement: fileURLToPath(
                        new URL('../backend/src/types/api', import.meta.url)
                    )
                }
            ]
        },
        define: {
            NPM_APP_VERSION: JSON.stringify(appVersion),
            GIT_LAST_COMMIT_TIME: JSON.stringify(buildDate)
        },
        build: {
            // ECharts is intentionally isolated into its own lazy-loaded vendor
            // chunk for analytics/dashboard pages. Heavy visualization vendors
            // stay below the PWA precache limit; 850 kB is the FM chunk budget.
            chunkSizeWarningLimit: 850,
            rollupOptions: {
                onwarn(warning, warn) {
                    if (isIgnoredThirdPartyRollupWarning(warning)) return;
                    warn(warning);
                },
                output: {
                    manualChunks: manualVendorChunk
                }
            }
        },
        test: {
            environment: 'happy-dom',
            globals: true,
            include: ['test/**/*.test.ts'],
            setupFiles: ['test/setup.ts']
        }
    };
});

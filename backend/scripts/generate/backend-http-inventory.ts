/**
 * Backend HTTP inventory generator (Phase 0a).
 *
 * Walks every backend source file, finds calls of the form
 *   `<target>.<verb>(path, ...middlewareAndHandler)`
 * where verb is one of the Express routing verbs (get/post/put/patch/delete/use/all),
 * and records the route with its middleware chain + mount prefix.
 *
 * Mount prefixes are resolved by following `app.use('/prefix', subRouter)` calls
 * and matching them against the module that exports the sub-router.
 *
 * Output: docs/generated/backend-http-inventory.{json,md}
 */

import * as path from 'node:path';
import ts from 'typescript';
import {
    getBackendProgram,
    getBackendSourceFiles,
    lineOf,
    mdEscape,
    nodeText,
    provenanceHeader,
    readStringArg,
    relPath,
    writeOutputs
} from './_shared.js';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

export interface HttpRoute {
    method: string;
    path: string;
    middleware: string[];
    sourceFile: string;
    sourceLine: number;
    mount?: string;
    authModel:
        | 'isLoggedIn'
        | 'requiresAdmin'
        | 'requiresPlatformAdmin'
        | 'requiresPermission'
        | 'requiresAuditView'
        | 'requiresObservabilityAuth'
        | 'device-gui-session'
        | 'route-permission'
        | 'public'
        | 'unknown';
}

export interface HttpInventory {
    generator: 'backend-http-inventory';
    version: 1;
    totals: {
        routes: number;
        mounts: number;
        byAuthModel: Record<string, number>;
    };
    mounts: Array<{
        prefix: string;
        sourceFile: string;
        sourceLine: number;
        middleware?: string[];
    }>;
    routes: HttpRoute[];
}

/** Read first argument expression (path string) */
function routePath(args: readonly ts.Expression[]): string | undefined {
    if (args.length === 0) return undefined;
    return readStringArg(args[0]);
}

/** Render middleware chain between path and the final handler */
function middlewareOf(
    args: readonly ts.Expression[],
    source: ts.SourceFile
): string[] {
    if (args.length < 2) return [];
    // Everything between the path (arg 0) and the terminal handler (last arg).
    // If only path + handler → empty middleware.
    const between = args.slice(1, args.length - 1);
    return between.map((a) =>
        nodeText(a, source).replace(/\s+/g, ' ').slice(0, 60)
    );
}

function isAuthNeutralMiddleware(middleware: string): boolean {
    return (
        middleware.startsWith('httpRouteLimit(') ||
        middleware.startsWith('enforceRateLimit(') ||
        middleware.startsWith('express.json(') ||
        /\.single\(/.test(middleware)
    );
}

function authModelFromMiddleware(chain: string[]): HttpRoute['authModel'] {
    const authChain = chain.filter((middleware) => {
        return !isAuthNeutralMiddleware(middleware);
    });
    const joined = authChain.join(' ');
    // Tightest gate wins. Order: super_admin > permission > admin >
    // audit-view > logged-in > route-permission > public.
    if (joined.includes('requiresPlatformAdmin'))
        return 'requiresPlatformAdmin';
    if (
        joined.includes('requiresPermission(') ||
        joined.includes('requiresAnyPermission(')
    )
        return 'requiresPermission';
    if (joined.includes('requiresAdmin')) return 'requiresAdmin';
    if (joined.includes('requiresAuditView')) return 'requiresAuditView';
    if (joined.includes('requireObsAuth')) return 'requiresObservabilityAuth';
    if (joined.includes('requireDeviceGuiSession')) return 'device-gui-session';
    // rpcBodyAuth wraps isLoggedIn with a DEV_MODE bypass for the auth
    // bootstrap methods — classify it alongside isLoggedIn.
    if (joined.includes('isLoggedIn') || joined.includes('rpcBodyAuth'))
        return 'isLoggedIn';
    if (
        joined.includes('hasApiPermission') ||
        joined.includes('validateDeviceAccess')
    )
        return 'route-permission';
    return authChain.length === 0 ? 'public' : 'unknown';
}

export function generate(): HttpInventory {
    const program = getBackendProgram();
    const sources = getBackendSourceFiles(program).filter((sf) =>
        sf.fileName.includes(path.join('modules', 'web'))
    );

    const routes: HttpRoute[] = [];
    const mounts: HttpInventory['mounts'] = [];

    for (const source of sources) {
        const sourceFile = relPath(source.fileName);
        const visit = (node: ts.Node): void => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression)
            ) {
                const verb = node.expression.name.text;
                if (!VERBS.has(verb)) {
                    ts.forEachChild(node, visit);
                    return;
                }
                const targetExpr = node.expression.expression;
                const targetText = ts.isIdentifier(targetExpr)
                    ? targetExpr.text
                    : nodeText(targetExpr, source);

                // Only consider `app.*` and `router.*` and common sub-router names
                const isRouterLike =
                    targetText === 'app' ||
                    targetText === 'router' ||
                    targetText === 'api' ||
                    targetText === 'grafana' ||
                    targetText === 'deviceProxy';
                if (!isRouterLike) {
                    ts.forEachChild(node, visit);
                    return;
                }

                const pathArg = routePath(node.arguments);
                if (pathArg === undefined) {
                    // app.use without path, or non-string path — skip
                    ts.forEachChild(node, visit);
                    return;
                }

                const chain = middlewareOf(node.arguments, source);

                // app.use('/prefix', …subRouter/middleware…) is a mount.
                // Two-arg form is the classic sub-router; multi-arg form
                // (e.g. `app.use('/uploads/x', isLoggedIn, csp, express.static(…))`)
                // is a static / closure-wrapped mount that still needs to
                // surface in the inventory with its middleware chain.
                if (verb === 'use') {
                    if (node.arguments.length >= 2) {
                        mounts.push({
                            prefix: pathArg,
                            middleware: chain,
                            sourceFile,
                            sourceLine: lineOf(node, source)
                        });
                    }
                    ts.forEachChild(node, visit);
                    return;
                }

                routes.push({
                    method: verb.toUpperCase(),
                    path: pathArg,
                    middleware: chain,
                    sourceFile,
                    sourceLine: lineOf(node, source),
                    authModel: authModelFromMiddleware(chain)
                });
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(source, visit);
    }

    // Attach mount prefixes to routes declared in sub-router files
    // Hand-edit map: which files define which routers → which prefix they mount to
    // (derived from app.use('/prefix', importedRouter) in web/index.ts)
    const SUBROUTER_MOUNTS: Record<
        string,
        {prefix: string; middleware: string[]}
    > = {
        'backend/src/modules/web/routes/api.ts': {
            prefix: '/api',
            middleware: []
        },
        'backend/src/modules/web/routes/auditDownload.ts': {
            prefix: '/api',
            middleware: []
        },
        'backend/src/modules/web/routes/device-proxy.ts': {
            prefix: '/api/device-proxy',
            middleware: []
        },
        'backend/src/modules/web/routes/emailAssets.ts': {
            prefix: '/api/notifications',
            middleware: ['isLoggedIn']
        },
        'backend/src/modules/web/routes/firmwareUpload.ts': {
            prefix: '/media',
            middleware: []
        },
        'backend/src/modules/web/routes/floorPlanUpload.ts': {
            prefix: '/api/uploads',
            middleware: ['isLoggedIn']
        },
        'backend/src/modules/web/routes/grafana.ts': {
            prefix: '/grafana',
            middleware: ['isLoggedIn', 'requireGrafanaPermission']
        },
        'backend/src/modules/web/routes/media.ts': {
            prefix: '/media',
            middleware: []
        },
        'backend/src/modules/web/routes/oauthEmail.ts': {
            prefix: '/api/oauth',
            middleware: []
        }
    };
    for (const r of routes) {
        const mount = SUBROUTER_MOUNTS[r.sourceFile];
        if (mount) {
            r.mount = mount.prefix;
            r.middleware = [...mount.middleware, ...r.middleware];
            r.authModel = authModelFromMiddleware(r.middleware);
        }
    }

    routes.sort((a, b) => {
        const ap = (a.mount ?? '') + a.path;
        const bp = (b.mount ?? '') + b.path;
        if (ap !== bp) return ap.localeCompare(bp);
        return a.method.localeCompare(b.method);
    });
    mounts.sort((a, b) => a.prefix.localeCompare(b.prefix));

    const byAuthModel: Record<string, number> = {};
    for (const r of routes) {
        byAuthModel[r.authModel] = (byAuthModel[r.authModel] ?? 0) + 1;
    }

    return {
        generator: 'backend-http-inventory',
        version: 1,
        totals: {
            routes: routes.length,
            mounts: mounts.length,
            byAuthModel
        },
        mounts,
        routes
    };
}

export function renderMarkdown(inv: HttpInventory): string {
    const header = provenanceHeader('Backend HTTP Inventory', [
        'backend/src/modules/web/**/*.ts'
    ]);
    const totals = inv.totals;
    const summary = [
        '## Totals',
        '',
        `- HTTP routes: **${totals.routes}**`,
        `- Mount points (\`app.use(path, router)\`): **${totals.mounts}**`,
        '- By auth model:',
        ...Object.entries(totals.byAuthModel)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `  - \`${k}\`: **${v}**`),
        ''
    ].join('\n');

    const mountTable = [
        '## Mount points',
        '',
        '| Prefix | Auth | Middleware | Source |',
        '|---|---|---|---|',
        ...inv.mounts.map((m) => {
            const auth = authModelFromMiddleware(m.middleware ?? []);
            const mw = mdEscape((m.middleware ?? []).join(', '));
            return `| \`${m.prefix}\` | ${auth} | ${mw} | [${m.sourceFile}:${m.sourceLine}](../../${m.sourceFile}#L${m.sourceLine}) |`;
        }),
        ''
    ].join('\n');

    const routeTable = [
        '## Routes',
        '',
        '| Method | Path | Full path | Auth | Middleware | Source |',
        '|---|---|---|---|---|---|',
        ...inv.routes.map((r) => {
            const fullPath = (r.mount ?? '') + r.path;
            return `| \`${r.method}\` | \`${r.path}\` | \`${fullPath}\` | ${r.authModel} | ${mdEscape(r.middleware.join(', '))} | [${r.sourceFile}:${r.sourceLine}](../../${r.sourceFile}#L${r.sourceLine}) |`;
        }),
        ''
    ].join('\n');

    return [header, summary, mountTable, routeTable].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const inv = generate();
    writeOutputs('backend-http-inventory', inv, renderMarkdown(inv));
    console.log(
        `[backend-http-inventory] ${inv.totals.routes} routes | ${inv.totals.mounts} mounts | auth: ${JSON.stringify(inv.totals.byAuthModel)}`
    );
}

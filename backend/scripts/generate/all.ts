/**
 * Phase 0a unified entrypoint — runs every generator in dependency order.
 *
 * Usage: `cd backend && npm run generate`
 *
 * Output: docs/generated/ — both .md and .json siblings for each inventory.
 * The runtime-plugin inventory is hand-produced per release and not overwritten.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {GENERATED_DIR, writeOutputs} from './_shared.js';
import {writeAiIndex} from './ai-index.js';
import {generate as genApiDocs} from './api-docs.js';
import {generate as genApiOpenapi} from './api-openapi.js';
import {buildHtml as buildApiScalar} from './api-scalar.js';
import {
    generate as genEvents,
    renderMarkdown as renderEvents
} from './backend-event-inventory.js';
import {
    generate as genHttp,
    renderMarkdown as renderHttp
} from './backend-http-inventory.js';
import {
    generate as genRpc,
    renderMarkdown as renderRpc
} from './backend-rpc-inventory.js';
import {
    generate as genWs,
    renderMarkdown as renderWs
} from './backend-ws-inventory.js';
import {generate as genDrift} from './doc-drift-report.js';
import {
    generate as genEmbeddedApps,
    renderMarkdown as renderEmbeddedApps
} from './embedded-apps-api.js';
import {
    generate as genCapabilities,
    renderMarkdown as renderCapabilities
} from './entity-capabilities.js';
import {
    generate as genFrontend,
    renderMarkdown as renderFrontend
} from './frontend-backend-dependencies.js';
import {generate as genHostContract} from './host-contract.js';
import {
    generate as genHostSdk,
    renderMarkdown as renderHostSdk
} from './host-sdk-index.js';
import {
    generate as genNodeRed,
    renderMarkdown as renderNodeRed,
    writePackageCatalog
} from './node-red-catalog.js';
import {
    generate as genTopology,
    renderMarkdown as renderTopology
} from './topology-metadata.js';
import {
    generate as genAuth,
    renderMarkdown as renderAuth
} from './transport-auth-matrix.js';

function step<T>(label: string, fn: () => T): T {
    const start = Date.now();
    process.stdout.write(`· ${label}...`);
    const out = fn();
    process.stdout.write(` ok (${Date.now() - start}ms)\n`);
    return out;
}

async function main() {
    fs.mkdirSync(GENERATED_DIR, {recursive: true});

    const rpc = step('backend-rpc-inventory', genRpc);
    writeOutputs('backend-rpc-inventory', rpc, renderRpc(rpc));

    const http = step('backend-http-inventory', genHttp);
    writeOutputs('backend-http-inventory', http, renderHttp(http));

    const ws = step('backend-ws-inventory', genWs);
    writeOutputs('backend-ws-inventory', ws, renderWs(ws));

    const events = step('backend-event-inventory', genEvents);
    writeOutputs('backend-event-inventory', events, renderEvents(events));

    const frontend = step('frontend-backend-dependencies', genFrontend);
    writeOutputs(
        'frontend-backend-dependencies',
        frontend,
        renderFrontend(frontend)
    );

    const auth = step('transport-auth-matrix', genAuth);
    writeOutputs('transport-auth-matrix', auth, renderAuth(auth));

    const nodeRed = await genNodeRed({rpc, auth});
    console.log('· node-red-catalog... ok');
    writeOutputs('node-red-catalog', nodeRed, renderNodeRed(nodeRed));
    writePackageCatalog(nodeRed);

    const embeddedApps = step('embedded-apps-api', genEmbeddedApps);
    writeOutputs(
        'embedded-apps-api',
        embeddedApps,
        renderEmbeddedApps(embeddedApps)
    );

    const capabilities = step('entity-capabilities', genCapabilities);
    writeOutputs(
        'entity-capabilities',
        capabilities,
        renderCapabilities(capabilities)
    );

    const topology = step('topology-metadata', genTopology);
    writeOutputs('topology-metadata', topology, renderTopology(topology));

    const drift = step('doc-drift-report', genDrift);
    fs.writeFileSync(path.join(GENERATED_DIR, 'doc-drift-report.md'), drift);

    const apiDocs = await genApiDocs();
    console.log(
        '· api-docs... ok (%d namespaces, %d methods, %d with prose)',
        apiDocs.totalNamespaces,
        apiDocs.totalMethods,
        apiDocs.methodsWithProse
    );

    const openapi = await genApiOpenapi();
    console.log(
        '· api-openapi... ok (%d namespaces, %d methods)',
        openapi.namespaces,
        openapi.methods
    );

    const hostContract = await genHostContract();
    console.log(
        '· host-contract... ok (%d namespaces, %d methods)',
        hostContract.namespaces,
        hostContract.methods
    );

    const hostSdk = step('host-sdk-index', genHostSdk);
    writeOutputs('host-sdk-index', hostSdk, renderHostSdk(hostSdk));

    // api.html is what /api/docs serves from disk — must be built here so
    // the live route never 404s after a fresh checkout.
    step('api-scalar', buildApiScalar);

    step('ai-index', writeAiIndex);

    // Stub the runtime plugin inventory if it doesn't exist yet — operators
    // hand-produce it per release from a dev-mode boot snapshot.
    const pluginPath = path.join(GENERATED_DIR, 'runtime-plugin-inventory.md');
    if (!fs.existsSync(pluginPath)) {
        fs.writeFileSync(
            pluginPath,
            [
                '# Runtime Plugin Inventory',
                '',
                'This file is hand-produced per release from a dev-mode boot',
                'snapshot — plugins register components at runtime, so static',
                'analysis cannot see them.',
                '',
                'Replace this placeholder with the actual inventory on release.',
                '',
                '## Format',
                '',
                '```',
                'Plugin name | Version | Registered namespaces | Method count | Notes',
                '```',
                ''
            ].join('\n')
        );
    }

    // Print the headline totals so a regeneration run lands with a useful log
    console.log('');
    console.log('=== Phase 0a baseline totals ===');
    console.log(`  RPC components: ${rpc.totals.components}`);
    console.log(
        `  RPC methods: ${rpc.totals.explicitMethods} explicit + ${rpc.totals.inheritedMethods} inherited = ${rpc.totals.productionCallable} prod (${rpc.totals.devModeCallable} w/ DEV)`
    );
    console.log(
        `  HTTP routes: ${http.totals.routes} across ${http.totals.mounts} mounts`
    );
    console.log(`  WS paths: ${ws.totals.upgradePaths}`);
    console.log(`  Events: ${events.totals.uniqueNames} unique names`);
    console.log(
        `  Frontend calls: ${frontend.totals.calls} across ${frontend.totals.files} files`
    );
    console.log(`  Auth matrix rows: ${auth.totals.rows}`);
    console.log(
        `  Node-RED catalog: ${nodeRed.nodes.length} nodes, ${nodeRed.methods.length} methods`
    );
    console.log(
        `  Entity capabilities: ${capabilities.totals.entityTypes} types, ${capabilities.totals.actionCount} actions`
    );
    console.log(
        `  Topology metadata: ${topology.totals.modules} modules, ${topology.totals.edges} edges, ${topology.totals.flows} flows`
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

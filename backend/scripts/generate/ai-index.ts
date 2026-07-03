// AI-facing index for generated contracts and stable docs.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    GENERATED_DIR,
    mdEscape,
    provenanceHeader,
    REPO_ROOT,
    relPath
} from './_shared.js';

interface AiIndexResource {
    id: string;
    path: string;
    audience: 'ai-agents' | 'api-consumers' | 'frontend-agents' | 'operators';
    kind: 'generated-contract' | 'generated-inventory' | 'stable-doc';
    format: 'json' | 'markdown' | 'typescript';
    role: string;
    aiUse: string;
    readFirst: boolean;
}

interface AiIndexSurface {
    id: string;
    role: string;
    sourceOfTruth: string;
    useFor: string;
    avoidFor: string;
}

interface AiIndexMcpResource {
    uri: string;
    source: string;
    role: string;
    safeMode: 'read-only' | 'read-write-deferred';
}

export interface AiIndex {
    generator: 'ai-index';
    version: 1;
    summary: {
        purpose: string;
        rule: string;
        mcpStatus: string;
    };
    surfaces: AiIndexSurface[];
    resources: AiIndexResource[];
    mcpResources: AiIndexMcpResource[];
    workflows: Array<{
        task: string;
        read: string[];
        reason: string;
    }>;
}

interface ResourceInput {
    id: string;
    rel: string;
    audience: AiIndexResource['audience'];
    kind: AiIndexResource['kind'];
    format: AiIndexResource['format'];
    role: string;
    aiUse: string;
    readFirst?: boolean;
}

const ROOT_LLMS_PATH = path.join(REPO_ROOT, 'llms.txt');

const RESOURCE_INPUTS: ResourceInput[] = [
    {
        id: 'ai-index',
        rel: 'docs/generated/ai-index.json',
        audience: 'ai-agents',
        kind: 'generated-contract',
        format: 'json',
        role: 'Small map of AI-readable docs and generated contracts.',
        aiUse: 'Start here before reading large generated files.',
        readFirst: true
    },
    {
        id: 'openapi',
        rel: 'docs/generated/api.openapi.json',
        audience: 'api-consumers',
        kind: 'generated-contract',
        format: 'json',
        role: 'OpenAPI 3.1 contract for the backend RPC surface.',
        aiUse: 'Use for exact params, responses, operation ids, and Scalar/MCP API tooling.',
        readFirst: true
    },
    {
        id: 'host-contract',
        rel: 'frontend/src/shell/template-host/generated/contract.ts',
        audience: 'frontend-agents',
        kind: 'generated-contract',
        format: 'typescript',
        role: 'Typed Host SDK method contract for template and multi-UI code.',
        aiUse: 'Use when building UI/template calls so the UI depends on the host layer, not raw backend details.',
        readFirst: true
    },
    {
        id: 'host-sdk',
        rel: 'frontend/src/shell/template-host/index.ts',
        audience: 'frontend-agents',
        kind: 'stable-doc',
        format: 'typescript',
        role: 'Host SDK public entrypoint exposed to templates and alternate UIs.',
        aiUse: 'Use to discover the supported UI-facing domains and helpers.',
        readFirst: true
    },
    {
        id: 'host-sdk-index',
        rel: 'docs/generated/host-sdk-index.json',
        audience: 'frontend-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Generated index of Host SDK modules, exports, and RPC bridge usage.',
        aiUse: 'Use to find the right @host domain before touching UI/template code.',
        readFirst: true
    },
    {
        id: 'ai-and-mcp-reference',
        rel: 'docs/reference/ai-and-mcp.md',
        audience: 'ai-agents',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Short AI/MCP entrypoint with Host SDK rules and common UI flows.',
        aiUse: 'Use before UI, docs, or MCP work so agents follow the right contract layer.',
        readFirst: true
    },
    {
        id: 'deployment-guide',
        rel: 'docs/reference/deployment.md',
        audience: 'operators',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Fleet Manager deploy.sh install, update, environment, and flag guide.',
        aiUse: 'Use for Fleet Manager install/deploy commands and deploy.sh parameters.',
        readFirst: true
    },
    {
        id: 'separate-ui-host-sdk-guide',
        rel: 'docs/reference/separate-ui-host-sdk.md',
        audience: 'frontend-agents',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Guide for BM template UIs and fully separate UIs using Fleet Manager.',
        aiUse: 'Use before building a separate UI, BM template UI, or Host SDK adapter.',
        readFirst: true
    },
    {
        id: 'deploy-reference',
        rel: 'docs/architecture/deploy-reference.md',
        audience: 'operators',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Detailed deploy.sh architecture, topology, routing, SSL, and mode reference.',
        aiUse: 'Use after the deployment guide when deploy behavior needs deeper explanation.'
    },
    {
        id: 'rpc-inventory',
        rel: 'docs/generated/backend-rpc-inventory.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Backend component and RPC inventory.',
        aiUse: 'Use to find backend owners, permissions, source locations, and callable methods.'
    },
    {
        id: 'http-inventory',
        rel: 'docs/generated/backend-http-inventory.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'HTTP route and middleware inventory.',
        aiUse: 'Use to verify route shapes, auth middleware, and served static/API endpoints.'
    },
    {
        id: 'ws-inventory',
        rel: 'docs/generated/backend-ws-inventory.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'WebSocket upgrade path and handler inventory.',
        aiUse: 'Use to check WS paths, handlers, and payload caps.'
    },
    {
        id: 'events',
        rel: 'docs/generated/backend-event-inventory.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Backend event emission inventory.',
        aiUse: 'Use when adding or wiring event contracts.'
    },
    {
        id: 'frontend-backend-dependencies',
        rel: 'docs/generated/frontend-backend-dependencies.json',
        audience: 'frontend-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Frontend calls into backend RPC/HTTP/direct device surfaces.',
        aiUse: 'Use to find existing UI callers before changing a backend contract.'
    },
    {
        id: 'auth-matrix',
        rel: 'docs/generated/transport-auth-matrix.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Transport and authorization matrix.',
        aiUse: 'Use to check public/admin/permission boundaries before exposing a surface.'
    },
    {
        id: 'entity-capabilities',
        rel: 'docs/generated/entity-capabilities.json',
        audience: 'frontend-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Entity type capability and action inventory.',
        aiUse: 'Use to drive component/action UI without duplicating entity rules.'
    },
    {
        id: 'embedded-apps-api',
        rel: 'docs/generated/embedded-apps-api.json',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'json',
        role: 'Node-RED Admin API + Grafana API (proxied) with create/update/delete examples.',
        aiUse: 'Use to provision Node-RED flows or Grafana dashboards via the FM proxy; live /api/docs/embedded-apps lists only enabled add-ons.'
    },
    {
        id: 'doc-drift-report',
        rel: 'docs/generated/doc-drift-report.md',
        audience: 'ai-agents',
        kind: 'generated-inventory',
        format: 'markdown',
        role: 'Compares stable docs against generated backend inventories.',
        aiUse: 'Use to detect stale handwritten docs.'
    },
    {
        id: 'docs-readme',
        rel: 'docs/README.md',
        audience: 'ai-agents',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Docs folder convention and audience rules.',
        aiUse: 'Use before creating or moving documentation.',
        readFirst: true
    },
    {
        id: 'claude-rules',
        rel: 'CLAUDE.md',
        audience: 'ai-agents',
        kind: 'stable-doc',
        format: 'markdown',
        role: 'Repo-wide agent rules, ownership, clean-code rules, and commit rules.',
        aiUse: 'Use before any code or doc change.',
        readFirst: true
    }
];

const SURFACES: AiIndexSurface[] = [
    {
        id: 'backend-rpc-describe',
        role: 'Backend source of truth.',
        sourceOfTruth: 'backend/src/types/api/*_DESCRIBE',
        useFor: 'RPC params, responses, permissions, generated OpenAPI, generated Host SDK contract.',
        avoidFor: 'UI layout and template-specific convenience APIs.'
    },
    {
        id: 'host-sdk',
        role: 'UI-facing source of truth for templates and alternate UIs.',
        sourceOfTruth:
            'frontend/src/shell/template-host/* + frontend/src/shell/template-host/generated/contract.ts',
        useFor: 'Multi-UI/template calls, typed frontend helpers, domain-level UI behavior.',
        avoidFor: 'Changing backend API contracts directly.'
    },
    {
        id: 'scalar-openapi',
        role: 'Human/API-tooling reference.',
        sourceOfTruth: 'docs/generated/api.openapi.json',
        useFor: 'Scalar docs, OpenAPI clients, future OpenAPI-backed MCP execution.',
        avoidFor:
            'Repo architecture, frontend call ownership, or internal plans.'
    },
    {
        id: 'local-docs-mcp',
        role: 'Read-only AI retrieval layer.',
        sourceOfTruth:
            'docs/generated/ai-index.json + generated inventories + stable docs',
        useFor: 'Read-only doc search and exact contract lookup.',
        avoidFor: 'Unreviewed write/API execution.'
    }
];

function resource(input: ResourceInput): AiIndexResource {
    return {
        id: input.id,
        path: input.rel,
        audience: input.audience,
        kind: input.kind,
        format: input.format,
        role: input.role,
        aiUse: input.aiUse,
        readFirst: input.readFirst === true
    };
}

function mcpResources(): AiIndexMcpResource[] {
    return [
        {
            uri: 'fm://docs/ai-index',
            source: 'docs/generated/ai-index.json',
            role: 'Small resource map for agents.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://api/openapi',
            source: 'docs/generated/api.openapi.json',
            role: 'OpenAPI contract for Scalar/OpenAPI tools.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://api/rpc-inventory',
            source: 'docs/generated/backend-rpc-inventory.json',
            role: 'RPC method/source/permission lookup.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://ui/host-contract',
            source: 'frontend/src/shell/template-host/generated/contract.ts',
            role: 'Typed Host SDK contract for multi-UI work.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://ui/host-sdk-index',
            source: 'docs/generated/host-sdk-index.json',
            role: 'Host SDK module/export lookup for multi-UI work.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://ui/frontend-backend-dependencies',
            source: 'docs/generated/frontend-backend-dependencies.json',
            role: 'Find UI callers before backend changes.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://auth/transport-matrix',
            source: 'docs/generated/transport-auth-matrix.json',
            role: 'Authorization and transport boundary lookup.',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://api/embedded-apps',
            source: 'docs/generated/embedded-apps-api.json',
            role: 'Node-RED + Grafana proxied API (create/update/delete flows and dashboards).',
            safeMode: 'read-only'
        },
        {
            uri: 'fm://api/execute',
            source: 'docs/generated/api.openapi.json',
            role: 'Future controlled API execution through OpenAPI/Scalar MCP.',
            safeMode: 'read-write-deferred'
        }
    ];
}

function workflows(): AiIndex['workflows'] {
    return [
        {
            task: 'Build or change UI/template code',
            read: [
                'separate-ui-host-sdk-guide',
                'host-sdk',
                'host-sdk-index',
                'host-contract',
                'frontend-backend-dependencies'
            ],
            reason: 'The Host SDK is the stable UI-facing layer; raw backend RPC is lower level.'
        },
        {
            task: 'Install or deploy Fleet Manager',
            read: ['deployment-guide', 'deploy-reference', 'ai-and-mcp-reference'],
            reason: 'The deploy docs define deploy.sh commands, flags, environments, modes, and routing behavior.'
        },
        {
            task: 'Change backend RPC contract',
            read: ['claude-rules', 'rpc-inventory', 'openapi', 'auth-matrix'],
            reason: 'Backend contract changes must preserve params, responses, and permission boundaries.'
        },
        {
            task: 'Find existing callers',
            read: ['frontend-backend-dependencies', 'rpc-inventory'],
            reason: 'Caller lookup prevents breaking existing frontend flows.'
        },
        {
            task: 'Prepare MCP context',
            read: [
                'ai-and-mcp-reference',
                'ai-index',
                'openapi',
                'rpc-inventory',
                'deployment-guide',
                'host-contract'
            ],
            reason: 'Use read-only MCP resources for retrieval; live RPC execution is deferred.'
        }
    ];
}

export function generate(): AiIndex {
    return {
        generator: 'ai-index',
        version: 1,
        summary: {
            purpose:
                'Route AI agents to the smallest correct source of truth before reading large generated files.',
            rule: 'Use Host SDK for UI/multi-UI work; use backend RPC/OpenAPI for backend/API contracts.',
            mcpStatus:
                'Repo ships a local read-only Fleet Manager docs MCP. Live RPC execution is deferred until auth, permissions, audit logs, and rate limits are designed.'
        },
        surfaces: SURFACES,
        resources: RESOURCE_INPUTS.map(resource),
        mcpResources: mcpResources(),
        workflows: workflows()
    };
}

function renderResources(resources: AiIndexResource[]): string[] {
    const rows = ['| ID | Path | Use |', '|---|---|---|'];
    for (const item of resources) {
        rows.push(
            `| \`${mdEscape(item.id)}\` | \`${mdEscape(item.path)}\` | ${mdEscape(item.aiUse)} |`
        );
    }
    return rows;
}

function renderSurfaces(surfaces: AiIndexSurface[]): string[] {
    const rows = ['| Surface | Use For | Avoid For |', '|---|---|---|'];
    for (const item of surfaces) {
        rows.push(
            `| \`${mdEscape(item.id)}\` | ${mdEscape(item.useFor)} | ${mdEscape(item.avoidFor)} |`
        );
    }
    return rows;
}

export function renderMarkdown(index: AiIndex): string {
    return [
        provenanceHeader('AI Context Index', [
            'backend/scripts/generate/ai-index.ts',
            'docs/generated/*.json',
            'frontend/src/shell/template-host/'
        ]),
        '## Rule',
        '',
        index.summary.rule,
        '',
        '## Contract Surfaces',
        '',
        ...renderSurfaces(index.surfaces),
        '',
        '## Read First',
        '',
        ...renderResources(index.resources.filter((item) => item.readFirst)),
        '',
        '## Generated Resources',
        '',
        ...renderResources(index.resources.filter((item) => !item.readFirst)),
        '',
        '## Recommended MCP Resources',
        '',
        '| URI | Source | Mode | Role |',
        '|---|---|---|---|',
        ...index.mcpResources.map(
            (item) =>
                `| \`${mdEscape(item.uri)}\` | \`${mdEscape(item.source)}\` | ${item.safeMode} | ${mdEscape(item.role)} |`
        ),
        '',
        '## Workflows',
        '',
        ...index.workflows.flatMap((item) => [
            `### ${item.task}`,
            '',
            `Read: ${item.read.map((id) => `\`${id}\``).join(', ')}`,
            '',
            item.reason,
            ''
        ])
    ].join('\n');
}

function renderLlms(index: AiIndex): string {
    const first = index.resources.filter((item) => item.readFirst);
    return [
        '# Shelly Fleet Manager AI Context',
        '',
        'Use this file as the small entrypoint before reading large docs.',
        '',
        '## Start Here',
        '',
        ...first.map((item) => `- ${item.id}: ${item.path} — ${item.aiUse}`),
        '',
        '## Main Rule',
        '',
        index.summary.rule,
        '',
        '## MCP Direction',
        '',
        index.summary.mcpStatus,
        ''
    ].join('\n');
}

export function writeAiIndex(): AiIndex {
    const index = generate();
    fs.mkdirSync(GENERATED_DIR, {recursive: true});
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'ai-index.json'),
        `${JSON.stringify(index, null, 2)}\n`
    );
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'ai-index.md'),
        renderMarkdown(index)
    );
    fs.writeFileSync(ROOT_LLMS_PATH, renderLlms(index));
    console.log(
        `[ai-index] wrote ${relPath(path.join(GENERATED_DIR, 'ai-index.json'))} + ${relPath(path.join(GENERATED_DIR, 'ai-index.md'))} + ${relPath(ROOT_LLMS_PATH)}`
    );
    return index;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    writeAiIndex();
}

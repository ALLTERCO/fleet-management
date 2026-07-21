// Agent-facing API catalog: Describe + rpc/auth inventories + Host SDK
// guidance joined into docs/generated/api-catalog.json.
// Naming: `namespaceKind` (device vs FM) and `declarationKind`
// (provenance) — never a bare `kind`; the two meanings collide.

import type {
    CrudOp,
    DescribeOutput,
    MethodSafety,
    NamespaceKind,
    PermissionRequirement
} from '../../src/types/api/_describe';
import {describeMethodIds, loadAllDescribes} from './_describes.js';
import {domainWrapperMap, moduleRpcLiterals} from './_hostSdkSource.js';
import {
    type AuthInventory,
    type AuthRow,
    authIndex,
    readGeneratedJson,
    rpcIndex
} from './_inventories.js';
import {mdEscape, provenanceHeader, writeOutputs} from './_shared.js';
import type {RpcInventory, RpcMethod} from './backend-rpc-inventory.js';

export interface ApiCatalogSafety {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
    isConsequential: boolean;
    /** Dispatcher/tunnel: the real effect depends on caller input. */
    effectDependsOnInput?: boolean;
    source:
        | 'describe-annotation'
        | 'permission-operation'
        | 'describe-method'
        | 'conservative-default';
}

export interface ApiCatalogMethod {
    id: string;
    namespace: string;
    namespaceKind: NamespaceKind;
    namespaceDescription: string;
    method: string;
    fullMethod: string;
    description?: string;
    paramsSchema: unknown;
    responseSchema: unknown;
    permission: PermissionRequirement;
    auth?: Pick<AuthRow, 'authBucket' | 'detail' | 'sourceFile' | 'sourceLine'>;
    declaration?: {
        declarationKind: RpcMethod['kind'];
        env: RpcMethod['env'];
        permission: RpcMethod['permission'];
        sourceFile: string;
        sourceLine: number;
    };
    safety: ApiCatalogSafety;
    requiresOnlineDevice: boolean;
    /** This method IS a raw escape hatch — prefer curated wrappers. */
    escapeHatch?: boolean;
    hostSdkModules?: string[];
    recommendedHostWrapper?: string;
}

export interface ApiCatalogEscapeHatch {
    name: string;
    path: string;
    note: string;
    /** Set when the hatch is itself an RPC method in this catalog. */
    rpcId?: string;
}

export interface ApiCatalog {
    generator: 'api-catalog';
    version: 1;
    summary: {
        namespaces: number;
        methods: number;
        rule: string;
    };
    escapeHatches: ApiCatalogEscapeHatch[];
    methods: ApiCatalogMethod[];
}

const ESCAPE_HATCHES: ApiCatalogEscapeHatch[] = [
    {
        name: 'host.api',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Generic RPC proxy over every namespace. Prefer the curated host domains.'
    },
    {
        name: 'call',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Raw single RPC call. Prefer a named host wrapper.'
    },
    {
        name: 'listAll',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Raw auto-paged RPC call. Prefer a named host wrapper.'
    },
    {
        name: 'useTemplateRpc',
        path: 'frontend/src/shell/template-host/rpc.ts',
        note: 'Raw reactive RPC wrapper for templates. Prefer domain composables.'
    },
    {
        name: 'host.devices.call',
        path: 'frontend/src/shell/template-host/devices.ts',
        note: 'Relays an arbitrary RPC to a Shelly device. Device firmware surface, not FM.',
        rpcId: 'device.call'
    },
    {
        name: 'createHostDomain().call',
        path: 'frontend/src/shell/template-host/domain.ts',
        note: 'Untyped namespace-scoped RPC call. Prefer callTyped or a named wrapper.'
    }
];

const HATCH_RPC_IDS = new Set(
    ESCAPE_HATCHES.flatMap((hatch) => (hatch.rpcId ? [hatch.rpcId] : []))
);

// Which SDK modules mention an RPC id — inverted from the shared scan.
function hostSdkModuleIndex(): Map<string, string[]> {
    const byId = new Map<string, Set<string>>();
    for (const [moduleName, literals] of moduleRpcLiterals()) {
        for (const id of literals) {
            const modules = byId.get(id) ?? new Set<string>();
            modules.add(moduleName);
            byId.set(id, modules);
        }
    }
    return new Map(
        [...byId.entries()].map(([id, modules]) => [id, [...modules].sort()])
    );
}

function safetyFromOperation(
    operation: CrudOp,
    openWorldHint: boolean,
    source: ApiCatalogSafety['source']
): ApiCatalogSafety {
    const readOnly = operation === 'read';
    return {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly && operation !== 'create',
        idempotentHint: readOnly,
        openWorldHint,
        isConsequential: !readOnly,
        source
    };
}

// Precedence: describe safety annotation > permission.operation >
// conservative default. Annotation overrides apply last.
function deriveSafety(
    methodName: string,
    permission: PermissionRequirement,
    safety: MethodSafety | undefined,
    namespaceKind: NamespaceKind
): ApiCatalogSafety {
    // device namespaces reach outside FM into physical devices
    const openWorldHint = namespaceKind === 'device';
    if (methodName === 'Describe') {
        // contract lookup — read-only by construction
        return {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint,
            isConsequential: false,
            source: 'describe-method'
        };
    }
    const operation = safety?.operation ?? permission.operation;
    const base = operation
        ? safetyFromOperation(
              operation,
              openWorldHint,
              safety ? 'describe-annotation' : 'permission-operation'
          )
        : {
              // no CRUD operation anywhere — presume a consequential write
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint,
              isConsequential: true,
              source: safety
                  ? ('describe-annotation' as const)
                  : ('conservative-default' as const)
          };
    if (safety?.idempotent !== undefined) {
        base.idempotentHint = safety.idempotent;
    }
    if (safety?.destructive !== undefined) {
        base.destructiveHint = safety.destructive;
    }
    if (safety?.effectDependsOnInput) {
        base.effectDependsOnInput = true;
    }
    return base;
}

function catalogMethod(
    contract: DescribeOutput,
    methodName: string,
    lookups: {
        rpcByMethod: Map<string, RpcMethod>;
        authByMethod: Map<string, AuthRow>;
        hostModules: Map<string, string[]>;
        wrappers: Map<string, string>;
    }
): ApiCatalogMethod {
    const method = contract.methods[methodName];
    if (!contract.kind) {
        // gated by apiDescribeMeta.test.ts — never emit without a kind
        throw new Error(`${contract.namespace}: namespace kind missing`);
    }
    const namespaceKind = contract.kind;
    const fullMethod = `${contract.namespace}.${method.name}`;
    const id = fullMethod.toLowerCase();
    const authRow = lookups.authByMethod.get(id);
    const rpcMethod = lookups.rpcByMethod.get(id);
    const hostModules = lookups.hostModules.get(id);
    const wrapper = lookups.wrappers.get(id);
    return {
        id,
        namespace: contract.namespace,
        namespaceKind,
        namespaceDescription: contract.description ?? '',
        method: method.name,
        fullMethod,
        ...(method.description ? {description: method.description} : {}),
        paramsSchema: method.params,
        responseSchema: method.response,
        permission: method.permission,
        ...(authRow
            ? {
                  auth: {
                      authBucket: authRow.authBucket,
                      detail: authRow.detail,
                      sourceFile: authRow.sourceFile,
                      sourceLine: authRow.sourceLine
                  }
              }
            : {}),
        ...(rpcMethod
            ? {
                  declaration: {
                      declarationKind: rpcMethod.kind,
                      env: rpcMethod.env,
                      permission: rpcMethod.permission,
                      sourceFile: rpcMethod.sourceFile,
                      sourceLine: rpcMethod.sourceLine
                  }
              }
            : {}),
        safety: deriveSafety(
            method.name,
            method.permission,
            method.safety,
            namespaceKind
        ),
        requiresOnlineDevice: namespaceKind === 'device',
        ...(HATCH_RPC_IDS.has(id) ? {escapeHatch: true} : {}),
        ...(hostModules ? {hostSdkModules: hostModules} : {}),
        ...(wrapper ? {recommendedHostWrapper: wrapper} : {})
    };
}

export async function generate(inputs?: {
    rpc?: RpcInventory;
    auth?: AuthInventory;
}): Promise<ApiCatalog> {
    const rpc =
        inputs?.rpc ??
        readGeneratedJson<RpcInventory>('backend-rpc-inventory.json');
    const auth =
        inputs?.auth ??
        readGeneratedJson<AuthInventory>('transport-auth-matrix.json');
    const describes = await loadAllDescribes();
    const lookups = {
        rpcByMethod: rpcIndex(rpc),
        authByMethod: authIndex(auth),
        hostModules: hostSdkModuleIndex(),
        wrappers: domainWrapperMap(describeMethodIds(describes))
    };
    const methods = describes
        .flatMap((contract) =>
            Object.keys(contract.methods).map((name) =>
                catalogMethod(contract, name, lookups)
            )
        )
        .sort((a, b) => a.fullMethod.localeCompare(b.fullMethod));
    return {
        generator: 'api-catalog',
        version: 1,
        summary: {
            namespaces: describes.length,
            methods: methods.length,
            rule: 'Custom UIs call the Host SDK first; raw RPC is for extending the SDK or backend integration.'
        },
        escapeHatches: ESCAPE_HATCHES,
        methods
    };
}

function namespaceRows(catalog: ApiCatalog): string[] {
    const byNamespace = new Map<
        string,
        {namespaceKind: NamespaceKind; description: string; count: number}
    >();
    for (const m of catalog.methods) {
        const entry = byNamespace.get(m.namespace) ?? {
            namespaceKind: m.namespaceKind,
            description: m.namespaceDescription,
            count: 0
        };
        entry.count += 1;
        byNamespace.set(m.namespace, entry);
    }
    return [...byNamespace.entries()].map(
        ([namespace, entry]) =>
            `| \`${namespace}\` | ${entry.namespaceKind} | ${entry.count} | ${mdEscape(entry.description)} |`
    );
}

export function renderMarkdown(catalog: ApiCatalog): string {
    const header = provenanceHeader('API Catalog (agent-facing)', [
        'backend/src/types/api/*_DESCRIBE',
        'docs/generated/backend-rpc-inventory.json',
        'docs/generated/transport-auth-matrix.json',
        'frontend/src/shell/template-host/'
    ]);
    const summary = [
        '## Totals',
        '',
        `- Namespaces: **${catalog.summary.namespaces}**`,
        `- Methods: **${catalog.summary.methods}**`,
        `- Rule: ${catalog.summary.rule}`,
        '',
        'Per-method detail (schemas, permissions, safety hints, recommended',
        'Host SDK wrappers) lives in `api-catalog.json`; look methods up via',
        'the MCP tool `get_api_method`.',
        ''
    ].join('\n');
    const hatches = [
        '## Raw Escape Hatches (advanced)',
        '',
        '| Surface | Path | Note |',
        '|---|---|---|',
        ...catalog.escapeHatches.map(
            (h) => `| \`${h.name}\` | \`${h.path}\` | ${mdEscape(h.note)} |`
        ),
        ''
    ].join('\n');
    const namespaces = [
        '## Namespaces',
        '',
        '| Namespace | namespaceKind | Methods | Description |',
        '|---|---|---:|---|',
        ...namespaceRows(catalog),
        ''
    ].join('\n');
    return [header, summary, hatches, namespaces].join('\n');
}

async function main(): Promise<void> {
    const catalog = await generate();
    writeOutputs('api-catalog', catalog, renderMarkdown(catalog));
    console.log(
        `[api-catalog] ${catalog.summary.namespaces} namespaces | ${catalog.summary.methods} methods`
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

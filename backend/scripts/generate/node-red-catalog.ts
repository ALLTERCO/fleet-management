/**
 * Node-RED catalog generator.
 *
 * Builds the machine-readable contract consumed by
 * `@shelly/fleet-manager-node-red`. The catalog is generated from the live
 * `_DESCRIBE` (via loadAllDescribes) — the same single source every other
 * generator reads — plus the generated rpc/auth inventories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    DescribeOutput,
    NamespaceKind
} from '../../src/types/api/_describe';
import {loadAllDescribes} from './_describes.js';
import {
    type AuthInventory,
    type AuthRow,
    authIndex,
    readGeneratedJson,
    rpcIndex
} from './_inventories.js';
import {isDeniedForNodeRedService} from '../../src/modules/nodeRed/serviceDenylist';
import {provenanceHeader, REPO_ROOT, writeOutputs} from './_shared.js';
import type {RpcInventory, RpcMethod} from './backend-rpc-inventory.js';

type NodeKey =
    | 'fm-server'
    | 'fm-rpc'
    | 'fm-target'
    | 'fm-tag'
    | 'fm-group'
    | 'fm-location'
    | 'fm-device'
    | 'fm-component-catalog'
    | 'fm-component-state'
    | 'fm-component-action'
    | 'fm-device-event'
    | 'fm-trigger-threshold'
    | 'fm-trigger-status'
    | 'fm-trigger-button'
    | 'fm-webhook-in'
    | 'fm-schedule'
    | 'fm-variable'
    | 'fm-webhook'
    | 'fm-script'
    | 'fm-firmware'
    | 'fm-backup'
    | 'fm-certificate'
    | 'fm-diagnostics'
    | 'fm-alert'
    | 'fm-report'
    | 'fm-energy'
    | 'fm-notification'
    | 'fm-audit';

export interface NodeRedCatalogMethod {
    id: string;
    namespace: string;
    namespaceKind: NamespaceKind;
    namespaceDescription: string;
    method: string;
    fullMethod: string;
    nodeKeys: NodeKey[];
    paramsSchema: unknown;
    responseSchema: unknown;
    permission: unknown;
    auth?: Pick<AuthRow, 'authBucket' | 'detail' | 'sourceFile' | 'sourceLine'>;
    description?: string;
    rpc?: Pick<
        RpcMethod,
        | 'kind'
        | 'env'
        | 'permission'
        | 'permissionArgs'
        | 'sourceFile'
        | 'sourceLine'
    >;
}

export interface NodeRedCatalogNode {
    key: NodeKey;
    category: string;
    label: string;
    description: string;
    methods: string[];
}

export interface NodeRedCatalog {
    generator: 'node-red-catalog';
    version: 1;
    packageName: '@shelly/fleet-manager-node-red';
    nodes: NodeRedCatalogNode[];
    methods: NodeRedCatalogMethod[];
    /** Methods kept out of every node; the package refuses them at runtime. */
    deniedMethods: string[];
}

const PACKAGE_CATALOG_PATH = path.join(
    REPO_ROOT,
    'packages/node-red-fleet-manager/generated/catalog.json'
);

const NODE_DEFINITIONS: Record<NodeKey, Omit<NodeRedCatalogNode, 'methods'>> = {
    'fm-server': {
        key: 'fm-server',
        category: 'Fleet Manager / Core',
        label: 'FM Server',
        description:
            'Shared Fleet Manager connection and service-token configuration.'
    },
    'fm-rpc': {
        key: 'fm-rpc',
        category: 'Fleet Manager / Core',
        label: 'FM RPC',
        description: 'Expert/raw Fleet Manager RPC call node.'
    },
    'fm-target': {
        key: 'fm-target',
        category: 'Fleet Manager / Targeting',
        label: 'FM Target',
        description:
            'Builds reusable targets from devices, groups, locations, tags, or fleet scope.'
    },
    'fm-tag': {
        key: 'fm-tag',
        category: 'Fleet Manager / Targeting',
        label: 'FM Tag',
        description: 'Tag CRUD and assignment operations.'
    },
    'fm-group': {
        key: 'fm-group',
        category: 'Fleet Manager / Targeting',
        label: 'FM Group',
        description:
            'Group lookup, membership, metrics, and group-scoped targeting.'
    },
    'fm-location': {
        key: 'fm-location',
        category: 'Fleet Manager / Targeting',
        label: 'FM Location',
        description: 'Location/site/building/room lookup and targeting.'
    },
    'fm-device': {
        key: 'fm-device',
        category: 'Fleet Manager / Devices & Components',
        label: 'FM Device',
        description:
            'Device lookup, topology, setup, status, and metadata operations.'
    },
    'fm-component-catalog': {
        key: 'fm-component-catalog',
        category: 'Fleet Manager / Devices & Components',
        label: 'FM Component Catalog',
        description:
            'Discover supported components and actions for a device model.'
    },
    'fm-component-state': {
        key: 'fm-component-state',
        category: 'Fleet Manager / Devices & Components',
        label: 'FM Component State',
        description: 'Read component status and configuration.'
    },
    'fm-component-action': {
        key: 'fm-component-action',
        category: 'Fleet Manager / Devices & Components',
        label: 'FM Component Action',
        description:
            'Execute component actions such as switch, light, cover, thermostat, and camera actions.'
    },
    'fm-device-event': {
        key: 'fm-device-event',
        category: 'Fleet Manager / Devices & Components',
        label: 'FM Device Event',
        description: 'Trigger flows from device and component events.'
    },
    'fm-trigger-threshold': {
        key: 'fm-trigger-threshold',
        category: 'Fleet Manager / Triggers',
        label: 'FM Value Threshold',
        description:
            'Fires when a device status value goes above or below a limit, optionally for N seconds.'
    },
    'fm-trigger-status': {
        key: 'fm-trigger-status',
        category: 'Fleet Manager / Triggers',
        label: 'FM Online / Offline',
        description: 'Fires when a device goes online or offline.'
    },
    'fm-trigger-button': {
        key: 'fm-trigger-button',
        category: 'Fleet Manager / Triggers',
        label: 'FM Button',
        description: 'Fires on button and input events such as single_push.'
    },
    'fm-webhook-in': {
        key: 'fm-webhook-in',
        category: 'Fleet Manager / Triggers',
        label: 'FM Webhook In',
        description:
            'Starts a flow from an outside HTTP call, checked with a per-hook secret.'
    },
    'fm-schedule': {
        key: 'fm-schedule',
        category: 'Fleet Manager / Scheduling & Automation',
        label: 'FM Schedule',
        description: 'Fleet Manager schedule record operations.'
    },
    'fm-variable': {
        key: 'fm-variable',
        category: 'Fleet Manager / Scheduling & Automation',
        label: 'FM Variable',
        description: 'Persistent FM-backed flow variables and state markers.'
    },
    'fm-webhook': {
        key: 'fm-webhook',
        category: 'Fleet Manager / Scheduling & Automation',
        label: 'FM Webhook',
        description: 'Inbound and outbound webhook automation.'
    },
    'fm-script': {
        key: 'fm-script',
        category: 'Fleet Manager / Scheduling & Automation',
        label: 'FM Script',
        description: 'Script execution and management operations.'
    },
    'fm-firmware': {
        key: 'fm-firmware',
        category: 'Fleet Manager / Lifecycle Operations',
        label: 'FM Firmware',
        description: 'Firmware library and auto-update status (read only).'
    },
    'fm-backup': {
        key: 'fm-backup',
        category: 'Fleet Manager / Lifecycle Operations',
        label: 'FM Backup',
        description:
            'Device backup download, restore, and lifecycle operations.'
    },
    'fm-certificate': {
        key: 'fm-certificate',
        category: 'Fleet Manager / Lifecycle Operations',
        label: 'FM Certificate',
        description:
            'Certificate store lookup and rollout preflight (no key export or push).'
    },
    'fm-diagnostics': {
        key: 'fm-diagnostics',
        category: 'Fleet Manager / Lifecycle Operations',
        label: 'FM Diagnostics',
        description: 'Operational checks, failed jobs, and debug snapshots.'
    },
    'fm-alert': {
        key: 'fm-alert',
        category: 'Fleet Manager / Observability & Outputs',
        label: 'FM Alert',
        description: 'Alert lifecycle operations and alert event workflows.'
    },
    'fm-report': {
        key: 'fm-report',
        category: 'Fleet Manager / Observability & Outputs',
        label: 'FM Report',
        description: 'Report generation, export, scheduling, and delivery.'
    },
    'fm-energy': {
        key: 'fm-energy',
        category: 'Fleet Manager / Observability & Outputs',
        label: 'FM Energy',
        description:
            'Energy query, summary, export, and daily energy operations.'
    },
    'fm-notification': {
        key: 'fm-notification',
        category: 'Fleet Manager / Observability & Outputs',
        label: 'FM Notification',
        description: 'Notification, email, and message delivery operations.'
    },
    'fm-audit': {
        key: 'fm-audit',
        category: 'Fleet Manager / Observability & Outputs',
        label: 'FM Audit',
        description: 'Audit and authorization-audit event lookup.'
    }
};

const COMPONENT_NAMESPACES = new Set([
    'alexa',
    'ble',
    'blugw',
    'bthome',
    'button',
    'camera',
    'cct',
    'cloud',
    'cover',
    'cury',
    'dali',
    'devicepower',
    'em',
    'em1',
    'em1data',
    'emdata',
    'eth',
    'flood',
    'http',
    'humidity',
    'illuminance',
    'input',
    'ir',
    'ircode',
    'irdevice',
    'irlibrary',
    'knx',
    'kvs',
    'light',
    'matter',
    'mbrtuclient',
    'mdns',
    'modbus',
    'mqtt',
    'object',
    'ota',
    'pill',
    'pilluart',
    'pm1',
    'presence',
    'presencezone',
    'restrictions',
    'rgb',
    'rgbcct',
    'rgbw',
    'serial',
    'service',
    'shelly',
    'smoke',
    'switch',
    'sys',
    'temperature',
    'thermostat',
    'trv',
    'virtual',
    'voltmeter',
    'web',
    'wifi',
    'ws',
    'xmod'
]);

const STATE_METHOD_PATTERN =
    /^(describe|get|list|read|status|config|find|children|path|topology|capabilities|metrics|history|timeline)/i;

function componentNodeKeys(method: string): NodeKey[] {
    if (method === 'Describe') return ['fm-component-catalog'];
    if (STATE_METHOD_PATTERN.test(method)) return ['fm-component-state'];
    return ['fm-component-action'];
}

// One specific node per namespace. fm-target builds targets; it runs no method.
const NAMESPACE_NODE_KEYS: Readonly<Record<string, NodeKey>> = {
    tag: 'fm-tag',
    group: 'fm-group',
    location: 'fm-location',
    device: 'fm-device',
    schedule: 'fm-schedule',
    storage: 'fm-variable',
    variables: 'fm-variable',
    webhook: 'fm-webhook',
    script: 'fm-script',
    firmware: 'fm-firmware',
    backup: 'fm-backup',
    certificate: 'fm-certificate',
    alert: 'fm-alert',
    report: 'fm-report',
    energy: 'fm-energy',
    notification: 'fm-notification',
    channel: 'fm-notification',
    mail: 'fm-notification',
    message_text: 'fm-notification',
    notification_policy: 'fm-notification',
    audit: 'fm-audit',
    authz_audit: 'fm-audit',
    system: 'fm-diagnostics',
    fleet: 'fm-diagnostics'
};

function nodeKeysFor(namespace: string, method: string): NodeKey[] {
    const specific = NAMESPACE_NODE_KEYS[namespace];
    if (specific) return [specific];
    if (COMPONENT_NAMESPACES.has(namespace)) return componentNodeKeys(method);
    return ['fm-rpc'];
}

// One denylist: the editor hides exactly what the server refuses.
export function isDeniedMethod(namespace: string, method: string): boolean {
    return isDeniedForNodeRedService({
        method: `${namespace}.${method}`,
        params: {}
    });
}

function catalogMethods(
    describes: DescribeOutput[],
    rpc: RpcInventory,
    auth: AuthInventory
): NodeRedCatalogMethod[] {
    const rpcByMethod = rpcIndex(rpc);
    const authByMethod = authIndex(auth);
    const out: NodeRedCatalogMethod[] = [];
    for (const contract of describes) {
        if (!contract.kind) {
            // gated by apiDescribeMeta.test.ts — never emit without a kind
            throw new Error(`${contract.namespace}: namespace kind missing`);
        }
        for (const method of Object.values(contract.methods)) {
            const fullMethod = `${contract.namespace}.${method.name}`;
            const lookup = fullMethod.toLowerCase();
            const authRow = authByMethod.get(lookup);
            const rpcMethod = rpcByMethod.get(lookup);
            out.push({
                id: lookup,
                namespace: contract.namespace,
                namespaceKind: contract.kind,
                namespaceDescription: contract.description ?? '',
                method: method.name,
                fullMethod,
                nodeKeys: [
                    ...new Set([
                        'fm-rpc' as const,
                        ...nodeKeysFor(contract.namespace, method.name)
                    ])
                ],
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
                ...(method.description
                    ? {description: method.description}
                    : {}),
                ...(rpcMethod
                    ? {
                          rpc: {
                              kind: rpcMethod.kind,
                              env: rpcMethod.env,
                              permission: rpcMethod.permission,
                              ...(rpcMethod.permissionArgs
                                  ? {
                                        permissionArgs: rpcMethod.permissionArgs
                                    }
                                  : {}),
                              sourceFile: rpcMethod.sourceFile,
                              sourceLine: rpcMethod.sourceLine
                          }
                      }
                    : {})
            });
        }
    }
    return out.sort((a, b) => a.fullMethod.localeCompare(b.fullMethod));
}

function catalogNodes(methods: NodeRedCatalogMethod[]): NodeRedCatalogNode[] {
    return Object.values(NODE_DEFINITIONS).map((def) => ({
        ...def,
        methods: methods
            .filter((method) => method.nodeKeys.includes(def.key))
            .map((method) => method.fullMethod)
            .sort()
    }));
}

export async function generate(inputs?: {
    rpc?: RpcInventory;
    auth?: AuthInventory;
}): Promise<NodeRedCatalog> {
    const rpc =
        inputs?.rpc ??
        readGeneratedJson<RpcInventory>('backend-rpc-inventory.json');
    const auth =
        inputs?.auth ??
        readGeneratedJson<AuthInventory>('transport-auth-matrix.json');
    const all = catalogMethods(await loadAllDescribes(), rpc, auth);
    const methods = all.filter((method) => !isDeniedCatalogMethod(method));
    return {
        generator: 'node-red-catalog',
        version: 1,
        packageName: '@shelly/fleet-manager-node-red',
        nodes: catalogNodes(methods),
        methods,
        deniedMethods: all
            .filter(isDeniedCatalogMethod)
            .map((method) => method.fullMethod)
    };
}

function isDeniedCatalogMethod(method: NodeRedCatalogMethod): boolean {
    return isDeniedMethod(method.namespace, method.method);
}

export function writePackageCatalog(catalog: NodeRedCatalog): void {
    fs.mkdirSync(path.dirname(PACKAGE_CATALOG_PATH), {recursive: true});
    fs.writeFileSync(
        PACKAGE_CATALOG_PATH,
        `${JSON.stringify(catalog, null, 2)}\n`
    );
}

export function renderMarkdown(catalog: NodeRedCatalog): string {
    const header = provenanceHeader('Node-RED Catalog', [
        'backend/test/fixtures/golden/*.Describe.golden.json',
        'docs/generated/backend-rpc-inventory.json',
        'docs/generated/transport-auth-matrix.json'
    ]);
    const summary = [
        '## Totals',
        '',
        `- Nodes: **${catalog.nodes.length}**`,
        `- Methods: **${catalog.methods.length}**`,
        `- Denied methods (never offered as nodes): **${catalog.deniedMethods.length}**`,
        `- Package: \`${catalog.packageName}\``,
        ''
    ].join('\n');
    const nodeRows = [
        '## Node Mapping',
        '',
        '| Node | Category | Methods | Description |',
        '|---|---|---:|---|',
        ...catalog.nodes.map(
            (node) =>
                `| \`${node.key}\` | ${node.category} | ${node.methods.length} | ${node.description} |`
        ),
        ''
    ].join('\n');
    const deniedRows = [
        '## Denied Methods',
        '',
        ...catalog.deniedMethods.map((method) => `- \`${method}\``),
        ''
    ].join('\n');
    return [header, summary, nodeRows, deniedRows].join('\n');
}

async function main(): Promise<void> {
    const catalog = await generate();
    writeOutputs('node-red-catalog', catalog, renderMarkdown(catalog));
    writePackageCatalog(catalog);
    console.log(
        `[node-red-catalog] ${catalog.nodes.length} nodes | ${catalog.methods.length} methods`
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

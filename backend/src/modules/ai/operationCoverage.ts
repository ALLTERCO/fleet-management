import {createHash} from 'node:crypto';
import {McpError} from './mcpErrors';
import {
    type CoverageDecision,
    type CoverageDisposition,
    EVENT_OPERATION_COVERAGE,
    HTTP_OPERATION_COVERAGE,
    REVIEWED_CATALOG_ONLY_METHODS,
    REVIEWED_MOUNTS
} from './operationCoverageData';

export type OperationCoverageSurface = 'rpc' | 'http' | 'integration' | 'event';

export interface RpcInventoryRow {
    namespace: string;
    method: string;
    kind: string;
    env: string;
    sourceFile: string;
    sourceLine: number;
}

export interface HttpInventoryRow {
    method: string;
    path: string;
    sourceFile: string;
    sourceLine: number;
    authModel?: string;
}

export interface EventInventoryRow {
    eventName: string;
    sourceFile: string;
    sourceLine: number;
}

export interface CatalogMethodRow {
    fullMethod: string;
    safety?: {readOnlyHint?: boolean};
}

export interface OperationCoverageSnapshotInput {
    rpcInventory: {methods: RpcInventoryRow[]};
    httpInventory: {routes: HttpInventoryRow[]};
    eventInventory: {events: EventInventoryRow[]};
    catalogMethods: CatalogMethodRow[];
    webMountSource?: string;
}

export interface OperationCoverageItem {
    identity: string;
    surface: OperationCoverageSurface;
    disposition: CoverageDisposition;
    operation: string;
    effectivePath?: string;
    tool?: string;
    method?: string;
    evidence: string;
    rationale: string;
    action: string;
}

export interface OperationCoverageReport {
    schemaVersion: 2;
    status: 'complete' | 'incomplete';
    items: OperationCoverageItem[];
    unclassified: string[];
    totals: {
        items: number;
        bySurface: Record<OperationCoverageSurface, number>;
        byDisposition: Partial<Record<CoverageDisposition, number>>;
    };
}

export interface ListOperationCoverageInput {
    surface?: OperationCoverageSurface;
    disposition?: CoverageDisposition;
    query?: string;
    limit?: number;
    cursor?: string;
}

export interface ListOperationCoverageOptions {
    maxBytes?: number;
    maxRows?: number;
}

const SURFACES: readonly OperationCoverageSurface[] = [
    'rpc',
    'http',
    'integration',
    'event'
];
const DISPOSITIONS: readonly CoverageDisposition[] = [
    'mcp_catalog_method',
    'mcp_transport',
    'mcp_discovery',
    'mcp_polling_equivalent',
    'external_callback',
    'protocol_adapter',
    'browser_ui',
    'static_asset',
    'operational_endpoint',
    'identity_session',
    'catalog_excluded_internal',
    'development_only'
];
const DEFAULT_LIMIT = 25;
const ABSOLUTE_MAX_ROWS = 100;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MIN_MAX_BYTES = 512;
const ABSOLUTE_MAX_BYTES = 256 * 1024;

const SOURCE_MOUNTS: Readonly<Record<string, string>> = {
    'backend/src/modules/web/routes/apiDocs.ts': '/api/docs',
    'backend/src/modules/web/routes/assetUpload.ts': '/api',
    'backend/src/modules/web/routes/auditDownload.ts': '/api',
    'backend/src/modules/web/routes/automationHooks.ts': '/automation-hooks',
    'backend/src/modules/web/routes/authSession.ts': '/api/auth/session',
    'backend/src/modules/web/routes/backupImport.ts': '/media',
    'backend/src/modules/web/routes/device-proxy.ts': '/api/device-proxy',
    'backend/src/modules/web/routes/emailAssets.ts': '/api/notifications',
    'backend/src/modules/web/routes/firmwareUpload.ts': '/media',
    'backend/src/modules/web/routes/floorPlanUpload.ts': '/api/uploads',
    'backend/src/modules/web/routes/grafanaAlertWebhook.ts': '/api/grafana',
    'backend/src/modules/web/routes/mcp.ts': '/mcp',
    'backend/src/modules/web/routes/media.ts': '/media',
    'backend/src/modules/web/routes/nodeRedProxy.ts': '/node-red',
    'backend/src/modules/web/routes/oauthEmail.ts': '/api/oauth',
    'backend/src/modules/web/routes/providerReceipts.ts': '/api/notifications',
    'backend/src/modules/web/routes/tariffLivePush.ts': '/api',
    'backend/src/modules/web/routes/zitadelActions.ts': '/api/zitadel/actions'
};

export const OPERATION_COVERAGE_QUERY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        surface: {type: 'string', enum: [...SURFACES]},
        disposition: {type: 'string', enum: [...DISPOSITIONS]},
        query: {type: 'string', maxLength: 120},
        limit: {
            type: 'integer',
            minimum: 1,
            maximum: ABSOLUTE_MAX_ROWS,
            default: DEFAULT_LIMIT
        },
        cursor: {type: 'string', maxLength: 512}
    }
} as const;

export const OPERATION_COVERAGE_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'nextCursor', 'summary'],
    properties: {
        items: {
            type: 'array',
            maxItems: ABSOLUTE_MAX_ROWS,
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'identity',
                    'surface',
                    'disposition',
                    'operation',
                    'evidence',
                    'rationale',
                    'action'
                ],
                properties: {
                    identity: {type: 'string'},
                    surface: {type: 'string', enum: [...SURFACES]},
                    disposition: {
                        type: 'string',
                        enum: [...DISPOSITIONS]
                    },
                    operation: {type: 'string'},
                    effectivePath: {type: 'string'},
                    tool: {type: 'string'},
                    method: {type: 'string'},
                    evidence: {type: 'string'},
                    rationale: {type: 'string'},
                    action: {type: 'string'}
                }
            }
        },
        total: {type: 'integer', minimum: 0},
        nextCursor: {type: ['string', 'null']},
        summary: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'unclassified', 'returned'],
            properties: {
                status: {type: 'string', enum: ['complete', 'incomplete']},
                unclassified: {type: 'integer', minimum: 0},
                returned: {type: 'integer', minimum: 0}
            }
        }
    }
} as const;

function joinPath(mount: string | undefined, child: string): string {
    if (!mount) return child;
    if (child === '/') return mount;
    return `${mount.replace(/\/$/, '')}/${child.replace(/^\//, '')}`;
}

function evidence(sourceFile: string, sourceLine: number): string {
    return `${sourceFile}:${sourceLine}`;
}

function fromDecision(
    base: Omit<OperationCoverageItem, keyof CoverageDecision>,
    decision: CoverageDecision
): OperationCoverageItem {
    return {
        ...base,
        disposition: decision.disposition,
        ...(decision.tool ? {tool: decision.tool} : {}),
        ...(decision.method ? {method: decision.method} : {}),
        rationale: decision.rationale,
        action: decision.action
    };
}

function rpcDecision(
    row: RpcInventoryRow,
    catalogIds: ReadonlySet<string>
): CoverageDecision | undefined {
    const operation = `${row.namespace}.${row.method}`;
    if (row.env !== 'production') {
        return {
            disposition: 'development_only',
            rationale:
                'The generated inventory marks this RPC as non-production.',
            action: 'Use it only in the declared development environment.'
        };
    }
    if (catalogIds.has(operation.toLowerCase())) {
        return {
            disposition: 'mcp_catalog_method',
            tool: 'fm_read/fm_write',
            method: operation,
            rationale:
                'The method is present in the generated MCP RPC catalog.',
            action: 'Use get_api_method, then call fm_read or fm_write.'
        };
    }
    if (row.kind === 'inherited-list-methods') {
        return {
            disposition: 'mcp_discovery',
            tool: 'list_methods',
            rationale:
                'The inherited RPC enumerator is replaced by bounded MCP catalog discovery.',
            action: 'Use list_methods and get_api_method.'
        };
    }
    if (
        row.kind === 'inherited-getconfig' ||
        row.kind === 'inherited-getstatus' ||
        row.kind === 'inherited-setconfig'
    ) {
        return {
            disposition: 'catalog_excluded_internal',
            rationale:
                'This inherited component fallback has no declared Describe contract.',
            action: 'Add a typed Describe method before exposing this operation through MCP.'
        };
    }
    return undefined;
}

function httpKey(row: HttpInventoryRow): string {
    return `${row.sourceFile}|${row.method}|${row.path}`;
}

function discoverMountCounts(source: string): Map<string, number> {
    const counts = new Map<string, number>();
    const pattern = /app\.use\(\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
        const mount = match[1];
        if (!mount) continue;
        counts.set(mount, (counts.get(mount) ?? 0) + 1);
    }
    return counts;
}

function totals(items: OperationCoverageItem[]) {
    const bySurface: Record<OperationCoverageSurface, number> = {
        rpc: 0,
        http: 0,
        integration: 0,
        event: 0
    };
    const byDisposition: Partial<Record<CoverageDisposition, number>> = {};
    for (const item of items) {
        bySurface[item.surface]++;
        byDisposition[item.disposition] =
            (byDisposition[item.disposition] ?? 0) + 1;
    }
    return {items: items.length, bySurface, byDisposition};
}

export function buildOperationCoverage(
    snapshot: OperationCoverageSnapshotInput
): OperationCoverageReport {
    const catalogById = new Map(
        snapshot.catalogMethods.map((row) => [
            row.fullMethod.toLowerCase(),
            row
        ])
    );
    const catalogIds = new Set(catalogById.keys());
    const items: OperationCoverageItem[] = [];
    const unclassified: string[] = [];

    for (const row of snapshot.rpcInventory.methods) {
        const operation = `${row.namespace}.${row.method}`;
        const decision = rpcDecision(row, catalogIds);
        const identity = `rpc:${operation}:${row.env}`;
        if (!decision) {
            unclassified.push(identity);
            continue;
        }
        items.push(
            fromDecision(
                {
                    identity,
                    surface: 'rpc',
                    operation,
                    evidence: evidence(row.sourceFile, row.sourceLine)
                },
                decision
            )
        );
    }

    const inventoryRpcIds = new Set(
        snapshot.rpcInventory.methods.map((row) =>
            `${row.namespace}.${row.method}`.toLowerCase()
        )
    );
    for (const row of snapshot.catalogMethods) {
        if (!inventoryRpcIds.has(row.fullMethod.toLowerCase())) {
            if (!REVIEWED_CATALOG_ONLY_METHODS.has(row.fullMethod)) {
                unclassified.push(`catalog-without-rpc:${row.fullMethod}`);
                continue;
            }
            items.push({
                identity: `rpc:${row.fullMethod}:catalog-only`,
                surface: 'rpc',
                disposition: 'mcp_catalog_method',
                operation: row.fullMethod,
                tool: 'get_api_method',
                method: row.fullMethod,
                evidence: 'docs/generated/api-catalog.json',
                rationale:
                    'This described aggregate component is catalogued even though the RPC inventory scanner does not emit its component source.',
                action: 'Use get_api_method, then call fm_read.'
            });
        }
    }

    const observedHttpKeys = new Set<string>();
    for (const row of snapshot.httpInventory.routes) {
        const key = httpKey(row);
        observedHttpKeys.add(key);
        const decision = HTTP_OPERATION_COVERAGE.get(key);
        const identity = `http:${row.method}:${row.sourceFile}:${row.path}`;
        if (!decision) {
            unclassified.push(identity);
            continue;
        }
        items.push(
            fromDecision(
                {
                    identity,
                    surface: 'http',
                    operation: `${row.method} ${row.path}`,
                    effectivePath: joinPath(
                        SOURCE_MOUNTS[row.sourceFile],
                        row.path
                    ),
                    evidence: evidence(row.sourceFile, row.sourceLine)
                },
                decision
            )
        );
    }
    for (const key of HTTP_OPERATION_COVERAGE.keys()) {
        if (!observedHttpKeys.has(key)) unclassified.push(`stale-http:${key}`);
    }

    const observedEvents = new Set<string>();
    for (const row of snapshot.eventInventory.events) {
        observedEvents.add(row.eventName);
        const decision = EVENT_OPERATION_COVERAGE.get(row.eventName);
        const identity = `event:${row.eventName}:${row.sourceFile}:${row.sourceLine}`;
        if (!decision) {
            unclassified.push(identity);
            continue;
        }
        items.push(
            fromDecision(
                {
                    identity,
                    surface: 'event',
                    operation: row.eventName,
                    evidence: evidence(row.sourceFile, row.sourceLine)
                },
                decision
            )
        );
    }
    for (const name of EVENT_OPERATION_COVERAGE.keys()) {
        if (!observedEvents.has(name)) unclassified.push(`stale-event:${name}`);
    }

    for (const mount of REVIEWED_MOUNTS) {
        items.push(
            fromDecision(
                {
                    identity: `integration:${mount.path}`,
                    surface: 'integration',
                    operation: `MOUNT ${mount.path}`,
                    effectivePath: mount.path,
                    evidence: 'backend/src/modules/web/index.ts'
                },
                mount
            )
        );
    }
    if (snapshot.webMountSource !== undefined) {
        const observed = discoverMountCounts(snapshot.webMountSource);
        const reviewed = new Map(
            REVIEWED_MOUNTS.map((mount) => [mount.path, mount.expectedCount])
        );
        for (const [mount, count] of observed) {
            if (reviewed.get(mount) !== count) {
                unclassified.push(`mount:${mount}:observed-${count}`);
            }
        }
        for (const [mount, count] of reviewed) {
            if (observed.get(mount) !== count) {
                unclassified.push(
                    `stale-mount:${mount}:expected-${count}:observed-${observed.get(mount) ?? 0}`
                );
            }
        }
    }

    for (const item of items) {
        if (!item.method) continue;
        const catalogMethod = catalogById.get(item.method.toLowerCase());
        if (!catalogMethod) {
            unclassified.push(
                `coverage-method-not-catalogued:${item.identity}:${item.method}`
            );
            continue;
        }
        if (item.disposition === 'mcp_catalog_method') {
            item.tool = catalogMethod.safety?.readOnlyHint
                ? 'fm_read'
                : 'fm_write';
            item.action = `Call ${item.method} through ${item.tool}.`;
        }
    }

    items.sort((a, b) => a.identity.localeCompare(b.identity));
    unclassified.sort();
    return {
        schemaVersion: 2,
        status: unclassified.length === 0 ? 'complete' : 'incomplete',
        items,
        unclassified,
        totals: totals(items)
    };
}

function invalidListInput(message: string): never {
    throw new McpError('invalid_params', message, {
        tool: 'list_operation_coverage'
    });
}

function coverageUnavailable(message: string): never {
    throw new McpError('operation_unavailable', message, {
        tool: 'list_operation_coverage'
    });
}

function validateListInput(
    input: ListOperationCoverageInput
): Required<Pick<ListOperationCoverageInput, 'query' | 'limit'>> &
    Omit<ListOperationCoverageInput, 'query' | 'limit'> {
    const unknownKey = Object.keys(input).some(
        (key) =>
            !['surface', 'disposition', 'query', 'limit', 'cursor'].includes(
                key
            )
    );
    const surface = input.surface as unknown;
    const disposition = input.disposition as unknown;
    const rawQuery = input.query as unknown;
    const rawLimit = input.limit as unknown;
    const cursor = input.cursor as unknown;
    if (
        unknownKey ||
        (surface !== undefined &&
            (typeof surface !== 'string' ||
                !SURFACES.includes(surface as OperationCoverageSurface))) ||
        (disposition !== undefined &&
            (typeof disposition !== 'string' ||
                !DISPOSITIONS.includes(disposition as CoverageDisposition))) ||
        (rawQuery !== undefined && typeof rawQuery !== 'string') ||
        (rawLimit !== undefined &&
            (typeof rawLimit !== 'number' ||
                !Number.isInteger(rawLimit) ||
                rawLimit < 1 ||
                rawLimit > ABSOLUTE_MAX_ROWS)) ||
        (cursor !== undefined &&
            (typeof cursor !== 'string' || cursor.length > 512))
    ) {
        return invalidListInput('Invalid operation coverage parameters');
    }
    const query =
        typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
    if (query.length > 120) {
        return invalidListInput('Invalid operation coverage parameters');
    }
    return {
        ...(surface !== undefined
            ? {surface: surface as OperationCoverageSurface}
            : {}),
        ...(disposition !== undefined
            ? {disposition: disposition as CoverageDisposition}
            : {}),
        ...(cursor !== undefined ? {cursor: cursor as string} : {}),
        query,
        limit: typeof rawLimit === 'number' ? rawLimit : DEFAULT_LIMIT
    };
}

function filterKey(input: ListOperationCoverageInput): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                surface: input.surface ?? null,
                disposition: input.disposition ?? null,
                query: input.query ?? ''
            })
        )
        .digest('base64url')
        .slice(0, 16);
}

function decodeCursor(cursor: string | undefined, key: string): number {
    if (cursor === undefined) return 0;
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        return invalidListInput('Invalid or stale operation coverage cursor');
    }
    let value: unknown;
    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
        if (Buffer.from(decoded).toString('base64url') !== cursor) {
            return invalidListInput(
                'Invalid or stale operation coverage cursor'
            );
        }
        value = JSON.parse(decoded);
    } catch {
        return invalidListInput('Invalid or stale operation coverage cursor');
    }
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
            (name) => name !== 'key' && name !== 'offset'
        ) ||
        (value as {key?: unknown}).key !== key ||
        typeof (value as {offset?: unknown}).offset !== 'number' ||
        !Number.isInteger((value as {offset: number}).offset) ||
        !Number.isSafeInteger((value as {offset: number}).offset) ||
        (value as {offset: number}).offset < 1
    ) {
        return invalidListInput('Invalid or stale operation coverage cursor');
    }
    return Number((value as {offset: number}).offset);
}

function encodeCursor(offset: number, key: string): string {
    return Buffer.from(JSON.stringify({offset, key})).toString('base64url');
}

function itemMatches(
    item: OperationCoverageItem,
    input: ReturnType<typeof validateListInput>
): boolean {
    if (input.surface && item.surface !== input.surface) return false;
    if (input.disposition && item.disposition !== input.disposition)
        return false;
    if (!input.query) return true;
    return `${item.identity} ${item.operation} ${item.method ?? ''} ${item.rationale} ${item.action}`
        .toLowerCase()
        .includes(input.query);
}

export function listOperationCoverage(
    report: OperationCoverageReport,
    rawInput: ListOperationCoverageInput = {},
    options: ListOperationCoverageOptions = {}
) {
    const input = validateListInput(rawInput);
    const configuredMaxRows = options.maxRows ?? ABSOLUTE_MAX_ROWS;
    if (!Number.isInteger(configuredMaxRows) || configuredMaxRows < 1) {
        return coverageUnavailable(
            'Operation coverage row limit is unavailable'
        );
    }
    const maxRows = Math.min(ABSOLUTE_MAX_ROWS, configuredMaxRows);
    const requestedRows = Math.min(input.limit, maxRows);
    const configuredMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (
        !Number.isInteger(configuredMaxBytes) ||
        configuredMaxBytes < MIN_MAX_BYTES
    ) {
        return coverageUnavailable(
            'Operation coverage byte limit is unavailable'
        );
    }
    const maxBytes = Math.min(ABSOLUTE_MAX_BYTES, configuredMaxBytes);
    const filtered = report.items.filter((item) => itemMatches(item, input));
    const key = filterKey(input);
    const offset = decodeCursor(input.cursor, key);
    if (input.cursor !== undefined && offset >= filtered.length) {
        return invalidListInput('Invalid or stale operation coverage cursor');
    }
    const items: OperationCoverageItem[] = [];
    while (
        items.length < requestedRows &&
        offset + items.length < filtered.length
    ) {
        const candidate = filtered[offset + items.length];
        const next = [...items, candidate];
        const probe = {
            items: next,
            total: filtered.length,
            nextCursor: 'x'.repeat(96),
            summary: {
                status: report.status,
                unclassified: report.unclassified.length,
                returned: next.length
            }
        };
        if (Buffer.byteLength(JSON.stringify(probe), 'utf8') > maxBytes) break;
        items.push(candidate);
    }
    if (items.length === 0 && offset < filtered.length) {
        return coverageUnavailable(
            'Operation coverage response limit cannot fit one item'
        );
    }
    const nextOffset = offset + items.length;
    return {
        items,
        total: filtered.length,
        nextCursor:
            nextOffset < filtered.length ? encodeCursor(nextOffset, key) : null,
        summary: {
            status: report.status,
            unclassified: report.unclassified.length,
            returned: items.length
        }
    };
}

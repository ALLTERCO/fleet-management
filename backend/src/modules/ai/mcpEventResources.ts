import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {getJwtToken} from '../../config/jwtSecret';
import RpcError from '../../rpc/RpcError';
import type {readJournalPage} from './eventJournal';
import {McpError} from './mcpErrors';
import type {OperationReconciliationRead} from './operationReconciliation';
import {redactSecrets, untrustedMarker} from './readEnvelope';
import type {OperateCaller} from './types';

export interface McpEventResourcePort {
    read(uri: string): Promise<{uri: string; mimeType: string; text: string}>;
    // Only on a session with a durable event stream; a stateless client
    // subscribes through subscriptions/listen instead.
    subscribe?(uri: string): Promise<void>;
    unsubscribe?(uri: string): Promise<void>;
}

export interface McpEventPollResult {
    cursor: string;
    changed: boolean;
    gap?: boolean;
}

export const MCP_EVENT_RESOURCE = {
    uri: 'fm://events',
    name: 'Fleet event history',
    description:
        'Retained job and observed device events visible to the current credential.',
    mimeType: 'application/json'
};

export const MCP_EVENT_TEMPLATE = {
    uriTemplate: 'fm://events{?deviceId,groupId,jobId,cursor}',
    name: 'Filtered Fleet event history',
    description:
        'Filter by device, group, or job and follow the returned cursor. Retention gaps are explicit.',
    mimeType: 'application/json'
};

/** Whether a URI names the event history rather than a document. */
export function isMcpEventUri(uri: string): boolean {
    return uri.startsWith(MCP_EVENT_RESOURCE.uri);
}

const PAGE_SIZE = 50;
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_URI_LENGTH = 4096;
const MAX_CONTENT_BYTES = 256 * 1024;

export function parseMcpEventUri(uri: string) {
    if (typeof uri !== 'string' || uri.length > MAX_URI_LENGTH) {
        throw new McpError('invalid_params', 'Invalid event resource URI');
    }
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        throw new McpError('invalid_params', 'Invalid event resource URI');
    }
    if (
        url.protocol !== 'fm:' ||
        url.host !== 'events' ||
        (url.pathname !== '' && url.pathname !== '/') ||
        url.username ||
        url.password ||
        url.hash
    )
        throw new McpError('invalid_params', 'Invalid event resource URI');
    for (const key of url.searchParams.keys()) {
        if (
            !['deviceId', 'groupId', 'jobId', 'cursor'].includes(key) ||
            url.searchParams.getAll(key).length !== 1
        ) {
            throw new McpError(
                'invalid_params',
                'Unknown or repeated event filter'
            );
        }
    }
    const deviceId = url.searchParams.get('deviceId') ?? undefined;
    const groupId = url.searchParams.get('groupId') ?? undefined;
    const jobId = url.searchParams.get('jobId') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    if (
        (deviceId !== undefined && !/^[\w:.-]{1,128}$/.test(deviceId)) ||
        (groupId !== undefined &&
            (!/^[1-9]\d{0,15}$/.test(groupId) ||
                !Number.isSafeInteger(Number(groupId)))) ||
        (jobId !== undefined &&
            !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
                jobId
            )) ||
        [deviceId, groupId, jobId].filter(Boolean).length > 1 ||
        cursor === ''
    ) {
        throw new McpError('invalid_params', 'Invalid event filters');
    }
    const query = new URLSearchParams();
    if (deviceId) query.set('deviceId', deviceId);
    if (groupId) query.set('groupId', groupId);
    if (jobId) query.set('jobId', jobId);
    return {
        deviceId,
        groupId,
        jobId,
        cursor,
        canonicalUri: `fm://events${query.size ? `?${query}` : ''}`
    };
}

function signature(encoded: string, secret: string): string {
    return createHmac('sha256', secret)
        .update(`mcp-event-feed-v1:${encoded}`)
        .digest('base64url');
}

function denied(error: unknown): boolean {
    if (error instanceof McpError) {
        return [
            'permission_denied',
            'namespace_not_allowed',
            'sensitive_namespace',
            'method_not_found'
        ].includes(error.reason);
    }
    return [1001, 1002, -32000, -32900].includes(RpcError.codeOf(error) ?? 0);
}

export function createMcpEventResources(
    caller: OperateCaller,
    authorizedRead: OperationReconciliationRead,
    dependencies: {
        readPage: typeof readJournalPage;
        now?: () => number;
        secret?: () => string;
    }
) {
    const readPage = dependencies.readPage;
    const now = dependencies.now ?? Date.now;
    const secret = dependencies.secret ?? getJwtToken;
    if (!caller.organizationId || !caller.userId || !caller.credentialId) {
        throw new McpError(
            'permission_denied',
            'Event history requires a tenant-bound credential'
        );
    }
    const organizationId = caller.organizationId;
    function binding(uri: string): string {
        return createHash('sha256')
            .update(
                JSON.stringify([
                    organizationId,
                    caller.userId,
                    caller.credentialId,
                    uri
                ])
            )
            .digest('hex');
    }
    function encode(afterId: string, uri: string): string {
        const encoded = Buffer.from(
            JSON.stringify({
                version: 1,
                afterId,
                binding: binding(uri),
                expires: now() + CURSOR_TTL_MS
            })
        ).toString('base64url');
        return `${encoded}.${signature(encoded, secret())}`;
    }
    function decode(
        cursor: string | undefined,
        uri: string
    ): string | undefined {
        if (cursor === undefined) return undefined;
        const [encoded, mac, extra] = cursor.split('.');
        if (!encoded || !mac || extra !== undefined)
            throw new McpError('invalid_params', 'Invalid event cursor');
        const expected = Buffer.from(signature(encoded, secret()));
        const provided = Buffer.from(mac);
        if (
            expected.length !== provided.length ||
            !timingSafeEqual(expected, provided)
        ) {
            throw new McpError('invalid_params', 'Invalid event cursor');
        }
        let value: Record<string, unknown>;
        try {
            value = JSON.parse(
                Buffer.from(encoded, 'base64url').toString('utf8')
            );
        } catch {
            throw new McpError('invalid_params', 'Invalid event cursor');
        }
        if (
            value?.version !== 1 ||
            value.binding !== binding(uri) ||
            typeof value.afterId !== 'string' ||
            !/^\d{1,20}$/.test(value.afterId) ||
            typeof value.expires !== 'number' ||
            value.expires <= now()
        ) {
            throw new McpError(
                'invalid_params',
                'Expired or mismatched event cursor'
            );
        }
        return value.afterId;
    }
    async function authorize(method: string, params: Record<string, unknown>) {
        const result = await authorizedRead({method, params});
        if (
            result.truncated ||
            result.method.toLowerCase() !== method.toLowerCase()
        ) {
            throw new McpError(
                'operation_unavailable',
                'Incomplete event authorization evidence'
            );
        }
    }
    function authorizeCached(
        method: string,
        params: Record<string, unknown>,
        grants?: Map<string, Promise<void>>
    ): Promise<void> {
        if (!grants) return authorize(method, params);
        const key = JSON.stringify([method, params]);
        let grant = grants.get(key);
        if (!grant) {
            grant = authorize(method, params);
            grants.set(key, grant);
        }
        return grant;
    }
    async function validate(uri: string, grants?: Map<string, Promise<void>>) {
        const filter = parseMcpEventUri(uri);
        decode(filter.cursor, filter.canonicalUri);
        if (filter.deviceId)
            await authorizeCached(
                'device.GetInfo',
                {shellyID: filter.deviceId},
                grants
            );
        if (filter.groupId)
            await authorizeCached(
                'Group.Get',
                {id: Number(filter.groupId)},
                grants
            );
        if (filter.jobId)
            await authorizeCached('Job.Get', {jobId: filter.jobId}, grants);
    }
    async function page(uri: string, pollingCursor?: string) {
        const filter = parseMcpEventUri(uri);
        const afterId = decode(
            pollingCursor ?? filter.cursor,
            filter.canonicalUri
        );
        const grants = new Map<string, Promise<void>>();
        await validate(uri, grants);
        const result = await readPage({
            organizationId,
            afterId,
            deviceIds: filter.deviceId ? [filter.deviceId] : undefined,
            groupIds: filter.groupId ? [filter.groupId] : undefined,
            jobIds: filter.jobId ? [filter.jobId] : undefined,
            limit: PAGE_SIZE
        });
        const visible: unknown[] = [];
        let bytes = 0;
        let lastId = afterId ?? '0';
        let capped = false;
        async function allowed(
            method: string,
            params: Record<string, unknown>
        ) {
            return authorizeCached(method, params, grants)
                .then(() => true)
                .catch((error: unknown) => {
                    if (denied(error)) return false;
                    throw error;
                });
        }
        for (const row of result.rows) {
            let canRead = !row.userId || row.userId === caller.userId;
            if (
                canRead &&
                (row.resourceKind === 'job' || row.resourceKind === 'job-unit')
            ) {
                const jobId =
                    row.resourceKind === 'job' ? row.resourceId : row.jobId;
                canRead =
                    !!jobId &&
                    (await allowed('Job.Get', {jobId, kind: row.jobKind}));
            } else if (canRead && row.resourceKind === 'device') {
                canRead = row.deviceIds.length > 0;
            } else if (canRead && row.resourceKind === 'group') {
                const groupId = Number(row.resourceId);
                canRead =
                    /^[1-9]\d{0,15}$/.test(row.resourceId) &&
                    Number.isSafeInteger(groupId) &&
                    (await allowed('Group.Get', {id: groupId}));
            } else canRead = false;
            for (const deviceId of canRead ? row.deviceIds : []) {
                if (!(await allowed('device.GetInfo', {shellyID: deviceId}))) {
                    canRead = false;
                    break;
                }
            }
            if (canRead) {
                // Journal payloads are device and job text, so an event read
                // hides secrets exactly as fm_read does.
                const shown = redactSecrets(row);
                const size = Buffer.byteLength(JSON.stringify(shown));
                if (bytes + size > MAX_CONTENT_BYTES) {
                    capped = true;
                    break;
                }
                bytes += size;
                visible.push(shown);
            }
            lastId = row.id;
        }
        const cursor = encode(
            capped ? lastId : result.nextAfterId,
            filter.canonicalUri
        );
        return {
            // Event payloads carry device and job text as it was reported.
            ...untrustedMarker({events: visible}),
            events: visible,
            cursor,
            historyGap: result.gap,
            nextUri: `${filter.canonicalUri}${filter.canonicalUri.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
        };
    }
    return {
        validate,
        async read(uri: string) {
            return {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(await page(uri))
            };
        },
        async poll(uri: string, cursor?: string): Promise<McpEventPollResult> {
            const result = await page(uri, cursor);
            return {
                cursor: result.cursor,
                changed: result.events.length > 0,
                gap: result.historyGap
            };
        }
    };
}

import {createHash, randomUUID} from 'node:crypto';
import type {Redis} from 'ioredis';
import {tuning} from '../../config';
import type {
    McpEventStreamsPort,
    McpReplay,
    McpStreamFrame,
    McpStreamPrincipal,
    McpStreamSession,
    McpStreamSubscription
} from './ports';

export type {
    McpReplay,
    McpStreamFrame,
    McpStreamPrincipal,
    McpStreamSession,
    McpStreamSubscription
} from './ports';

const MAX_SUBSCRIPTIONS = 32;
const MAX_RETAINED_MESSAGES = 256;
const MAX_FRAME_BYTES = 16 * 1024;
const READER_LEASE_MS = 5_000;

interface SessionRecord extends McpStreamPrincipal {
    id: string;
    binding: string;
    expiresAtMs: number;
}

function principalBinding(principal: McpStreamPrincipal): string {
    return createHash('sha256')
        .update(
            JSON.stringify([
                principal.username,
                principal.userId ?? null,
                principal.organizationId,
                principal.credentialId
            ])
        )
        .digest('hex');
}

function sessionTtlMs(): number {
    return tuning.mcp.sessionTtlMin * 60_000;
}

function sessionKey(id: string): string {
    return `${tuning.redis.keyPrefix}:mcp:event-session:${id}`;
}

function sessionIndexKey(): string {
    return `${tuning.redis.keyPrefix}:mcp:event-session-index`;
}

function subscriptionsKey(id: string): string {
    return `${tuning.redis.keyPrefix}:mcp:event-subscriptions:${id}`;
}

function streamKey(id: string): string {
    return `${tuning.redis.keyPrefix}:mcp:event-stream:${id}`;
}

function readerLeaseKey(id: string): string {
    return `${tuning.redis.keyPrefix}:mcp:event-reader:${id}`;
}

function credentialIsCurrent(
    principal: McpStreamPrincipal,
    nowMs = Date.now()
): boolean {
    return (
        principal.credentialExpiresAtMs === undefined ||
        principal.credentialExpiresAtMs > nowMs
    );
}

function samePrincipal(
    stored: McpStreamPrincipal,
    current: McpStreamPrincipal
): boolean {
    return (
        stored.username === current.username &&
        stored.userId === current.userId &&
        stored.organizationId === current.organizationId &&
        stored.credentialId === current.credentialId
    );
}

function parseRecord(raw: string): SessionRecord | undefined {
    try {
        const value = JSON.parse(raw) as Partial<SessionRecord>;
        if (
            typeof value.id !== 'string' ||
            typeof value.binding !== 'string' ||
            typeof value.username !== 'string' ||
            typeof value.credentialId !== 'string' ||
            typeof value.expiresAtMs !== 'number'
        ) {
            return undefined;
        }
        return value as SessionRecord;
    } catch {
        return undefined;
    }
}

export async function createMcpStreamSession(
    principal: McpStreamPrincipal,
    redis: Redis,
    id: string = randomUUID()
): Promise<string> {
    if (!credentialIsCurrent(principal)) {
        throw new Error('MCP credential has expired');
    }
    const expiresAtMs = Math.min(
        Date.now() + sessionTtlMs(),
        principal.credentialExpiresAtMs ?? Number.POSITIVE_INFINITY
    );
    const ttlMs = Math.max(1, expiresAtMs - Date.now());
    const record: SessionRecord = {
        ...principal,
        id,
        binding: principalBinding(principal),
        expiresAtMs
    };
    const created = (await redis.eval(
        `redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[6])
return 1`,
        2,
        sessionKey(id),
        sessionIndexKey(),
        String(Date.now()),
        String(tuning.mcp.maxSessions),
        JSON.stringify(record),
        String(ttlMs),
        String(expiresAtMs),
        id
    )) as number;
    if (created !== 1) throw new Error('MCP session limit reached');
    return id;
}

export async function getMcpStreamSession(
    id: string | undefined,
    principal: McpStreamPrincipal,
    redis: Redis,
    touch = true
): Promise<McpStreamSession | undefined> {
    if (!id || !credentialIsCurrent(principal)) return undefined;
    const store = redis;
    const stored = await store.get(sessionKey(id));
    const record = parseRecord(stored ?? '');
    if (!record || !samePrincipal(record, principal)) return undefined;
    if (touch) {
        const expiresAtMs = Math.min(
            Date.now() + sessionTtlMs(),
            record.credentialExpiresAtMs ?? Number.POSITIVE_INFINITY
        );
        const ttlMs = Math.max(1, expiresAtMs - Date.now());
        const touched = (await store.eval(
            `local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.binding ~= ARGV[1] then return 0 end
record.expiresAtMs = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
redis.call('ZADD', KEYS[4], ARGV[4], ARGV[5])
return 1`,
            4,
            sessionKey(id),
            subscriptionsKey(id),
            streamKey(id),
            sessionIndexKey(),
            record.binding,
            String(expiresAtMs),
            String(ttlMs),
            String(expiresAtMs),
            id
        )) as number;
        if (touched !== 1) return undefined;
        record.expiresAtMs = expiresAtMs;
    }
    return record;
}

export async function deleteMcpStreamSession(
    id: string,
    principal: McpStreamPrincipal,
    redis: Redis
): Promise<boolean> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store, false))) return false;
    const deleted =
        (await store.del(sessionKey(id), subscriptionsKey(id), streamKey(id))) >
        0;
    await store.zrem(sessionIndexKey(), id);
    return deleted;
}

export async function subscribeMcpStream(
    id: string,
    principal: McpStreamPrincipal,
    subscription: McpStreamSubscription,
    redis: Redis
): Promise<void> {
    const store = redis;
    const session = await getMcpStreamSession(id, principal, store);
    if (!session) throw new Error('Unknown or unauthorized MCP session');
    const key = subscriptionsKey(id);
    const result = (await store.eval(
        `if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`,
        1,
        key,
        subscription.uri,
        subscription.cursor ?? '',
        String(MAX_SUBSCRIPTIONS),
        String(Math.max(1, session.expiresAtMs - Date.now()))
    )) as number;
    if (result !== 1) throw new Error('MCP subscription limit reached');
}

export async function unsubscribeMcpStream(
    id: string,
    principal: McpStreamPrincipal,
    uri: string,
    redis: Redis
): Promise<boolean> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store))) return false;
    return (await store.hdel(subscriptionsKey(id), uri)) === 1;
}

export async function listMcpStreamSubscriptions(
    id: string,
    principal: McpStreamPrincipal,
    redis: Redis
): Promise<McpStreamSubscription[]> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store))) return [];
    const values = await store.hgetall(subscriptionsKey(id));
    return Object.entries(values).map(([uri, cursor]) => ({
        uri,
        ...(cursor ? {cursor} : {})
    }));
}

export async function updateMcpSubscriptionCursor(
    id: string,
    principal: McpStreamPrincipal,
    uri: string,
    cursor: string,
    redis: Redis,
    readerOwner?: string
): Promise<boolean> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store))) return false;
    const updated = (await store.eval(
        `${readerOwner ? "if redis.call('GET', KEYS[2]) ~= ARGV[3] then return -1 end" : ''}
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return 1`,
        readerOwner ? 2 : 1,
        subscriptionsKey(id),
        ...(readerOwner ? [readerLeaseKey(id)] : []),
        uri,
        cursor,
        ...(readerOwner ? [readerOwner] : [])
    )) as number;
    return updated === 1;
}

export async function appendMcpStreamFrame(
    id: string,
    principal: McpStreamPrincipal,
    payload: unknown,
    redis: Redis,
    readerOwner?: string
): Promise<string> {
    const store = redis;
    const session = await getMcpStreamSession(id, principal, store);
    if (!session) throw new Error('Unknown or unauthorized MCP session');
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) {
        throw new Error('MCP stream frame exceeds retained frame limit');
    }
    const eventId = readerOwner
        ? ((await store.eval(
              `if redis.call('GET', KEYS[2]) ~= ARGV[1] then return false end
return redis.call('XADD', KEYS[1], 'MAXLEN', '=', ARGV[2], '*', 'payload', ARGV[3])`,
              2,
              streamKey(id),
              readerLeaseKey(id),
              readerOwner,
              String(MAX_RETAINED_MESSAGES),
              encoded
          )) as string | null)
        : ((await store.xadd(
              streamKey(id),
              'MAXLEN',
              '=',
              String(MAX_RETAINED_MESSAGES),
              '*',
              'payload',
              encoded
          )) as string);
    if (!eventId) throw new Error('MCP event reader lease was lost');
    await store.pexpire(
        streamKey(id),
        Math.max(1, session.expiresAtMs - Date.now())
    );
    return eventId;
}

function streamIdBefore(left: string, right: string): boolean {
    const [leftMs, leftSeq] = left.split('-').map(Number);
    const [rightMs, rightSeq] = right.split('-').map(Number);
    return leftMs < rightMs || (leftMs === rightMs && leftSeq < rightSeq);
}

function frameFromEntry(entry: [string, string[]]): McpStreamFrame | undefined {
    const payloadAt = entry[1].indexOf('payload');
    if (payloadAt < 0 || payloadAt + 1 >= entry[1].length) return undefined;
    try {
        return {id: entry[0], payload: JSON.parse(entry[1][payloadAt + 1])};
    } catch {
        return undefined;
    }
}

export async function replayMcpStreamFrames(
    id: string,
    principal: McpStreamPrincipal,
    afterId: string | undefined,
    redis: Redis
): Promise<McpReplay> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store))) {
        throw new Error('Unknown or unauthorized MCP session');
    }
    const first = (await store.xrange(streamKey(id), '-', '+', 'COUNT', 1)) as [
        string,
        string[]
    ][];
    const gap = Boolean(
        afterId && first[0] && streamIdBefore(afterId, first[0][0])
    );
    const entries = (await store.xrange(
        streamKey(id),
        afterId ? `(${afterId}` : '-',
        '+',
        'COUNT',
        MAX_RETAINED_MESSAGES
    )) as [string, string[]][];
    return {
        frames: entries.map(frameFromEntry).filter(Boolean) as McpStreamFrame[],
        gap
    };
}

export async function acquireMcpStreamReader(
    id: string,
    principal: McpStreamPrincipal,
    owner: string,
    redis: Redis
): Promise<boolean> {
    const store = redis;
    if (!(await getMcpStreamSession(id, principal, store))) return false;
    // No NX: a resuming client replaces a stream the server has not seen drop.
    // The old reader stops at its next lease check.
    return (
        (await store.set(readerLeaseKey(id), owner, 'PX', READER_LEASE_MS)) ===
        'OK'
    );
}

export async function renewMcpStreamReader(
    id: string,
    owner: string,
    redis: Redis
): Promise<boolean> {
    const renewed = (await redis.eval(
        `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`,
        1,
        readerLeaseKey(id),
        owner,
        String(READER_LEASE_MS)
    )) as number;
    return renewed === 1;
}

export async function ownsMcpStreamReader(
    id: string,
    owner: string,
    redis: Redis
): Promise<boolean> {
    return (await redis.get(readerLeaseKey(id))) === owner;
}

export async function releaseMcpStreamReader(
    id: string,
    owner: string,
    redis: Redis
): Promise<void> {
    await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`,
        1,
        readerLeaseKey(id),
        owner
    );
}

export const MCP_EVENT_STREAM_LIMITS = {
    maxSubscriptions: MAX_SUBSCRIPTIONS,
    maxRetainedMessages: MAX_RETAINED_MESSAGES,
    maxFrameBytes: MAX_FRAME_BYTES
} as const;

export function createMcpEventStreamsStore(redis: Redis): McpEventStreamsPort {
    return {
        createSession: (principal, id) =>
            createMcpStreamSession(principal, redis, id),
        getSession: (id, principal, touch) =>
            getMcpStreamSession(id, principal, redis, touch),
        deleteSession: (id, principal) =>
            deleteMcpStreamSession(id, principal, redis),
        subscribe: (id, principal, subscription) =>
            subscribeMcpStream(id, principal, subscription, redis),
        unsubscribe: (id, principal, uri) =>
            unsubscribeMcpStream(id, principal, uri, redis),
        listSubscriptions: (id, principal) =>
            listMcpStreamSubscriptions(id, principal, redis),
        updateCursor: (id, principal, uri, cursor, readerOwner) =>
            updateMcpSubscriptionCursor(
                id,
                principal,
                uri,
                cursor,
                redis,
                readerOwner
            ),
        appendFrame: (id, principal, payload, readerOwner) =>
            appendMcpStreamFrame(id, principal, payload, redis, readerOwner),
        replay: (id, principal, afterId) =>
            replayMcpStreamFrames(id, principal, afterId, redis),
        acquireReader: (id, principal, owner) =>
            acquireMcpStreamReader(id, principal, owner, redis),
        renewReader: (id, owner) => renewMcpStreamReader(id, owner, redis),
        ownsReader: (id, owner) => ownsMcpStreamReader(id, owner, redis),
        releaseReader: (id, owner) => releaseMcpStreamReader(id, owner, redis),
        available: () => true
    };
}

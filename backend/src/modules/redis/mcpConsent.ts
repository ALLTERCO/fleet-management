// Redis adapters for MCP consent state: remembered approvals, single-use
// confirmation claims and elicitation prompts waiting for a human. Shared by
// every backend instance, so a yes, a revoke or a used token holds everywhere.

import {createHash} from 'node:crypto';
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type {
    McpConfirmationClaimsPort,
    McpElicitationDelivery,
    McpElicitationSession,
    McpElicitationsPort,
    McpElicitationWait,
    McpStandingApprovalRecord,
    McpStandingApprovalScope,
    McpStandingApprovalsPort
} from './ports';
import type {RedisPubSub} from './RedisPubSub';

const logger = log4js.getLogger('mcp-consent');

// A claim outlives its token by this much, so an instance whose clock runs
// behind still finds the claim while it would accept the token.
const CLAIM_CLOCK_SKEW_MS = 60_000;

function prefix(): string {
    return `${tuning.redis.keyPrefix}:mcp`;
}

function digest(parts: readonly string[]): string {
    return createHash('sha256')
        .update(JSON.stringify(parts))
        .digest('hex')
        .slice(0, 32);
}

const approvalKey = (id: string) => `${prefix()}:approval:${id}`;
const approvalIndexKey = () => `${prefix()}:approvals`;
const approvalScopeKey = (scope: McpStandingApprovalScope) =>
    scope.userId === undefined
        ? `${prefix()}:approvals:org:${digest([scope.organizationId])}`
        : `${prefix()}:approvals:user:${digest([scope.organizationId, scope.userId])}`;
const claimKey = (tokenDigest: string) =>
    `${prefix()}:confirm-claim:${tokenDigest}`;
const sessionKey = (id: string) => `${prefix()}:elicit-session:${id}`;
const sessionIndexKey = () => `${prefix()}:elicit-session-index`;
const waitsKey = (sessionId: string) => `${prefix()}:elicit-waits:${sessionId}`;
const deliveryChannel = (instanceId: string) =>
    `${tuning.redis.pubsubChannelPrefix}:mcp-elicit:${instanceId}`;

// Indexes are scored by expiry, so pruning by score drops dead members and the
// key itself expires with its last member.
const GRANT_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4])
if not redis.call('ZSCORE', KEYS[2], ARGV[3]) and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])
for i = 2, 4 do
  redis.call('ZADD', KEYS[i], ARGV[2], ARGV[3])
  local last = redis.call('ZRANGE', KEYS[i], -1, -1, 'WITHSCORES')
  redis.call('PEXPIREAT', KEYS[i], last[2])
end
return 1
`.trim();

// Compare-and-delete: a re-grant between the read and this call is kept.
const REVOKE_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
for i = 2, 4 do redis.call('ZREM', KEYS[i], ARGV[2]) end
return 1
`.trim();

const CREATE_SESSION_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
if not redis.call('ZSCORE', KEYS[2], ARGV[5]) and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1
`.trim();

const GET_SESSION_LUA = `
local value = redis.call('GET', KEYS[1])
if not value then return false end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[1])
return value
`.trim();

const DELETE_SESSION_LUA = `
local value = redis.call('GET', KEYS[1])
if not value or cjson.decode(value).binding ~= ARGV[2] then return false end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
local waits = redis.call('HVALS', KEYS[3])
redis.call('DEL', KEYS[3])
return waits
`.trim();

const REGISTER_WAIT_LUA = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
return 1
`.trim();

// Only the owner may take a wait, and an expired one is dropped, not returned.
const TAKE_WAIT_LUA = `
local value = redis.call('HGET', KEYS[1], ARGV[1])
if not value then return false end
local wait = cjson.decode(value)
if wait.binding ~= ARGV[2] then return false end
redis.call('HDEL', KEYS[1], ARGV[1])
if tonumber(wait.expiresAtMs) <= tonumber(ARGV[3]) then return false end
return value
`.trim();

function isRecordOf<T>(
    value: unknown,
    fields: Readonly<Record<string, 'string' | 'number' | 'boolean'>>
): value is T {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return Object.entries(fields).every(
        ([field, type]) => typeof record[field] === type
    );
}

function parseAs<T>(
    raw: string | null,
    fields: Readonly<Record<string, 'string' | 'number' | 'boolean'>>,
    what: string
): T | null {
    if (raw === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        value = undefined;
    }
    if (isRecordOf<T>(value, fields)) return value;
    logger.warn('discarding a malformed MCP %s record', what);
    return null;
}

const APPROVAL_FIELDS = {
    id: 'string',
    organizationId: 'string',
    userId: 'string',
    username: 'string',
    method: 'string',
    subject: 'string',
    scope: 'string',
    grantedAtMs: 'number',
    expiresAtMs: 'number'
} as const;
const SESSION_FIELDS = {
    id: 'string',
    binding: 'string',
    elicitation: 'boolean'
} as const;
const WAIT_FIELDS = {
    sessionId: 'string',
    requestId: 'string',
    binding: 'string',
    instanceId: 'string',
    expiresAtMs: 'number'
} as const;
const DELIVERY_FIELDS = {
    instanceId: 'string',
    sessionId: 'string',
    requestId: 'string'
} as const;

const parseApproval = (raw: string | null) =>
    parseAs<McpStandingApprovalRecord>(raw, APPROVAL_FIELDS, 'approval');
const parseSession = (raw: string | null) =>
    parseAs<McpElicitationSession>(raw, SESSION_FIELDS, 'elicitation session');
const parseWait = (raw: string | null) =>
    parseAs<McpElicitationWait>(raw, WAIT_FIELDS, 'elicitation wait');

function inScope(
    record: McpStandingApprovalRecord,
    scope: McpStandingApprovalScope
): boolean {
    return (
        record.organizationId === scope.organizationId &&
        (scope.userId === undefined || record.userId === scope.userId)
    );
}

function approvalKeys(record: McpStandingApprovalRecord): string[] {
    return [
        approvalKey(record.id),
        approvalIndexKey(),
        approvalScopeKey({organizationId: record.organizationId}),
        approvalScopeKey({
            organizationId: record.organizationId,
            userId: record.userId
        })
    ];
}

export function createMcpStandingApprovalsStore(
    redis: Redis
): McpStandingApprovalsPort {
    return {
        async grant(record, maxTotal) {
            const stored = await redis.eval(
                GRANT_LUA,
                4,
                ...approvalKeys(record),
                JSON.stringify(record),
                record.expiresAtMs,
                record.id,
                Date.now(),
                maxTotal
            );
            return Number(stored) === 1;
        },
        async get(id) {
            return parseApproval(await redis.get(approvalKey(id)));
        },
        async list(scope) {
            const now = Date.now();
            const index = approvalScopeKey(scope);
            await redis.zremrangebyscore(index, '-inf', now);
            const ids = await redis.zrange(index, 0, -1);
            if (ids.length === 0) return [];
            const raws = await redis.mget(ids.map(approvalKey));
            return raws
                .map(parseApproval)
                .filter(
                    (record): record is McpStandingApprovalRecord =>
                        record !== null &&
                        record.expiresAtMs > now &&
                        inScope(record, scope)
                )
                .sort((a, b) => a.grantedAtMs - b.grantedAtMs);
        },
        async revoke(id, scope) {
            const raw = await redis.get(approvalKey(id));
            const record = parseApproval(raw);
            if (!record || !inScope(record, scope)) return false;
            const removed = await redis.eval(
                REVOKE_LUA,
                4,
                ...approvalKeys(record),
                raw as string,
                record.id
            );
            return Number(removed) === 1;
        }
    };
}

// When this Redis last started. A claim written before a restart may be gone,
// so tokens issued before it are refused rather than trusted.
async function redisStartedAtMs(redis: Redis): Promise<number> {
    const info = await redis.info('server');
    const match = /uptime_in_seconds:(\d+)/.exec(info);
    if (!match) throw new Error('Redis INFO did not report uptime_in_seconds');
    return Date.now() - Number(match[1]) * 1000;
}

export function createMcpConfirmationClaimsStore(
    redis: Redis
): McpConfirmationClaimsPort {
    return {
        async claim({tokenDigest, issuedAtMs, expiresAtMs}) {
            if (issuedAtMs < (await redisStartedAtMs(redis))) {
                return 'predates_store';
            }
            const set = await redis.set(
                claimKey(tokenDigest),
                '1',
                'PXAT',
                expiresAtMs + CLAIM_CLOCK_SKEW_MS,
                'NX'
            );
            return set === 'OK' ? 'claimed' : 'already_used';
        }
    };
}

function parseDelivery(payload: string): McpElicitationDelivery | null {
    return parseAs<McpElicitationDelivery>(
        payload,
        DELIVERY_FIELDS,
        'elicitation delivery'
    );
}

export function createMcpElicitationsStore(clients: {
    redis: Redis;
    pubsub: RedisPubSub;
}): McpElicitationsPort {
    const {redis, pubsub} = clients;
    return {
        async createSession(session, {ttlMs, maxSessions}) {
            const now = Date.now();
            const created = await redis.eval(
                CREATE_SESSION_LUA,
                2,
                sessionKey(session.id),
                sessionIndexKey(),
                JSON.stringify(session),
                ttlMs,
                now,
                maxSessions,
                session.id,
                now + ttlMs
            );
            return Number(created) === 1;
        },
        async getSession(id, ttlMs) {
            const raw = (await redis.eval(
                GET_SESSION_LUA,
                2,
                sessionKey(id),
                sessionIndexKey(),
                ttlMs,
                id,
                Date.now() + ttlMs
            )) as string | null;
            return parseSession(raw);
        },
        async deleteSession(id, binding) {
            const raws = (await redis.eval(
                DELETE_SESSION_LUA,
                3,
                sessionKey(id),
                sessionIndexKey(),
                waitsKey(id),
                id,
                binding
            )) as string[] | null;
            if (raws === null) return null;
            return raws
                .map(parseWait)
                .filter((wait): wait is McpElicitationWait => wait !== null);
        },
        async registerWait(wait) {
            await redis.eval(
                REGISTER_WAIT_LUA,
                1,
                waitsKey(wait.sessionId),
                wait.requestId,
                JSON.stringify(wait),
                Math.max(1, wait.expiresAtMs - Date.now())
            );
        },
        async takeWait({sessionId, requestId, binding}) {
            const raw = (await redis.eval(
                TAKE_WAIT_LUA,
                1,
                waitsKey(sessionId),
                requestId,
                binding,
                Date.now()
            )) as string | null;
            return parseWait(raw);
        },
        async deliver(delivery) {
            // PUBLISH counts receivers: zero means the waiting instance is gone.
            const receivers = await redis.publish(
                deliveryChannel(delivery.instanceId),
                JSON.stringify(delivery)
            );
            return receivers > 0;
        },
        async onDelivery(instanceId, handler) {
            await pubsub.subscribe(
                deliveryChannel(instanceId),
                (_channel, payload) => {
                    const delivery = parseDelivery(payload);
                    if (delivery?.instanceId === instanceId) handler(delivery);
                }
            );
        }
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function parsePayload(value: unknown): Record<string, unknown> | null {
    const record = asRecord(value);
    if (record) return record;
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
        return asRecord(JSON.parse(value));
    } catch {
        return null;
    }
}

function payloadUserId(value: unknown): string | null {
    const payload = parsePayload(value);
    const userId = payload?.userId ?? payload?.user_id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

function findNestedUserId(value: unknown, depth = 0): string | null {
    if (depth > 6) return null;
    const direct = payloadUserId(value);
    if (direct) return direct;
    const record = parsePayload(value);
    if (!record) return null;
    for (const child of Object.values(record)) {
        const nested = findNestedUserId(child, depth + 1);
        if (nested) return nested;
    }
    return null;
}

// Tries event payload, userinfo, and aggregate shapes in turn.
export function extractUserId(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const root = parsed as Record<string, unknown>;
    const userBlock = root.user as Record<string, unknown> | undefined;
    if (typeof userBlock?.id === 'string' && userBlock.id.length > 0) {
        return userBlock.id;
    }
    const userinfoBlock = root.userinfo as Record<string, unknown> | undefined;
    if (
        typeof userinfoBlock?.sub === 'string' &&
        userinfoBlock.sub.length > 0
    ) {
        return userinfoBlock.sub;
    }
    for (const candidate of [
        root.payload,
        asRecord(root.event)?.payload,
        asRecord(root.data)?.payload
    ]) {
        const userId = payloadUserId(candidate);
        if (userId) return userId;
    }
    const nestedUserId = findNestedUserId(root);
    if (nestedUserId) return nestedUserId;
    if (typeof root.userId === 'string' && root.userId.length > 0) {
        return root.userId;
    }
    if (
        typeof root.aggregateID === 'string' &&
        root.aggregateID.length > 0 &&
        root.aggregateType === 'user'
    ) {
        return root.aggregateID;
    }
    return null;
}

// Resource-owning org id for the user; falls back to user.resource_owner.
export function extractOrgId(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const root = parsed as Record<string, unknown>;
    const orgBlock = root.org as Record<string, unknown> | undefined;
    if (typeof orgBlock?.id === 'string' && orgBlock.id.length > 0) {
        return orgBlock.id;
    }
    const userBlock = root.user as Record<string, unknown> | undefined;
    const ro = userBlock?.resource_owner;
    if (typeof ro === 'string' && ro.length > 0) return ro;
    return null;
}

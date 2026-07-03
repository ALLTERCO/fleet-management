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
    const payload = root.payload as Record<string, unknown> | undefined;
    if (typeof payload?.userId === 'string' && payload.userId.length > 0) {
        return payload.userId;
    }
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

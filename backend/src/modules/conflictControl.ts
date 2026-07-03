import RpcError from '../rpc/RpcError';

export interface RevisionedResource {
    revision?: string | number | null;
    etag?: string | null;
    updatedAt?: string | null;
}

export interface ConflictCheckInput {
    resource: RevisionedResource | null | undefined;
    expectedRevision: string | number | null | undefined;
    resourceType: string;
    resourceId?: string | number;
}

export function revisionToken(resource: RevisionedResource): string | null {
    if (resource.etag) return resource.etag;
    if (resource.revision !== undefined && resource.revision !== null) {
        return String(resource.revision);
    }
    return resource.updatedAt ?? null;
}

export function assertFreshRevision(input: ConflictCheckInput): void {
    if (!input.resource) {
        throw RpcError.NotFound(input.resourceType, input.resourceId);
    }
    const current = revisionToken(input.resource);
    if (!current) return;
    if (
        input.expectedRevision === undefined ||
        input.expectedRevision === null
    ) {
        throw staleUpdateError(input, current);
    }
    if (String(input.expectedRevision) !== current) {
        throw staleUpdateError(input, current);
    }
}

function staleUpdateError(
    input: ConflictCheckInput,
    currentRevision: string
): RpcError {
    return RpcError.Domain('ResourceConflict', {
        message: `${input.resourceType} changed since it was loaded`,
        details: {
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            currentRevision
        }
    });
}

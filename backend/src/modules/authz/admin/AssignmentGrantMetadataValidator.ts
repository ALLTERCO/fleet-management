import RpcError from '../../../rpc/RpcError';
import type {
    AssignmentGrantMetadata,
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';
import {authzGrantIsHighRisk} from '../../../types/api/authzCatalog';

const REASON_MAX_LENGTH = 200;
const COMMENT_MAX_LENGTH = 1000;

export interface AssignmentGrantMetadataRequest {
    metadata: AssignmentGrantMetadata;
    personaKey: string;
    scope: AssignmentScope;
    subjectType: AssignmentSubjectType;
    // Machine credentials must expire; humans only need to say why.
    subjectIsServiceUser: boolean;
}

export interface NormalizedAssignmentGrantMetadata {
    reason: string | null;
    comment: string | null;
    expiresAt: string | null;
}

export function normalizeAssignmentGrantMetadata(
    request: AssignmentGrantMetadataRequest
): NormalizedAssignmentGrantMetadata {
    const metadata = {
        reason: normalizeText(
            'reason',
            request.metadata.reason,
            REASON_MAX_LENGTH
        ),
        comment: normalizeText(
            'comment',
            request.metadata.comment,
            COMMENT_MAX_LENGTH
        ),
        expiresAt: normalizeExpiresAt(request.metadata.expiresAt)
    };
    requireHighRiskGrantMetadata(request, metadata);
    return metadata;
}

function requireHighRiskGrantMetadata(
    request: AssignmentGrantMetadataRequest,
    metadata: NormalizedAssignmentGrantMetadata
): void {
    if (!isHighRiskGrant(request)) return;
    if (!metadata.reason) {
        throw RpcError.InvalidParams(
            'high-risk assignment grants require a reason'
        );
    }
    if (request.subjectIsServiceUser && !metadata.expiresAt) {
        throw RpcError.InvalidParams(
            'high-risk service-user grants require expiresAt'
        );
    }
}

function isHighRiskGrant(request: AssignmentGrantMetadataRequest): boolean {
    return authzGrantIsHighRisk(request.personaKey, request.scope.all === true);
}

function normalizeText(
    field: string,
    value: string | null | undefined,
    maxLength: number
): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
        throw RpcError.InvalidParams(`${field} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > maxLength) {
        throw RpcError.InvalidParams(
            `${field} must be at most ${maxLength} characters`
        );
    }
    return trimmed;
}

function normalizeExpiresAt(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
        throw RpcError.InvalidParams('expiresAt must be a string');
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const expiresAtMs = Date.parse(trimmed);
    if (!Number.isFinite(expiresAtMs)) {
        throw RpcError.InvalidParams('expiresAt must be a valid date-time');
    }
    if (expiresAtMs <= Date.now()) {
        throw RpcError.InvalidParams('expiresAt must be in the future');
    }
    return new Date(expiresAtMs).toISOString();
}

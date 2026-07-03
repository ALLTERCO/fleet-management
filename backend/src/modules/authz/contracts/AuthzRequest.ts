import type {ResourceRef} from './ResourceRef';

export interface AuthzRequestContext {
    sourceIp?: string;
    mfaPresent?: boolean;
    requestId?: string;
    sessionId?: string;
}

export interface AuthzRequest {
    action: string;
    resource: ResourceRef;
    context?: AuthzRequestContext;
}

import type {ResourceRef} from './ResourceRef';
import type {ScopeFilter} from './ScopeFilter';

export type AuthzDecisionReason =
    | 'allowed'
    | 'missing_sender'
    | 'missing_resource'
    | 'resource_resolution_failed'
    | 'unsupported_resource'
    | 'unsupported_action'
    | 'denied';

export interface AuthzDecision {
    allowed: boolean;
    reason: AuthzDecisionReason;
    action?: string;
    resource?: ResourceRef;
    scopeFilter?: ScopeFilter;
    explanation: string;
}

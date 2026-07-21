import type {user_t} from '../../../types';
import * as AuditLogger from '../../AuditLogger';

// Shelly device methods are named <Component>.<Verb>. Get/List/Check verbs are
// reads; every other verb changes device state.
export function isStateChangingRelayMethod(method: string): boolean {
    const verb = method.slice(method.lastIndexOf('.') + 1);
    return !/^(Get|List|Check)/i.test(verb);
}

export interface RelayOutcome {
    success: boolean;
    errorMessage?: string;
}

// Audit a completed raw relay. Raw relays skip Commander, so this is the only
// trail for device commands sent that way. Reads are skipped so the hot
// status-poll path can't flood the log; every state-changing command is kept.
export function auditRelay(
    user: user_t,
    method: string,
    params: unknown,
    outcome: RelayOutcome
): void {
    if (!isStateChangingRelayMethod(method)) return;
    AuditLogger.logRpc({
        username: user.username,
        actorUserId: user.userId,
        method,
        params,
        organizationId: user.organizationId,
        ...(outcome.success
            ? {}
            : {success: false, errorMessage: outcome.errorMessage})
    });
}

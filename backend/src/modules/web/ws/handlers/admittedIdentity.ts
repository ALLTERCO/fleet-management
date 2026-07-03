// /shelly admission identity guard (P0).
//
// The WaitingRoom admits a device using the self-claimed `src` field
// from the device's first JSON-RPC frame. After admission, the factory
// calls `Shelly.GetDeviceInfo` over the now-trusted socket and uses
// `info.id` for DB registration. The two MUST match — a device that
// claims one id at admission but identifies as another after the
// socket is open is an identity spoof and gets refused.

import type {AuditLogEntry} from '../../../AuditLogger';

export class IdentityMismatchError extends Error {
    readonly admittedShellyID: string;
    readonly registeredShellyID: string;

    constructor(admittedShellyID: string, registeredShellyID: string) {
        super(
            `device admitted as ${admittedShellyID} resolved to ${registeredShellyID}`
        );
        this.name = 'IdentityMismatchError';
        this.admittedShellyID = admittedShellyID;
        this.registeredShellyID = registeredShellyID;
    }
}

// Pure ANSWER: returns the mismatch error so callers can branch, or
// null when the two ids agree. Side-effect-free so callers stay in
// control of the refuse flow.
export function checkAdmittedIdentity(
    admittedShellyID: string,
    registeredShellyID: string
): IdentityMismatchError | null {
    return admittedShellyID === registeredShellyID
        ? null
        : new IdentityMismatchError(admittedShellyID, registeredShellyID);
}

export interface IdentityMismatchAuditInput {
    admittedShellyID: string;
    registeredShellyID: string;
    sourceIp?: string;
}

// Pure audit-entry builder so the row shape stays pinned by the unit
// test. The flow module hands the result to AuditLogger.log().
export function identityMismatchAuditEntry(
    input: IdentityMismatchAuditInput
): AuditLogEntry {
    const entry: AuditLogEntry = {
        eventType: 'device_identity_mismatch',
        shellyId: input.admittedShellyID,
        shellyIds: [input.admittedShellyID, input.registeredShellyID],
        success: false,
        errorMessage: `device admitted as ${input.admittedShellyID} resolved to ${input.registeredShellyID}`
    };
    if (input.sourceIp !== undefined) entry.ipAddress = input.sourceIp;
    return entry;
}

import {getLogger} from 'log4js';
import * as AuditLogger from '../AuditLogger';
import {invalidateAccessControl} from '../deviceIngress/deviceTrustCache';
import * as EventDistributor from '../EventDistributor';
import * as Observability from '../Observability';
import {
    ACCESS_CONTROL,
    admitBatch,
    type get_resp_t,
    groupAddDevicesBatch
} from '../PostgresProvider';
import type {AdmissionIntent} from '../WaitingRoom/types';

const logger = getLogger('auto-admit-finalize');

export interface AutoAdmitFinalizeDeps {
    admitBatch: typeof admitBatch;
    groupAddDevicesBatch: (
        organizationId: string,
        groupId: number,
        shellyIds: string[]
    ) => Promise<number>;
    setDeviceOrg: (shellyId: string, organizationId: string) => void;
    invalidateOrganizationAccess: (orgId: string) => void;
    invalidateGroupMembership: (
        orgId: string,
        externalIds?: readonly string[]
    ) => void;
    logAutoAdmitViaDiscovery: typeof AuditLogger.logAutoAdmitViaDiscovery;
}

const defaultDeps: AutoAdmitFinalizeDeps = {
    admitBatch,
    groupAddDevicesBatch,
    setDeviceOrg: EventDistributor.setDeviceOrg,
    invalidateOrganizationAccess: EventDistributor.invalidateOrganizationAccess,
    invalidateGroupMembership: EventDistributor.invalidateGroupMembership,
    logAutoAdmitViaDiscovery: AuditLogger.logAutoAdmitViaDiscovery
};

let activeDeps: AutoAdmitFinalizeDeps = defaultDeps;
export function __setAutoAdmitFinalizeDepsForTests(
    overrides: Partial<AutoAdmitFinalizeDeps> | null
): void {
    activeDeps = overrides ? {...defaultDeps, ...overrides} : defaultDeps;
}

// 'refused': the row is DENIED and the guarded write left it untouched.
// 'failed': nothing was admitted (write threw, retired id, foreign org).
// Both make the caller skip approve + audit and keep the intent for the
// next reconnect.
export type AutoAdmitBindResult = 'bound' | 'refused' | 'failed';

// Create-or-claim the row and mark it ALLOWED in one guarded write, so a
// device Fleet has never seen is bound before Shelly.Connect fires.
export async function bindAutoAdmittedDeviceOrg(
    shellyID: string,
    intent: AdmissionIntent
): Promise<AutoAdmitBindResult> {
    const bound = await bindDeviceOrg(shellyID, intent.organization_id);
    if (bound !== 'bound') return bound;
    // The intake read cached PENDING moments ago; the next reconnect must
    // see ALLOWED.
    await invalidateAccessControl(shellyID);
    const groupMembershipChanged = await addToGroupSafe(shellyID, intent);
    if (groupMembershipChanged) {
        activeDeps.invalidateGroupMembership(intent.organization_id, [
            shellyID
        ]);
    } else {
        activeDeps.invalidateOrganizationAccess(intent.organization_id);
    }
    return 'bound';
}

export function recordAutoAdmitAudit(
    shellyID: string,
    intent: AdmissionIntent
): void {
    activeDeps.logAutoAdmitViaDiscovery({
        shellyId: shellyID,
        organizationId: intent.organization_id,
        groupId: intent.group_id,
        createdBy: null
    });
}

async function bindDeviceOrg(
    shellyID: string,
    organizationId: string
): Promise<AutoAdmitBindResult> {
    const rows = await runAdmitBatch(shellyID, organizationId);
    if (rows === null) return 'failed';
    const row = rows.find((r) => r.external_id === shellyID);
    if (!row) {
        logger.error(
            'auto-admit matched no row for %s org=%s — retired or owned by another org',
            shellyID,
            organizationId
        );
        return 'failed';
    }
    if (row.control_access === ACCESS_CONTROL.DENIED) {
        Observability.incrementCounter('waiting_room_auto_admit_refused');
        logger.warn(
            'auto-admit refused for %s org=%s — device is DENIED',
            shellyID,
            organizationId
        );
        return 'refused';
    }
    if (row.control_access !== ACCESS_CONTROL.ALLOWED) {
        logger.error(
            'auto-admit left %s org=%s at control_access=%d',
            shellyID,
            organizationId,
            row.control_access
        );
        return 'failed';
    }
    activeDeps.setDeviceOrg(shellyID, organizationId);
    return 'bound';
}

// Never override a DENIED row from an unattended path; only an operator may.
// Auto-admit still creates the row: a first-seen device has none yet.
async function runAdmitBatch(
    shellyID: string,
    organizationId: string
): Promise<get_resp_t[] | null> {
    try {
        return await activeDeps.admitBatch(
            [{externalId: shellyID}],
            ACCESS_CONTROL.ALLOWED,
            organizationId,
            false,
            true
        );
    } catch (err) {
        logger.error('admitBatch threw for auto-admit %s: %s', shellyID, err);
        return null;
    }
}

async function addToGroupSafe(
    shellyID: string,
    intent: AdmissionIntent
): Promise<boolean> {
    if (intent.group_id === null) return false;
    try {
        await activeDeps.groupAddDevicesBatch(
            intent.organization_id,
            intent.group_id,
            [shellyID]
        );
        return true;
    } catch (err) {
        // Bind already committed, so the device is admitted but missing from
        // its group. Fail loud (error + metric) instead of a silent warn.
        Observability.incrementCounter('waiting_room_group_add_failed');
        logger.error(
            'auto-admit %s bound to org but group-add to group %d FAILED — device admitted yet absent from the group: %s',
            shellyID,
            intent.group_id,
            err
        );
        return false;
    }
}

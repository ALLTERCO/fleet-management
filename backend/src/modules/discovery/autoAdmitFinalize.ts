import {getLogger} from 'log4js';
import * as AuditLogger from '../AuditLogger';
import * as EventDistributor from '../EventDistributor';
import * as Observability from '../Observability';
import {
    groupAddDevicesBatch,
    setDeviceOrganizationBatch
} from '../PostgresProvider';
import type {AdmissionIntent} from '../WaitingRoom/types';

const logger = getLogger('auto-admit-finalize');

export interface AutoAdmitFinalizeDeps {
    setDeviceOrganizationBatch: (
        externalIds: string[],
        organizationId: string
    ) => Promise<string[]>;
    groupAddDevicesBatch: (
        organizationId: string,
        groupId: number,
        shellyIds: string[]
    ) => Promise<number>;
    setDeviceOrg: (shellyId: string, organizationId: string) => void;
    invalidateGroupCache: (orgId: string) => void;
    logAutoAdmitViaDiscovery: typeof AuditLogger.logAutoAdmitViaDiscovery;
}

const defaultDeps: AutoAdmitFinalizeDeps = {
    setDeviceOrganizationBatch,
    groupAddDevicesBatch,
    setDeviceOrg: EventDistributor.setDeviceOrg,
    invalidateGroupCache: EventDistributor.invalidateGroupCache,
    logAutoAdmitViaDiscovery: AuditLogger.logAutoAdmitViaDiscovery
};

let activeDeps: AutoAdmitFinalizeDeps = defaultDeps;
export function __setAutoAdmitFinalizeDepsForTests(
    overrides: Partial<AutoAdmitFinalizeDeps> | null
): void {
    activeDeps = overrides ? {...defaultDeps, ...overrides} : defaultDeps;
}

// false → caller must skip approve + audit (device not actually bound).
export async function bindAutoAdmittedDeviceOrg(
    shellyID: string,
    intent: AdmissionIntent
): Promise<boolean> {
    const bound = await bindDeviceOrg(shellyID, intent.organization_id);
    if (!bound) return false;
    activeDeps.invalidateGroupCache(intent.organization_id);
    await addToGroupSafe(shellyID, intent);
    return true;
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
): Promise<boolean> {
    const matched = await runBindBatch(shellyID, organizationId);
    if (matched === null) return false;
    if (matched.length === 0) {
        logger.error(
            'auto-admit bind matched zero rows for %s org=%s — device unknown to FM',
            shellyID,
            organizationId
        );
        return false;
    }
    for (const ext of matched) activeDeps.setDeviceOrg(ext, organizationId);
    return true;
}

async function runBindBatch(
    shellyID: string,
    organizationId: string
): Promise<string[] | null> {
    try {
        return await activeDeps.setDeviceOrganizationBatch(
            [shellyID],
            organizationId
        );
    } catch (err) {
        logger.error(
            'setDeviceOrganizationBatch threw for auto-admit %s: %s',
            shellyID,
            err
        );
        return null;
    }
}

async function addToGroupSafe(
    shellyID: string,
    intent: AdmissionIntent
): Promise<void> {
    if (intent.group_id === null) return;
    try {
        await activeDeps.groupAddDevicesBatch(
            intent.organization_id,
            intent.group_id,
            [shellyID]
        );
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
    }
}

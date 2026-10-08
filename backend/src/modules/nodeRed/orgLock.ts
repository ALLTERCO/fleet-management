// One Node-RED belongs to one organization. Node-RED has no tenants of its
// own, so a second org reaching it would see and change the first org's flows.

import log4js from 'log4js';
import {tuning} from '../../config/tuning';

const logger = log4js.getLogger('node-red-org-lock');

/** Reason code for an org-lock refusal, on RPC errors and proxy JSON alike. */
export const NODE_RED_WRONG_ORGANIZATION = 'node_red_wrong_organization';

export type NodeRedOrgDecision = 'allow' | 'deny' | 'unlocked';

/** Pure rule: no lock configured means "unlocked", else orgs must match. */
export function nodeRedOrgDecision(input: {
    callerOrg: string | undefined;
    lockedOrg: string;
}): NodeRedOrgDecision {
    if (!input.lockedOrg) return 'unlocked';
    return input.callerOrg === input.lockedOrg ? 'allow' : 'deny';
}

let unlockedWarned = false;

function warnUnlockedOnce(): void {
    if (unlockedWarned) return;
    unlockedWarned = true;
    logger.warn(
        'FM_NODE_RED_ORG_ID is not set; every organization can reach Node-RED. Set it on multi-organization installs.'
    );
}

/** May a caller from this organization reach this Node-RED? */
export function nodeRedOrgAllows(callerOrg: string | undefined): boolean {
    const decision = nodeRedOrgDecision({
        callerOrg,
        lockedOrg: tuning.nodeRed.orgId
    });
    if (decision === 'unlocked') warnUnlockedOnce();
    return decision !== 'deny';
}

/** The locked organization, or undefined on an unlocked install. */
export function nodeRedLockedOrg(): string | undefined {
    return tuning.nodeRed.orgId || undefined;
}

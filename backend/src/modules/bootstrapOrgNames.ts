// Mirror the org names the deploy gave Zitadel (FM_CLIENT_ORG_NAME etc.) into
// FM's own profile table, so the UI shows "fleet" rather than a raw org id.
// Fills an unset display_name; an operator-set name persists, a cleared one
// re-takes the env default on the next boot.

import {getLogger} from 'log4js';
import {
    fmClientOrgId,
    fmClientOrgName,
    fmPlatformOrgId,
    fmPlatformOrgName
} from '../config/zitadel';
import * as postgres from './PostgresProvider';

const logger = getLogger('bootstrap-org-names');

export async function bootstrapOrgNames(): Promise<void> {
    try {
        await applyOrgName(fmClientOrgId(), fmClientOrgName());
        await applyOrgName(fmPlatformOrgId(), fmPlatformOrgName());
    } catch (err) {
        // Cosmetic — never take boot down over a name backfill.
        logger.warn('Org-name sync failed (non-fatal): %s', err);
    }
}

async function applyOrgName(
    id: string | undefined,
    name: string | undefined
): Promise<void> {
    if (!id || !name) return;
    await postgres.callMethod('organization.fn_profile_set_default_name', {
        p_id: id,
        p_display_name: name
    });
    logger.info('Org %s named "%s" from deploy env (if unset)', id, name);
}

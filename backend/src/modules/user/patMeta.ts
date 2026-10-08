import log4js from 'log4js';
import * as store from '../PostgresProvider';

const logger = log4js.getLogger('zitadel-pats');

// Runs after Zitadel already revoked the token, so a failure only leaves an unused row.
export async function deletePatMeta(tokenId: string): Promise<void> {
    try {
        await store.callMethod(
            'organization.fn_service_user_token_meta_delete',
            {
                p_token_id: tokenId
            }
        );
    } catch (error) {
        logger.warn(
            'Failed to delete PAT metadata for token %s: %s',
            tokenId,
            error
        );
    }
}

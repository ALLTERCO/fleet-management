/** Frontend mirrors of backend schema limits — keep in sync with @api/_shared. */
import {MAX_BATCH_SIZE, NAME_SCHEMA} from '@api/_shared';

export const NAME_MAX_LENGTH = Number(NAME_SCHEMA.maxLength ?? 120);
export const BATCH_MAX = MAX_BATCH_SIZE;

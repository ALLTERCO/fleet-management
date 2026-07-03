/** backup_operation_failed — manual-resolve incident per occurrence. */
import {makeOperationFailedEvaluator} from './operationFailedEvaluator';

export const backupOperationFailedEvaluator = makeOperationFailedEvaluator(
    'backup_operation_failed',
    (shellyID) => `Backup failed on ${shellyID}`
);

/** firmware_operation_failed — manual-resolve incident per occurrence. */
import {makeOperationFailedEvaluator} from './operationFailedEvaluator';

export const firmwareOperationFailedEvaluator = makeOperationFailedEvaluator(
    'firmware_operation_failed',
    (shellyID) => `Firmware operation failed on ${shellyID}`
);

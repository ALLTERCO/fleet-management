// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. It used to be a second, untyped proxy over the
// same namespace, so the same call had two homes and one of them skipped
// every argument shape the curated one applies.

import {hostRpcAccess} from './api';
import {createFirmwareDomain} from './core/domains/firmware';

export const firmware = createFirmwareDomain(hostRpcAccess);

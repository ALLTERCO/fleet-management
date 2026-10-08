// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. It used to be a second, untyped proxy over the
// same namespace, so the same call had two homes and one of them skipped
// every argument shape the curated one applies.

import {hostRpcAccess} from './api';
import {createDashboardDomain} from './core/domains/dashboards';

export const dashboards = createDashboardDomain(hostRpcAccess);

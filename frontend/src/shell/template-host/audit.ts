// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. It used to be a second, untyped proxy over the
// same namespace, so the same call had two homes and one of them skipped
// every argument shape the curated one applies.

import {hostRpcAccess} from './api';
import {createAuditDomain} from './core/domains/audit';
import {createHostDomain} from './domain';

export const audit = createAuditDomain(hostRpcAccess);

// A separate namespace with one method and no curated domain, so the raw
// proxy stays — it is the only way there, not a duplicate of something better.
export const authzAudit = createHostDomain('authz_audit');

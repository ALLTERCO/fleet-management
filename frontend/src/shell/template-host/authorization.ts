// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it, so `host.authorization` reaches the same personas,
// assignments and role grants the runtime SDK already exposes.

import {hostRpcAccess} from './api';
import {createAuthorizationDomain} from './core/domains/authorization';

export const authorization = createAuthorizationDomain(hostRpcAccess);

// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. A second untyped proxy over the same namespace
// meant one call had two homes, and one home skipped the argument shaping.

import {hostRpcAccess} from './api';
import {createUserDomain} from './core/domains/users';
import {createHostDomain} from './domain';

export const users = createUserDomain(hostRpcAccess);

// No curated domain for user groups yet, so the raw proxy stays.
export const userGroups = createHostDomain('user_group');

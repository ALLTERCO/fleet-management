// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. A second untyped proxy over the same namespace
// meant one call had two homes, and one home skipped the argument shaping.

import {hostRpcAccess} from './api';
import {createNotificationDomain} from './core/domains/notifications';
import {createHostDomain} from './domain';

export const notifications = createNotificationDomain(hostRpcAccess);

// No curated domain for this namespace yet, so the raw proxy stays — it is
// the only way to reach it, not a duplicate of something better.
export const notificationPolicies = createHostDomain('notification_policy');

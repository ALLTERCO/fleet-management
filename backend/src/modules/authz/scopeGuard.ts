// Shared scope guard. Both write paths into assignments must use this.

import type {AssignmentScope} from '../../types/api/assignment';

// True iff the scope explicitly grants something. Empty scope ({} or
// {all:false} or {device_ids:[]}) is NOT a grant — fail closed so a malformed
// "narrow" scope doesn't accidentally grant global access.
export function isExplicitScope(scope: AssignmentScope): boolean {
    if (scope.all === true) return true;
    return !!(
        scope.device_ids?.length ||
        scope.location_ids?.length ||
        scope.device_group_ids?.length ||
        scope.device_tags?.length ||
        scope.dashboard_ids?.length ||
        scope.plugin_keys?.length ||
        scope.waiting_room_ids?.length ||
        scope.configuration_keys?.length ||
        scope.report_ids?.length ||
        scope.organization_ids?.length ||
        scope.alert_ids?.length ||
        scope.notification_ids?.length ||
        scope.integration_keys?.length ||
        scope.automation_ids?.length
    );
}

export const SCOPE_NOT_EXPLICIT_MESSAGE =
    'scope must explicitly grant: set all=true or at least one ' +
    'non-empty selector (device_ids, location_ids, device_group_ids, ' +
    'device_tags, dashboard_ids, plugin_keys, waiting_room_ids, ' +
    'configuration_keys, report_ids, organization_ids, alert_ids, ' +
    'notification_ids, integration_keys, automation_ids)';

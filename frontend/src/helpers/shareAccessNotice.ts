export type ShareAccessResourceType =
    | 'dashboard'
    | 'location'
    | 'group'
    | 'device';

export const DASHBOARD_SHARE_ACCESS_NOTICE =
    'This grants access to the dashboard layout only. Device, group, location, tag, and telemetry access remain governed by separate permissions. Data the recipient cannot access stays hidden.';

export function shareAccessNotice(
    resourceType: ShareAccessResourceType
): string | null {
    return resourceType === 'dashboard' ? DASHBOARD_SHARE_ACCESS_NOTICE : null;
}

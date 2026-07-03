// Frontend re-exports of canonical permission types from @api/permissions,
// plus the legacy possiblePermissionsForUser map (UserBoard summary only).

export {
    COMPONENT_DEFINITIONS,
    COMPONENT_ORDER,
    type ComponentCapabilityMap,
    type ComponentDefinition,
    type ComponentName,
    type CrudOperation,
    mapLegacyComponentName,
    methodToCrudOperation,
    type UiCapabilities
} from '@api/permissions';

// UserBoard "has-all-perms" rollup UI uses this list for its summary display.
// Authoritative surface is COMPONENT_DEFINITIONS.
export const possiblePermissionsForUser: Record<string, string[]> = {
    Admin: ['*', 'ListCommands', 'SendRPC', 'PostgresCall'],
    Alexa: ['*', 'Disable', 'Enable'],
    Dashboard: ['*', 'GetSettings', 'SetSettings', 'Create'],
    Device: [
        '*',
        'list',
        'GetInfo',
        'GetSetup',
        'Call',
        'Get',
        'GetDeviceChannels',
        'GetStatusTimeline',
        'GetStatusHistory'
    ],
    Energy: ['*', 'Query', 'Current', 'Describe'],
    Entity: ['*', 'Get', 'List', 'Describe', 'GetCapabilities', 'InvokeAction'],
    System: ['*', 'Subscribe', 'Unsubscribe'],
    GrafanaComponent: ['*', 'GetConfig', 'GetDashboard'],
    Group: [
        '*',
        'Create',
        'Add',
        'Remove',
        'List',
        'Get',
        'Delete',
        'Rename',
        'Set',
        'Find',
        'GetMetrics',
        'GetCapabilities'
    ],
    MailComponent: ['Send'],
    Notification: ['*', 'Subscribe', 'ListTokens'],
    Plugin: ['*', 'List', 'Upload', 'Remove'],
    Audit: ['*', 'Query', 'Export'],
    Report: ['*', 'Generate', 'GetReport', 'PurgeReports'],
    StorageComponent: [
        '*',
        'GetItem',
        'SetItem',
        'RemoveItem',
        'Keys',
        'GetAll'
    ],
    UserComponents: [
        '*',
        'Create',
        'Update',
        'Delete',
        'List',
        'Refresh',
        'Authenticate'
    ],
    WaitingRoomComponents: [
        '*',
        'GetPending',
        'GetDenied',
        'AcceptPending',
        'RejectPending'
    ],
    Permissions: ['*', 'List', 'Delete', 'View']
};

// Single source of truth for backend websocket event names. The backend
// delivers only exact subscribed names, so the connect subscription and
// every dispatch/handler comparison must read from here — an event name
// string exists exactly once, in this file (frontend/test/wsEventsDrift
// gates it).

export const SHELLY_EVENT = {
    CONNECT: 'Shelly.Connect',
    DISCONNECT: 'Shelly.Disconnect',
    DELETE: 'Shelly.Delete',
    STATUS: 'Shelly.Status',
    SETTINGS: 'Shelly.Settings',
    KVS: 'Shelly.KVS',
    INFO: 'Shelly.Info',
    PRESENCE: 'Shelly.Presence',
    PRESENCE_TRACK: 'Shelly.PresenceTrack',
    OTA_PROGRESS: 'Shelly.OtaProgress'
} as const;

export const ENTITY_EVENT = {
    ADDED: 'Entity.Added',
    REMOVED: 'Entity.Removed',
    EVENT: 'Entity.Event'
} as const;

// Raw device notifications forwarded by the backend (no namespace prefix).
export const DEVICE_NOTIFY = {
    STATUS: 'NotifyStatus',
    EVENT: 'NotifyEvent'
} as const;

export const BTHOME_EVENT = {
    DISCOVERY_RESULT: 'BTHome.DiscoveryResult',
    DISCOVERY_DONE: 'BTHome.DiscoveryDone',
    CONTROL_LEARNING: 'BTHome.ControlLearning',
    CONTROLS_UPDATED: 'BTHome.ControlsUpdated'
} as const;

export const CONSOLE_EVENT = {
    LOG: 'Console.Log'
} as const;

export const LOCATION_EVENT = {
    CREATED: 'Location.Created',
    UPDATED: 'Location.Updated',
    DELETED: 'Location.Deleted',
    ASSIGNMENT_SET: 'Location.AssignmentSet',
    ASSIGNMENT_REMOVED: 'Location.AssignmentRemoved',
    // Aggregate event for a batch assign — one event, not one per subject.
    ASSIGNMENTS_SET: 'Location.AssignmentsSet'
} as const;

export const WAITING_ROOM_EVENT = {
    ACCEPTED: 'WaitingRoomEvent.Accepted'
} as const;

export const ALERT_EVENT = {
    CREATED: 'Alert.Created',
    UPDATED: 'Alert.Updated',
    RESOLVED: 'Alert.Resolved',
    RULE_CREATED: 'Alert.RuleCreated',
    RULE_UPDATED: 'Alert.RuleUpdated',
    RULE_DELETED: 'Alert.RuleDeleted'
} as const;

export const NOTIFICATION_EVENT = {
    CREATED: 'Notification.Created',
    READ_STATE_CHANGED: 'Notification.ReadStateChanged',
    DELIVERY_UPDATED: 'Notification.DeliveryUpdated'
} as const;

export const CERTIFICATE_EVENT = {
    PUSH_ROW: 'Certificate.PushRow',
    JOB_UPDATED: 'Certificate.JobUpdated',
    EXPIRING: 'Certificate.Expiring',
    CREATED: 'Certificate.Created',
    UPDATED: 'Certificate.Updated',
    DELETED: 'Certificate.Deleted'
} as const;

export const CREDENTIAL_EVENT = {
    PUSH_ROW: 'Credential.PushRow',
    JOB_UPDATED: 'Credential.JobUpdated',
    CHANGED: 'Credential.Changed'
} as const;

export const JOB_EVENT = {
    UPDATED: 'Job.Updated',
    UNIT_UPDATED: 'Job.UnitUpdated'
} as const;

export const DASHBOARD_EVENT = {
    CREATED: 'Dashboard.Created',
    UPDATED: 'Dashboard.Updated',
    DELETED: 'Dashboard.Deleted',
    ITEMS_CHANGED: 'Dashboard.ItemsChanged',
    SETTINGS_CHANGED: 'Dashboard.SettingsChanged',
    ORDER_CHANGED: 'Dashboard.OrderChanged'
} as const;

export const REPORT_EVENT = {
    ANOMALY: 'Report.Anomaly',
    PROGRESS: 'Report.Progress',
    READY: 'Report.Ready'
} as const;

export const VARIABLES_EVENT = {
    CHANGED: 'Variables.Changed'
} as const;

export const DEVICE_EVENT = {
    RELATIONSHIPS_CHANGED: 'Device.RelationshipsChanged'
} as const;

export const GROUP_EVENT = {
    CREATED: 'Group.Created',
    UPDATED: 'Group.Updated',
    DELETED: 'Group.Deleted',
    MEMBERS_ADDED: 'Group.MembersAdded',
    MEMBERS_REMOVED: 'Group.MembersRemoved'
} as const;

export const TAG_EVENT = {
    CREATED: 'Tag.Created',
    UPDATED: 'Tag.Updated',
    DELETED: 'Tag.Deleted',
    ASSIGNED: 'Tag.Assigned',
    UNASSIGNED: 'Tag.Unassigned'
} as const;

export const CHANNEL_EVENT = {
    AUTO_DISABLED: 'Channel.AutoDisabled',
    HEALTH_RESET: 'Channel.HealthReset',
    CREATED: 'Channel.Created',
    UPDATED: 'Channel.Updated',
    DELETED: 'Channel.Deleted'
} as const;

export const PERSONA_EVENT = {
    CREATED: 'Persona.Created',
    UPDATED: 'Persona.Updated',
    DELETED: 'Persona.Deleted'
} as const;

export const ORGANIZATION_EVENT = {
    PROFILE_UPDATED: 'Organization.ProfileUpdated'
} as const;

export const USER_GROUP_EVENT = {
    CREATED: 'UserGroup.Created',
    UPDATED: 'UserGroup.Updated',
    DELETED: 'UserGroup.Deleted',
    MEMBERS_ADDED: 'UserGroup.MembersAdded',
    MEMBERS_REMOVED: 'UserGroup.MembersRemoved'
} as const;

export const USER_EVENT = {
    CREATED: 'User.Created',
    UPDATED: 'User.Updated',
    DELETED: 'User.Deleted'
} as const;

export const DESTINATION_EVENT = {
    CREATED: 'Destination.Created',
    UPDATED: 'Destination.Updated',
    DELETED: 'Destination.Deleted',
    MEMBERS_ADDED: 'Destination.MembersAdded',
    MEMBERS_REMOVED: 'Destination.MembersRemoved'
} as const;

// Server-pushed without a subscription (session/auth control channel).
export const DIRECT_PUSH_EVENT = {
    SESSION_RESYNC_REQUIRED: 'Session.ResyncRequired',
    AUTH_CHANGED: 'NotifyAuthChanged'
} as const;

// Dynamic names — subscribed per-connection via addTemporarySubscription;
// never in the static subscribe list.
export const DEVICE_CHANGE_EVENT = 'DeviceEvent.Change';
export const SHELLY_DEVICE_EVENT_PREFIX = 'Shelly.Event.';

/** Exact method name the backend composes for a firmware device event. */
export function deviceEventMethod(component: string, event: string): string {
    return `${SHELLY_DEVICE_EVENT_PREFIX}${component}.${event}`;
}

// Namespace prefixes for the dispatcher's startsWith routing.
export const WS_PREFIX = {
    SHELLY: 'Shelly.',
    CONSOLE: 'Console.',
    ALERT: 'Alert.',
    NOTIFICATION: 'Notification.',
    CERTIFICATE: 'Certificate.',
    CREDENTIAL: 'Credential.',
    JOB: 'Job.',
    LOCATION: 'Location.',
    DASHBOARD: 'Dashboard.',
    REPORT: 'Report.',
    VARIABLES: 'Variables.',
    GROUP: 'Group.',
    TAG: 'Tag.',
    CHANNEL: 'Channel.',
    PERSONA: 'Persona.',
    USER_GROUP: 'UserGroup.',
    USER: 'User.',
    DESTINATION: 'Destination.'
} as const;

// The full static subscribe list sent on connect — every statically
// handled event, grouped by domain above.
export const WS_SUBSCRIBED_EVENTS: readonly string[] = [
    ...Object.values(SHELLY_EVENT),
    ...Object.values(ENTITY_EVENT),
    ...Object.values(DEVICE_NOTIFY),
    ...Object.values(BTHOME_EVENT),
    ...Object.values(CONSOLE_EVENT),
    ...Object.values(LOCATION_EVENT),
    ...Object.values(WAITING_ROOM_EVENT),
    ...Object.values(ALERT_EVENT),
    ...Object.values(NOTIFICATION_EVENT),
    ...Object.values(CERTIFICATE_EVENT),
    ...Object.values(CREDENTIAL_EVENT),
    ...Object.values(JOB_EVENT),
    ...Object.values(DASHBOARD_EVENT),
    ...Object.values(REPORT_EVENT),
    ...Object.values(VARIABLES_EVENT),
    ...Object.values(DEVICE_EVENT),
    ...Object.values(GROUP_EVENT),
    ...Object.values(TAG_EVENT),
    ...Object.values(CHANNEL_EVENT),
    ...Object.values(PERSONA_EVENT),
    ...Object.values(ORGANIZATION_EVENT),
    ...Object.values(USER_GROUP_EVENT),
    ...Object.values(USER_EVENT),
    ...Object.values(DESTINATION_EVENT)
];

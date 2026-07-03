// Per-namespace guidance for the Host SDK contract so agents pick the right
// API (e.g. group vs location). Only confusable namespaces need an entry.

export interface NamespaceGuide {
    purpose: string;
    useInstead?: string;
}

export const NAMESPACE_GUIDE: Record<string, NamespaceGuide> = {
    device: {
        purpose:
            'Individual Shelly devices: inventory, status, config, direct RPC.',
        useInstead:
            'For a single capability channel use `entity`; for composites use `virtualdevice`.'
    },
    entity: {
        purpose:
            'Capability channels of a device (switch/light/sensor) for per-channel actions.',
        useInstead: 'For whole-device operations use `device`.'
    },
    virtualdevice: {
        purpose:
            'Composite devices built from signals of one or more real devices.'
    },
    group: {
        purpose:
            'Logical grouping of devices for bulk actions and access control.',
        useInstead:
            'For physical places (site/building/floor/room) use `location`; for freeform labels use `tag`.'
    },
    location: {
        purpose:
            'Physical hierarchy (site > building > floor > room) with geo and assignments.',
        useInstead:
            'For logical/access grouping use `group`; for freeform labels use `tag`.'
    },
    tag: {
        purpose: 'Freeform key/value labels on devices and other subjects.',
        useInstead:
            'For structured grouping use `group`; for physical places use `location`.'
    },
    fleet: {purpose: 'Fleet-wide metrics and operations across a scope.'},
    fleetmap: {
        purpose: 'Map-dashboard snapshots: energy/signal/alerts per location.'
    },
    fleetsummary: {
        purpose: 'Org-wide live load and energy totals for summary tiles.'
    },
    dashboard: {purpose: 'User dashboards: cards, items, layout, ordering.'},
    alert: {
        purpose: 'Alert rules and alert instances (ack/silence/resolve).'
    },
    notification: {
        purpose:
            'Notification inbox, destinations/channels, and delivery history.'
    },
    notification_policy: {
        purpose: 'Routing and suppression policies for notifications.'
    },
    integration: {
        purpose: 'Outbound endpoints (webhook/email/slack/teams/telegram).'
    },
    report: {purpose: 'Generated reports (energy, dumps) and downloads.'},
    energy: {purpose: 'Energy queries, summaries, and classification.'},
    analytics: {
        purpose: 'Ad-hoc analytics such as brush-to-compare attribution.'
    },
    waitingroom: {
        purpose: 'Devices awaiting admission: approve/deny/quarantine.',
        useInstead: 'To actively find devices on the LAN use `discovery`.'
    },
    discovery: {
        purpose: 'Active onboarding: scan the LAN and admit a device.',
        useInstead: 'For devices that connected on their own use `waitingroom`.'
    },
    firmware: {purpose: 'Firmware update jobs and auto-update modes.'},
    backup: {purpose: 'Device config backup and restore jobs.'},
    user: {
        purpose: 'User accounts, profiles, and personal access tokens.',
        useInstead:
            'For groups of users use `user_group`; for roles use `persona`.'
    },
    user_group: {
        purpose: 'Groups of users (people, not devices).',
        useInstead: 'For grouping devices use `group`.'
    },
    persona: {purpose: 'Permission roles (personas).'},
    permission: {purpose: 'Role listings and permission grants.'},
    assignment: {purpose: 'Assign subjects to personas.'},
    organization: {purpose: 'Organization (tenant) profile and metadata.'}
};

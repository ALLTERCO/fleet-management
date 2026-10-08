// AUTO-GENERATED — do not edit by hand.
// Source: backend/src/types/api/*.ts (_DESCRIBE) + host-namespace-guide.ts
// Regenerate: cd backend && npm run generate

export const HOST_NAMESPACE_GUIDE = {
    device: {
        kind: 'fleet-manager',
        purpose:
            'Individual Shelly devices: inventory, status, config, direct RPC.',
        useInstead:
            'For a single capability channel use `entity`; for composites use `virtualdevice`.'
    },
    entity: {
        kind: 'fleet-manager',
        purpose:
            'Capability channels of a device (switch/light/sensor) for per-channel actions.',
        useInstead: 'For whole-device operations use `device`.'
    },
    virtualdevice: {
        kind: 'fleet-manager',
        purpose:
            'Composite devices built from signals of one or more real devices.'
    },
    group: {
        kind: 'fleet-manager',
        purpose:
            'Logical grouping of devices for bulk actions and access control.',
        useInstead:
            'For physical places (site/building/floor/room) use `location`; for freeform labels use `tag`.'
    },
    location: {
        kind: 'fleet-manager',
        purpose:
            'Physical hierarchy (site > building > floor > room) with geo and assignments.',
        useInstead:
            'For logical/access grouping use `group`; for freeform labels use `tag`.'
    },
    tag: {
        kind: 'fleet-manager',
        purpose: 'Freeform key/value labels on devices and other subjects.',
        useInstead:
            'For structured grouping use `group`; for physical places use `location`.'
    },
    fleet: {
        kind: 'fleet-manager',
        purpose: 'Fleet-wide metrics and operations across a scope.'
    },
    fleetMap: {
        kind: 'fleet-manager',
        purpose: 'Map-dashboard snapshots: energy/signal/alerts per location.'
    },
    fleetSummary: {
        kind: 'fleet-manager',
        purpose: 'Org-wide live load and energy totals for summary tiles.'
    },
    dashboard: {
        kind: 'fleet-manager',
        purpose: 'User dashboards: cards, items, layout, ordering.'
    },
    alert: {
        kind: 'fleet-manager',
        purpose: 'Alert rules and alert instances (ack/silence/resolve).'
    },
    notification: {
        kind: 'fleet-manager',
        purpose:
            'Notification inbox, destinations/channels, and delivery history.'
    },
    notification_policy: {
        kind: 'fleet-manager',
        purpose: 'Routing and suppression policies for notifications.'
    },
    channel: {
        kind: 'fleet-manager',
        purpose: 'Outbound endpoints (webhook/email/slack/teams/telegram).'
    },
    report: {
        kind: 'fleet-manager',
        purpose: 'Generated reports (energy, dumps) and downloads.'
    },
    energy: {
        kind: 'fleet-manager',
        purpose: 'Energy queries, summaries, and classification.'
    },
    analytics: {
        kind: 'fleet-manager',
        purpose: 'Ad-hoc analytics such as brush-to-compare attribution.'
    },
    waitingroom: {
        kind: 'fleet-manager',
        purpose: 'Devices awaiting admission: approve/deny/quarantine.',
        useInstead: 'To actively find devices on the LAN use `discovery`.'
    },
    discovery: {
        kind: 'fleet-manager',
        purpose: 'Active onboarding: scan the LAN and admit a device.',
        useInstead: 'For devices that connected on their own use `waitingroom`.'
    },
    firmware: {
        kind: 'fleet-manager',
        purpose: 'Firmware update jobs and auto-update modes.'
    },
    backup: {
        kind: 'fleet-manager',
        purpose: 'Device config backup and restore jobs.'
    },
    user: {
        kind: 'fleet-manager',
        purpose: 'User accounts, profiles, and personal access tokens.',
        useInstead:
            'For groups of users use `user_group`; for roles use `persona`.'
    },
    user_group: {
        kind: 'fleet-manager',
        purpose: 'Groups of users (people, not devices).',
        useInstead: 'For grouping devices use `group`.'
    },
    persona: {
        kind: 'fleet-manager',
        purpose: 'Permission roles (personas).'
    },
    permission: {
        kind: 'fleet-manager',
        purpose: 'Role listings and permission grants.'
    },
    assignment: {
        kind: 'fleet-manager',
        purpose: 'Assign subjects to personas.'
    },
    organization: {
        kind: 'fleet-manager',
        purpose: 'Organization (tenant) profile and metadata.'
    }
};

import {
    ALERTS_PATH,
    DASHBOARDS_PATH,
    DEVICES_PATH,
    ORGANIZE_PATH,
    WAITING_ROOM_PATH
} from '@/constants';
import {getDeviceName} from '@/helpers/device';
import type {SearchCandidate} from '@/helpers/searchMatch';
import {
    SETTINGS_NAV_GROUPS,
    type SettingsNavGroup,
    type SettingsNavItem,
    settingsNavCandidate,
    settingsPageVisible
} from '@/helpers/settingsNavigation';

/**
 * The one place that turns everything searchable into candidates for
 * `searchMatch`. No component builds its own: a search result has to know
 * where it goes, and that answer belongs in one file. The settings sidebar
 * filters nav items rather than routing to them, so it keeps its own filter
 * and shares the searchable words through `settingsNavCandidate`.
 *
 * Two kinds of source feed this. Devices, locations, groups, tags, entities,
 * active alerts and pending devices are already sitting in the browser for
 * other reasons — turning them into candidates costs nothing. Alert rules,
 * dashboards, tariffs, personas, users, notification channels, destination
 * groups and message templates are not: each needs one backend call the app
 * does not already make, so `composables/useLazySearchSources.ts` fetches
 * them lazily and this file only ever sees what already arrived.
 */

export type SearchSourceKind =
    | 'page'
    | 'device'
    | 'location'
    | 'group'
    | 'tag'
    | 'entity'
    | 'alertInstance'
    | 'pendingDevice'
    | 'alertRule'
    | 'dashboard'
    | 'tariff'
    | 'persona'
    | 'user'
    | 'notificationChannel'
    | 'destinationGroup'
    | 'messageTemplate';

/** Everything the palette needs to show a result and act on it. */
export interface SearchTarget {
    kind: SearchSourceKind;
    /** The word a store manager reads, never the internal kind. */
    kindLabel: string;
    /** Unique within the kind. Several kinds share one route — every active
     *  alert opens the same inbox, every tariff the same list page — so
     *  recents keys off this, never off the route, to tell them apart. */
    id: string;
    /** Where opening the result goes. An in-app path unless `external`. */
    route: string;
    /** The route leaves the app, so it wants a new tab. */
    external?: boolean;
}

/** The little a search result needs from a device. */
export interface SearchableDevice {
    shellyID: string;
    /** As the device reported it. Only `name` and `id` steer the link. */
    info?: Record<string, unknown>;
}

/** The little a search result needs from a location, group, tag or one of
 *  the named settings records (rule, dashboard, tariff, persona, channel,
 *  destination group, message template). A persona's id is a string; the
 *  rest are numeric, so this takes either. */
export interface SearchableRecord {
    id: number | string;
    name: string;
}

/** A device component. The board has no page per component, so the label
 *  is the component's own name and the route lands on the owning device. */
export interface SearchableEntity {
    id: string;
    name: string;
    /** The shellyID of the device this component lives on. */
    source: string;
}

/** The little a search result needs from a firing alert. */
export interface SearchableAlertInstance {
    id: number;
    title: string;
}

/** The little a search result needs from a device waiting to be admitted.
 *  `status` is the raw device status the ingress reported, the same shape
 *  `WaitingRoomDeviceCard` reads its title from. */
export interface SearchablePendingDevice {
    shellyID: string;
    status?: Record<string, unknown>;
}

/** The little a search result needs from an organization user. */
export interface SearchableUser {
    userId: string;
    userName: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
}

export interface SearchSources {
    devices: Readonly<Record<string, SearchableDevice>>;
    locations: Readonly<Record<number, SearchableRecord>>;
    groups: Readonly<Record<number, SearchableRecord>>;
    tags: Readonly<Record<number, SearchableRecord>>;
    entities: Readonly<Record<string, SearchableEntity>>;
    activeAlerts: Readonly<Record<number, SearchableAlertInstance>>;
    pendingDevices: Readonly<Record<string, SearchablePendingDevice>>;
    /** Lazily fetched: empty until `useLazySearchSources` loads each one. */
    alertRules: Readonly<Record<number, SearchableRecord>>;
    dashboards: Readonly<Record<number, SearchableRecord>>;
    tariffs: Readonly<Record<number, SearchableRecord>>;
    personas: Readonly<Record<string, SearchableRecord>>;
    users: readonly SearchableUser[];
    notificationChannels: Readonly<Record<number, SearchableRecord>>;
    destinationGroups: Readonly<Record<number, SearchableRecord>>;
    messageTemplates: Readonly<Record<number, SearchableRecord>>;
    /** Hides a settings page this person cannot open, as the sidebar does. */
    canOpenPage: (path: string) => boolean;
}

const KIND_LABEL: Record<SearchSourceKind, string> = {
    page: 'Settings page',
    device: 'Device',
    location: 'Site',
    group: 'Group',
    tag: 'Tag',
    entity: 'Component',
    alertInstance: 'Active alert',
    pendingDevice: 'Pending device',
    alertRule: 'Alert rule',
    dashboard: 'Dashboard',
    tariff: 'Tariff',
    persona: 'Persona',
    user: 'User',
    notificationChannel: 'Notification channel',
    destinationGroup: 'Destination group',
    messageTemplate: 'Message template'
};

// The locations workspace is the organize landing page, so a deploy can move
// it. Groups and tags are fixed routes, written this way in `organize.vue`.
const GROUPS_PATH = '/organize/groups';
const TAGS_PATH = '/organize/tags';

// Fixed routes for the settings pages that manage these records. Channels
// and destination groups have a page per row (`[id].vue`); tariffs, personas,
// users and message templates do not, so a result for one of those opens the
// list instead — nothing to filter it by, same as a device with no board.
const TARIFFS_PATH = '/settings/energy/tariffs';
const PERSONAS_PATH = '/settings/personas';
const USERS_PATH = '/settings/users';
const CHANNELS_PATH = '/settings/alerts/channels';
const DESTINATIONS_PATH = '/settings/alerts/destinations';
const TEMPLATES_PATH = '/settings/alerts/templates';

/**
 * The devices board filters its list on `info.name` and `info.id`, so the term
 * has to be one of those. The name we show can come from the product name,
 * which that filter would never match.
 */
function deviceFilterTerm(device: SearchableDevice): string {
    const {id, name} = device.info ?? {};
    if (typeof id === 'string' && id.trim() !== '') return id;
    if (typeof name === 'string' && name.trim() !== '') return name;
    return device.shellyID;
}

/** A device has no page of its own: open the board, filtered down to it. */
function deviceRoute(device: SearchableDevice): string {
    return `${DEVICES_PATH}?search=${encodeURIComponent(
        deviceFilterTerm(device)
    )}`;
}

function pageCandidate(
    item: SettingsNavItem,
    group: SettingsNavGroup
): SearchCandidate<SearchTarget> {
    const target: SearchTarget = {
        kind: 'page',
        kindLabel: KIND_LABEL.page,
        id: item.path,
        route: item.path
    };
    if (item.external === true) target.external = true;
    // The sidebar's own label and words, pointed at the page instead.
    return {...settingsNavCandidate(item, group), value: target};
}

function deviceCandidate(
    device: SearchableDevice
): SearchCandidate<SearchTarget> {
    // Never blank: falls back to the id, then to a readable placeholder.
    const name = getDeviceName(device.info, device.shellyID);
    return {
        value: {
            kind: 'device',
            kindLabel: KIND_LABEL.device,
            id: device.shellyID,
            route: deviceRoute(device)
        },
        label: name,
        keywords: [device.shellyID],
        // An id is typed, not guessed. One wrong digit must find nothing.
        exact: true
    };
}

function locationCandidate(
    location: SearchableRecord
): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind: 'location',
            kindLabel: KIND_LABEL.location,
            id: String(location.id),
            route: `${ORGANIZE_PATH}?selected=${location.id}`
        },
        label: location.name
    };
}

function groupCandidate(
    group: SearchableRecord
): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind: 'group',
            kindLabel: KIND_LABEL.group,
            id: String(group.id),
            route: `${GROUPS_PATH}?preview=${group.id}`
        },
        label: group.name
    };
}

function tagCandidate(tag: SearchableRecord): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind: 'tag',
            kindLabel: KIND_LABEL.tag,
            id: String(tag.id),
            route: `${TAGS_PATH}/${tag.id}`
        },
        label: tag.name
    };
}

function entityCandidate(
    entity: SearchableEntity,
    devices: Readonly<Record<string, SearchableDevice>>
): SearchCandidate<SearchTarget> {
    // The owning device usually has a friendlier filter term than its raw
    // shellyID; fall back to the shellyID when the device itself is unknown.
    const owner = devices[entity.source];
    const route = owner
        ? deviceRoute(owner)
        : `${DEVICES_PATH}?search=${encodeURIComponent(entity.source)}`;
    return {
        value: {
            kind: 'entity',
            kindLabel: KIND_LABEL.entity,
            id: entity.id,
            route
        },
        label: entity.name || entity.id,
        keywords: [entity.id],
        // A component id is typed, not guessed, same as a device id.
        exact: true
    };
}

function activeAlertCandidate(
    instance: SearchableAlertInstance
): SearchCandidate<SearchTarget> {
    // No per-instance deep link exists — the bell itself opens the inbox,
    // not one alert, so a search result does the same.
    return {
        value: {
            kind: 'alertInstance',
            kindLabel: KIND_LABEL.alertInstance,
            id: String(instance.id),
            route: ALERTS_PATH
        },
        label: instance.title
    };
}

/** Same title rule `WaitingRoomDeviceCard` renders: device name, then the
 *  app name, then the model, then the shellyID nothing else answered. */
function pendingDeviceName(device: SearchablePendingDevice): string {
    const sys = device.status?.sys as
        | {app?: string; device?: {name?: string; model?: string}}
        | undefined;
    return (
        sys?.device?.name?.trim() ||
        sys?.app?.trim() ||
        sys?.device?.model?.trim() ||
        device.shellyID
    );
}

function pendingDeviceCandidate(
    device: SearchablePendingDevice
): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind: 'pendingDevice',
            kindLabel: KIND_LABEL.pendingDevice,
            id: device.shellyID,
            route: WAITING_ROOM_PATH
        },
        label: pendingDeviceName(device),
        keywords: [device.shellyID],
        exact: true
    };
}

/** A named settings record whose label is a person-chosen name, not an
 *  identifier — forgiving matching applies, same as a location or a tag. */
function namedCandidate(
    kind: SearchSourceKind,
    record: SearchableRecord,
    route: string
): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind,
            kindLabel: KIND_LABEL[kind],
            id: String(record.id),
            route
        },
        label: record.name
    };
}

function alertRuleCandidate(
    rule: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate(
        'alertRule',
        rule,
        `/settings/alerts/rules/${rule.id}`
    );
}

function dashboardCandidate(
    dashboard: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate(
        'dashboard',
        dashboard,
        `${DASHBOARDS_PATH}/${dashboard.id}`
    );
}

function tariffCandidate(
    tariff: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate('tariff', tariff, TARIFFS_PATH);
}

function personaCandidate(
    persona: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate('persona', persona, PERSONAS_PATH);
}

function notificationChannelCandidate(
    channel: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate(
        'notificationChannel',
        channel,
        `${CHANNELS_PATH}/${channel.id}`
    );
}

function destinationGroupCandidate(
    group: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate(
        'destinationGroup',
        group,
        `${DESTINATIONS_PATH}/${group.id}`
    );
}

function messageTemplateCandidate(
    template: SearchableRecord
): SearchCandidate<SearchTarget> {
    return namedCandidate('messageTemplate', template, TEMPLATES_PATH);
}

/** A display name a person recognises, never the bare Zitadel account row. */
function userLabel(user: SearchableUser): string {
    const full = [user.firstName, user.lastName]
        .filter((part) => part?.trim())
        .join(' ')
        .trim();
    return user.displayName?.trim() || full || user.userName || user.userId;
}

function userCandidate(user: SearchableUser): SearchCandidate<SearchTarget> {
    return {
        value: {
            kind: 'user',
            kindLabel: KIND_LABEL.user,
            id: user.userId,
            route: USERS_PATH
        },
        label: userLabel(user),
        keywords: [user.userName]
    };
}

function settingsPageCandidates(
    canOpenPage: (path: string) => boolean
): SearchCandidate<SearchTarget>[] {
    return SETTINGS_NAV_GROUPS.flatMap((group) =>
        group.items
            .filter((item) => settingsPageVisible(item, canOpenPage))
            .map((item) => pageCandidate(item, group))
    );
}

/**
 * Every candidate the palette can offer, in a stable order: the curated
 * settings pages first, then the records. Equal scores keep this order, so
 * the same query never reshuffles.
 */
export function buildSearchCandidates(
    sources: SearchSources
): SearchCandidate<SearchTarget>[] {
    return [
        ...settingsPageCandidates(sources.canOpenPage),
        ...Object.values(sources.devices).map(deviceCandidate),
        ...Object.values(sources.locations).map(locationCandidate),
        ...Object.values(sources.groups).map(groupCandidate),
        ...Object.values(sources.tags).map(tagCandidate),
        ...Object.values(sources.entities).map((entity) =>
            entityCandidate(entity, sources.devices)
        ),
        ...Object.values(sources.activeAlerts).map(activeAlertCandidate),
        ...Object.values(sources.pendingDevices).map(pendingDeviceCandidate),
        ...Object.values(sources.alertRules).map(alertRuleCandidate),
        ...Object.values(sources.dashboards).map(dashboardCandidate),
        ...Object.values(sources.tariffs).map(tariffCandidate),
        ...Object.values(sources.personas).map(personaCandidate),
        ...sources.users.map(userCandidate),
        ...Object.values(sources.notificationChannels).map(
            notificationChannelCandidate
        ),
        ...Object.values(sources.destinationGroups).map(
            destinationGroupCandidate
        ),
        ...Object.values(sources.messageTemplates).map(messageTemplateCandidate)
    ];
}

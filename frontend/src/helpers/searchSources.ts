// Registry of every searchable domain in the app. Adding a new entity type
// means one entry here — nowhere else. Data comes from Pinia stores (backend
// is the source of truth); this file only describes how to present matches.

import {DEVICES_PATH} from '@/constants';
import {DeviceBoard} from '@/helpers/components';
import {useAlertsStore} from '@/stores/alerts';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useChannelsStore} from '@/stores/channels';
import {useLocationsStore} from '@/stores/locations';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useTagsStore} from '@/stores/tags';

export interface SearchHit {
    id: string;
    label: string;
    meta: string;
    type: string;
    icon: string;
    route: string;
    // When set, selecting the hit runs this instead of navigating to `route`.
    action?: () => void;
}

export interface SearchSource {
    type: string;
    icon: string;
    label: string;
    items: () => readonly unknown[];
    keys: readonly string[];
    toHit: (raw: unknown) => SearchHit;
}

function deviceSource(): SearchSource {
    const store = useDevicesStore();
    const rightSide = useRightSideMenuStore();
    return {
        type: 'Device',
        icon: 'fas fa-microchip',
        label: 'Devices',
        items: () => Object.values(store.devices),
        keys: [
            'shellyID',
            'info.name',
            'info.model',
            'info.app',
            'info.mac',
            'settings.name'
        ],
        toHit: (raw) => {
            const d = raw as {
                shellyID: string;
                info?: {name?: string; app?: string; model?: string};
                settings?: {name?: string};
            };
            const name = d.settings?.name || d.info?.name || d.shellyID;
            const meta = [d.info?.app, d.shellyID].filter(Boolean).join(' · ');
            return {
                id: `device-${d.shellyID}`,
                label: name,
                meta,
                type: 'Device',
                icon: 'fas fa-microchip',
                // Devices have no detail route — selecting a device opens the
                // global right-side inspector (same as clicking its card).
                route: DEVICES_PATH,
                action: () =>
                    rightSide.showInspector(DeviceBoard, {
                        shellyID: d.shellyID
                    })
            };
        }
    };
}

function groupSource(): SearchSource {
    const store = useGroupsStore();
    return {
        type: 'Group',
        icon: 'fas fa-folder-tree',
        label: 'Groups',
        items: () => Object.values(store.groups),
        keys: ['name', 'description'],
        toHit: (raw) => {
            const g = raw as {
                id: number;
                name: string;
                devices?: string[];
            };
            const deviceCount = g.devices?.length ?? 0;
            return {
                id: `group-${g.id}`,
                label: g.name,
                meta: `${deviceCount} device${deviceCount === 1 ? '' : 's'}`,
                type: 'Group',
                icon: 'fas fa-folder-tree',
                route: `/organize/groups?preview=${g.id}`
            };
        }
    };
}

function tagSource(): SearchSource {
    const store = useTagsStore();
    return {
        type: 'Tag',
        icon: 'fas fa-tag',
        label: 'Tags',
        items: () => Object.values(store.tags),
        keys: ['name', 'key', 'description'],
        toHit: (raw) => {
            const t = raw as {id: number; name: string; key?: string};
            return {
                id: `tag-${t.id}`,
                label: t.name,
                meta: t.key ?? '',
                type: 'Tag',
                icon: 'fas fa-tag',
                route: `/organize/tags/${t.id}`
            };
        }
    };
}

function locationSource(): SearchSource {
    const store = useLocationsStore();
    return {
        type: 'Location',
        icon: 'fas fa-location-dot',
        label: 'Locations',
        items: () => Object.values(store.locations),
        keys: ['name', 'locationCode', 'kind'],
        toHit: (raw) => {
            const l = raw as {
                id: number;
                name: string;
                kind?: string;
                locationCode?: string;
            };
            const meta = [l.kind, l.locationCode].filter(Boolean).join(' · ');
            return {
                id: `location-${l.id}`,
                label: l.name,
                meta,
                type: 'Location',
                icon: 'fas fa-location-dot',
                route: `/organize/locations/${l.id}`
            };
        }
    };
}

function alertSource(): SearchSource {
    const store = useAlertsStore();
    return {
        type: 'Alert',
        icon: 'fas fa-triangle-exclamation',
        label: 'Alerts',
        items: () => Object.values(store.instances),
        keys: ['title', 'message', 'source.subjectId'],
        toHit: (raw) => {
            const a = raw as {id: number; title: string; severity: string};
            return {
                id: `alert-${a.id}`,
                label: a.title,
                meta: a.severity,
                type: 'Alert',
                icon: 'fas fa-triangle-exclamation',
                route: `/alerts?instance=${a.id}`
            };
        }
    };
}

function ruleSource(): SearchSource {
    const store = useAlertsStore();
    return {
        type: 'Rule',
        icon: 'fas fa-gavel',
        label: 'Rules',
        items: () => Object.values(store.rules),
        keys: ['name', 'kind'],
        toHit: (raw) => {
            const r = raw as {id: number; name: string; kind: string};
            return {
                id: `rule-${r.id}`,
                label: r.name,
                meta: r.kind,
                type: 'Rule',
                icon: 'fas fa-gavel',
                route: `/alerts/rules/${r.id}`
            };
        }
    };
}

function channelSource(): SearchSource {
    const store = useChannelsStore();
    return {
        type: 'Channel',
        icon: 'fas fa-plug',
        label: 'Channels',
        items: () => Object.values(store.channels),
        keys: ['name', 'provider'],
        toHit: (raw) => {
            const e = raw as {id: number; name: string; provider: string};
            return {
                id: `channel-${e.id}`,
                label: e.name,
                meta: e.provider,
                type: 'Channel',
                icon: 'fas fa-plug',
                route: `/alerts/channels/${e.id}`
            };
        }
    };
}

function destinationSource(): SearchSource {
    const store = useDestinationsStore();
    return {
        type: 'Destination',
        icon: 'fas fa-paper-plane',
        label: 'Destinations',
        items: () => Object.values(store.destinations),
        keys: ['name', 'description'],
        toHit: (raw) => {
            const d = raw as {id: number; name: string};
            return {
                id: `destination-${d.id}`,
                label: d.name,
                meta: '',
                type: 'Destination',
                icon: 'fas fa-paper-plane',
                route: `/alerts/destinations/${d.id}`
            };
        }
    };
}

function entitySource(): SearchSource {
    const store = useEntityStore();
    return {
        type: 'Entity',
        icon: 'fas fa-puzzle-piece',
        label: 'Entities',
        items: () => Object.values(store.entities),
        keys: ['id', 'type'],
        toHit: (raw) => {
            const e = raw as {id: string; type: string; source?: string};
            return {
                id: `entity-${e.id}`,
                label: e.id,
                meta: e.type,
                type: 'Entity',
                icon: 'fas fa-puzzle-piece',
                route: e.source ? `${DEVICES_PATH}/${e.source}` : DEVICES_PATH
            };
        }
    };
}

export function buildSearchSources(): SearchSource[] {
    return [
        deviceSource(),
        entitySource(),
        groupSource(),
        tagSource(),
        locationSource(),
        alertSource(),
        ruleSource(),
        channelSource(),
        destinationSource()
    ];
}

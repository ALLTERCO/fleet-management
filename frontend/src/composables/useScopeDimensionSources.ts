import {type ComputedRef, computed} from 'vue';
import {getDeviceName} from '@/helpers/device';
import type {ScopeDimensionKey, ScopeOption} from '@/helpers/scopeDimensions';
import {useAlertsStore} from '@/stores/alerts';
import {useDashboardsStore} from '@/stores/dashboards';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useChannelsStore} from '@/stores/channels';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';

// One home for "which store backs each scope dimension, and how its items
// become {value, label} picks". The picker stays a dumb strategy-map consumer.
export interface ScopeDimensionSource {
    // Load the backing list; call once when the dimension is first shown.
    // Absent for devices — the live connection keeps that store populated.
    fetch?: () => void;
    options: ComputedRef<ScopeOption[]>;
}

type SourceMap = Partial<Record<ScopeDimensionKey, ScopeDimensionSource>>;

function byLabel(a: ScopeOption, b: ScopeOption): number {
    return a.label.localeCompare(b.label);
}

export function useScopeDimensionSources(): SourceMap {
    const devicesStore = useDevicesStore();
    const locationsStore = useLocationsStore();
    const groupsStore = useGroupsStore();
    const tagsStore = useTagsStore();
    const dashboardsStore = useDashboardsStore();
    const alertsStore = useAlertsStore();
    const destinationsStore = useDestinationsStore();
    const channelsStore = useChannelsStore();

    return {
        device_ids: {
            options: computed(() =>
                Object.values(devicesStore.devices)
                    .map((d: {shellyID: string; info?: unknown}) => ({
                        value: d.shellyID,
                        label: getDeviceName(d.info as never, d.shellyID)
                    }))
                    .sort(byLabel)
            )
        },
        location_ids: {
            fetch: () => void locationsStore.fetchLocations(),
            options: computed(() =>
                Object.values(
                    locationsStore.locations as Record<
                        number,
                        {id: number; name?: string}
                    >
                )
                    .map((l) => ({value: l.id, label: l.name || `#${l.id}`}))
                    .sort(byLabel)
            )
        },
        device_group_ids: {
            fetch: () => void groupsStore.fetchGroups(),
            options: computed(() =>
                Object.values(
                    groupsStore.groups as Record<
                        number,
                        {id: number; name: string}
                    >
                )
                    .map((g) => ({value: g.id, label: g.name}))
                    .sort(byLabel)
            )
        },
        device_tags: {
            fetch: () => void tagsStore.fetchTags(),
            options: computed(() =>
                Object.values(
                    tagsStore.tags as Record<number, {id: number; key: string}>
                )
                    .map((t) => ({value: t.key, label: t.key}))
                    .sort(byLabel)
            )
        },
        dashboard_ids: {
            fetch: () => void dashboardsStore.fetchAll(),
            options: computed(() =>
                Object.values(
                    dashboardsStore.dashboards as Record<
                        number,
                        {id: number; name: string}
                    >
                )
                    .map((d) => ({value: d.id, label: d.name}))
                    .sort(byLabel)
            )
        },
        alert_ids: {
            fetch: () => void alertsStore.fetchRules(),
            options: computed(() =>
                Object.values(alertsStore.rules)
                    .map((r) => ({value: String(r.id), label: r.name}))
                    .sort(byLabel)
            )
        },
        notification_ids: {
            fetch: () => void destinationsStore.fetchDestinations(),
            options: computed(() =>
                Object.values(destinationsStore.destinations)
                    .map((d) => ({value: String(d.id), label: d.name}))
                    .sort(byLabel)
            )
        },
        integration_keys: {
            fetch: () => void channelsStore.fetchChannels(),
            options: computed(() =>
                Object.values(channelsStore.channels)
                    .map((e) => ({value: String(e.id), label: e.name}))
                    .sort(byLabel)
            )
        }
    };
}

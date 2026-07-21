<template>
    <PageTemplate
        fill
        v-model:search="nameFilter"
        title="Devices"
        :tabs="sectionTabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search devices…"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        :items="combinedItems"
        :page-size="50"
        pagination-mode="infinite"
        url-key="devices"
        :item-key="deviceItemKey"
        :empty="rawDevices.length === 0"
        empty-title="No devices found"
        empty-sub="Connect Shelly devices via their outbound websocket."
        @filter-click="filterVisible = true"
    >
        <template #actions>
            <AddDeviceMenu @pick="onAddDeviceKind" />
            <Button
                v-if="rawDevices.length > 0"
                :type="editMode ? 'red' : 'blue'"
                size="sm"
                @click="toggleEditMode"
            >
                {{ editMode ? 'Done' : 'Select' }}
            </Button>
        </template>

        <div v-if="activeTagChips.length > 0" class="dv-active-chips">
            <span class="dv-active-chips__label">
                <i class="fas fa-filter" /> Filtering by:
            </span>
            <button
                v-for="tag in activeTagChips"
                :key="tag.id"
                type="button"
                class="dv-active-chip"
                :title="`Remove ${tag.name} filter`"
                @click="removeTagFilter(tag.id)"
            >
                <TagChip :tag="tag" />
                <i class="fas fa-xmark dv-active-chip__x" />
            </button>
            <button
                v-if="activeTagChips.length > 1"
                type="button"
                class="dv-active-chips__clear"
                @click="tagFilter = []"
            >
                Clear all
            </button>
        </div>

        <template #item="{item}">
            <div v-if="item.kind === 'section'" class="grid-section">
                <div class="dc-section">
                    <span
                        class="dc-section-dot"
                        :style="{background: item.color}"
                    />
                    {{ item.label }}
                    <span class="sec-n">{{ item.count }}</span>
                </div>
            </div>
            <DeviceFleetCard
                v-else-if="item.kind === 'device' && item.data.shellyID"
                :device="item.data"
                :class="{
                    'dc-selected':
                        (editMode && item.data.selected) ||
                        activeDevice === item.data.shellyID
                }"
                @click.stop="clicked(item.data)"
            />
            <BTHomeDeviceWidget
                v-else-if="item.kind === 'sensor'"
                :device="(item.data as SensorDevice)"
                :selected="
                    editMode
                        ? selectedSensorIds.has(item.data.id)
                        : activeSensor === item.data.id
                "
                @click.stop="sensorClicked(item.data as BTHomeCard)"
            />
        </template>

        <template #modals>
            <ConfirmationModal ref="modalRefDelete">
                <template #title>
                    <h3>You are about to delete a device! <br />Proceed?</h3>
                </template>
            </ConfirmationModal>
            <FilterModal
                :visible="filterVisible"
                title="Filter Devices"
                match-label="devices"
                :match-count="deviceLikeMatchingCount"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterVisible = false"
                @apply-generic="applyFilters"
            />
            <AddDeviceWizard
                :visible="addDeviceWizardVisible"
                :kind="pendingKind"
                @close="addDeviceWizardVisible = false"
                @created="onVirtualDeviceCreated"
            />

            <!-- Bulk action bar — a fixed-position overlay. Lives in the modals
                 slot so the page keeps a single root element: a sibling block
                 makes the root a fragment the route <Transition> can't animate. -->
            <Transition name="bulk-slide">
                <div
                    v-if="editMode && selectedDevices.length === 0"
                    class="dv__bulk-wrap"
                >
                    <div class="dv__bulk dv__bulk--hint">
                        <i class="fas fa-hand-pointer" />
                        <span class="dv__bulk-hint">Click devices to select them</span>
                        <Button type="blue" size="sm" @click="selectAllDevices">Select All</Button>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            @click="cancelSelection"
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
                <div
                    v-else-if="editMode && selectedDevices.length > 0"
                    class="dv__bulk-wrap"
                >
                    <div class="dv__bulk">
                        <span class="dv__bulk-count">{{ selectedDevices.length }} selected</span>
                        <span class="dv__bulk-sep" />
                        <Button v-if="editMode" type="red" size="sm" @click="deleteSelectedDevices">
                            Delete
                        </Button>
                        <Button type="blue" size="sm" @click="selectAllDevices">
                            {{ allDevicesSelected ? 'Deselect All' : 'Select All' }}
                        </Button>
                        <Button type="blue-hollow" size="sm" @click="cancelSelection">Cancel</Button>
                    </div>
                </div>
            </Transition>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import '@/styles/device-page.css';
import type {DefineComponent} from 'vue';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import Button from '@/components/core/Button.vue';
import type {FilterSection} from '@/components/core/FilterModal.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import TagChip from '@/components/core/TagChip.vue';
import AddDeviceMenu from '@/components/devices/add/AddDeviceMenu.vue';
import AddDeviceWizard from '@/components/devices/add/AddDeviceWizard.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import BTHomeDeviceInspector from '@/components/pages/devices/BTHomeDeviceInspector.vue';
import BTHomeDeviceWidget from '@/components/widgets/BTHomeDeviceWidget.vue';
import {useDeviceSectionTabs} from '@/composables/useSectionTabs';
import {useSubjectAssociations} from '@/composables/useSubjectAssociations';
import {UI_CONFIG} from '@/config/ui';
import {
    buildPromotedBluByMac,
    promotedForAddr
} from '@/helpers/bluCardDedup';
import {DeviceBoard} from '@/helpers/components';
import {getDeviceName} from '@/helpers/device';
import {deleteFleetDevice} from '@/helpers/deviceDeleteRpc';
import {deviceTypeOf} from '@/helpers/deviceTypeFilter';
import {
    booleanSection,
    countByKey,
    deviceClassSection,
    enumSection,
    type KindedLocation,
    locationIdsFromState,
    locationSectionsByKind,
    locationStateByKind,
    namedSection
} from '@/helpers/filter-sections';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useRightSideMenuStore} from '@/stores/right-side';
import type {SensorDevice} from '@/stores/sensors';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import type {WizardKind} from '@/stores/virtualDeviceDraftStore';
import type {shelly_device_t} from '@/types';
import type {StatItem} from '@/types/page-template';

interface BTHomeCard extends SensorDevice {
    shellyID: string;
    bthomeDeviceId: number;
    addr: string;
    // Gateway presence — BLE sensors go unreachable when their gateway drops.
    online: boolean;
    // Set when the sensor has a promoted first-class device: the card is keyed
    // to it (its page + photo) while keeping the BTHome sensor look.
    promoted?: boolean;
}

interface ConfirmationModalHandle {
    storeAction(action: () => void | Promise<void>): void;
}

interface GridDevice {
    kind: 'device';
    data: shelly_device_t;
}
interface GridSensor {
    kind: 'sensor';
    data: BTHomeCard;
}
interface GridSection {
    kind: 'section';
    label: string;
    count: number;
    color: string;
}
type GridItem = GridDevice | GridSensor | GridSection;

type SortMode = 'online-az' | 'az' | 'za' | 'offline-first';

const deviceStore = useDevicesStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();
const toast = useToastStore();
const rightSideStore = useRightSideMenuStore();
const {tagsByDevice, locationsByDevice} = useSubjectAssociations();
const sectionTabs = useDeviceSectionTabs();

const route = useRoute();
const router = useRouter();

const STORAGE_KEY = 'fm-device-filters';

function loadSavedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        /* corrupt JSON — ignore */
    }
    return null;
}
const saved = loadSavedState();

const nameFilter = ref(String(route.query.search ?? saved?.nameFilter ?? ''));
const addDeviceWizardVisible = ref(false);
// The device kind picked in the add-device menu; seeds the wizard's first step.
const pendingKind = ref<WizardKind>(null);
const sortMode = ref<SortMode>(
    (route.query.sort as SortMode) ?? saved?.sortMode ?? 'online-az'
);
const statusFilter = ref<string[]>(saved?.statusFilter ?? []);
const typeFilter = ref<string[]>(saved?.typeFilter ?? []);
const groupFilter = ref<string[]>(saved?.groupFilter ?? []);
const tagFilter = ref<string[]>(saved?.tagFilter ?? []);
const sourceFilter = ref<string[]>(saved?.sourceFilter ?? []);
const locationFilter = ref<string[]>(saved?.locationFilter ?? []);

watch(
    [
        nameFilter,
        sortMode,
        statusFilter,
        typeFilter,
        groupFilter,
        tagFilter,
        sourceFilter,
        locationFilter
    ],
    () => {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    nameFilter: nameFilter.value,
                    sortMode: sortMode.value,
                    statusFilter: statusFilter.value,
                    typeFilter: typeFilter.value,
                    groupFilter: groupFilter.value,
                    tagFilter: tagFilter.value,
                    sourceFilter: sourceFilter.value,
                    locationFilter: locationFilter.value
                })
            );
        } catch {
            /* quota exceeded — non-fatal */
        }
    },
    {deep: true}
);

let _urlTimer: ReturnType<typeof setTimeout> | undefined;
watch([nameFilter, sortMode], ([search, sort]) => {
    clearTimeout(_urlTimer);
    _urlTimer = setTimeout(() => {
        const query: Record<string, string> = {};
        if (search) query.search = search;
        if (sort !== 'online-az') query.sort = sort;
        router.replace({query});
    }, UI_CONFIG.urlSyncDebounceMs);
});

const rawDevices = computed(() => {
    void deviceStore.devicesVersion;
    return Object.values(deviceStore.devices);
});
const modalRefDelete = ref<ConfirmationModalHandle>();
const filterVisible = ref(false);
const editMode = ref(false);
async function onVirtualDeviceCreated() {
    await deviceStore.refreshDevicesInBackground('devices');
}

function onAddDeviceKind(kind: WizardKind) {
    pendingKind.value = kind;
    addDeviceWizardVisible.value = true;
}
const activeDevice = ref<string | null>(null);
const activeSensor = ref<string | null>(null);
// Visual multi-select for BLU sensors — sensor cards are rebuilt on every
// recompute, so selection lives here by id, not as a flag on the object.
const selectedSensorIds = ref<Set<string>>(new Set());

const SORT_SECTION: FilterSection = {
    key: 'sort',
    label: 'Sort By',
    icon: 'fa-arrow-down-a-z',
    singleSelect: true,
    options: [
        {key: 'online-az', label: 'Online first (A-Z)'},
        {key: 'az', label: 'Name (A-Z)'},
        {key: 'za', label: 'Name (Z-A)'},
        {key: 'offline-first', label: 'Offline first'}
    ]
};

const filterSections = computed<FilterSection[]>(() => {
    const devs = rawDevices.value;
    const byType = countByKey(devs, (d) => d.info?.app ?? 'Unknown');
    const bySource = countByKey(devs, (d) => deviceTypeOf(d.source));
    const onlineCount = devs.filter((d) => d.online).length;

    const groupItems = Object.values(groupsStore.groups).map((g) => ({
        id: g.id,
        name: g.name
    }));
    const groupCounts = countByKey(
        devs.flatMap((d) => d.groupIds ?? []),
        (id) => id
    );

    const tagItems = Object.values(tagsStore.tags).map((t) => ({
        id: t.id,
        name: t.name
    }));
    const tagCounts = countByKey(
        Object.values(tagsByDevice.value).flat(),
        (id) => id
    );

    const locationCounts = countByKey(
        Object.values(locationsByDevice.value).flat(),
        (id) => id
    );

    return [
        SORT_SECTION,
        booleanSection(
            'status',
            'Status',
            'fa-wifi',
            'Online',
            'Offline',
            onlineCount,
            devs.length - onlineCount
        ),
        enumSection('type', 'Device Type', 'fa-microchip', byType),
        deviceClassSection(bySource),
        namedSection(
            'group',
            'Groups',
            'fa-folder-tree',
            groupItems,
            groupCounts
        ),
        namedSection('tag', 'Tags', 'fa-tag', tagItems, tagCounts),
        ...locationSectionsByKind(kindedLocations.value, locationCounts)
    ];
});

const kindedLocations = computed<KindedLocation[]>(() =>
    Object.values(locationsStore.locations).map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind
    }))
);

const activeFilterState = computed<Record<string, string[]>>(() => ({
    sort: [sortMode.value],
    status: statusFilter.value,
    type: typeFilter.value,
    group: groupFilter.value,
    tag: tagFilter.value,
    source: sourceFilter.value,
    ...locationStateByKind(locationFilter.value, kindedLocations.value)
}));

const activeFilterCount = computed(
    () =>
        (sortMode.value !== 'online-az' ? 1 : 0) +
        statusFilter.value.length +
        typeFilter.value.length +
        groupFilter.value.length +
        tagFilter.value.length +
        sourceFilter.value.length +
        locationFilter.value.length
);

// Visible chips for active tag filters — clicking removes one in place
// without opening the full filter modal.
const activeTagChips = computed(() =>
    tagFilter.value
        .map((id) => tagsStore.tags[Number(id)])
        .filter((t): t is NonNullable<typeof t> => !!t)
);

function removeTagFilter(tagId: number): void {
    tagFilter.value = tagFilter.value.filter((id) => Number(id) !== tagId);
}

function applyFilters(next: Record<string, string[]>) {
    const picked = next.sort?.[0];
    if (
        picked === 'online-az' ||
        picked === 'az' ||
        picked === 'za' ||
        picked === 'offline-first'
    ) {
        sortMode.value = picked;
    }
    statusFilter.value = next.status ?? [];
    typeFilter.value = next.type ?? [];
    groupFilter.value = next.group ?? [];
    tagFilter.value = next.tag ?? [];
    sourceFilter.value = next.source ?? [];
    locationFilter.value = Array.from(locationIdsFromState(next), String);
    filterVisible.value = false;
}

const showDevices = computed(() => {
    const typeSet = new Set(typeFilter.value);
    const sourceSet = new Set(sourceFilter.value);
    const groupSet = new Set(groupFilter.value.map(Number));
    const tagSet = new Set(tagFilter.value.map(Number));
    const locSet = new Set(locationFilter.value.map(Number));
    const tagIx = tagsByDevice.value;
    const locIx = locationsByDevice.value;

    let onlineNeeded: boolean | null = null;
    if (statusFilter.value[0] === 'true') onlineNeeded = true;
    else if (statusFilter.value[0] === 'false') onlineNeeded = false;

    const needle = nameFilter.value.toLowerCase();

    const filtered = rawDevices.value.filter((d) => {
        if (onlineNeeded !== null && d.online !== onlineNeeded) return false;
        if (typeSet.size > 0 && !typeSet.has(d.info?.app ?? '')) return false;
        if (sourceSet.size > 0 && !sourceSet.has(deviceTypeOf(d.source))) {
            return false;
        }
        if (groupSet.size > 0) {
            const gids = d.groupIds ?? [];
            if (!gids.some((id) => groupSet.has(id))) return false;
        }
        if (tagSet.size > 0) {
            const devTags = tagIx[d.shellyID] ?? [];
            if (!devTags.some((id) => tagSet.has(id))) return false;
        }
        if (locSet.size > 0) {
            const devLocs = locIx[d.shellyID] ?? [];
            if (!devLocs.some((id) => locSet.has(id))) return false;
        }
        if (needle) {
            const matches = [d.info?.name, d.info?.id].some(
                (t) => typeof t === 'string' && t.toLowerCase().includes(needle)
            );
            if (!matches) return false;
        }
        return true;
    });

    return filtered.sort((a, b) => {
        const nameA = (a.info?.name || a.shellyID || '').toLowerCase();
        const nameB = (b.info?.name || b.shellyID || '').toLowerCase();
        switch (sortMode.value) {
            case 'online-az':
                if (a.online !== b.online) return a.online ? -1 : 1;
                return nameA.localeCompare(nameB);
            case 'az':
                return nameA.localeCompare(nameB);
            case 'za':
                return nameB.localeCompare(nameA);
            case 'offline-first':
                if (a.online !== b.online) return a.online ? 1 : -1;
                return nameA.localeCompare(nameB);
            default:
                return 0;
        }
    });
});

const selectedDevices = computed(() => deviceStore.selectedDevices);

const BTHOME_CARD_KINDS = new Set([
    'door_window',
    'button',
    'remote_controller',
    'motion_sensor',
    'climate_sensor',
    'distance_sensor',
    'weather_station',
    'trv',
    'sensor'
]);

function buildBTHomeCard(
    device: shelly_device_t,
    settingsKey: string
): BTHomeCard | null {
    const cfg = (device.settings as Record<string, any>)?.[settingsKey];
    const componentId =
        cfg?.id ?? Number.parseInt(settingsKey.split(':')[1] ?? '', 10);
    if (!Number.isFinite(componentId)) return null;
    const status =
        componentId != null
            ? (device.status?.[`bthomedevice:${componentId}`] as Record<
                  string,
                  any
              > | null)
            : null;
    const overview = status?.overview as Record<string, any> | undefined;
    const addr =
        (typeof overview?.addr === 'string' && overview.addr) ||
        (typeof cfg?.addr === 'string' && cfg.addr);
    if (!addr) return null;

    const kind = BTHOME_CARD_KINDS.has(String(overview?.kind))
        ? (overview?.kind as SensorDevice['kind'])
        : 'sensor';
    const state =
        overview?.state === 'open' || overview?.state === 'closed'
            ? overview.state
            : undefined;
    const battery =
        typeof overview?.battery === 'number'
            ? overview.battery
            : typeof status?.battery === 'number'
              ? status.battery
              : undefined;
    const name =
        (typeof overview?.displayName === 'string' && overview.displayName) ||
        (typeof cfg?.name === 'string' && cfg.name.trim()) ||
        (typeof cfg?.productName === 'string' && cfg.productName) ||
        (typeof cfg?.meta?.productName === 'string' && cfg.meta.productName) ||
        (typeof cfg?.localName === 'string' && cfg.localName.trim()) ||
        (typeof cfg?.meta?.localName === 'string' && cfg.meta.localName.trim()) ||
        addr;

    const modelId =
        (typeof overview?.modelId === 'string' && overview.modelId) ||
        (typeof cfg?.modelId === 'string' && cfg.modelId) ||
        (typeof cfg?.meta?.modelId === 'string' && cfg.meta.modelId) ||
        '';
    const productName =
        (typeof overview?.productName === 'string' && overview.productName) ||
        (typeof cfg?.productName === 'string' && cfg.productName) ||
        (typeof cfg?.meta?.productName === 'string' && cfg.meta.productName) ||
        '';

    return {
        id: addr,
        shellyID: device.shellyID,
        bthomeDeviceId: componentId,
        addr,
        online: device.online,
        name,
        kind,
        ...(modelId ? {modelId} : {}),
        ...(productName ? {productName} : {}),
        ...(state ? {state} : {}),
        ...(battery != null ? {battery} : {}),
        ...(typeof overview?.activeChannelLabel === 'string' &&
        overview.activeChannelLabel.trim()
            ? {activeChannelLabel: overview.activeChannelLabel}
            : {}),
        ...(typeof overview?.summary === 'string' && overview.summary
            ? {summary: overview.summary}
            : {}),
        ...(typeof overview?.primaryDisplayValue === 'string' &&
        overview.primaryDisplayValue
            ? {primaryDisplayValue: overview.primaryDisplayValue}
            : {}),
        ...(typeof overview?.lastEventSummary === 'string' &&
        overview.lastEventSummary
            ? {lastEvent: overview.lastEventSummary}
            : typeof overview?.lastEvent === 'string' && overview.lastEvent
              ? {lastEvent: overview.lastEvent}
              : {})
    };
}

// One card per physical BLU sensor, classified once by BLE MAC:
// - gatewayChildren: not promoted, shown grouped under their gateway.
// - promotedByShellyID: promoted to a first-class device, keyed to that device
//   so the grid renders it there (its page, name, online) — never twice.
interface BTHomeCardSet {
    gatewayChildren: BTHomeCard[];
    promotedByShellyID: Map<string, BTHomeCard>;
}

function collectBTHomeCards(devices: shelly_device_t[]): BTHomeCardSet {
    const byMac = buildPromotedBluByMac(Object.values(deviceStore.devices));
    const seen = new Set<string>();
    const gatewayChildren: BTHomeCard[] = [];
    const promotedByShellyID = new Map<string, BTHomeCard>();
    for (const dev of devices) {
        const settings = dev.settings as Record<string, any>;
        for (const key of Object.keys(settings)) {
            if (!key.startsWith('bthomedevice:')) continue;
            const card = buildBTHomeCard(dev, key);
            if (!card || seen.has(card.id)) continue;
            seen.add(card.id);
            const promoted = promotedForAddr(card.addr, byMac);
            if (promoted)
                promotedByShellyID.set(
                    promoted.shellyID,
                    enrichPromotedCard(card, promoted)
                );
            else gatewayChildren.push(card);
        }
    }
    return {gatewayChildren, promotedByShellyID};
}

// Keep the sensor's configured name and live state, but route clicks/status to
// the promoted first-class device.
function enrichPromotedCard(
    card: BTHomeCard,
    promoted: shelly_device_t
): BTHomeCard {
    const model = (promoted.info as {model?: string} | undefined)?.model;
    const imageModel = promoted.meta?.bluetoothDevice?.visual?.imageModel;
    return {
        ...card,
        shellyID: promoted.shellyID,
        name: card.name || getDeviceName(promoted.info, promoted.shellyID),
        online: promoted.online,
        promoted: true,
        ...(model ? {modelId: model} : {}),
        ...(imageModel ? {imageModel} : {})
    };
}

const allCards = computed(() => collectBTHomeCards(rawDevices.value));
const visibleCards = computed(() => collectBTHomeCards(showDevices.value));
const allBTHomeCards = computed(() => allCards.value.gatewayChildren);
const visibleBTHomeCards = computed(() => visibleCards.value.gatewayChildren);
const promotedSensorCards = computed(() => allCards.value.promotedByShellyID);
const deviceLikeTotalCount = computed(
    () => rawDevices.value.length + allBTHomeCards.value.length
);
const deviceLikeMatchingCount = computed(
    () => showDevices.value.length + visibleBTHomeCards.value.length
);
const deviceLikeOnlineCount = computed(
    () =>
        deviceStore.onlineCount +
        allBTHomeCards.value.filter((sensor) => sensor.online).length
);

const headerStats = computed<StatItem[]>(() => {
    const total = deviceLikeTotalCount.value;
    const filtered = deviceLikeMatchingCount.value;
    const stats: StatItem[] = [
        {value: total, label: 'devices', status: 'on'},
        {value: deviceLikeOnlineCount.value, label: 'online'}
    ];
    if (filtered !== total) {
        stats.push({value: filtered, label: 'matching', highlight: true});
    }
    return stats;
});

const combinedItems = computed<GridItem[]>(() => {
    const result: GridItem[] = [];
    const devices = showDevices.value;
    const sensorsByGateway = new Map<string, BTHomeCard[]>();
    for (const sensor of visibleBTHomeCards.value) {
        const list = sensorsByGateway.get(sensor.shellyID) ?? [];
        list.push(sensor);
        sensorsByGateway.set(sensor.shellyID, list);
    }
    const grouped =
        sortMode.value === 'online-az' || sortMode.value === 'offline-first';

    let onlineCount = 0;
    let offlineCount = 0;
    if (grouped) {
        for (const dev of devices) {
            if (dev.online) onlineCount++;
            else offlineCount++;
        }
    }

    let lastOnline: boolean | null = null;
    for (const dev of devices) {
        if (grouped && dev.online !== lastOnline) {
            if (dev.online)
                result.push({
                    kind: 'section',
                    label: 'Online',
                    count: onlineCount,
                    color: 'var(--color-status-on)'
                });
            else
                result.push({
                    kind: 'section',
                    label: 'Offline',
                    count: offlineCount,
                    color: 'var(--color-status-off)'
                });
            lastOnline = dev.online;
        }
        // A promoted BLU sensor renders as its sensor card (keeps the door/
        // window + battery look), not a plain device card.
        const promotedCard = promotedSensorCards.value.get(dev.shellyID);
        if (promotedCard) {
            result.push({kind: 'sensor', data: promotedCard});
            continue;
        }
        result.push({kind: 'device', data: dev});
        for (const sensor of sensorsByGateway.get(dev.shellyID) ?? []) {
            result.push({kind: 'sensor', data: sensor});
        }
    }
    return result;
});

function deviceItemKey(item: GridItem): string | number {
    if (item.kind === 'section') return `section:${item.label}`;
    if (item.kind === 'device') return item.data.shellyID;
    return `sensor:${item.data.id}`;
}

function toggleEditMode() {
    for (const d of selectedDevices.value) d.selected = false;
    selectedSensorIds.value.clear();
    editMode.value = !editMode.value;
}

const allDevicesSelected = computed(() => {
    const devs = showDevices.value;
    return devs.length > 0 && devs.every((d) => d.selected);
});

function selectAllDevices() {
    const shouldSelect = !allDevicesSelected.value;
    for (const d of showDevices.value) d.selected = shouldSelect;
}

function clearSelection() {
    for (const d of selectedDevices.value) d.selected = false;
}

function cancelSelection() {
    clearSelection();
    selectedSensorIds.value.clear();
    editMode.value = false;
}

function deleteSelectedDevices() {
    const toDelete = selectedDevices.value.slice();
    if (!toDelete.length) return;
    modalRefDelete.value?.storeAction(async () => {
        let deleted = 0;
        for (const dev of toDelete) {
            try {
                await deleteFleetDevice(dev);
                deviceStore.deviceDeleted(dev.shellyID);
                deleted += 1;
            } catch {
                toast.error(`Failed to delete ${dev.shellyID}`);
            }
        }
        if (deleted > 0) {
            toast.success(
                deleted === 1
                    ? 'Device deleted'
                    : `${deleted} devices deleted`
            );
        }
        rightSideStore.clearInspector();
        activeDevice.value = null;
    });
}

function clicked(device: shelly_device_t) {
    if (editMode.value) {
        device.selected = !device.selected;
    } else {
        rightSideStore.showInspector(DeviceBoard, {shellyID: device.shellyID});
        activeDevice.value = device.shellyID;
    }
}

function sensorClicked(sensor: BTHomeCard) {
    if (editMode.value) {
        if (selectedSensorIds.value.has(sensor.id)) {
            selectedSensorIds.value.delete(sensor.id);
        } else {
            selectedSensorIds.value.add(sensor.id);
        }
        return;
    }
    // A promoted sensor is a first-class device — open its device page.
    if (sensor.promoted) {
        rightSideStore.showInspector(DeviceBoard, {shellyID: sensor.shellyID});
        activeDevice.value = sensor.shellyID;
        return;
    }
    activeSensor.value = activeSensor.value === sensor.id ? null : sensor.id;
    rightSideStore.showInspector(
        BTHomeDeviceInspector as unknown as DefineComponent,
        {
            shellyID: sensor.shellyID,
            bthomeDeviceId: sensor.bthomeDeviceId,
            addr: sensor.addr,
            displayName: sensor.name
        }
    );
}

onMounted(() => {
    deviceStore.refreshDevicesInBackground('devices');
});

onUnmounted(() => rightSideStore.clearInspector());

watch(
    () => rightSideStore.inspectorComponent,
    (comp) => {
        if (!comp) activeDevice.value = null;
    }
);
</script>

<style scoped>
.dv-active-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--type-caption);
}
.dv-active-chips__label {
    color: var(--color-text-tertiary);
    font-weight: 600;
}
.dv-active-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
}
.dv-active-chip__x {
    opacity: 0.5;
    font-size: 0.7em;
    color: var(--color-text-tertiary);
}
.dv-active-chip:hover .dv-active-chip__x {
    opacity: 1;
}
.dv-active-chips__clear {
    background: transparent;
    border: 1px solid var(--color-border-medium);
    color: var(--color-text-secondary);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    cursor: pointer;
    font-size: var(--type-caption);
}
.dv-active-chips__clear:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}

.dv__btn--active {
    box-shadow: 0 0 0 2px var(--color-primary);
}

.dv__bulk-wrap {
    position: fixed;
    bottom: var(--gap-md);
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
}
.dv__bulk {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    box-shadow: var(--shadow-lg);
}
.dv__bulk--hint {
    color: var(--color-text-tertiary);
}
.dv__bulk--hint i { opacity: 0.5; }
.dv__bulk-hint {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    white-space: nowrap;
}
.dv__bulk-count {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    white-space: nowrap;
}
.dv__bulk-sep {
    width: 1px;
    height: var(--gap-sm);
    background: var(--color-border-medium);
    flex-shrink: 0;
}

.bulk-slide-enter-active, .bulk-slide-leave-active {
    transition: transform 0.25s ease, opacity 0.25s ease;
}
.bulk-slide-enter-from, .bulk-slide-leave-to {
    transform: translateX(-50%) translateY(var(--gap-md));
    opacity: 0;
}

.grid-section {
    padding: 0;
    margin-top: calc(-1 * var(--space-1));
    margin-bottom: calc(-1 * var(--space-1-5));
}
:deep(.dc-section) {
    margin-top: 0;
    margin-bottom: 0;
}
</style>

<template>
    <div class="scp">
        <div v-if="supportedScopeTypes.length === 0" class="scp__empty">
            This alert has a fixed scope and can't be narrowed.
        </div>

        <template v-else>
            <!-- Search and the type tabs share one line. -->
            <div class="scp__bar">
                <Input
                    v-model="query"
                    class="scp__search"
                    placeholder="Search devices, groups, locations, tags…"
                />
                <!-- One category is no choice; a zero-category toggle renders
                     an empty, degenerate slider — show tabs only when they
                     actually let the user switch. -->
                <ViewToggle
                    v-if="catOptions.length > 1"
                    v-model="cat"
                    :options="catOptions"
                    class="scp__tabs"
                />
            </div>

            <div v-if="!noResults" class="scp__panel">
                <div class="scp__toolbar">
                    <span class="scp__sel">
                        {{ selectedCount }} of {{ activeIds.length }} selected
                    </span>
                    <Button
                        v-if="!single"
                        type="blue-hollow"
                        size="sm"
                        @click="allSelected ? clearActive() : selectAllActive()"
                    >
                        {{ allSelected ? 'Clear' : 'Select all' }}
                    </Button>
                </div>

                <!-- Real entity cards; click a card to select it (glow). -->
                <div class="scp__grid-wrap">
                    <div class="dc-grid">
                        <template v-if="cat === 'device'">
                            <DeviceFleetCard
                                v-for="d in filteredDevices"
                                :key="d.shellyID"
                                :device="d.dev"
                                :selected="isDevicePicked(d.shellyID)"
                                @select="toggleDevice(d.shellyID)"
                            />
                            <!-- BLU sensors: components on a gateway, pickable here too. -->
                            <button
                                v-for="s in filteredBluSensors"
                                :key="s.entityId"
                                type="button"
                                class="scp__blu"
                                :class="{'scp__blu--on': isEntityPicked(s.entityId)}"
                                @click="toggleEntity(s.entityId)"
                            >
                                <i class="fas fa-satellite-dish scp__blu-icon" />
                                <span class="scp__blu-name">{{ s.label }}</span>
                            </button>
                        </template>

                        <template v-else-if="cat === 'group'">
                            <CardValue_Group
                                v-for="g in filteredGroups"
                                :key="g.id"
                                :group="g"
                                size="1x1"
                                :resizable="false"
                                :selected="isPicked('groupIds', g.id)"
                                @open-preview="toggleInt('groupIds', g.id)"
                            />
                        </template>

                        <template v-else-if="cat === 'location'">
                            <CardValue_Location
                                v-for="l in filteredLocations"
                                :key="l.id"
                                :location="l"
                                size="1x1"
                                :resizable="false"
                                :selected="isPicked('locationIds', l.id)"
                                @open-preview="toggleInt('locationIds', l.id)"
                            />
                        </template>

                        <template v-else-if="cat === 'tag'">
                            <CardValue_Tag
                                v-for="t in filteredTags"
                                :key="t.id"
                                :tag="t"
                                size="1x1"
                                :resizable="false"
                                :selected="isPicked('tagIds', t.id)"
                                @open-preview="toggleInt('tagIds', t.id)"
                            />
                        </template>
                    </div>
                </div>
            </div>

            <p v-else class="scp__empty">{{ emptyMessage }}</p>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {AlertScopeType, ScopeSelector} from '@api/alert';
import {computed, onMounted, ref} from 'vue';
import CardValue_Group from '@/components/cards/CardValue_Group.vue';
import CardValue_Location from '@/components/cards/CardValue_Location.vue';
import CardValue_Tag from '@/components/cards/CardValue_Tag.vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import ViewToggle, {
    type ViewToggleOption
} from '@/components/core/ViewToggle.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {buildPromotedBluByMac} from '@/helpers/bluCardDedup';
import {getDeviceName} from '@/helpers/device';
import {listBluSensorTargets} from '@/helpers/componentStateTargets';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import type {shelly_device_t} from '@/types';

const model = defineModel<ScopeSelector>({required: true});

const props = defineProps<{
    supportedScopeTypes: AlertScopeType[];
    single?: boolean;
}>();

const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const groupsStore = useGroupsStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();
const single = computed(() => props.single === true);

type Cat = 'device' | 'group' | 'location' | 'tag';
const query = ref('');
// Always default to Devices; the filter shows one category at a time.
const cat = ref<Cat>('device');

const CAT_LABELS: Record<Cat, string> = {
    device: 'Devices',
    group: 'Groups',
    location: 'Locations',
    tag: 'Tags'
};

const catOptions = computed<ViewToggleOption<Cat>[]>(() =>
    (['device', 'group', 'location', 'tag'] as Cat[])
        .filter((c) => supports(c))
        .map((c) => ({value: c, label: CAT_LABELS[c]}))
);

onMounted(() => {
    // If this kind can't scope by device, fall back to the first type it can.
    if (!supports('device') && catOptions.value[0]) {
        cat.value = catOptions.value[0].value;
    }
    if (supports('group')) groupsStore.fetchGroups();
    if (supports('location')) locationsStore.fetchLocations();
    if (supports('tag')) tagsStore.fetchTags();
});

function supports(type: AlertScopeType): boolean {
    return props.supportedScopeTypes.includes(type);
}

function showSection(type: Cat): boolean {
    return cat.value === type && supports(type);
}

const sortedDevices = computed(() =>
    Object.values(devicesStore.devices)
        .map((dev) => ({
            dev: dev as shelly_device_t,
            shellyID: dev.shellyID,
            name: getDeviceName(dev.info, dev.shellyID)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
);
const fuzzyDevices = useFuzzySearch(sortedDevices, query, {
    keys: ['name', 'shellyID']
});
const filteredDevices = computed(() => fuzzyDevices.value.slice(0, 200));

// A promoted BLU sensor is already a device row, so exclude it from the sensor
// list — keyed by MAC, one row per physical sensor.
const promotedBluMacs = computed(
    () =>
        new Set(
            buildPromotedBluByMac(Object.values(devicesStore.devices)).keys()
        )
);

// BLU sensors are entities (bthomesensor), not device records — surface the
// un-promoted ones in the device tab so they're pickable when the kind allows
// entity scope.
const sortedBluSensors = computed(() =>
    supports('component')
        ? listBluSensorTargets(
              Object.values(entityStore.entities),
              promotedBluMacs.value
          ).sort((a, b) => a.label.localeCompare(b.label))
        : []
);
const fuzzyBluSensors = useFuzzySearch(sortedBluSensors, query, {
    keys: ['label', 'entityId']
});
const filteredBluSensors = computed(() => fuzzyBluSensors.value.slice(0, 200));

const sortedGroups = computed(() =>
    Object.values(groupsStore.groups).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const filteredGroups = useFuzzySearch(sortedGroups, query, {keys: ['name']});

const sortedLocations = computed(() =>
    Object.values(locationsStore.locations).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const filteredLocations = useFuzzySearch(sortedLocations, query, {
    keys: ['name']
});

const sortedTags = computed(() =>
    Object.values(tagsStore.tags).sort((a, b) => a.name.localeCompare(b.name))
);
const filteredTags = useFuzzySearch(sortedTags, query, {keys: ['name', 'key']});

const emptyMessage = computed(() => {
    if (query.value.trim()) return `No matches for “${query.value}”.`;
    return `No ${CAT_LABELS[cat.value].toLowerCase()} available yet.`;
});

const noResults = computed(() => {
    const anyVisible =
        (showSection('device') &&
            (filteredDevices.value.length > 0 ||
                filteredBluSensors.value.length > 0)) ||
        (showSection('group') && filteredGroups.value.length > 0) ||
        (showSection('location') && filteredLocations.value.length > 0) ||
        (showSection('tag') && filteredTags.value.length > 0);
    return !anyVisible;
});

type IntField = 'groupIds' | 'locationIds' | 'tagIds';

function isPicked(field: IntField, value: number): boolean {
    return (model.value[field] ?? []).includes(value);
}

function toggleInt(field: IntField, value: number) {
    const arr = model.value[field] ?? [];
    const next = arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value];
    model.value = single.value ? {[field]: next.slice(-1)} : {...model.value, [field]: next};
}

function isDevicePicked(shellyID: string): boolean {
    return (model.value.deviceIds ?? []).includes(shellyID);
}

function toggleDevice(shellyID: string) {
    const arr = model.value.deviceIds ?? [];
    const next = arr.includes(shellyID)
        ? arr.filter((v) => v !== shellyID)
        : [...arr, shellyID];
    model.value = single.value ? {deviceIds: next.slice(-1)} : {...model.value, deviceIds: next};
}

function isEntityPicked(entityId: string): boolean {
    return (model.value.componentIds ?? []).includes(entityId);
}

function toggleEntity(entityId: string) {
    const arr = model.value.componentIds ?? [];
    const next = arr.includes(entityId)
        ? arr.filter((v) => v !== entityId)
        : [...arr, entityId];
    model.value = single.value ? {componentIds: next.slice(-1)} : {...model.value, componentIds: next};
}

// ── Select all / clear for the category on screen ───────────────────────
const activeIds = computed<Array<string | number>>(() => {
    switch (cat.value) {
        case 'device':
            return filteredDevices.value.map((d) => d.shellyID);
        case 'group':
            return filteredGroups.value.map((g) => g.id);
        case 'location':
            return filteredLocations.value.map((l) => l.id);
        case 'tag':
            return filteredTags.value.map((t) => t.id);
        default:
            return [];
    }
});

function fieldFor(c: Cat): 'deviceIds' | IntField {
    return c === 'device' ? 'deviceIds' : (`${c}Ids` as IntField);
}

const selectedCount = computed(() => {
    const sel = new Set(
        (model.value[fieldFor(cat.value)] ?? []) as Array<string | number>
    );
    return activeIds.value.filter((id) => sel.has(id)).length;
});

const allSelected = computed(
    () =>
        activeIds.value.length > 0 &&
        selectedCount.value === activeIds.value.length
);

function selectAllActive() {
    const field = fieldFor(cat.value);
    const cur = new Set<string | number>(
        (model.value[field] ?? []) as Array<string | number>
    );
    for (const id of activeIds.value) cur.add(id);
    model.value = {...model.value, [field]: [...cur]};
}

function clearActive() {
    const field = fieldFor(cat.value);
    const ids = new Set(activeIds.value);
    const next = ((model.value[field] ?? []) as Array<string | number>).filter(
        (v) => !ids.has(v)
    );
    model.value = {...model.value, [field]: next};
}
</script>

<style scoped>
.scp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.scp__empty {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-md);
}

/* Search and the type tabs share one line. */
.scp__bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.scp__search {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
}
/* Let the toggle size to its tabs instead of the shared 320px cap. The class
   lands on the toggle's root, so the scoped attribute outranks the global cap. */
.scp__tabs {
    flex: 0 0 auto;
    width: auto;
    max-width: none;
}

.scp__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.scp__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.scp__sel {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

/* Scrollable card grid; cells use the shared --grid-cell sizing via .dc-grid. */
.scp__grid-wrap {
    max-height: 360px;
    overflow-y: auto;
}

/* BLU sensor tile — a device-sized selectable card in the device grid. */
.scp__blu {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: var(--grid-cell, 200px);
    height: var(--grid-cell, 200px);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-card);
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: center;
    transition:
        border-color var(--motion-hover),
        box-shadow var(--motion-hover);
}
.scp__blu:hover {
    border-color: var(--color-primary);
}
.scp__blu--on {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
}
.scp__blu-icon {
    font-size: var(--icon-size-xl);
    color: var(--color-ble, var(--color-primary));
}
.scp__blu-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
</style>

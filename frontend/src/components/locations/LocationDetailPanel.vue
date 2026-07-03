<template>
    <article class="ldp">
        <header class="ldp__hdr">
            <LocationBreadcrumbs v-if="path.length > 0" :items="path" />
            <div class="ldp__hdr-row">
                <h1 class="ldp__name">{{ location?.name ?? loadingLabel }}</h1>
                <span v-if="metaLabel" class="ldp__meta">{{ metaLabel }}</span>
                <button
                    v-if="canEdit"
                    type="button"
                    class="ldp__edit-btn"
                    aria-label="Edit location"
                    title="Edit location"
                    @click="openEdit"
                >
                    <i class="fas fa-pen" aria-hidden="true" />
                </button>
            </div>
            <SubjectTagPicker
                v-if="location"
                subject-type="location"
                :subject-id="String(location.id)"
                class="ldp__tags"
            />
        </header>

        <LocationGeoInset
            v-if="locationGeo && location"
            class="ldp__geo"
            :geo="locationGeo"
            :location-name="location.name"
        />

        <LocationKpiStrip
            :kind="location?.kind ?? null"
            :device-count="rollups.deviceCount.value"
            :online-split="rollups.onlineSplit.value"
            :alert-count="rollups.alertCount.value"
            :power-sum-watts="rollups.powerSumWatts.value"
            :temperature="rollups.temperature.value"
        />

        <DetailTabs
            :tabs="tabs"
            :active="activeTab"
            @change="onTabChange"
        />

        <div class="ldp__body">
            <LocationOverviewTab
                v-if="activeTab === 'overview'"
                :location="location"
                @navigate="$emit('navigate', $event)"
            />
            <LocationPlanTab
                v-else-if="activeTab === 'plan'"
                :location="location"
                @navigate="$emit('navigate', $event)"
            />
            <LocationDevicesTab
                v-else-if="activeTab === 'devices'"
                :location-id="locationId"
                :subtree-ids="rollups.subtreeIds.value"
                :scope-label="scopeLabel"
            />
            <LocationSettingsTab
                v-else
                :can-delete="canDelete"
                @open-edit="openEdit"
                @request-delete="$emit('request-delete')"
            />
        </div>

        <LocationFormModal
            v-if="location"
            v-model="editVisible"
            mode="edit"
            :initial="location"
        />
    </article>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import DetailTabs from '@/components/core/DetailTabs.vue';
import LocationBreadcrumbs from '@/components/core/LocationBreadcrumbs.vue';
import SubjectTagPicker from '@/components/core/SubjectTagPicker.vue';
import LocationDevicesTab from '@/components/locations/LocationDevicesTab.vue';
import LocationGeoInset from '@/components/locations/LocationGeoInset.vue';
import LocationKpiStrip from '@/components/locations/LocationKpiStrip.vue';
import LocationOverviewTab from '@/components/locations/LocationOverviewTab.vue';
import LocationPlanTab from '@/components/locations/LocationPlanTab.vue';
import LocationSettingsTab from '@/components/locations/LocationSettingsTab.vue';
import LocationFormModal from '@/components/modals/LocationFormModal.vue';
import {useKeyboardShortcuts} from '@/composables/useKeyboardShortcuts';
import {useLocationRollups} from '@/composables/useLocationRollups';
import {usePermissions} from '@/composables/usePermissions';
import {tabFromDigit} from '@/helpers/keyboardShortcuts';
import {locationGeoLatLng} from '@/helpers/location-geo';
import type {DetailTabKey} from '@/helpers/locationsUrlState';
import type {ApiLocation, LocationBreadcrumbEntry} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';

export type {DetailTabKey} from '@/helpers/locationsUrlState';

const props = defineProps<{
    locationId: number;
    activeTab: DetailTabKey;
}>();

const emit = defineEmits<{
    'tab-change': [tab: DetailTabKey];
    'request-delete': [];
    navigate: [locationId: number];
}>();

const locations = useLocationsStore();
const {canWrite} = usePermissions();

const location = computed<ApiLocation | null>(
    () => locations.locations[props.locationId] ?? null
);

const selectedRef = computed<number | null>(() => props.locationId);
const rollups = useLocationRollups(selectedRef);
const locationGeo = computed(() =>
    location.value ? locationGeoLatLng(location.value) : null
);

const path = ref<LocationBreadcrumbEntry[]>([]);

watch(
    () => props.locationId,
    async (id) => {
        path.value = await locations.fetchPath(id);
        if (location.value == null) await locations.fetchLocation(id);
    },
    {immediate: true}
);

const editVisible = ref(false);

const loadingLabel = 'Loading…';

const scopeLabel = computed(() => {
    const kind = location.value?.kind;
    return kind ?? 'location';
});

const metaLabel = computed(() => {
    const loc = location.value;
    if (loc == null) return null;
    const kindLabel = locations.kindLabel(loc.kind);
    const devices = rollups.deviceCount.value;
    return `${kindLabel} · ${devices} device${devices === 1 ? '' : 's'}`;
});

const tabs = computed<{id: DetailTabKey; label: string; icon: string}[]>(() => [
    {id: 'overview', label: 'Overview', icon: 'fas fa-circle-info'},
    {id: 'plan', label: 'Plan', icon: 'fas fa-cube'},
    {id: 'devices', label: 'Devices', icon: 'fas fa-plug'},
    {id: 'settings', label: 'Settings', icon: 'fas fa-sliders'}
]);

const canEdit = computed(() => canWrite.value);
const canDelete = computed(() => canWrite.value);

function onTabChange(tabId: string): void {
    const allowed: DetailTabKey[] = ['overview', 'plan', 'devices', 'settings'];
    if (allowed.includes(tabId as DetailTabKey)) {
        emit('tab-change', tabId as DetailTabKey);
    }
}

function openEdit(): void {
    trackInteraction('locations', 'edit_modal_open', String(props.locationId));
    editVisible.value = true;
}

// Keyboard shortcuts — 1-4 switch tabs, e opens edit.
// Editable-target guard in useKeyboardShortcuts skips when typing.
function switchTabByDigit(event: KeyboardEvent): void {
    const tab = tabFromDigit(event.key);
    if (tab != null) emit('tab-change', tab);
}

useKeyboardShortcuts({
    bindings: [
        {key: ['1', '2', '3', '4'], handler: switchTabByDigit},
        {
            key: 'e',
            handler: () => {
                if (canEdit.value) openEdit();
            }
        }
    ]
});
</script>

<style scoped>
.ldp {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.ldp__hdr {
    padding: var(--space-5) var(--space-5) var(--space-3);
}

.ldp__hdr-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-top: var(--space-2);
}

.ldp__edit-btn {
    margin-left: auto;
    flex-shrink: 0;
    align-self: center;
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-tertiary);
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: var(--icon-size-sm);
    transition:
        background var(--duration-fast),
        color var(--duration-fast),
        border-color var(--duration-fast);
    position: relative;
}

.ldp__edit-btn::after {
    content: "";
    position: absolute;
    inset: -6px;
}

.ldp__edit-btn:hover {
    background: var(--state-hover-bg);
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}

.ldp__edit-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
}

.ldp__name {
    font-size: var(--type-heading);
    font-weight: var(--font-medium);
    letter-spacing: -0.02em;
    color: var(--color-text-primary);
    margin: 0;
    line-height: var(--leading-tight);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ldp__meta {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
}

.ldp__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.ldp__geo {
    margin: 0 var(--space-5) var(--space-3);
    flex-shrink: 0;
}
</style>

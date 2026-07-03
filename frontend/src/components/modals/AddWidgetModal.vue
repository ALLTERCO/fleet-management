<template>
    <SteppedModal
        v-model:stage="stage"
        v-model:visible="modals.addWidget"
        :max-steps="maxSteps"
        wide
        @onchange="stageChanged"
        @save="onSave"
        @close="onClose"
    >
        <template #stepTitle="{ stage: s }">
            <span v-if="category === 'devices'" class="font-semibold">
                {{ s === 1 ? 'Device' : s === 2 ? 'Components' : 'Size' }}
            </span>
            <span v-else class="font-semibold">
                {{ CATEGORIES.find(c => c.id === category)?.label }}
            </span>
        </template>

        <template #default="{ stage: s }">
            <div class="awm">
                <!-- ══════════════════════════════════════════
                     Stage 1: Category tabs + selection grid
                     ══════════════════════════════════════════ -->
                <template v-if="s === 1">
                    <div class="cat-tabs">
                        <button
                            v-for="cat in CATEGORIES"
                            :key="cat.id"
                            class="cat-tab"
                            :class="{ active: category === cat.id }"
                            @click="switchCategory(cat.id)"
                        >
                            <i :class="cat.icon" />
                            {{ cat.label }}
                        </button>
                    </div>

                    <!-- ── Devices ── -->
                    <AddWidgetStage1DevicePicker
                        v-if="category === 'devices'"
                        v-model:search="search"
                        v-model:selected="selectedDevices"
                    />

                    <!-- ── Groups ── -->
                    <AddWidgetStage1GroupPicker
                        v-else-if="category === 'groups'"
                        v-model:search="search"
                        v-model:selected="selectedGroup"
                    />

                    <!-- ── Locations ── -->
                    <AddWidgetStage1LocationPicker
                        v-else-if="category === 'locations'"
                        v-model:search="search"
                        v-model:selected="selectedLocation"
                    />

                    <!-- ── Tags ── -->
                    <AddWidgetStage1TagPicker
                        v-else-if="category === 'tags'"
                        v-model:search="search"
                        v-model:selected="selectedTag"
                    />

                    <!-- ── Actions ── -->
                    <AddWidgetStage1ActionPicker
                        v-else-if="category === 'actions'"
                        v-model:search="search"
                        v-model:selected="selectedAction"
                        :actions="actions"
                        :loading="actionsLoading"
                    />

                    <!-- ── UI Widgets ── -->
                    <template v-else-if="category === 'widgets'">
                        <AddWidgetStage1WidgetCatalog
                            v-model:selected="selectedUIWidget"
                        />
                        <div v-if="selectedUIWidget" class="awm-editor">
                            <AddWidgetCfgForm
                                :widget="selectedUIWidget"
                                :chart-device-list="chartDeviceList"
                                :chart-cfg="chartCfg"
                                :gauge-cfg="gaugeCfg"
                                :stats-cfg="statsCfg"
                                :top-cfg="topCfg"
                                :timeline-cfg="timelineCfg"
                                :heatmap-cfg="heatmapCfg"
                                :site-grid-cfg="siteGridCfg"
                                :maint-cfg="maintCfg"
                                :cross-bar-cfg="crossBarCfg"
                            />
                            <div class="awm-editor__preview">
                                <span class="awm-editor__preview-label">
                                    Live preview
                                </span>
                                <CardPreview :entry="livePreviewEntry" />
                            </div>
                        </div>
                    </template>
                </template>

                <!-- ── Stage 2: Component selection ── -->
                <AddWidgetStage2EntitySelector
                    v-else-if="s === 2"
                    :grouped-entities="groupedEntities"
                    v-model:selected="selectedEntities"
                />

                <!-- ── Stage 3: Size picker ── -->
                <AddWidgetStage3SizePicker
                    v-else-if="s === 3"
                    :entities="selectedEntityObjects"
                    :sizes="entitySizes"
                    @update:sizes="onSizesUpdate"
                />
            </div>
        </template>
    </SteppedModal>
</template>

<script lang="ts" setup>
import {computed, provide, reactive, ref} from 'vue';
import {ACTIONS_LIST_KEY} from '@/composables/dashboardInjectionKeys';
import {
    getDeviceName,
    getLogo,
    handleDeviceImgError,
    isDiscovered
} from '@/helpers/device';
import {modals} from '@/helpers/ui';
import {buildWidgetPayload} from '@/helpers/widgetBuilders';
import {
    WIDGET_CATEGORIES as ALL_CATEGORIES,
    defaultSizeForEntityType
} from '@/helpers/widgetCatalog';
import {
    CATALOG_UI_WIDGETS,
    UI_WIDGET_META,
    WIDGET_SAMPLE_CONFIG
} from '@/helpers/widgetSamples';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';
import type {action_t, entity_t, shelly_device_t} from '@/types';
import type {DashboardEntry, UiWidgetId} from '@/types/dashboard-entry';
import CardPreview from '../dashboard/CardPreview.vue';
import AddWidgetCfgForm from './AddWidgetCfgForm.vue';
import AddWidgetStage1ActionPicker from './AddWidgetStage1ActionPicker.vue';
import AddWidgetStage1DevicePicker from './AddWidgetStage1DevicePicker.vue';
import AddWidgetStage1GroupPicker from './AddWidgetStage1GroupPicker.vue';
import AddWidgetStage1LocationPicker from './AddWidgetStage1LocationPicker.vue';
import AddWidgetStage1TagPicker from './AddWidgetStage1TagPicker.vue';
import AddWidgetStage1WidgetCatalog from './AddWidgetStage1WidgetCatalog.vue';
import AddWidgetStage2EntitySelector from './AddWidgetStage2EntitySelector.vue';
import AddWidgetStage3SizePicker from './AddWidgetStage3SizePicker.vue';
import SteppedModal from './SteppedModal.vue';

type CategoryId =
    | 'devices'
    | 'groups'
    | 'locations'
    | 'tags'
    | 'actions'
    | 'widgets';

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const groupStore = useGroupsStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();
const toastStore = useToastStore();
const ActionsController = getRegistry('actions');

// ── State ──
const stage = ref(1);
const category = ref<CategoryId>('devices');
const search = ref('');

// Device flow — multi-select
const selectedDevices = ref<string[]>([]);
const selectedEntities = ref<string[]>([]);
const entitySizes = reactive<Record<string, string>>({});

// Non-device selections
const selectedGroup = ref(-1);
const selectedLocation = ref(-1);
const selectedTag = ref(-1);
const selectedAction = ref('');
const selectedUIWidget = ref<UiWidgetId | ''>('');
const chartCfg = reactive({
    shellyId: '',
    metric: 'power' as
        | 'power'
        | 'consumption'
        | 'returned_energy'
        | 'voltage'
        | 'current'
        | 'temperature'
        | 'humidity'
        | 'luminance',
    chartType: 'bar' as 'bar' | 'line'
});
const gaugeCfg = reactive({
    entityId: '',
    field: '',
    label: '',
    unit: '',
    min: 0,
    max: 3500
});
const statsCfg = reactive({
    shellyId: '',
    metric: 'temperature' as
        | 'temperature'
        | 'humidity'
        | 'power'
        | 'consumption',
    name: ''
});
const topCfg = reactive({entityIdsRaw: '', limit: 10});
const timelineCfg = reactive({shellyId: '', field: '', name: ''});
const heatmapCfg = reactive({
    shellyId: '',
    metric: 'temperature' as
        | 'temperature'
        | 'humidity'
        | 'power'
        | 'consumption'
});
const siteGridCfg = reactive({
    metric: 'power' as 'power' | 'devices' | 'alerts'
});
const maintCfg = reactive({maxItems: 20});
const crossBarCfg = reactive({
    metric: 'live_power' as
        | 'live_power'
        | 'energy_24h'
        | 'energy_7d'
        | 'energy_30d',
    limit: 10
});
const actions = ref<action_t[]>([]);
const actionsLoading = ref(false);

// Expose to CardPreview tiles in the actions catalog so the resolver can
// look up the full action record by id (matches dash/[id].vue).
provide(ACTIONS_LIST_KEY, actions);

/** Live-preview entry: assembles a DashboardEntry from the user's current
 *  config form values for the selected widget. Empty/partial config falls
 *  back to the WIDGET_SAMPLE_CONFIG fixture so the preview always renders. */
const livePreviewEntry = computed<DashboardEntry>(() => {
    const id = (selectedUIWidget.value || 'clock_widget') as UiWidgetId;
    const sample = WIDGET_SAMPLE_CONFIG[id]?.() ?? {id};
    let data: Record<string, any> = sample;
    switch (id) {
        case 'chart_widget':
            data = {...sample, ...chartCfg};
            break;
        case 'gauge_widget':
            data = {...sample, ...gaugeCfg};
            break;
        case 'stats_summary_widget':
            data = {
                ...sample,
                entries: statsCfg.shellyId
                    ? [
                          {
                              shellyId: statsCfg.shellyId,
                              metric: statsCfg.metric,
                              name: statsCfg.name || statsCfg.metric
                          }
                      ]
                    : sample.entries
            };
            break;
        case 'top_consumers_widget':
            data = {
                ...sample,
                entityIds: topCfg.entityIdsRaw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                limit: topCfg.limit
            };
            break;
        case 'state_timeline_widget':
            data = {
                ...sample,
                entities: timelineCfg.shellyId
                    ? [
                          {
                              shellyId: timelineCfg.shellyId,
                              field: timelineCfg.field,
                              name: timelineCfg.name || 'State'
                          }
                      ]
                    : sample.entities
            };
            break;
        case 'activity_heatmap_widget':
            data = {...sample, ...heatmapCfg};
            break;
        case 'site_grid_widget':
            data = {...sample, ...siteGridCfg};
            break;
        case 'maintenance_list_widget':
            data = {...sample, maxItems: maintCfg.maxItems};
            break;
        case 'cross_site_bar_widget':
            data = {...sample, ...crossBarCfg};
            break;
        // energy_flow_sankey_widget, fleet_kpi_strip_widget, data_table_widget,
        // clock_widget: no inline config to fold in — use sample as-is.
    }
    return {type: 'ui_widget', size: '1x1', data};
});

const emit = defineEmits<{
    added: [
        item: {
            type:
                | 'entities'
                | 'group'
                | 'location'
                | 'tag'
                | 'action'
                | 'ui_widget';
            data: any;
        }
    ];
}>();

// ── Computed ──
const maxSteps = computed(() => (category.value === 'devices' ? 3 : 1));
const groupCount = computed(() => Object.keys(groupStore.groups).length);
const locationCount = computed(
    () => Object.keys(locationsStore.locations).length
);
const tagCount = computed(() => Object.keys(tagsStore.tags).length);

// Gate Locations / Tags tabs on the org actually having any.
const CATEGORIES = computed(() =>
    ALL_CATEGORIES.filter((c) => {
        if (c.id === 'locations') return locationCount.value > 0;
        if (c.id === 'tags') return tagCount.value > 0;
        return true;
    })
);

const chartDeviceList = computed(() =>
    Object.values(deviceStore.devices)
        .filter((d) => !isDiscovered(d.shellyID))
        .sort((a, b) =>
            getDeviceName(a.info, a.shellyID).localeCompare(
                getDeviceName(b.info, b.shellyID)
            )
        )
);


/** Entities grouped by selected device — for step 2 */
const groupedEntities = computed(() => {
    const groups: Array<{device: shelly_device_t; entities: entity_t[]}> = [];
    for (const shellyID of selectedDevices.value) {
        const dev = deviceStore.devices[shellyID];
        if (!dev) continue;
        const ents = Object.values(entityStore.entities)
            .filter((e) => e.source === shellyID)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (ents.length > 0) {
            groups.push({device: dev, entities: ents as entity_t[]});
        }
    }
    return groups;
});

/** Flat list of all entities across selected devices */
const allDeviceEntities = computed(() =>
    groupedEntities.value.flatMap((g) => g.entities)
);

const selectedEntityObjects = computed(() =>
    selectedEntities.value.map((id) => entityStore.entities[id]).filter(Boolean)
);


function _actionDeviceCount(action: action_t): number {
    return action.actions.reduce(
        (acc: number, curr: any) => acc + curr.dst.length,
        0
    );
}

function clearSizes(): void {
    for (const key of Object.keys(entitySizes)) {
        delete entitySizes[key];
    }
}

// Stage-3 sub-component owns the update shape and emits the whole map
// each pick — copy keys back into the parent's reactive() bag so the
// existing stage-3-init defaulting + onSave reads stay in place.
function onSizesUpdate(next: Record<string, string>): void {
    for (const key of Object.keys(entitySizes)) {
        if (!(key in next)) delete entitySizes[key];
    }
    for (const [key, value] of Object.entries(next)) {
        entitySizes[key] = value;
    }
}

// ── Category / navigation ──
function switchCategory(cat: CategoryId) {
    if (category.value === cat) return;
    category.value = cat;
    search.value = '';
    selectedDevices.value = [];
    selectedEntities.value = [];
    clearSizes();
    selectedGroup.value = -1;
    selectedLocation.value = -1;
    selectedTag.value = -1;
    selectedAction.value = '';
    selectedUIWidget.value = '';
    stage.value = 1;

    if (
        cat === 'actions' &&
        actions.value.length === 0 &&
        !actionsLoading.value
    ) {
        actionsLoading.value = true;
        ActionsController.getItem('rpc')
            .then((res) => {
                actions.value = Array.isArray(res) ? res : [];
            })
            .catch(() => {
                actions.value = [];
            })
            .finally(() => {
                actionsLoading.value = false;
            });
    }
}

// ── Stage change handler ──
function stageChanged(newStage: number) {
    // Validate: need at least 1 device to enter step 2
    if (
        category.value === 'devices' &&
        newStage === 2 &&
        selectedDevices.value.length === 0
    ) {
        toastStore.warning('Select at least one device');
        stage.value = 1;
        return;
    }
    // Validate: need at least 1 entity to enter step 3
    if (
        category.value === 'devices' &&
        newStage === 3 &&
        selectedEntities.value.length === 0
    ) {
        toastStore.warning('Select at least one component');
        stage.value = 2;
        return;
    }
    // Init default sizes when entering stage 3
    if (category.value === 'devices' && newStage === 3) {
        for (const id of selectedEntities.value) {
            if (!entitySizes[id]) {
                const ent = entityStore.entities[id];
                entitySizes[id] = defaultSizeForEntityType(ent?.type);
            }
        }
    }
}

// ── Save / close ──
function onSave() {
    modals.addWidget = false;

    switch (category.value) {
        case 'devices': {
            if (selectedEntities.value.length === 0) {
                toastStore.warning('Select at least one component');
                resetState();
                return;
            }
            const sizes: Record<string, string> = {};
            for (const id of selectedEntities.value) {
                sizes[id] = entitySizes[id] ?? '1x1';
            }
            emit('added', {
                type: 'entities',
                data: {ids: [...selectedEntities.value], sizes}
            });
            break;
        }
        case 'groups': {
            if (selectedGroup.value === -1) {
                toastStore.warning('Select a group');
                resetState();
                return;
            }
            emit('added', {
                type: 'group',
                data: {
                    id: selectedGroup.value,
                    name: groupStore.groups[selectedGroup.value]?.name
                }
            });
            break;
        }
        case 'locations': {
            if (selectedLocation.value === -1) {
                toastStore.warning('Select a location');
                resetState();
                return;
            }
            emit('added', {
                type: 'location',
                data: {
                    id: selectedLocation.value,
                    name: locationsStore.locations[selectedLocation.value]?.name
                }
            });
            break;
        }
        case 'tags': {
            if (selectedTag.value === -1) {
                toastStore.warning('Select a tag');
                resetState();
                return;
            }
            emit('added', {
                type: 'tag',
                data: {
                    id: selectedTag.value,
                    name: tagsStore.tags[selectedTag.value]?.name
                }
            });
            break;
        }
        case 'actions': {
            if (!selectedAction.value) {
                toastStore.warning('Select an action');
                resetState();
                return;
            }
            emit('added', {
                type: 'action',
                data: {id: selectedAction.value}
            });
            break;
        }
        case 'widgets': {
            if (!selectedUIWidget.value) {
                toastStore.warning('Select a widget');
                resetState();
                return;
            }
            const result = buildWidgetPayload(selectedUIWidget.value, {
                chartCfg,
                gaugeCfg,
                statsCfg,
                topCfg,
                timelineCfg,
                heatmapCfg,
                siteGridCfg,
                maintCfg,
                crossBarCfg
            });
            if (!result.ok) {
                toastStore.warning(result.message);
                return;
            }
            emit('added', {type: 'ui_widget', data: result.data});
            break;
        }
    }

    resetState();
}

function onClose() {
    modals.addWidget = false;
    resetState();
}

function resetState() {
    stage.value = 1;
    category.value = 'devices';
    search.value = '';
    selectedDevices.value = [];
    selectedEntities.value = [];
    clearSizes();
    selectedGroup.value = -1;
    selectedLocation.value = -1;
    selectedTag.value = -1;
    selectedAction.value = '';
    selectedUIWidget.value = '';
    chartCfg.shellyId = '';
    chartCfg.metric = 'power';
    chartCfg.chartType = 'bar';
    Object.assign(gaugeCfg, {
        entityId: '',
        field: '',
        label: '',
        unit: '',
        min: 0,
        max: 3500
    });
    Object.assign(statsCfg, {shellyId: '', metric: 'temperature', name: ''});
    Object.assign(topCfg, {entityIdsRaw: '', limit: 10});
    Object.assign(timelineCfg, {shellyId: '', field: '', name: ''});
    Object.assign(heatmapCfg, {shellyId: '', metric: 'temperature'});
    Object.assign(siteGridCfg, {metric: 'power'});
    Object.assign(maintCfg, {maxItems: 20});
    Object.assign(crossBarCfg, {metric: 'live_power', limit: 10});
}
</script>

<style>
.awm {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 10px);
    min-height: 0;
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3);
}

@media (min-width: 768px) {
    .awm {
        padding: var(--space-5);
    }
}

/* ── Selected state: accent glow ── */
.cat-dc.checked {
    border-color: rgba(var(--dev-accent), 0.6);
    box-shadow:
        0 0 12px rgba(var(--dev-accent), 0.2),
        0 0 4px rgba(var(--dev-accent), 0.1),
        inset 0 0 0 1px rgba(var(--dev-accent), 0.15);
}

.cat-dc.checked:hover {
    border-color: rgba(var(--dev-accent), 0.7);
    box-shadow:
        0 0 18px rgba(var(--dev-accent), 0.25),
        0 0 6px rgba(var(--dev-accent), 0.15),
        inset 0 0 0 1px rgba(var(--dev-accent), 0.2);
}

.cat-dc.checked .cat-dc-bar {
    height: 2.5px;
}

/* ── Selected state for UI widget tiles ── */
.cat-ui.selected {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    box-shadow:
        0 0 12px rgba(var(--color-primary-rgb), 0.15),
        0 0 4px rgba(var(--color-primary-rgb), 0.1),
        inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.12);
}

.cat-ui.selected:hover {
    border-color: rgba(var(--color-primary-rgb), 0.6);
    box-shadow:
        0 0 18px rgba(var(--color-primary-rgb), 0.2),
        0 0 6px rgba(var(--color-primary-rgb), 0.12),
        inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.15);
}

/* ── UI widget illustration thumbnails ──
   `.cat-ui` was a <div> in the legacy markup; now it's a <button> for
   keyboard/AT support. Override browser-default button typography. */
.cat-ui {
    font: inherit;
    color: inherit;
    /* Stacked: illustration on top, name, then short description. */
    flex-direction: column;
    text-align: center;
    padding: var(--space-3);
    gap: var(--space-1-5);
    cursor: pointer;
    transition:
        border-color var(--motion-state),
        box-shadow var(--motion-state),
        transform var(--motion-hover);
    /* Match the dashboard's bento cell so the picker visually matches the
       dashboard once added. */
    min-height: var(--grid-cell);
}
.cat-ui:hover {
    transform: translateY(-2px);
}
.cat-ui-illustration {
    width: 100%;
    height: 64px;
    display: block;
}
.cat-ui-name {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    letter-spacing: -0.1px;
}
.cat-ui-desc {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    line-height: var(--leading-snug);
}

/* ── Widget editor: form + live preview side-by-side ── */
.awm-editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
@media (min-width: 768px) {
    .awm-editor {
        grid-template-columns: minmax(0, 1fr) auto;
    }
}
.awm-editor__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}
.awm-editor__preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
}
.awm-editor__preview-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
}

.awm-info-line {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin: 0;
}

.awm-cfg-row {
    display: flex;
    gap: var(--space-1-5);
}
.awm-cfg-row__input {
    flex: 1;
    min-width: 0;
}

/* ── Checkmark overlay ── */
.awm-dev-check {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(var(--dev-accent), 0.9);
    color: var(--color-text-inverse);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    z-index: 5;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    animation: awm-check-in 0.15s ease-out;
}

@keyframes awm-check-in {
    from { transform: scale(0); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

/* ── Offline image dimming ── */
.cat-dc-img--off img {
    opacity: 0.25;
    filter: grayscale(1);
}

/* ══════════════════════════════════════════
   STEP 2: COMPONENT SELECTION (grouped)
   ══════════════════════════════════════════ */
.awm-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.awm-device-group {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    overflow: hidden;
}

.awm-group-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-3);
    border-bottom: 1px solid var(--color-border-default);
}

.awm-group-img {
    width: var(--space-8);
    height: var(--space-8);
    object-fit: contain;
    flex-shrink: 0;
}

.awm-group-name {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.awm-group-all {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    cursor: pointer;
    flex-shrink: 0;
}

.awm-group-all-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}

/* ── Component list ── */
.awm-comp-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1);
}

.awm-comp {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--duration-fast) ease;
}

.awm-comp:hover {
    background: var(--color-surface-3);
}

.awm-comp--sel {
    background: rgba(var(--color-primary-rgb), 0.06);
}

.awm-stage2-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
}

.awm-stage2-bar .awm-comp--all {
    margin-bottom: 0;
    padding: var(--space-2) var(--space-3);
    border-bottom: none;
    border-radius: 0;
}

.awm-comp--all {
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
    border-radius: 0;
}

.awm-comp-all-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.awm-check {
    width: var(--space-4);
    height: var(--space-4);
    accent-color: var(--color-primary);
    flex-shrink: 0;
}

.awm-check:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.awm-comp-icon {
    width: var(--space-5);
    text-align: center;
    color: var(--color-text-secondary);
    flex-shrink: 0;
}

.awm-comp-name {
    flex: 1;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.awm-comp-type {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
    flex-shrink: 0;
}

/* ══════════════════════════════════════════
   STEP 3: SIZE PICKER WITH LIVE PREVIEWS
   ══════════════════════════════════════════ */
.awm-sizes {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.awm-size-group {
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
}

.awm-size-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
}

.awm-size-icon {
    width: var(--space-5);
    text-align: center;
    color: var(--color-text-secondary);
    flex-shrink: 0;
}

.awm-size-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.awm-size-type {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
}

/* ── Preview row: 3 card sizes side by side ── */
.awm-pv-row {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    flex-wrap: wrap;
}

.awm-pv {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1-5);
    cursor: pointer;
    border: 2px solid transparent;
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    transition:
        border-color 0.15s,
        background 0.15s;
}

.awm-pv:hover {
    background: rgba(var(--color-primary-rgb), 0.04);
    border-color: rgba(var(--color-primary-rgb), 0.15);
}

.awm-pv--sel {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    background: rgba(var(--color-primary-rgb), 0.06);
}

.awm-pv:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.awm-pv-inner {
    overflow: hidden;
    border-radius: var(--radius-lg);
}

/* ── 1x1 preview: 200px scaled to 100px (0.5) ── */
.awm-pv--1x1 .awm-pv-inner {
    width: 100px;
    height: 100px;
}

.awm-pv--1x1 .awm-pv-grid {
    transform: scale(0.5);
    transform-origin: top left;
}

/* ── 2x1 preview: 414px×200px scaled to 207px×100px (0.5) ── */
.awm-pv--2x1 .awm-pv-inner {
    width: 207px;
    height: 100px;
}

.awm-pv--2x1 .awm-pv-grid {
    transform: scale(0.5);
    transform-origin: top left;
}

/* ── 2x2 preview: 414px×414px scaled to 186px×186px (0.45) ── */
.awm-pv--2x2 .awm-pv-inner {
    width: 186px;
    height: 186px;
}

.awm-pv--2x2 .awm-pv-grid {
    transform: scale(0.45);
    transform-origin: top left;
}

.awm-pv-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: none;
    letter-spacing: 0.05em;
}

.awm-pv--sel .awm-pv-label {
    color: var(--color-primary);
}

/* ══════════════════════════════════════════
   EMPTY STATE
   ══════════════════════════════════════════ */
.awm-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-12) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.awm-empty i {
    font-size: var(--type-subheading);
    opacity: 0.4;
}

/* ── Informational empty state (no groups/actions) ── */
.awm-empty-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-10) var(--space-4);
    color: var(--color-text-tertiary);
}

.awm-empty-info i {
    font-size: var(--type-heading);
    opacity: 0.3;
}

.awm-empty-title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.awm-empty-desc {
    font-size: var(--type-body);
    max-width: 320px;
    line-height: 1.5;
}

/* Prevent glow clipping on selected device/group cards */
:deep(.cat-grid) { padding: var(--space-1); margin: -4px; }

/* ── Selection count bar (devices) ── */
.awm-sel-bar {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-1, 4px);
}

/* ══════════════════════════════════════════
   RESPONSIVE
   ══════════════════════════════════════════ */
@media (max-width: 480px) {
    .awm-pv-row {
        justify-content: center;
    }
}

/* ── Chart widget inline config ── */
.chart-cfg {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3);
    margin-top: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
}

.chart-cfg-label {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    white-space: nowrap;
}

.chart-cfg-select {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: 3px var(--space-1-5);
    outline: none;
    cursor: pointer;
}

.chart-cfg-select:focus {
    border-color: rgba(var(--color-primary-rgb), 0.5);
}
</style>

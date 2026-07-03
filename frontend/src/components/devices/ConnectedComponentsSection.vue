<template>
    <section class="connected-components">
        <div
            v-if="stateMessage"
            class="connected-components__state"
            :class="`connected-components__state--${stateMessage.tone}`"
        >
            <i :class="stateMessage.icon" />
            <span>{{ stateMessage.text }}</span>
        </div>

        <!-- One flat grid — no category sub-sections. -->
        <div class="connected-components__grid">
            <article
                v-for="item in flatItems"
                :key="item.key"
                class="connected-components__item"
            >
                <div class="connected-components__chips">
                    <span
                        v-for="chip in item.chips"
                        :key="chip.key"
                        class="connected-components__chip"
                        :class="`connected-components__chip--${chip.tone}`"
                    >
                        <i v-if="chip.icon" :class="chip.icon" />
                        {{ chip.label }}
                    </span>
                </div>
                <slot
                    v-if="item.kind === 'entity' && item.entity"
                    name="entity"
                    :entity="item.entity"
                />
                <slot
                    v-else-if="item.group"
                    name="group"
                    :group="item.group"
                />
            </article>
        </div>
    </section>
</template>

<script setup lang="ts">
import {
    type DeviceRelationshipsGraph, 
    relationships
} from '@host/relationships';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {onDeviceRelationshipChanged} from '@/tools/websocket';
import type {bthomedevice_entity, entity_t} from '@/types';

export interface ConnectedSensorGroup {
    key: string;
    type: 'ble' | 'addon' | 'virtual';
    icon: string;
    name: string;
    productName: string;
    modelId: string;
    sensors: entity_t[];
    deviceEntity?: bthomedevice_entity;
    sourceComponentKey?: string;
}

type RelationshipEdge = DeviceRelationshipsGraph['edges'][number];
type RelationshipNode = DeviceRelationshipsGraph['nodes'][number];

interface Chip {
    key: string;
    label: string;
    icon?: string;
    tone: 'neutral' | 'good' | 'warning' | 'critical';
}

interface SectionItem {
    key: string;
    kind: 'entity' | 'group';
    category: ComponentCategory;
    entity?: entity_t;
    group?: ConnectedSensorGroup;
    chips: Chip[];
}

interface SectionGroup {
    key: ComponentCategory;
    label: string;
    icon: string;
    items: SectionItem[];
    count: number;
}

interface StateMessage {
    icon: string;
    text: string;
    tone: 'neutral' | 'warning' | 'critical';
}

type ComponentCategory =
    | 'controls'
    | 'sensors'
    | 'energy'
    | 'bluetooth'
    | 'virtual'
    | 'diagnostics';

const CATEGORY_ORDER: ComponentCategory[] = [
    'controls',
    'sensors',
    'energy',
    'bluetooth',
    'virtual',
    'diagnostics'
];

const CATEGORY_META: Record<
    ComponentCategory,
    {label: string; icon: string}
> = {
    controls: {label: 'Controls', icon: 'fas fa-sliders'},
    sensors: {label: 'Sensors', icon: 'fas fa-gauge-high'},
    energy: {label: 'Energy', icon: 'fas fa-bolt'},
    bluetooth: {label: 'Bluetooth', icon: 'fab fa-bluetooth-b'},
    virtual: {label: 'Virtual roles', icon: 'fas fa-layer-group'},
    diagnostics: {label: 'Diagnostics', icon: 'fas fa-circle-info'}
};

const CONTROL_TYPES = new Set([
    'switch',
    'cover',
    'light',
    'rgb',
    'rgbw',
    'cct',
    'rgbcct',
    'dimmer',
    'thermostat',
    'trv',
    'blutrv',
    'button',
    'boolean',
    'enum',
    'number',
    'text'
]);

const SENSOR_TYPES = new Set([
    'temperature',
    'humidity',
    'illuminance',
    'voltmeter',
    'input',
    'flood',
    'smoke',
    'presence',
    'presencezone',
    'camerazone',
    'camera',
    'bthomesensor'
]);

const ENERGY_TYPES = new Set(['em', 'em1', 'pm1', 'devicepower', 'meter']);
const DIAGNOSTIC_TYPES = new Set([
    'schedule',
    'media',
    'ui',
    'matter',
    'service',
    'cloud',
    'mqtt',
    'ws',
    'wifi',
    'sys'
]);

const props = defineProps<{
    shellyID: string;
    title?: string;
    entities: entity_t[];
    groups: ConnectedSensorGroup[];
    deviceOnline: boolean;
    deviceSleeping: boolean;
    relationshipContext?: boolean;
}>();

defineSlots<{
    entity(props: {entity: entity_t}): unknown;
    group(props: {group: ConnectedSensorGroup}): unknown;
}>();

const graph = ref<DeviceRelationshipsGraph | null>(null);
const graphError = ref<string | null>(null);
const graphLoading = ref(false);
let unsubscribeRelationshipChanged: (() => void) | null = null;
let graphRequestId = 0;

const visibleGroups = computed<SectionGroup[]>(() =>
    CATEGORY_ORDER.map((category) => sectionGroup(category)).filter(
        (group) => group.items.length > 0
    )
);

// Flattened across categories — rendered as one grid, no sub-headers.
const flatItems = computed(() => visibleGroups.value.flatMap((g) => g.items));

const totalItems = computed(
    () => props.entities.length + props.groups.length
);

const stateMessage = computed<StateMessage | null>(() => {
    if (totalItems.value === 0) {
        if (graphError.value) {
            return {
                icon: 'fas fa-triangle-exclamation',
                text: graphError.value,
                tone: 'warning'
            };
        }
        // Virtual / BLU devices (relationshipContext) have no physical
        // online state, so the "device is offline" message doesn't apply.
        if (
            !props.deviceOnline &&
            !props.deviceSleeping &&
            !props.relationshipContext
        ) {
            return {
                icon: 'fas fa-plug-circle-xmark',
                text: 'Device is offline, so connected components are unavailable.',
                tone: 'critical'
            };
        }
        return {
            icon: 'fas fa-circle-info',
            text: 'No connected components are available yet.',
            tone: 'neutral'
        };
    }
    return null;
});

onMounted(() => {
    if (!props.relationshipContext) return;
    subscribeToRelationshipChanges();
    void loadGraph();
});

onBeforeUnmount(() => {
    graphRequestId += 1;
    unsubscribeRelationshipChanged?.();
    unsubscribeRelationshipChanged = null;
});

watch(
    () => [props.shellyID, props.relationshipContext] as const,
    () => {
        if (props.relationshipContext) {
            if (!unsubscribeRelationshipChanged) {
                subscribeToRelationshipChanges();
            }
            void loadGraph();
        } else {
            graphRequestId += 1;
            unsubscribeRelationshipChanged?.();
            unsubscribeRelationshipChanged = null;
            graph.value = null;
            graphError.value = null;
            graphLoading.value = false;
        }
    }
);

function subscribeToRelationshipChanges(): void {
    unsubscribeRelationshipChanged = onDeviceRelationshipChanged((event) => {
        if (
            event.params.externalId === undefined ||
            event.params.externalId === props.shellyID
        ) {
            void loadGraph();
        }
    });
}

async function loadGraph(): Promise<void> {
    const requestId = ++graphRequestId;
    graphError.value = null;
    graphLoading.value = true;
    try {
        const nextGraph = await relationships.getDeviceGraph({
            shellyID: props.shellyID,
            depth: 1
        });
        if (!isCurrentGraphRequest(requestId)) return;
        graph.value = nextGraph;
    } catch (error) {
        if (!isCurrentGraphRequest(requestId)) return;
        graph.value = null;
        graphError.value = rpcErrorMessage(
            error,
            'Relationship context is unavailable.'
        );
    } finally {
        if (isCurrentGraphRequest(requestId)) graphLoading.value = false;
    }
}

function isCurrentGraphRequest(requestId: number): boolean {
    return requestId === graphRequestId;
}

function sectionGroup(category: ComponentCategory): SectionGroup {
    const meta = CATEGORY_META[category];
    const items = sectionItems.value.filter(
        (item) => item.category === category
    );
    return {
        key: category,
        label: meta.label,
        icon: meta.icon,
        items,
        count: items.length
    };
}

const sectionItems = computed<SectionItem[]>(() => [
    ...props.entities.map(entityItem),
    ...props.groups.map(groupItem)
]);

function entityItem(entity: entity_t): SectionItem {
    return {
        key: entity.id,
        kind: 'entity',
        category: categoryForEntity(entity),
        entity,
        chips: chipsForEntity(entity)
    };
}

function groupItem(group: ConnectedSensorGroup): SectionItem {
    return {
        key: group.key,
        kind: 'group',
        category: group.type === 'virtual' ? 'virtual' : 'bluetooth',
        group,
        chips: chipsForGroup(group)
    };
}

function chipsForEntity(entity: entity_t): Chip[] {
    return compactChips([
        roleChip(entity),
        sourceChip(entity),
        relationshipChip(entity),
        availabilityChip(entity)
    ]);
}

function chipsForGroup(group: ConnectedSensorGroup): Chip[] {
    const kind =
        group.type === 'ble'
            ? 'BLU group'
            : group.type === 'virtual'
              ? 'virtual group'
              : 'add-on';
    return [
        {
            key: `group:${group.key}`,
            label: kind,
            icon: group.icon,
            tone: 'neutral'
        }
    ];
}

function roleChip(entity: entity_t): Chip | null {
    const role = stringProperty(entity, 'roleKey');
    if (!role) return null;
    return {
        key: `${entity.id}:role`,
        label: humanize(role),
        icon: 'fas fa-layer-group',
        tone: 'neutral'
    };
}

function sourceChip(entity: entity_t): Chip | null {
    const sourceName = sourceDeviceLabel(entity);
    if (!sourceName) return null;
    return {
        key: `${entity.id}:source`,
        label: `from ${sourceName}`,
        icon: 'fas fa-arrow-right-arrow-left',
        tone: 'neutral'
    };
}

function relationshipChip(entity: entity_t): Chip | null {
    const label = relationshipLabel(entity);
    if (!label) return null;
    return {
        key: `${entity.id}:relationship`,
        label,
        icon: label.startsWith('via') ? 'fab fa-bluetooth-b' : 'fas fa-link',
        tone: 'neutral'
    };
}

function availabilityChip(entity: entity_t): Chip | null {
    const available = (entity.properties as {available?: unknown}).available;
    if (available !== false) return null;
    return {
        key: `${entity.id}:available`,
        label: 'source offline',
        icon: 'fas fa-triangle-exclamation',
        tone: 'warning'
    };
}

function sourceDeviceLabel(entity: entity_t): string | null {
    const sourceExternalId = stringProperty(entity, 'sourceDeviceExternalId');
    if (!sourceExternalId) return null;
    return nodeLabel(`device:${sourceExternalId}`) ?? humanize(sourceExternalId);
}

function relationshipLabel(entity: entity_t): string | null {
    const componentKey = componentKeyForEntity(entity);
    if (!componentKey) return null;
    const edge = graph.value?.edges.find(
        (candidate) =>
            edgeTouchesComponent(candidate, componentKey) &&
            edgeIsOperatorSource(candidate)
    );
    if (!edge) return null;
    const other = nodeReferencesComponent(edge.source, componentKey)
        ? edge.target
        : edge.source;
    const label = nodeLabel(other);
    if (!label) return edgeLabel(edge);
    if (edge.type === 'transported_by_gateway') return `via ${label}`;
    if (edge.type === 'heard_by_gateway') return `heard by ${label}`;
    return edgeLabel(edge) ? `${edgeLabel(edge)} ${label}` : label;
}

function edgeTouchesComponent(edge: RelationshipEdge, componentKey: string) {
    return (
        nodeReferencesComponent(edge.source, componentKey) ||
        nodeReferencesComponent(edge.target, componentKey)
    );
}

function nodeReferencesComponent(nodeId: string, componentKey: string): boolean {
    return nodeId === componentKey || nodeId.endsWith(`:${componentKey}`);
}

function edgeIsOperatorSource(edge: RelationshipEdge): boolean {
    return [
        'binds_role_to_source',
        'source_feeds_virtual_role',
        'transported_by_gateway',
        'heard_by_gateway',
        'promoted_from_gateway_component'
    ].includes(edge.type);
}

function edgeLabel(edge: RelationshipEdge): string {
    return edge.label ?? edge.type.replaceAll('_', ' ');
}

function nodeLabel(nodeId: string): string | null {
    return graph.value?.nodes.find((node: RelationshipNode) => node.id === nodeId)
        ?.label ?? null;
}

function categoryForEntity(entity: entity_t): ComponentCategory {
    if (entity.type === 'blutrv') return 'bluetooth';
    if (ENERGY_TYPES.has(entity.type)) return 'energy';
    if (CONTROL_TYPES.has(entity.type)) return 'controls';
    if (SENSOR_TYPES.has(entity.type)) return 'sensors';
    if (isVirtualRole(entity)) return 'virtual';
    if (DIAGNOSTIC_TYPES.has(entity.type)) return 'diagnostics';
    return 'diagnostics';
}

function isVirtualRole(entity: entity_t): boolean {
    return (
        entity.id.endsWith(':virtual') ||
        stringProperty(entity, 'roleKey') !== null
    );
}

function componentKeyForEntity(entity: entity_t): string | null {
    const sourceComponentKey = stringProperty(entity, 'sourceComponentKey');
    if (sourceComponentKey) return sourceComponentKey;
    const componentId = (entity.properties as {id?: unknown}).id;
    if (typeof componentId !== 'number' && typeof componentId !== 'string') {
        return null;
    }
    return `${entity.type}:${componentId}`;
}

function stringProperty(entity: entity_t, key: string): string | null {
    const value = (entity.properties as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compactChips(chips: Array<Chip | null>): Chip[] {
    return chips.filter((chip): chip is Chip => chip !== null);
}

function humanize(value: string): string {
    return value
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
</script>

<style scoped>
.connected-components {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.connected-components__header,
.connected-components__group-header,
.connected-components__health,
.connected-components__chips,
.connected-components__state {
    display: flex;
    align-items: center;
}

.connected-components__header {
    justify-content: space-between;
    gap: var(--space-3);
}

.connected-components__header > div:first-child {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.connected-components__title {
    color: var(--color-text-secondary);
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
}

.connected-components__header small,
.connected-components__group-header small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.connected-components__health {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1);
}

.connected-components__health-pill,
.connected-components__chip {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: 1;
    white-space: nowrap;
}

.connected-components__health-pill {
    padding: var(--space-1) var(--space-2);
}

.connected-components__chip {
    max-width: 100%;
    overflow: hidden;
    padding: 5px var(--space-2);
    text-overflow: ellipsis;
}

.connected-components__chip i {
    flex: 0 0 auto;
}

.connected-components__chip--good,
.connected-components__health-pill--good {
    border-color: color-mix(in srgb, var(--color-success) 24%, var(--color-border-muted));
    color: var(--color-success-text);
}

.connected-components__chip--warning,
.connected-components__health-pill--warning {
    border-color: color-mix(in srgb, var(--color-warning) 28%, var(--color-border-muted));
    color: var(--color-warning-text);
}

.connected-components__chip--critical,
.connected-components__health-pill--critical {
    border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border-muted));
    color: var(--color-danger-text);
}

.connected-components__state {
    gap: var(--space-2);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.connected-components__state--warning {
    border-color: color-mix(in srgb, var(--color-warning) 28%, var(--color-border-muted));
    color: var(--color-warning-text);
}

.connected-components__state--critical {
    border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border-muted));
    color: var(--color-danger-text);
}

.connected-components__group {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-2);
}

.connected-components__group-header {
    justify-content: space-between;
    gap: var(--space-2);
}

.connected-components__group-header span {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.connected-components__grid {
    display: grid;
    align-items: stretch;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.connected-components__item {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-1-5);
}

.connected-components__chips {
    flex-wrap: wrap;
    gap: var(--space-1);
}
.connected-components__chips:empty {
    display: none;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue scoped CSS deep selector. */
.connected-components__item :deep(.widget-card) {
    height: 100%;
}

@media (max-width: 620px) {
    .connected-components__header {
        align-items: flex-start;
        flex-direction: column;
    }

    .connected-components__health {
        justify-content: flex-start;
    }

    .connected-components__grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>

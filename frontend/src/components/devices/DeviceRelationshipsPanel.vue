<template>
    <div class="rel">
        <header class="rel__head">
            <div class="rel__title">
                <strong>Relationships</strong>
                <p v-if="graph">
                    <b>{{ centerLabel }}</b>
                    <template v-if="locationLabel">
                        <span class="rel__sep">·</span>{{ locationLabel }}
                    </template>
                    <span class="rel__sep">·</span>
                    {{ relations.length }} {{ relations.length === 1 ? 'connection' : 'connections' }}
                </p>
            </div>
            <div class="rel__head-actions">
                <span
                    v-if="attentionCount > 0"
                    class="rel__pill"
                    :class="`rel__pill--${attentionTone}`"
                >
                    <i class="rel__pill-dot" />
                    {{ attentionCount }} {{ attentionCount === 1 ? 'needs' : 'need' }} attention
                </span>
                <button
                    type="button"
                    class="rel__refresh"
                    :disabled="loading"
                    title="Refresh"
                    aria-label="Refresh relationships"
                    @click="loadGraph"
                >
                    <i class="fas fa-rotate-right" />
                </button>
            </div>
        </header>

        <div v-if="loading" class="rel__state">
            <Spinner />
            <span>Loading relationships</span>
        </div>

        <Notification v-else-if="error" type="warning">
            {{ error }}
        </Notification>

        <div v-else-if="graph && !hasContent" class="rel__empty">
            <i class="fas fa-diagram-project" />
            <div>
                <span>No relationships yet</span>
                <small>
                    This device is not placed, connected, or watched by anything
                    the fleet tracks. Add it to a group, a dashboard, or an alert
                    to see it here.
                </small>
            </div>
        </div>

        <template v-else-if="graph">
            <p class="rel__rollup">
                <template v-for="(seg, index) in rollupSegments" :key="index">
                    <span v-if="index > 0" class="rel__sep">·</span>
                    {{ seg.lead }}
                    <b v-if="seg.value">{{ seg.value }}</b>
                    <em v-if="seg.note" :class="`rel__note--${seg.note.tone}`">
                        {{ seg.note.word }}
                    </em>
                </template>
            </p>

            <div class="rel__graph-wrap">
                <div class="rel__graph" role="group" aria-label="Relationship graph">
                    <svg class="rel__svg" viewBox="0 0 620 400" aria-hidden="true">
                        <defs>
                            <marker
                                id="rel-arrow"
                                viewBox="0 0 10 10"
                                refX="5"
                                refY="5"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto"
                            >
                                <path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="var(--color-text-tertiary)" />
                            </marker>
                        </defs>
                        <g fill="none" stroke-width="1.6" marker-mid="url(#rel-arrow)">
                            <path
                                v-for="hub in hubNodes"
                                :key="`line-${hub.key}`"
                                :d="hub.pathD"
                                :style="{stroke: hub.accent}"
                                stroke-opacity="0.45"
                                :class="{'rel__line--linked': hoveredKey === hub.key}"
                            />
                        </g>
                        <g v-if="!reducedMotion">
                            <circle cx="310" cy="200" r="24" fill="none" stroke-width="1.4" :style="{stroke: centerAccent}">
                                <animate attributeName="r" values="24;78" dur="2.6s" repeatCount="indefinite" />
                                <animate attributeName="stroke-opacity" values="0.5;0" dur="2.6s" repeatCount="indefinite" />
                            </circle>
                            <circle
                                v-for="hub in hubNodes"
                                :key="`pulse-${hub.key}`"
                                r="3.4"
                                :style="{fill: hub.accent}"
                            >
                                <animateMotion
                                    dur="2.6s"
                                    :begin="hub.pulseBegin"
                                    repeatCount="indefinite"
                                    :path="hub.pathD"
                                />
                                <animate
                                    attributeName="opacity"
                                    values="0;1;1;0"
                                    keyTimes="0;0.16;0.86;1"
                                    dur="2.6s"
                                    :begin="hub.pulseBegin"
                                    repeatCount="indefinite"
                                />
                            </circle>
                        </g>
                    </svg>

                    <div class="rel__anchor" :style="{left: '50%', top: '50%'}">
                        <div
                            class="rel-node rel-node--center"
                            :class="{
                                'rel-node--warn': centerHealth === 'warn',
                                'rel-node--crit': centerHealth === 'crit',
                                'rel-node--motion': !reducedMotion,
                            }"
                            :style="{'--nc': centerAccent}"
                        >
                            <span class="rel-node__photo"><i class="fas fa-microchip" /></span>
                            <span class="rel-node__name">{{ centerLabel }}</span>
                        </div>
                    </div>

                    <div
                        v-for="hub in hubNodes"
                        :key="`node-${hub.key}`"
                        class="rel__anchor"
                        :style="slotStyle(hub.slot)"
                    >
                        <button
                            type="button"
                            class="rel-node"
                            :class="{
                                'rel-node--warn': hub.health === 'warn',
                                'rel-node--crit': hub.health === 'crit',
                                'rel-node--link': isNavigable(hub.relation.node),
                                'rel-node--linked': hoveredKey === hub.key,
                                'rel-node--motion': !reducedMotion,
                            }"
                            :style="{'--nc': hub.accent}"
                            @click="navigateToNode(hub.relation.node)"
                            @mouseenter="hoveredKey = hub.key"
                            @mouseleave="hoveredKey = null"
                            @focus="hoveredKey = hub.key"
                            @blur="hoveredKey = null"
                        >
                            <span class="rel-node__ic"><i :class="hub.relation.icon" /></span>
                            <span class="rel-node__tx">
                                <span class="rel-node__k">
                                    {{ hub.relation.kind }}
                                    <template v-if="hub.relation.statusWord">
                                        · {{ hub.relation.statusWord }}
                                    </template>
                                </span>
                                <span class="rel-node__n">{{ hub.relation.label }}</span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            <template v-if="attentionItems.length">
                <div class="rel-sec">Needs attention</div>
                <div class="rel-attn">
                    <div
                        v-for="item in attentionItems"
                        :key="item.key"
                        class="rel-attn__row"
                        :class="`rel-attn__row--${item.tone}`"
                    >
                        <span class="rel-attn__ic"><i :class="item.icon" /></span>
                        <div class="rel-attn__tx">
                            <b>{{ item.title }}</b>
                            <small>{{ item.detail }}</small>
                        </div>
                        <div v-if="isNavigable(item.target)" class="rel-attn__act">
                            <button type="button" class="rel-btn" @click="navigateToNode(item.target)">
                                Open
                            </button>
                        </div>
                    </div>
                </div>
            </template>

            <div v-if="impactItems.length" class="rel-impact">
                <div class="rel-impact__h">
                    <span><i class="fas fa-bolt" />Depends on this device</span>
                    <small>
                        reconfiguring or removing it affects {{ impactItems.length }}
                        {{ impactItems.length === 1 ? 'thing' : 'things' }}
                    </small>
                </div>
                <div class="rel-impact__items">
                    <button
                        v-for="item in impactItems"
                        :key="item.key"
                        type="button"
                        class="rel-imp"
                        :class="{'rel-imp--link': isNavigable(item.node)}"
                        @click="navigateToNode(item.node)"
                        @mouseenter="hoveredKey = item.key"
                        @mouseleave="hoveredKey = null"
                    >
                        {{ item.label }} <small>· {{ item.kindLabel }}</small>
                    </button>
                </div>
            </div>

            <div class="rel-sec">All connections</div>
            <div class="rel-lists">
                <div
                    v-for="bucket in visibleBuckets"
                    :key="bucket.bucket"
                    class="rel-card"
                    :style="{'--bc': `var(--rel-${bucket.bucket})`}"
                >
                    <div class="rel-card__h">
                        <span class="rel-card__badge"><i :class="bucket.icon" /></span>
                        <b>{{ bucket.label }}</b>
                        <small>{{ bucket.items.length }}</small>
                    </div>
                    <div class="rel-card__rows">
                        <button
                            v-for="rel in bucket.items"
                            :key="rel.edgeId"
                            type="button"
                            class="rel-row"
                            :class="{
                                'rel-row--warn': rel.health === 'warn',
                                'rel-row--crit': rel.health === 'crit',
                                'rel-row--link': isNavigable(rel.node),
                                'rel-row--linked': hoveredKey === rel.key,
                            }"
                            :style="{'--cc': accentVar(rel.bucket, rel.health)}"
                            @click="navigateToNode(rel.node)"
                            @mouseenter="hoveredKey = rel.key"
                            @mouseleave="hoveredKey = null"
                            @focus="hoveredKey = rel.key"
                            @blur="hoveredKey = null"
                        >
                            <span class="rel-row__ic"><i :class="rel.icon" /></span>
                            <span class="rel-row__tx">
                                <span class="rel-row__k">{{ rel.kind }}</span>
                                <span class="rel-row__n">{{ rel.label }}</span>
                                <span v-if="rel.detail" class="rel-row__d">{{ rel.detail }}</span>
                            </span>
                            <span class="rel-row__meta">
                                <span
                                    v-if="rel.statusWord"
                                    class="rel-chip"
                                    :class="`rel-chip--${rel.health}`"
                                >
                                    {{ rel.statusWord }}
                                </span>
                                <span class="rel-row__chev"><i class="fas fa-chevron-right" /></span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {type DeviceRelationshipsGraph, relationships} from '@host/relationships';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import Notification from '@/components/core/Notification.vue';
import Spinner from '@/components/core/Spinner.vue';
import {DeviceBoard, GroupBoard} from '@/helpers/components';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useRightSideMenuStore} from '@/stores/right-side';
import {onDeviceRelationshipChanged} from '@/tools/websocket';

type RelationshipNode = DeviceRelationshipsGraph['nodes'][number];
type RelationshipEdge = DeviceRelationshipsGraph['edges'][number];
type RelationshipSummary = DeviceRelationshipsGraph['summaries'][number];
type EdgeType = RelationshipEdge['type'];
type Bucket = 'place' | 'connection' | 'function' | 'watched' | 'parts';
type Health = 'ok' | 'warn' | 'crit';

interface EdgeMeta {
    bucket: Bucket;
    kind: string;
    icon: string;
    impactful?: boolean;
}

interface Relation {
    key: string;
    edgeId: string;
    edgeType: EdgeType;
    bucket: Bucket;
    kind: string;
    icon: string;
    label: string;
    detail: string | null;
    direction: 'out' | 'in';
    health: Health;
    statusWord: string | null;
    impactful: boolean;
    node: RelationshipNode | undefined;
}

interface HexSlot {
    vx: number;
    vy: number;
}

interface HubNode {
    key: string;
    relation: Relation;
    slot: HexSlot;
    pathD: string;
    accent: string;
    health: Health;
    pulseBegin: string;
}

interface RollupSegment {
    lead: string;
    value?: string;
    note?: {word: string; tone: 'warn' | 'crit'};
}

interface AttentionItem {
    key: string;
    tone: 'warn' | 'crit';
    title: string;
    detail: string;
    icon: string;
    target: RelationshipNode | undefined;
}

interface ImpactItem {
    key: string;
    label: string;
    kindLabel: string;
    node: RelationshipNode | undefined;
}

interface BucketView {
    bucket: Bucket;
    label: string;
    icon: string;
    items: Relation[];
}

const CENTER = {vx: 310, vy: 200};

// Hexagon anchor points around the center, in the 620×400 SVG viewBox.
// The hub places direct neighbors on a ring that adapts to how many there are
// (radial, first slot at top, clockwise). Capped so the graph stays readable —
// the complete set always lives in the lists below.
const HUB_MAX = 8;
const HUB_RX = 218;
const HUB_RY = 150;

function slotFor(index: number, count: number): HexSlot {
    const angle = -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2;
    return {
        vx: CENTER.vx + HUB_RX * Math.cos(angle),
        vy: CENTER.vy + HUB_RY * Math.sin(angle)
    };
}

const BUCKET_ORDER: Bucket[] = [
    'place',
    'connection',
    'function',
    'watched',
    'parts'
];

const BUCKET_META: Record<Bucket, {label: string; icon: string}> = {
    place: {label: 'Place', icon: 'fas fa-location-dot'},
    connection: {label: 'Connection', icon: 'fas fa-tower-broadcast'},
    function: {label: 'Function', icon: 'fas fa-bolt'},
    watched: {label: 'Watched & shown', icon: 'fas fa-bell'},
    parts: {label: 'Parts', icon: 'fas fa-microchip'}
};

// Edges that are internal plumbing, not relationships worth showing.
const EXCLUDED_EDGES = new Set<EdgeType>([
    'has_visual_asset',
    'recorded_history_event'
]);

const EDGE_META: Partial<Record<EdgeType, EdgeMeta>> = {
    located_in: {bucket: 'place', kind: 'Location', icon: 'fas fa-location-dot'},
    belongs_to_group: {bucket: 'place', kind: 'Group', icon: 'fas fa-layer-group'},
    tagged_with: {bucket: 'place', kind: 'Tag', icon: 'fas fa-tag'},
    transported_by_gateway: {bucket: 'connection', kind: 'Gateway', icon: 'fas fa-tower-broadcast'},
    heard_by_gateway: {bucket: 'connection', kind: 'Gateway', icon: 'fas fa-tower-broadcast'},
    uses_profile: {bucket: 'connection', kind: 'Profile', icon: 'fas fa-lock'},
    configured_external_connection: {bucket: 'connection', kind: 'Connection', icon: 'fas fa-plug'},
    source_feeds_virtual_role: {bucket: 'function', kind: 'Feeds', icon: 'fas fa-bolt', impactful: true},
    used_by_virtual_device: {bucket: 'function', kind: 'Used by', icon: 'fas fa-bolt', impactful: true},
    binds_role_to_source: {bucket: 'function', kind: 'Reads from', icon: 'fas fa-bolt'},
    extracts_from: {bucket: 'function', kind: 'Extracted from', icon: 'fas fa-bolt'},
    promoted_from_gateway_component: {bucket: 'function', kind: 'Promoted from', icon: 'fas fa-bolt'},
    serves: {bucket: 'function', kind: 'Serves', icon: 'fas fa-bolt', impactful: true},
    controls: {bucket: 'function', kind: 'Controls', icon: 'fas fa-sliders', impactful: true},
    controlled_by: {bucket: 'function', kind: 'Controlled by', icon: 'fas fa-sliders'},
    charged_to_cost_center: {bucket: 'function', kind: 'Cost center', icon: 'fas fa-coins'},
    watched_by_alert_rule: {bucket: 'watched', kind: 'Alert', icon: 'fas fa-bell', impactful: true},
    shown_on_dashboard: {bucket: 'watched', kind: 'Dashboard', icon: 'fas fa-table-columns', impactful: true},
    has_component: {bucket: 'parts', kind: 'Component', icon: 'fas fa-microchip'},
    has_entity: {bucket: 'parts', kind: 'Entity', icon: 'fas fa-plug'}
};

// One relation per slot, in the order the hexagon fills.
const HUB_PRIORITY: EdgeType[][] = [
    ['located_in'],
    ['belongs_to_group'],
    ['transported_by_gateway', 'heard_by_gateway'],
    ['source_feeds_virtual_role', 'used_by_virtual_device', 'binds_role_to_source', 'serves', 'controls'],
    ['watched_by_alert_rule'],
    ['shown_on_dashboard'],
    ['tagged_with'],
    ['uses_profile']
];

const props = defineProps<{shellyID: string}>();

const router = useRouter();
const rightSideStore = useRightSideMenuStore();

const graph = ref<DeviceRelationshipsGraph | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const hoveredKey = ref<string | null>(null);
const reducedMotion = ref(false);

let unsubscribeRelationshipChanged: (() => void) | null = null;
let motionQuery: MediaQueryList | null = null;

const nodeMap = computed(() => {
    const map = new Map<string, RelationshipNode>();
    for (const node of graph.value?.nodes ?? []) map.set(node.id, node);
    return map;
});

const centerNode = computed(() => nodeMap.value.get(graph.value?.center ?? ''));

const centerLabel = computed(
    () => centerNode.value?.label ?? graph.value?.center ?? props.shellyID
);

const centerHealth = computed<Health>(() => toHealth(centerNode.value?.status));

const centerAccent = computed(() => accentVar('place', centerHealth.value, true));

const relations = computed<Relation[]>(() => {
    const g = graph.value;
    if (!g) return [];
    const seen = new Set<string>();
    const list: Relation[] = [];
    for (const edge of g.edges) {
        if (edge.source !== g.center && edge.target !== g.center) continue;
        const meta = edgeMeta(edge.type);
        if (!meta) continue;
        const neighborId = edge.source === g.center ? edge.target : edge.source;
        if (neighborId === g.center) continue;
        const dedupeKey = `${edge.type}:${neighborId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const node = nodeMap.value.get(neighborId);
        const health = worstHealth(edge.status, node?.status);
        list.push({
            // Unique per edge-type+neighbor: one neighbor can relate via several
            // edge types (e.g. a gateway that both transports and hears the
            // device); keying on the neighbor alone collides in v-for / hover.
            key: dedupeKey,
            edgeId: edge.id,
            edgeType: edge.type,
            bucket: meta.bucket,
            kind: meta.kind,
            icon: meta.icon,
            label: node?.label ?? neighborId,
            // Backend-formatted relationship detail (signal / role / channel),
            // shown only when it adds something beyond the neighbor's name.
            detail:
                edge.label && edge.label !== node?.label ? edge.label : null,
            direction: edge.source === g.center ? 'out' : 'in',
            health,
            // Word must come from whichever status drove the worst health, else
            // a crit row (severity from the node) can show no word or a lesser one.
            statusWord:
                health === 'ok'
                    ? null
                    : statusWord(worstStatus(edge.status, node?.status)),
            impactful: meta.impactful ?? false,
            node
        });
    }
    return list;
});

// Include attention so device-health summaries still show when a device has
// summaries but no bucketed relations (else warnings hide behind the empty state).
const hasContent = computed(
    () => relations.value.length > 0 || attentionItems.value.length > 0
);

const visibleBuckets = computed<BucketView[]>(() =>
    BUCKET_ORDER.map((bucket) => ({
        bucket,
        label: BUCKET_META[bucket].label,
        icon: BUCKET_META[bucket].icon,
        items: relations.value.filter((rel) => rel.bucket === bucket)
    })).filter((view) => view.items.length > 0)
);

const hubNodes = computed<HubNode[]>(() => {
    const chosen = pickHubRelations(relations.value);
    return chosen.map((relation, index) => {
        const slot = slotFor(index, chosen.length);
        const accent = accentVar(relation.bucket, relation.health);
        return {
            key: relation.key,
            relation,
            slot,
            pathD: hexPath(slot, relation.direction),
            accent,
            health: relation.health,
            // Outgoing pulses ride the beat, incoming pulses the off-beat.
            pulseBegin: relation.direction === 'out' ? '0s' : '-1.3s'
        };
    });
});

const attentionCount = computed(() => attentionItems.value.length);

const attentionTone = computed<'warn' | 'crit'>(() =>
    attentionItems.value.some((item) => item.tone === 'crit') ? 'crit' : 'warn'
);

const attentionItems = computed<AttentionItem[]>(() =>
    (graph.value?.summaries ?? [])
        .filter((summary) => summary.severity !== 'info')
        .map((summary, index) => toAttention(summary, index))
);

const impactItems = computed<ImpactItem[]>(() => {
    const seen = new Set<string>();
    const items: ImpactItem[] = [];
    for (const relation of relations.value) {
        if (!relation.impactful || seen.has(relation.key)) continue;
        seen.add(relation.key);
        items.push({
            key: relation.key,
            label: relation.label,
            kindLabel: relation.kind.toLowerCase(),
            node: relation.node
        });
    }
    return items;
});

const locationLabel = computed(
    () => relations.value.find((rel) => rel.edgeType === 'located_in')?.label ?? null
);

const rollupSegments = computed<RollupSegment[]>(() => {
    const segments: RollupSegment[] = [];
    const location = firstRelation('located_in');
    if (location) segments.push({lead: 'In', value: location.label});
    const group = firstRelation('belongs_to_group');
    if (group) segments.push({lead: 'group', value: group.label});
    const gateway = firstRelation('transported_by_gateway', 'heard_by_gateway');
    if (gateway) {
        segments.push({
            lead: 'via',
            value: gateway.label,
            note: gateway.statusWord ? {word: gateway.statusWord, tone: gateway.health === 'crit' ? 'crit' : 'warn'} : undefined
        });
    }
    const feeds = firstRelation('source_feeds_virtual_role');
    if (feeds) segments.push({lead: 'feeds', value: feeds.label});
    const alerts = relations.value.filter((rel) => rel.edgeType === 'watched_by_alert_rule');
    if (alerts.length > 0) {
        const critical = alerts.some((rel) => rel.health === 'crit');
        segments.push({
            lead: 'watched by',
            value: `${alerts.length} ${alerts.length === 1 ? 'alert' : 'alerts'}`,
            note: critical ? {word: 'critical', tone: 'crit'} : undefined
        });
    }
    return segments;
});

onMounted(() => {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.value = motionQuery.matches;
    motionQuery.addEventListener('change', syncReducedMotion);
    unsubscribeRelationshipChanged = onDeviceRelationshipChanged((event) => {
        if (!shouldRefreshForEvent(event.params.externalId)) return;
        void loadGraph();
    });
    void loadGraph();
});

onBeforeUnmount(() => {
    unsubscribeRelationshipChanged?.();
    unsubscribeRelationshipChanged = null;
    motionQuery?.removeEventListener('change', syncReducedMotion);
    motionQuery = null;
});

watch(() => props.shellyID, () => void loadGraph());

async function loadGraph(): Promise<void> {
    loading.value = true;
    error.value = null;
    hoveredKey.value = null;
    try {
        graph.value = await relationships.getDeviceGraph({
            shellyID: props.shellyID,
            depth: 2
        });
    } catch (err) {
        graph.value = null;
        error.value = rpcErrorMessage(err);
    } finally {
        loading.value = false;
    }
}

function syncReducedMotion(): void {
    reducedMotion.value = motionQuery?.matches ?? false;
}

function shouldRefreshForEvent(externalId: string | undefined): boolean {
    return externalId === undefined || externalId === props.shellyID;
}

function edgeMeta(type: EdgeType): EdgeMeta | null {
    if (EXCLUDED_EDGES.has(type)) return null;
    const explicit = EDGE_META[type];
    if (explicit) return explicit;
    return fallbackMeta(type);
}

// Keyword routing keeps new/unknown edge types from crashing or vanishing.
function fallbackMeta(type: string): EdgeMeta | null {
    if (/group|location|tag/.test(type)) {
        return {bucket: 'place', kind: humanize(type), icon: 'fas fa-location-dot'};
    }
    if (/gateway|profile|transport|external_connection|connector/.test(type)) {
        return {bucket: 'connection', kind: humanize(type), icon: 'fas fa-tower-broadcast'};
    }
    if (/alert|dashboard|notification|route|watched|shown|maintenance/.test(type)) {
        return {bucket: 'watched', kind: humanize(type), icon: 'fas fa-bell'};
    }
    if (/role|virtual|serves|control|cost|extract|promoted|schedule|script|webhook|automation|energy|classified|source|depend/.test(type)) {
        return {bucket: 'function', kind: humanize(type), icon: 'fas fa-bolt'};
    }
    return null;
}

function pickHubRelations(all: Relation[]): Relation[] {
    const chosen: Relation[] = [];
    const usedKeys = new Set<string>();
    for (const group of HUB_PRIORITY) {
        if (chosen.length >= HUB_MAX) break;
        const match = all.find(
            (rel) => group.includes(rel.edgeType) && !usedKeys.has(rel.key)
        );
        if (!match) continue;
        chosen.push(match);
        usedKeys.add(match.key);
    }
    for (const rel of all) {
        if (chosen.length >= HUB_MAX) break;
        // Parts (components/entities) are list-only — never in the hub.
        if (rel.bucket === 'parts' || usedKeys.has(rel.key)) continue;
        chosen.push(rel);
        usedKeys.add(rel.key);
    }
    return chosen;
}

function hexPath(slot: HexSlot, direction: 'out' | 'in'): string {
    const mx = (CENTER.vx + slot.vx) / 2;
    const my = (CENTER.vy + slot.vy) / 2;
    if (direction === 'out') {
        return `M${CENTER.vx} ${CENTER.vy} L${mx} ${my} L${slot.vx} ${slot.vy}`;
    }
    return `M${slot.vx} ${slot.vy} L${mx} ${my} L${CENTER.vx} ${CENTER.vy}`;
}

function slotStyle(slot: HexSlot): {left: string; top: string} {
    return {
        left: `${(slot.vx / 620) * 100}%`,
        top: `${(slot.vy / 400) * 100}%`
    };
}

function toAttention(summary: RelationshipSummary, index: number): AttentionItem {
    const target = firstReferencedNode(summary.nodeIds);
    const tone: 'warn' | 'crit' = summary.severity === 'critical' ? 'crit' : 'warn';
    const {title, detail} = splitSummary(summary.text);
    return {
        key: `${index}:${summary.reasonCode ?? 'summary'}`,
        tone,
        title,
        detail,
        icon: attentionIcon(target, tone),
        target
    };
}

// First sentence is the headline; the rest is guidance.
function splitSummary(text: string): {title: string; detail: string} {
    const match = text.match(/^(.*?[.!?])\s+(.*)$/s);
    if (match) return {title: match[1].trim(), detail: match[2].trim()};
    return {title: text, detail: ''};
}

function firstReferencedNode(nodeIds: string[] | undefined): RelationshipNode | undefined {
    for (const id of nodeIds ?? []) {
        const node = nodeMap.value.get(id);
        if (node && node.id !== graph.value?.center) return node;
    }
    return undefined;
}

function attentionIcon(node: RelationshipNode | undefined, tone: 'warn' | 'crit'): string {
    if (node?.type === 'alert.rule') return 'fas fa-bell';
    if (node?.type === 'blu.transport') return 'fas fa-tower-broadcast';
    if (node?.type === 'dashboard') return 'fas fa-table-columns';
    return tone === 'crit' ? 'fas fa-circle-exclamation' : 'fas fa-triangle-exclamation';
}

function firstRelation(...types: EdgeType[]): Relation | undefined {
    return relations.value.find((rel) => types.includes(rel.edgeType));
}

function accentVar(bucket: Bucket, health: Health, centerBlue = false): string {
    if (health === 'crit') return 'var(--rel-crit)';
    if (health === 'warn') return 'var(--rel-warn)';
    if (centerBlue) return 'var(--color-primary)';
    return `var(--rel-${bucket})`;
}

function toHealth(status: string | undefined): Health {
    if (status === 'critical' || status === 'offline' || status === 'unavailable') {
        return 'crit';
    }
    if (status === 'warning' || status === 'stale' || status === 'unknown') {
        return 'warn';
    }
    return 'ok';
}

function worstHealth(...statuses: (string | undefined)[]): Health {
    let worst: Health = 'ok';
    for (const status of statuses) {
        const health = toHealth(status);
        if (health === 'crit') return 'crit';
        if (health === 'warn') worst = 'warn';
    }
    return worst;
}

// The status that drives the worst health, so the displayed word matches the
// row's severity tint (crit > warn > any-set > none).
function worstStatus(...statuses: (string | undefined)[]): string | undefined {
    let picked: string | undefined;
    let rank = 0;
    for (const status of statuses) {
        const health = toHealth(status);
        const r = health === 'crit' ? 3 : health === 'warn' ? 2 : status ? 1 : 0;
        if (r > rank) {
            rank = r;
            picked = status;
        }
    }
    return picked;
}

function statusWord(status: string | undefined): string | null {
    if (!status || status === 'healthy' || status === 'disabled') return null;
    return status;
}

function humanize(type: string): string {
    const spaced = type.replaceAll('_', ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isNavigable(node: RelationshipNode | undefined): boolean {
    if (!node) return false;
    return (
        node.type.startsWith('device.') ||
        node.type === 'group' ||
        node.type === 'location' ||
        node.type === 'tag' ||
        node.type === 'dashboard' ||
        node.type === 'alert.rule'
    );
}

// TODO(follow-up): inline actions (mute alert, re-pair gateway, add gateway)
// belong here — this pass only navigates to the referenced entity.
function navigateToNode(node: RelationshipNode | undefined): void {
    if (!node) return;
    if (node.type.startsWith('device.')) {
        const shellyID = node.externalId ?? idPart(node.id);
        void rightSideStore.showInspector(DeviceBoard, {shellyID});
        return;
    }
    if (node.type === 'group') {
        const groupId = Number(idPart(node.id));
        if (Number.isFinite(groupId)) {
            void rightSideStore.showInspector(GroupBoard, {groupId});
        } else {
            void router.push('/organize/groups');
        }
        return;
    }
    if (node.type === 'location') {
        void router.push({name: '/organize/locations/[id]', params: {id: idPart(node.id)}});
        return;
    }
    if (node.type === 'tag') {
        void router.push({name: '/organize/tags/[id]', params: {id: idPart(node.id)}});
        return;
    }
    if (node.type === 'dashboard') {
        void router.push({name: '/dash/[id]', params: {id: idPart(node.id)}});
        return;
    }
    if (node.type === 'alert.rule') {
        void router.push('/settings/alerts');
    }
}

function idPart(nodeId: string): string {
    const separator = nodeId.indexOf(':');
    return separator === -1 ? nodeId : nodeId.slice(separator + 1);
}
</script>

<style scoped>
.rel {
    --rel-place: var(--color-primary);
    --rel-connection: var(--color-info);
    --rel-function: var(--color-accent);
    --rel-watched: var(--chart-color-8);
    --rel-parts: var(--color-text-secondary);
    --rel-warn: var(--color-warning);
    --rel-crit: var(--color-danger);

    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-5);
}

/* --- Header --- */
.rel__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
}

.rel__title {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.rel__title strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: 650;
}

.rel__title p {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.rel__title b {
    color: var(--color-text-secondary);
    font-weight: 600;
}

.rel__sep {
    margin: 0 var(--space-1);
    color: var(--color-text-tertiary);
    opacity: 0.6;
}

.rel__head-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-2);
}

.rel__pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-caption);
    white-space: nowrap;
}

.rel__pill-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
}

.rel__pill--warn {
    border: 1px solid color-mix(in srgb, var(--rel-warn) 38%, transparent);
    background: color-mix(in srgb, var(--rel-warn) 12%, transparent);
    color: var(--color-warning-text);
}

.rel__pill--crit {
    border: 1px solid color-mix(in srgb, var(--rel-crit) 40%, transparent);
    background: color-mix(in srgb, var(--rel-crit) 12%, transparent);
    color: var(--color-danger-text);
}

.rel__refresh {
    display: inline-flex;
    width: var(--space-8);
    height: var(--space-8);
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    cursor: pointer;
}

.rel__refresh:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

.rel__refresh:disabled {
    cursor: default;
    opacity: 0.5;
}

/* --- States --- */
.rel__state {
    display: flex;
    min-height: 200px;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
}

.rel__empty {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: 1px dashed var(--color-border-muted);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-5);
}

.rel__empty i {
    display: inline-flex;
    width: var(--space-10);
    height: var(--space-10);
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
}

.rel__empty div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.rel__empty span {
    color: var(--color-text-primary);
    font-weight: 600;
}

.rel__empty small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

/* --- Rollup --- */
.rel__rollup {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    line-height: 1.7;
}

.rel__rollup b {
    color: var(--color-text-primary);
    font-weight: 600;
}

.rel__rollup em {
    font-style: normal;
    font-weight: 650;
}

.rel__note--warn {
    color: var(--color-warning-text);
}

.rel__note--crit {
    color: var(--color-danger-text);
}

/* --- Graph --- */
.rel__graph-wrap {
    overflow-x: auto;
    border-radius: var(--radius-lg);
}

.rel__graph {
    position: relative;
    width: min(620px, 100%);
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--glass-2-bg);
    aspect-ratio: 620 / 400;
    backdrop-filter: var(--glass-2-filter);
    box-shadow: var(--glass-shadow);
}

.rel__svg {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.rel__line--linked {
    stroke-opacity: 0.9 !important;
}

.rel__anchor {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, -50%);
}

.rel-node {
    position: relative;
    display: flex;
    max-width: 190px;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--nc) 8%, var(--color-surface-3));
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-primary);
    text-align: left;
    box-shadow: var(--glass-shadow);
    cursor: default;
    transition:
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        background 0.18s ease;
}

.rel-node--motion {
    animation: rel-float 6s ease-in-out infinite;
}

.rel-node--link {
    cursor: pointer;
}

.rel-node--link:hover,
.rel-node--linked {
    border-color: color-mix(in srgb, var(--nc) 60%, var(--glass-border));
    background: color-mix(in srgb, var(--nc) 16%, var(--color-surface-3));
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--nc) 40%, transparent),
        0 0 22px color-mix(in srgb, var(--nc) 34%, transparent);
}

.rel-node:focus-visible {
    outline: 2px solid var(--nc);
    outline-offset: 3px;
}

.rel-node__ic {
    display: grid;
    width: var(--space-8);
    height: var(--space-8);
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--nc) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nc) 30%, transparent);
    color: var(--nc);
}

.rel-node__tx {
    display: flex;
    min-width: 0;
    flex-direction: column;
    line-height: 1.25;
}

.rel-node__k {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.rel-node__n {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rel-node--center {
    max-width: 220px;
    animation: none;
    border-color: color-mix(in srgb, var(--color-primary) 42%, var(--glass-border));
    background: linear-gradient(
        160deg,
        color-mix(in srgb, var(--color-primary) 30%, var(--color-surface-3)),
        var(--color-surface-2)
    );
    cursor: default;
}

.rel-node__photo {
    display: grid;
    width: var(--space-10);
    height: var(--space-10);
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-primary) 30%, var(--color-surface-4));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 30%, transparent);
    color: var(--color-primary-text);
    font-size: 1.1rem;
}

.rel-node--center .rel-node__n {
    font-size: var(--type-body);
    font-weight: 650;
    white-space: normal;
}

.rel-node--center.rel-node--motion .rel-node__photo {
    animation: rel-breathe 2.6s ease-in-out infinite;
}

.rel-node--crit.rel-node--motion {
    animation: rel-float 6s ease-in-out infinite, rel-firing 1.25s ease-in-out infinite;
}

/* --- Section label --- */
.rel-sec {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.rel-sec::after {
    content: "";
    height: 1px;
    flex: 1;
    background: var(--color-border-muted);
}

/* --- Attention --- */
.rel-attn {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rel-attn__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    padding: var(--space-3);
}

.rel-attn__row--warn {
    background: color-mix(in srgb, var(--rel-warn) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rel-warn) 26%, transparent);
}

.rel-attn__row--crit {
    background: color-mix(in srgb, var(--rel-crit) 11%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rel-crit) 30%, transparent);
}

.rel-attn__ic {
    display: grid;
    width: var(--space-8);
    height: var(--space-8);
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-md);
}

.rel-attn__row--warn .rel-attn__ic {
    background: color-mix(in srgb, var(--rel-warn) 20%, transparent);
    color: var(--color-warning-text);
}

.rel-attn__row--crit .rel-attn__ic {
    background: color-mix(in srgb, var(--rel-crit) 20%, transparent);
    color: var(--color-danger-text);
}

.rel-attn__tx {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.rel-attn__tx b {
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 600;
}

.rel-attn__tx small {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    line-height: 1.42;
}

.rel-attn__act {
    display: flex;
    flex: 0 0 auto;
    margin-left: auto;
    gap: var(--space-2);
}

.rel-btn {
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    padding: var(--space-1-5) var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
}

.rel-btn:hover {
    background: var(--color-surface-4);
}

/* --- Impact --- */
.rel-impact {
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--glass-2-bg);
    padding: var(--space-4);
    backdrop-filter: var(--glass-2-filter);
    box-shadow: var(--glass-shadow);
}

.rel-impact__h {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
}

.rel-impact__h span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 680;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.rel-impact__h span i {
    color: var(--color-primary);
}

.rel-impact__h small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.rel-impact__items {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.rel-imp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    padding: var(--space-1-5) var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    cursor: default;
    transition:
        border-color 0.15s ease,
        background 0.15s ease;
}

.rel-imp::before {
    content: "";
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--color-primary);
}

.rel-imp small {
    color: var(--color-text-tertiary);
}

.rel-imp--link {
    cursor: pointer;
}

.rel-imp--link:hover {
    border-color: color-mix(in srgb, var(--color-primary) 42%, transparent);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

/* --- Lists --- */
.rel-lists {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.rel-card {
    overflow: hidden;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    box-shadow: var(--glass-shadow);
}

.rel-card__h {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-bottom: 1px solid var(--color-border-muted);
    padding: var(--space-3);
}

.rel-card__badge {
    display: grid;
    width: var(--space-6);
    height: var(--space-6);
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bc) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bc) 30%, transparent);
    color: var(--bc);
}

.rel-card__h b {
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 680;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.rel-card__h small {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}

.rel-card__rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1-5);
}

.rel-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    color: var(--color-text-primary);
    text-align: left;
    cursor: default;
    transition:
        background 0.16s ease,
        box-shadow 0.16s ease;
}

.rel-row--link {
    cursor: pointer;
}

.rel-row--link:hover,
.rel-row--linked {
    background: color-mix(in srgb, var(--cc) 13%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cc) 30%, transparent);
}

.rel-row:focus-visible {
    outline: 2px solid var(--cc);
    outline-offset: -2px;
}

.rel-row--warn {
    background: color-mix(in srgb, var(--rel-warn) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rel-warn) 28%, transparent);
}

.rel-row--crit {
    background: color-mix(in srgb, var(--rel-crit) 11%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rel-crit) 32%, transparent);
}

.rel-row__ic {
    display: grid;
    width: var(--space-8);
    height: var(--space-8);
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--cc) 15%, var(--color-surface-3));
    color: var(--cc);
}

.rel-row__tx {
    display: flex;
    min-width: 0;
    flex-direction: column;
    line-height: 1.3;
}

.rel-row__k {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.rel-row__n {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rel-row__d {
    overflow: hidden;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rel-row__meta {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}

.rel-chip {
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    padding: 2px var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    white-space: nowrap;
    text-transform: capitalize;
}

.rel-chip--warn {
    border-color: color-mix(in srgb, var(--rel-warn) 40%, transparent);
    background: color-mix(in srgb, var(--rel-warn) 13%, transparent);
    color: var(--color-warning-text);
}

.rel-chip--crit {
    border-color: color-mix(in srgb, var(--rel-crit) 44%, transparent);
    background: color-mix(in srgb, var(--rel-crit) 14%, transparent);
    color: var(--color-danger-text);
}

.rel-row__chev {
    display: grid;
    place-items: center;
    color: var(--color-text-tertiary);
    transition:
        transform 0.16s ease,
        color 0.16s ease;
}

.rel-row--link:hover .rel-row__chev,
.rel-row--linked .rel-row__chev {
    transform: translateX(3px);
    color: var(--cc);
}

@keyframes rel-float {
    0%,
    100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-7px);
    }
}

@keyframes rel-breathe {
    0%,
    100% {
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 30%, transparent);
    }
    50% {
        box-shadow:
            inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 40%, transparent),
            0 0 18px color-mix(in srgb, var(--color-primary) 40%, transparent);
    }
}

@keyframes rel-firing {
    0%,
    100% {
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--rel-crit) 30%, transparent);
    }
    50% {
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--rel-crit) 60%, transparent),
            0 0 20px color-mix(in srgb, var(--rel-crit) 45%, transparent);
    }
}

@media (max-width: 720px) {
    .rel-lists {
        grid-template-columns: 1fr;
    }

    .rel-attn__act {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .rel-node,
    .rel-node__photo {
        animation: none !important;
    }
}
</style>

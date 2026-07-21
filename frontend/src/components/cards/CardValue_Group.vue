<template>
    <!-- 1x1: compact — name, counts, type breakdown, health bar -->
    <div
        v-if="size === '1x1'"
        class="gc gc-1x1"
        :class="{ 'is-selected': selected }"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="gc-1x1-body">
            <!-- Name (header) — top centre, wraps to two lines -->
            <div class="gc-1x1-name">{{ group.name }}</div>
            <!-- Picture — avatar badge below the name -->
            <div class="gc-1x1-glyph">
                <span class="gc-1x1-avatar"><GroupGlyph :group="group" /></span>
            </div>
            <!-- Kind (left) · number of devices (right) -->
            <div class="gc-1x1-meta">
                <GroupKindBadge
                    :kind-id="group.kind"
                    plain
                    class="gc-1x1-kind"
                />
                <span class="gc-1x1-devcount">{{ totalDevices }}</span>
            </div>
        </div>
        <div v-if="editMode" class="gc-edit-overlay" @click.stop>
            <button type="button" class="gc-edit-btn" title="Move left" @click="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button type="button" class="gc-edit-btn" title="Move right" @click="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button v-if="resizable" type="button" class="gc-edit-btn" title="Cycle size" @click="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button type="button" class="gc-edit-btn gc-edit-btn--del" title="Remove card" @click="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- 2x1: wide — health ring left, info right -->
    <div
        v-else-if="size === '2x1'"
        class="gc ec-wide"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="gc-bar" :class="healthBarClass" />
        <div class="gc-main">
            <!-- Left: health ring -->
            <div class="gc-ring-wrap">
                <svg viewBox="0 0 100 100" class="gc-ring-svg" role="img" :aria-label="`${onlineDevices} of ${totalDevices} devices online`">
                    <title>{{ onlineDevices }} of {{ totalDevices }} devices online</title>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-surface-1)" stroke-width="5" />
                    <circle
                        cx="50" cy="50" r="42" fill="none"
                        :stroke="healthColor"
                        stroke-width="5"
                        stroke-linecap="round"
                        :stroke-dasharray="ringCircumference"
                        :stroke-dashoffset="ringOffset"
                        transform="rotate(-90 50 50)"
                    />
                    <text x="50" y="50" text-anchor="middle" dominant-baseline="central" fill="var(--color-text-primary)" font-size="24" font-weight="800">
                        {{ onlineDevices }}<tspan fill="var(--color-text-disabled)" font-size="15" font-weight="600">/{{ totalDevices }}</tspan>
                    </text>
                </svg>
                <div class="gc-ring-label" :style="{ color: healthColor }">{{ healthLabel }}</div>
            </div>
            <div class="gc-divider" />
            <!-- Right: name + type breakdown + subgroups -->
            <div class="gc-right-col">
                <div class="gc-wide-header">
                    <div class="gc-name"><GroupGlyph :group="group" class="gc-glyph" /> {{ group.name }}</div>
                    <GroupKindBadge :kind-id="group.kind" class="gc-kind-badge gc-kind-badge--inline" />
                    <div class="gc-wide-header-actions">
                        <span v-if="hasWarning" class="gc-badge gc-badge-w gc-badge--sm">!</span>
                        <button
                            v-if="hasMetadata"
                            type="button"
                            class="gc-info-btn"
                            :title="metadataTitle"
                            @click.stop
                        >
                            <i class="fas fa-circle-info" />
                        </button>
                    </div>
                </div>
                <div v-if="policyBadges.length" class="gc-policy-badges">
                    <span
                        v-for="badge in policyBadges"
                        :key="badge.key"
                        class="gc-policy-badge"
                        :class="`gc-policy-badge--${badge.variant}`"
                        :title="badge.title"
                    >
                        <i :class="badge.icon" />
                        {{ badge.label }}
                    </span>
                </div>
                <div v-if="deviceTypeSummary" class="gc-type-summary">{{ deviceTypeSummary }}</div>
                <div v-if="subgroups.length" class="gc-subgroup-rows">
                    <div
                        v-for="sg in subgroups"
                        :key="sg.id"
                        class="gc-subgroup-row"
                        @click.stop="$emit('open-preview')"
                    >
                        <span class="gc-subgroup-name">{{ sg.name }}</span>
                        <span class="gc-subgroup-count">{{ sg.devices.length }}</span>
                    </div>
                </div>
            </div>
        </div>
        <!-- Alert for offline devices -->
        <div v-if="offlineNames.length" class="gc-alert">
            <div class="gc-alert-icon">
                <i class="fas fa-triangle-exclamation" />
            </div>
            <div class="gc-alert-txt">{{ offlineNames.join(', ') }} offline</div>
        </div>
        <div v-if="editMode" class="gc-edit-overlay" @click.stop>
            <button type="button" class="gc-edit-btn" title="Move left" @click="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button type="button" class="gc-edit-btn" title="Move right" @click="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button v-if="resizable" type="button" class="gc-edit-btn" title="Cycle size" @click="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button type="button" class="gc-edit-btn gc-edit-btn--del" title="Remove card" @click="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- 2x2: hero — full detail with subgroups, devices, stats, footer -->
    <div
        v-else
        class="gc ec-hero"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="gc-bar" :class="healthBarClass" />
        <!-- Header -->
        <div class="gc-header">
            <div class="gc-hero-title-row">
                <div class="gc-name"><GroupGlyph :group="group" class="gc-glyph" /> {{ group.name }}</div>
                <GroupKindBadge :kind-id="group.kind" class="gc-kind-badge gc-kind-badge--inline" />
                <div class="gc-hero-title-actions">
                    <span v-if="hasWarning" class="gc-badge gc-badge-w gc-badge--md">!</span>
                    <button
                        v-if="hasMetadata"
                        type="button"
                        class="gc-info-btn"
                        :title="metadataTitle"
                        @click.stop
                    >
                        <i class="fas fa-circle-info" />
                    </button>
                </div>
            </div>
            <div class="gc-hero-subtitle">{{ totalDevices }} devices · {{ subgroups.length }} subgroups</div>
            <div v-if="policyBadges.length" class="gc-policy-badges">
                <span
                    v-for="badge in policyBadges"
                    :key="badge.key"
                    class="gc-policy-badge"
                    :class="`gc-policy-badge--${badge.variant}`"
                    :title="badge.title"
                >
                    <i :class="badge.icon" />
                    {{ badge.label }}
                </span>
            </div>
        </div>
        <!-- Health bar -->
        <div class="gc-health-section">
            <div class="gc-health-bar-lg">
                <div
                    class="gc-health-fill"
                    :class="{ warn: hasWarning }"
                    :style="{ width: `${healthPct}%` }"
                />
            </div>
            <div class="gc-health-counts">
                <span class="gc-health-count"><span class="dot-on" /> <b>{{ onlineDevices }}</b> online</span>
                <span v-if="offlineDevices > 0" class="gc-health-count"><span class="dot-off" /> <b>{{ offlineDevices }}</b> offline</span>
            </div>
        </div>
        <!-- Subgroups -->
        <div v-if="subgroups.length" class="gc-devices">
            <div class="gc-sec-label">SUBGROUPS</div>
            <div class="gc-subgroup-list">
                <div
                    v-for="sg in subgroups"
                    :key="sg.id"
                    class="gc-subgroup-row-hero"
                    @click.stop="$emit('open-preview')"
                >
                    <div class="gc-subgroup-left">
                        <i class="fas fa-folder gc-subgroup-folder-icon" />
                        <span class="gc-subgroup-name-hero">{{ sg.name }}</span>
                        <span class="gc-subgroup-devcount">{{ sg.devices.length }} devices</span>
                    </div>
                    <span class="gc-subgroup-health" :style="{ color: subgroupHealthColor(sg) }">
                        {{ subgroupOnline(sg) }}/{{ sg.devices.length }}
                    </span>
                </div>
            </div>
        </div>
        <!-- Device chips -->
        <div v-if="deviceChips.length" class="gc-devices">
            <div class="gc-sec-label">DEVICES</div>
            <div class="gc-device-grid">
                <div
                    v-for="chip in deviceChips"
                    :key="chip.shellyID"
                    class="gc-device-chip"
                    :class="{ offline: !chip.online }"
                >
                    <span class="gc-chip-dot" :class="chip.online ? 'on' : 'off'" />
                    {{ chip.name }}
                </div>
            </div>
        </div>
        <!-- Metadata chips -->
        <div v-if="hasMetadata" class="gc-devices">
            <div class="gc-sec-label">METADATA</div>
            <div class="gc-device-grid">
                <span
                    v-for="(value, key) in group.metadata"
                    :key="String(key)"
                    class="gc-meta-chip"
                >
                    {{ key }}: <b>{{ value }}</b>
                </span>
            </div>
        </div>
        <!-- Alert -->
        <div v-if="offlineNames.length" class="gc-alert">
            <div class="gc-alert-icon">
                <i class="fas fa-triangle-exclamation" />
            </div>
            <div class="gc-alert-txt">{{ offlineNames.slice(0, 3).join(', ') }} offline</div>
        </div>
        <!-- Footer -->
        <div class="gc-footer">
            <span class="gc-footer-stat">{{ totalDevices }} devices</span>
            <span class="gc-footer-stat" :class="{ ok: offlineDevices === 0 }" :style="{ color: healthColor }">
                {{ offlineDevices === 0 ? 'All operational' : `${onlineDevices}/${totalDevices} operational` }}
            </span>
        </div>
        <div v-if="editMode" class="gc-edit-overlay" @click.stop>
            <button type="button" class="gc-edit-btn" title="Move left" @click="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button type="button" class="gc-edit-btn" title="Move right" @click="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button v-if="resizable" type="button" class="gc-edit-btn" title="Cycle size" @click="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button type="button" class="gc-edit-btn gc-edit-btn--del" title="Remove card" @click="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {AlertSeverity} from '@api/alert';
import {computed, onBeforeUnmount, ref} from 'vue';
import GroupGlyph from '@/components/core/GroupGlyph.vue';
import GroupKindBadge from '@/components/core/GroupKindBadge.vue';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';

interface GroupData {
    id: number;
    name: string;
    devices: string[];
    metadata?: Record<string, any>;
    kind?: string;
    parentId?: number | null;
    effectiveSeverityFloor?: AlertSeverity | null;
    effectiveRetentionDays?: number | null;
    effectiveAuditRetentionDays?: number | null;
    isLegacy?: boolean;
}

type PolicyBadge = {
    key: string;
    variant: AlertSeverity | 'neutral';
    icon: string;
    label: string;
    title: string;
};

const props = withDefaults(
    defineProps<{
        group: GroupData;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
        selected?: boolean;
        resizable?: boolean;
    }>(),
    {editMode: false, selected: false, resizable: true}
);

defineEmits<{
    delete: [];
    move: [direction: number];
    'cycle-size': [];
    'open-preview': [];
}>();

const devicesStore = useDevicesStore();
const groupsStore = useGroupsStore();

// --- Health computations ---

const totalDevices = computed(() => props.group.devices.length);

const onlineDevices = computed(
    () =>
        props.group.devices.filter((sid) => devicesStore.devices[sid]?.online)
            .length
);

const offlineDevices = computed(() => totalDevices.value - onlineDevices.value);

const healthPct = computed(() =>
    totalDevices.value === 0
        ? 100
        : Math.round((onlineDevices.value / totalDevices.value) * 100)
);

const hasWarning = computed(() => offlineDevices.value > 0);

const healthColor = computed(() =>
    hasWarning.value ? 'var(--color-status-warn)' : 'var(--color-status-on)'
);

const healthBarClass = computed(() =>
    offlineDevices.value === 0
        ? 'h'
        : offlineDevices.value === totalDevices.value
          ? 'e'
          : 'w'
);

const healthLabel = computed(() =>
    offlineDevices.value === 0
        ? 'All online'
        : `${offlineDevices.value} offline`
);

// --- SVG ring for 2x1 ---

const RING_RADIUS = 42;
const ringCircumference = computed(() => Math.round(2 * Math.PI * RING_RADIUS));
const ringOffset = computed(() => {
    const circ = ringCircumference.value;
    return totalDevices.value === 0
        ? 0
        : Math.round(circ * (1 - onlineDevices.value / totalDevices.value));
});

// --- Subgroups ---

const subgroups = computed(() =>
    Object.values(groupsStore.groups).filter(
        (g) => g.parentGroupId === props.group.id
    )
);

function subgroupOnline(sg: GroupData): number {
    return sg.devices.filter((sid) => devicesStore.devices[sid]?.online).length;
}

function subgroupHealthColor(sg: GroupData): string {
    const online = subgroupOnline(sg);
    if (sg.devices.length === 0 || online === sg.devices.length)
        return 'var(--color-status-on)';
    if (online === 0) return 'var(--color-status-off)';
    return 'var(--color-status-warn)';
}

// --- Device chips (2x2 only) ---

const deviceChips = computed(() =>
    props.group.devices.map((sid) => {
        const d = devicesStore.devices[sid];
        return {
            shellyID: sid,
            name: d?.info?.name || d?.settings?.name || sid,
            online: !!d?.online
        };
    })
);

// --- Offline device names (for alerts) ---

const offlineNames = computed(() =>
    props.group.devices
        .filter((sid) => {
            const d = devicesStore.devices[sid];
            return d && !d.online;
        })
        .map((sid) => {
            const d = devicesStore.devices[sid];
            const name = d?.info?.name || d?.settings?.name;
            if (name) return name;
            // Shorten raw shellyID: "shellypro1-ec62608ce8e0" → "Pro1-ce8e0"
            const parts = sid.match(/shelly(.+?)-.*(.{5})$/);
            return parts ? `${parts[1]}-${parts[2]}` : sid;
        })
);

// --- Device type summary (for 2x1) ---

const deviceTypeParts = computed(() => {
    const counts: Record<string, number> = {};
    for (const sid of props.group.devices) {
        const d = devicesStore.devices[sid];
        const app = d?.info?.app ?? d?.info?.model ?? 'unknown';
        counts[app] = (counts[app] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({type, count}));
});

const deviceTypeSummary = computed(() => {
    if (deviceTypeParts.value.length === 0) return '';
    return deviceTypeParts.value
        .map((p) => `${p.count} ${p.type}`)
        .join(' \u00b7 ');
});

// --- Metadata ---

const showMetadata = ref(false);
// Track both the pending timer and the registered listener so unmount
// can cancel either. Real leak in virtualized card lists without this.
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let closeOnClick: (() => void) | null = null;

function toggleMetadata() {
    showMetadata.value = !showMetadata.value;
    if (!showMetadata.value) return;
    // Defer one tick so the click that opened the menu doesn't immediately
    // close it as an outside-click.
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        closeOnClick = () => {
            showMetadata.value = false;
            if (closeOnClick) {
                document.removeEventListener('click', closeOnClick);
                closeOnClick = null;
            }
        };
        document.addEventListener('click', closeOnClick);
    }, 0);
}

onBeforeUnmount(() => {
    if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }
    if (closeOnClick) {
        document.removeEventListener('click', closeOnClick);
        closeOnClick = null;
    }
});

const hasMetadata = computed(() => {
    const m = props.group.metadata;
    return m && Object.keys(m).length > 0;
});

const metadataTitle = computed(() => {
    const m = props.group.metadata;
    if (!m) return '';
    return Object.entries(m)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
});

// --- Policy badges (severity floor + retention days) ---

const policyBadges = computed<PolicyBadge[]>(() => {
    const out: PolicyBadge[] = [];
    const floor = props.group.effectiveSeverityFloor;
    if (floor) {
        out.push({
            key: 'floor',
            variant: floor,
            icon: 'fas fa-triangle-exclamation',
            label: `${floor}+`,
            title: `Severity floor: ${floor} — lower-severity alerts are suppressed for this group`
        });
    }
    const days = props.group.effectiveRetentionDays;
    if (days != null) {
        out.push({
            key: 'retention',
            variant: 'neutral',
            icon: 'fas fa-clock-rotate-left',
            label: `${days}d`,
            title: `Retention: ${days} days`
        });
    }
    const audit = props.group.effectiveAuditRetentionDays;
    if (audit != null) {
        out.push({
            key: 'audit',
            variant: 'neutral',
            icon: 'fas fa-scroll',
            label: `audit ${audit}d`,
            title: `Audit retention: ${audit} days`
        });
    }
    return out;
});
</script>

<style scoped>
/* Layout helpers scoped to this component — base .gc styles come from card-entities.css */

.gc {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
}

/* Glyph aligns with the name baseline; sized via em so it inherits .gc-name's font-size. */
.gc-glyph {
    margin-right: var(--space-1);
    vertical-align: -0.05em;
}

/* 1x1 — frosted-glass card: name (top centre), picture, then kind (left) ·
   number of devices (right). Overrides the flat .gc gradient base. */
.gc-1x1 {
    height: var(--grid-cell, 200px);
    background: var(--glass-1-bg);
    -webkit-backdrop-filter: var(--glass-1-filter);
    backdrop-filter: var(--glass-1-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-shadow);
    transition:
        transform var(--motion-hover),
        filter var(--motion-hover),
        border-color var(--motion-hover);
}
.gc-1x1:hover {
    transform: translateY(var(--hover-lift));
    filter: brightness(var(--hover-brightness));
    border-color: var(--color-border-strong);
}
.gc-1x1.is-selected {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring, var(--glass-shadow));
}
.gc-1x1-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-4);
    text-align: center;
}
/* Name on top — wraps to two lines, then ellipsis */
.gc-1x1-name {
    max-width: 100%;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    line-height: 1.25;
    color: var(--color-text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
}
/* Picture — avatar badge filling the middle */
.gc-1x1-glyph {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
}
.gc-1x1-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 104px;
    height: 104px;
    /* No border / no gray box — the icon or picture stands on its own. */
    font-size: 3.3rem;
    line-height: 1;
    color: var(--color-text-primary);
}
.gc-1x1-avatar :deep(.gg--icon) {
    color: inherit;
}
/* Picture fills the whole avatar, so it reads as large as possible. */
.gc-1x1-avatar :deep(.gg--image) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-lg);
}
/* Kind (left) · number of devices (right) */
.gc-1x1-meta {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--space-2);
}
.gc-1x1-kind {
    min-width: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.gc-1x1-devcount {
    margin-left: auto;
    flex-shrink: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
}

/* Selected state — scoped so it wins over global .gc styles */

/* Info button (metadata icon) */
.gc-info-btn {
    appearance: none;
    border: none;
    background: none;
    padding: 0;
    color: var(--color-text-disabled);
    opacity: 0.4;
    cursor: pointer;
    flex-shrink: 0;
    line-height: 1;
}
.gc-info-btn:hover {
    opacity: 0.7;
}
.gc-info-btn--abs {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 1;
}

/* Ring layout for 2x1 */
.gc-ring-wrap {
    flex: 0 0 38%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-5);
}
.gc-ring-svg {
    width: 140px;
    height: 140px;
}
.gc-ring-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    margin-top: var(--space-2);
}
.gc-divider {
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--color-border-medium), transparent);
    margin: var(--space-3) 0;
    flex-shrink: 0;
}

/* Right column for 2x1 */
.gc-right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--space-3) var(--space-5);
    gap: var(--space-2);
    min-width: 0;
}
/* Name + kind badge cluster on the left; actions pushed to the right via
   margin-left:auto on the actions container. Previous space-between with
   3 children put the badge in the middle of the empty space. */
.gc-wide-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.gc-wide-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-left: auto;
}
.gc-type-summary {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-disabled);
}

/* Subgroup rows for 2x1 */
.gc-subgroup-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: auto;
}
.gc-subgroup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    cursor: pointer;
}
.gc-subgroup-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.gc-subgroup-count {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

/* Hero (2x2) title row. Name + kind badge cluster on the left;
   warning/info actions pushed to the right via margin-left:auto on
   the actions container. */
.gc-hero-title-row {
    display: flex;
    align-items: start;
    gap: var(--space-2);
}
.gc-hero-title-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-left: auto;
}
.gc-hero-subtitle {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    margin-top: var(--space-2);
}

/* Subgroup rows for 2x2 hero */
.gc-subgroup-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.gc-subgroup-row-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    cursor: pointer;
}
.gc-subgroup-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.gc-subgroup-name-hero {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.gc-subgroup-devcount {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.gc-subgroup-health {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
}

/* Metadata chips */
.gc-meta-chip {
    font-size: var(--type-body);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    color: var(--color-text-tertiary);
}
.gc-meta-chip b {
    color: var(--color-text-secondary);
}

/* Edit mode overlay */
.gc-edit-overlay {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    gap: var(--space-2);
    z-index: 2;
}
.gc-edit-btn {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}
/* 48px touch target */
.gc-edit-btn::after { content: ""; position: absolute; inset: -7px; }
.gc-edit-btn:hover {
    border-color: var(--color-border-medium);
}
.gc-edit-btn--del:hover {
    border-color: var(--color-status-off);
    color: var(--color-status-off);
}

/* Info rows — icon + value + label aligned */
.gc-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
}
.gc-info-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.gc-info-icon {
    width: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.5;
}
.gc-info-val {
    min-width: 21px;
    font-weight: var(--font-black);
    color: var(--color-text-primary);
    text-align: right;
}
.gc-info-label { flex: 1; }

/* Status dots — centered */
.gc-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
}
.gc-status-num { color: var(--color-text-primary); }
.gc-status-num--off { color: var(--color-status-off); }
.gc-status-sep {
    width: 1px; height: 13px;
    background: linear-gradient(180deg, transparent, var(--color-border-medium), transparent);
    flex-shrink: 0;
    margin: 0 var(--space-1);
}
.gc-hdot {
    width: 8px; height: 8px; border-radius: var(--radius-full); flex-shrink: 0;
}
.gc-hdot--on { background: var(--color-status-on); }
.gc-hdot--off { background: var(--color-status-off); }

.gc-subgroup-folder-icon { color: var(--color-text-tertiary); font-size: var(--type-body); }

/* Badge sizes */
.gc-badge--sm { width: 16px; height: 16px; font-size: var(--type-body); }
.gc-badge--md { width: 21px; height: 21px; font-size: var(--type-body); }

/* Kind badge — slots under the name in 1x1 card, inline in wide / hero. */
.gc-kind-badge { align-self: flex-start; margin-top: var(--space-1); }
.gc-kind-badge--inline { margin-top: 0; }

/* Policy badges — severity floor + retention days */
.gc-policy-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
}
.gc-policy-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    line-height: 1;
}
.gc-policy-badge--info {
    background: var(--color-alert-info-bg);
    color: var(--color-alert-info-fg);
    border-color: var(--color-alert-info-border);
}
.gc-policy-badge--warning {
    background: var(--color-alert-warning-bg);
    color: var(--color-alert-warning-fg);
    border-color: var(--color-alert-warning-border);
}
.gc-policy-badge--critical {
    background: var(--color-alert-critical-bg);
    color: var(--color-alert-critical-fg);
    border-color: var(--color-alert-critical-border);
}
.gc-policy-badge--neutral {
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    border-color: var(--color-border-medium);
}
</style>

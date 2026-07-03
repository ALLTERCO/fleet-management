<template>
    <!-- Dashboard-tile mode: rendered when `size` prop is given. -->
    <div
        v-if="size"
        class="tgc tgc--tile"
        :class="[`tgc--${size}`, {'tgc-selected': selected}]"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="tgc-bar" :class="healthBarClass" />
        <div class="tgc-tile-body">
            <div class="tgc-hdr">
                <TagChip v-if="resolvedTag" :tag="resolvedTag" />
                <span v-else class="tgc-key">tag {{ tagId }}</span>
            </div>
            <div v-if="resolvedTag" class="tgc-name">{{ resolvedTag.name }}</div>
            <p v-if="size !== '1x1' && resolvedTag?.description" class="tgc-desc">
                {{ resolvedTag.description }}
            </p>
            <div class="tgc-stats">
                <span class="tgc-stat">
                    <span class="tgc-hdot tgc-hdot--on" />
                    <span class="tgc-stat-v">{{ onlineDevices }}</span>
                    <span class="tgc-stat-l">online</span>
                </span>
                <span v-if="offlineDevices > 0" class="tgc-stat">
                    <span class="tgc-hdot tgc-hdot--off" />
                    <span class="tgc-stat-v">{{ offlineDevices }}</span>
                    <span class="tgc-stat-l">offline</span>
                </span>
                <span class="tgc-stat tgc-stat--total">
                    <i class="fas fa-microchip tgc-stat-icon" />
                    <span class="tgc-stat-v">{{ totalDevices }}</span>
                </span>
            </div>
        </div>
        <div v-if="editMode" class="tgc-edit" @click.stop>
            <button type="button" class="tgc-edit-btn" title="Move left" @click="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button type="button" class="tgc-edit-btn" title="Move right" @click="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button v-if="resizable" type="button" class="tgc-edit-btn" title="Cycle size" @click="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button type="button" class="tgc-edit-btn tgc-edit-btn--del" title="Remove card" @click="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- Picker mode: solid color card, icon left full-height, name right. -->
    <div
        v-else-if="resolvedTag"
        class="tgc"
        :class="{'is-selected': selected}"
        :style="cardAccent"
        :title="resolvedTag.description || resolvedTag.key"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <span class="tgc-name">{{ resolvedTag.name }}</span>
        <span v-if="assignmentTotal > 0" class="tgc-count">{{ assignmentTotal }}</span>
    </div>
</template>

<script setup lang="ts">
import type {Tag as ApiTag} from '@api/tag';
import {computed} from 'vue';
import TagChip from '@/components/core/TagChip.vue';
import {accentToCss} from '@/config/accentTokens';
import {useDevicesStore} from '@/stores/devices';
import {useTagsStore} from '@/stores/tags';

const props = withDefaults(
    defineProps<{
        // Picker mode: pass the full tag object.
        tag?: ApiTag;
        // Dashboard-tile mode: pass the tagId; component resolves + aggregates.
        tagId?: number;
        size?: '1x1' | '2x1' | '2x2';
        selected?: boolean;
        editMode?: boolean;
        resizable?: boolean;
    }>(),
    {
        tag: undefined,
        tagId: undefined,
        size: undefined,
        selected: false,
        editMode: false,
        resizable: true
    }
);

defineEmits<{
    'open-preview': [];
    delete: [];
    move: [direction: number];
    'cycle-size': [];
}>();

const tagsStore = useTagsStore();
const devicesStore = useDevicesStore();

const resolvedTag = computed<ApiTag | undefined>(() => {
    if (props.tag) return props.tag;
    if (props.tagId != null) return tagsStore.tags[props.tagId];
    return undefined;
});

const assignmentTotal = computed(() => {
    const counts = resolvedTag.value?.counts;
    if (!counts) return 0;
    return Object.values(counts).reduce(
        (acc, n) => acc + ((n as number) ?? 0),
        0
    );
});
const countSummary = computed(() => {
    const t = assignmentTotal.value;
    if (t === 0) return '';
    return `${t} assignment${t === 1 ? '' : 's'}`;
});

const tagDevices = computed(() => {
    const id = resolvedTag.value?.id ?? props.tagId;
    if (id == null) return [];
    return Object.values(devicesStore.devices).filter((d) =>
        d.tagIds?.includes(id)
    );
});
const totalDevices = computed(() => tagDevices.value.length);
const onlineDevices = computed(
    () => tagDevices.value.filter((d) => d.online).length
);
const offlineDevices = computed(
    () => totalDevices.value - onlineDevices.value
);
const healthBarClass = computed(() => {
    if (totalDevices.value === 0) return 'tgc-bar--neutral';
    if (onlineDevices.value === 0) return 'tgc-bar--err';
    if (offlineDevices.value > 0) return 'tgc-bar--warn';
    return 'tgc-bar--ok';
});

const cardAccent = computed(() => {
    const resolved = accentToCss(resolvedTag.value?.color);
    if (!resolved) return undefined;
    return {
        '--tgc-color': resolved,
        borderColor: resolved
    } as const;
});

</script>

<style scoped>
/* ── Picker / list card ── */
/* --tgc-accent / --tgc-accent-soft / --tgc-accent-edge are bound inline
   per-instance from the tag's color. When the tag has no color the variables
   are undefined and the fallbacks (--color-*) win. */
.tgc {
    position: relative;
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    background: var(--glass-1-bg);
    -webkit-backdrop-filter: var(--glass-1-filter);
    backdrop-filter: var(--glass-1-filter);
    cursor: pointer;
    transition:
        box-shadow var(--motion-hover),
        transform var(--motion-hover),
        filter var(--motion-hover);
    box-shadow: var(--glass-shadow);
    height: var(--space-10);
    overflow: hidden;
}
.tgc:hover {
    transform: translateY(var(--hover-lift));
    filter: brightness(var(--hover-brightness));
    box-shadow:
        var(--glass-shadow),
        0 8px 24px -10px var(--tgc-color, var(--color-border-strong));
}
.tgc:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-primary);
    outline-offset: var(--focus-ring-offset);
}
.tgc-selected {
    box-shadow: var(--shadow-brand-ring);
}
.tgc-icon,
.tgc-image {
    width: var(--space-10);
    flex-shrink: 0;
}
.tgc-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tgc-color, var(--color-text-primary));
    font-size: var(--icon-size-lg);
}
.tgc-image {
    display: block;
    height: 100%;
    object-fit: cover;
}
.tgc-name {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-4);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    text-align: center;
    white-space: nowrap;
}
/* Divider only sits between a leading visual and the name. A glyph-less tag
   has no leading segment, so no divider — just the centered, compact name. */
.tgc--has-visual > .tgc-name::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    height: 56%;
    width: 1px;
    transform: translateY(-50%);
    background: linear-gradient(
        180deg,
        transparent,
        var(--divider-hairline),
        transparent
    );
}
.tgc-count {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-overlay-light);
    border: 1px solid var(--glass-highlight);
}

/* ── Dashboard tile mode ── */
.tgc--tile {
    position: relative;
    padding: 0;
    gap: 0;
    height: 100%;
    overflow: hidden;
}
.tgc-bar {
    height: 3px;
    width: 100%;
    flex-shrink: 0;
}
.tgc-bar--ok { background: var(--color-status-on); }
.tgc-bar--warn { background: var(--color-status-warn); }
.tgc-bar--err { background: var(--color-status-off); }
.tgc-bar--neutral { background: var(--color-border-default); }
.tgc-tile-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    min-height: 0;
}
.tgc-tile-body .tgc-name {
    font-size: var(--type-subheading);
}
.tgc--1x1 .tgc-tile-body .tgc-name {
    font-size: var(--type-body);
}
.tgc-stats {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    margin-top: auto;
    flex-wrap: wrap;
}
.tgc-stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.tgc-hdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.tgc-hdot--on { background: var(--color-status-on); }
.tgc-hdot--off { background: var(--color-status-off); }
.tgc-stat-icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
}
.tgc-stat-v {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
}
.tgc-stat-l {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.tgc-edit {
    position: absolute;
    top: var(--space-1-5);
    right: var(--space-1-5);
    display: flex;
    gap: var(--space-1);
}
.tgc-edit-btn {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.tgc-edit-btn--del:hover { color: var(--color-status-off); }
</style>

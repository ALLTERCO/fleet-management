<template>
    <div class="gtn" :class="'gtn--depth-' + Math.min(depth, 5)">
        <div
            class="gtn__row"
            :class="{'gtn__row--selected': selectedId === node.id}"
            role="button"
            tabindex="0"
            @click="emit('select', node.id)"
            @keydown.enter="emit('select', node.id)"
        >
            <img
                v-if="node.imageAssetId"
                :src="node.imageAssetId"
                alt=""
                class="gtn__image"
            />
            <i
                v-else
                :class="['gtn__icon', node.visual?.icon || 'fas fa-folder', {'gtn__icon--open': children.length > 0}]"
                :style="node.visual?.accent ? {color: `rgb(var(--accent-${node.visual.accent}))`} : undefined"
            />
            <span class="gtn__name">{{ node.name }}</span>

            <!-- Counts: devices (recursive) + direct subgroups -->
            <span class="gtn__stats">
                <span class="gtn__stat">{{ totalDeviceCount }} <i class="fas fa-microchip" /></span>
                <span v-if="children.length > 0" class="gtn__stat">{{ children.length }} <i class="fas fa-folder" /></span>
            </span>

            <!-- Delete — red, not for root -->
            <button v-if="depth > 0" class="gtn__btn gtn__btn--delete" title="Delete group" aria-label="Delete group" @click.stop="emit('delete', node.id)">
                <i class="fas fa-trash" />
            </button>
        </div>

        <!-- Children — always expanded, no toggle needed -->
        <GroupTreeNode
            v-for="child in children"
            :key="child.id"
            :node="child"
            :children-map="childrenMap"
            :selected-id="selectedId"
            :depth="depth + 1"
            @select="emit('select', $event)"
            @toggle="emit('toggle', $event)"
            @delete="emit('delete', $event)"
        >
        </GroupTreeNode>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    node: {
        id: number;
        name: string;
        devices?: string[];
        parentGroupId?: number | null;
        visual?: {icon?: string; accent?: string};
        imageAssetId?: string | null;
    };
    childrenMap: Record<number, any[]>;
    selectedId: number | null;
    depth: number;
}>();

const emit = defineEmits<{
    select: [groupId: number];
    toggle: [groupId: number];
    delete: [groupId: number];
}>();

const children = computed(() => props.childrenMap[props.node.id] ?? []);

// Recursive device count — this group's devices + all descendants' devices
function countDevicesRecursive(
    groupId: number,
    map: Record<number, any[]>,
    groups: Record<number, any>
): number {
    const group = groups[groupId] ?? props.node;
    let count = group.devices?.length ?? 0;
    for (const child of map[groupId] ?? []) {
        count += countDevicesRecursive(child.id, map, groups);
    }
    return count;
}

const totalDeviceCount = computed(() =>
    countDevicesRecursive(props.node.id, props.childrenMap, {
        [props.node.id]: props.node
    })
);
</script>

<style scoped>
.gtn { display: flex; flex-direction: column; }

.gtn--depth-0 { padding-left: 0; }
.gtn--depth-1 { padding-left: var(--space-3); }
.gtn--depth-2 { padding-left: var(--space-6); }
.gtn--depth-3 { padding-left: calc(var(--space-3) * 3); }
.gtn--depth-4 { padding-left: var(--space-12); }
.gtn--depth-5 { padding-left: calc(var(--space-3) * 5); }

.gtn__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.gtn__row:hover { background: var(--state-hover-bg); }
.gtn__row--selected {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-text-primary);
}

.gtn__icon { color: var(--color-text-disabled); font-size: var(--type-body); flex-shrink: 0; }
.gtn__icon--open { color: var(--color-primary); opacity: 0.7; }
.gtn__row--selected .gtn__icon { color: var(--color-primary); }
.gtn__image {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-xs);
    object-fit: contain;
    flex-shrink: 0;
}

.gtn__name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Stats — device count + subgroup count */
.gtn__stats {
    display: flex; gap: var(--space-2); flex-shrink: 0;
}
.gtn__stat {
    font-size: var(--type-body); font-weight: 400; color: var(--color-text-disabled);
    font-variant-numeric: tabular-nums;
    display: flex; align-items: center; gap: var(--space-1);
}
.gtn__stat i { font-size: var(--type-body); opacity: 0.6; }

/* Action buttons — 28px, always visible, colored */
/* 28px visual, 48px hit area via ::after */
.gtn__btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; border-radius: var(--radius-full);
    cursor: pointer; font-size: var(--type-body); flex-shrink: 0;
    position: relative;
    transition: background var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}
.gtn__btn::after {
    content: ""; position: absolute; inset: -10px;
}
.gtn__btn:active { transform: scale(0.9); }

/* Red delete button */
.gtn__btn--delete {
    background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
    color: var(--color-danger-text);
}
.gtn__btn--delete:hover {
    background: color-mix(in srgb, var(--color-danger-text) 20%, transparent);
}

.gtn__inline-add {
    padding-left: var(--space-3);
    padding-top: var(--space-1);
}
</style>

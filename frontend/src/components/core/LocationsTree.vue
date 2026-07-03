<template>
    <div class="lt">
        <!-- Root drop zone — only shown while actively dragging a node;
             previously visible at all times, which felt like dead chrome. -->
        <div
            v-if="dragId !== null"
            class="lt__root-drop"
            :class="{'lt__root-drop--active': rootHover}"
            @dragover.prevent="onRootDragOver"
            @dragleave="rootHover = false"
            @drop.prevent="onDropRoot"
        >
            <i class="fas fa-level-up-alt" />
            Drop here to make top-level
        </div>

        <div v-if="visibleRows.length === 0" class="lt__empty">
            No locations yet.
        </div>

        <template v-for="row in visibleRows" :key="row.location.id">
            <div
                class="lt__row"
                :class="{
                    'lt__row--dragging': dragId === row.location.id,
                    'lt__row--drop-ok': dropTarget === row.location.id && dropOk,
                    'lt__row--drop-bad': dropTarget === row.location.id && !dropOk,
                    'lt__row--selected': selectedId === row.location.id,
                    'lt__row--child': row.depth > 0
                }"
                :style="{
                    '--lt-depth': row.depth,
                    paddingLeft: `calc(var(--gap-md) + ${row.depth} * var(--space-5))`
                }"
                :draggable="canWrite"
                @dragstart="onDragStart($event, row.location.id)"
                @dragover.prevent="onDragOver($event, row.location.id)"
                @dragleave="onDragLeave(row.location.id)"
                @drop.prevent="onDrop($event, row.location.id)"
                @dragend="onDragEnd"
            >
                <button
                    v-if="hasChildren(row.location.id)"
                    type="button"
                    class="lt__chevron"
                    :class="{'lt__chevron--open': expanded.has(row.location.id)}"
                    :aria-label="
                        expanded.has(row.location.id) ? 'Collapse' : 'Expand'
                    "
                    @click.stop="toggle(row.location.id)"
                >
                    <i class="fas fa-chevron-right" />
                </button>
                <span v-else class="lt__chevron lt__chevron--leaf" />

                <span
                    class="lt__dot"
                    :style="{background: kindDotColor(row.location.kind)}"
                    :aria-label="row.location.kind"
                />
                <span class="lt__name" @click="$emit('open', row.location.id)">
                    {{ row.location.name }}
                </span>
                <button
                    v-if="canWrite"
                    type="button"
                    class="lt__add"
                    :title="`Add child under ${row.location.name}`"
                    :aria-label="`Add child under ${row.location.name}`"
                    @click.stop="onAddChild(row.location)"
                >
                    <i class="fas fa-plus" />
                </button>
                <button
                    v-if="canWrite"
                    type="button"
                    class="lt__delete"
                    :title="`Delete ${row.location.name}`"
                    :aria-label="`Delete ${row.location.name}`"
                    @click.stop="$emit('delete', row.location.id)"
                >
                    <i class="fas fa-trash-can" />
                </button>
            </div>
        </template>

        <LocationFormModal
            v-model="createVisible"
            mode="create"
            :default-parent-id="createParentId"
            :default-kind="createKind"
            @saved="onChildCreated"
        />
    </div>
</template>

<script setup lang="ts">
import type {Location as ApiLocation, LocationKind} from '@api/location';
import {computed, ref, watch} from 'vue';
import LocationFormModal from '@/components/modals/LocationFormModal.vue';
import {useKeyboardShortcuts} from '@/composables/useKeyboardShortcuts';
import {usePermissions} from '@/composables/usePermissions';
import {nextRowSelection} from '@/helpers/keyboardShortcuts';
import {kindDotColor} from '@/helpers/location-kinds';
import {childKindFor} from '@/helpers/locationKindRules';
import {
    buildTree,
    canReparent, 
    type LocationTreeNode
} from '@/helpers/locationTree';
import {useLocationsStore} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';

const props = withDefaults(
    defineProps<{
        selectedId?: number | null;
    }>(),
    {selectedId: null}
);

const emit = defineEmits<{
    open: [id: number];
    created: [id: number];
    delete: [id: number];
}>();

const createVisible = ref(false);
const createParentId = ref<number | null>(null);
const createKind = ref<LocationKind | undefined>();

// "+" on a row opens the shared modal, pre-seeded with this parent and the
// sensible child kind; inheritance fills the rest from the parent.
function onAddChild(parent: ApiLocation): void {
    createParentId.value = parent.id;
    createKind.value = childKindFor(parent.kind);
    if (!expanded.value.has(parent.id)) toggle(parent.id);
    createVisible.value = true;
    trackInteraction('locations', 'create_open', String(parent.id));
}

function onChildCreated(loc: ApiLocation): void {
    emit('created', loc.id);
}

const store = useLocationsStore();
const {canWrite} = usePermissions();

const EXPAND_KEY = 'fm.locationsTree.expanded';
const expanded = ref<Set<number>>(loadExpanded());
const dragId = ref<number | null>(null);
const dropTarget = ref<number | null>(null);
const dropOk = ref(false);
const rootHover = ref(false);

function loadExpanded(): Set<number> {
    try {
        const raw = localStorage.getItem(EXPAND_KEY);
        if (raw === null) return new Set();
        const arr = JSON.parse(raw) as unknown;
        return Array.isArray(arr)
            ? new Set(arr.filter((n) => typeof n === 'number'))
            : new Set();
    } catch {
        return new Set();
    }
}

// First visit (no saved state): expand every parent so the tree opens
// fully. Saved state takes precedence on return visits.
watch(
    () => Object.values(store.locations).length,
    (count) => {
        if (count === 0) return;
        if (localStorage.getItem(EXPAND_KEY) !== null) return;
        const parents = new Set<number>();
        for (const loc of Object.values(store.locations)) {
            if (loc.parentLocationId != null) parents.add(loc.parentLocationId);
        }
        if (parents.size > 0) expanded.value = parents;
    },
    {immediate: true}
);

watch(
    expanded,
    (next) => {
        try {
            localStorage.setItem(EXPAND_KEY, JSON.stringify([...next]));
        } catch {
            /* quota — non-fatal */
        }
    },
    {deep: true}
);

const tree = computed<LocationTreeNode[]>(() => buildTree(store.locations));

const childCountByParent = computed<Record<number, number>>(() => {
    const out: Record<number, number> = {};
    for (const loc of Object.values(store.locations)) {
        const p = loc.parentLocationId;
        if (p != null) out[p] = (out[p] ?? 0) + 1;
    }
    return out;
});

function _childCountFor(id: number): number {
    return childCountByParent.value[id] ?? 0;
}

function hasChildren(id: number): boolean {
    return childCountByParent.value[id] != null;
}

function flatten(
    nodes: LocationTreeNode[],
    into: LocationTreeNode[]
): LocationTreeNode[] {
    for (const n of nodes) {
        into.push(n);
        if (expanded.value.has(n.location.id)) flatten(n.children, into);
    }
    return into;
}

const visibleRows = computed<LocationTreeNode[]>(() => flatten(tree.value, []));

function toggle(id: number) {
    const next = new Set(expanded.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
}

// Auto-expand every ancestor of `selectedId` so the row is visible after
// a reload or a deep-link. Skips work when nothing is selected or when
// the path is already expanded.
watch(
    [() => props.selectedId, () => store.locations],
    ([selected, locations]) => {
        if (selected == null) return;
        const ancestors = collectAncestorIds(selected, locations);
        if (ancestors.length === 0) return;
        const next = new Set(expanded.value);
        let changed = false;
        for (const id of ancestors) {
            if (!next.has(id)) {
                next.add(id);
                changed = true;
            }
        }
        if (changed) expanded.value = next;
    },
    {immediate: true}
);

function collectAncestorIds(
    leafId: number,
    locations: Record<number, {parentLocationId: number | null}>
): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    let cursor: number | null = locations[leafId]?.parentLocationId ?? null;
    while (cursor != null && !seen.has(cursor)) {
        seen.add(cursor);
        ids.push(cursor);
        cursor = locations[cursor]?.parentLocationId ?? null;
    }
    return ids;
}

function onDragStart(e: DragEvent, id: number) {
    if (!canWrite.value) return;
    dragId.value = id;
    e.dataTransfer?.setData('text/plain', String(id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e: DragEvent, targetId: number) {
    if (dragId.value == null) return;
    const ok = canReparent(dragId.value, targetId, store.locations);
    dropTarget.value = targetId;
    dropOk.value = ok;
    if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'move' : 'none';
}

function onDragLeave(targetId: number) {
    if (dropTarget.value === targetId) {
        dropTarget.value = null;
        dropOk.value = false;
    }
}

function onRootDragOver() {
    if (dragId.value == null) return;
    const ok = canReparent(dragId.value, null, store.locations);
    rootHover.value = ok;
}

async function onDrop(_e: DragEvent, targetId: number) {
    if (dragId.value == null) return;
    const id = dragId.value;
    const ok = canReparent(id, targetId, store.locations);
    reset();
    if (!ok) {
        trackInteraction('locations', 'drag_move', `blocked:${id}→${targetId}`);
        return;
    }
    trackInteraction('locations', 'drag_move', `${id}→${targetId}`);
    await store.updateLocation(id, {parentLocationId: targetId});
    // Auto-expand the target so the moved child is visible.
    if (!expanded.value.has(targetId)) toggle(targetId);
}

async function onDropRoot() {
    if (dragId.value == null) return;
    const id = dragId.value;
    const ok = canReparent(id, null, store.locations);
    reset();
    if (!ok) {
        trackInteraction('locations', 'drag_move', `blocked:${id}→root`);
        return;
    }
    trackInteraction('locations', 'drag_move', `${id}→root`);
    await store.updateLocation(id, {parentLocationId: null});
}

function onDragEnd() {
    reset();
}

function reset() {
    dragId.value = null;
    dropTarget.value = null;
    dropOk.value = false;
    rootHover.value = false;
}

// Keyboard navigation — ↑/↓ moves selection, Enter expands/collapses.
// Window-level binding with the editable-target guard so typing in the
// search input or any other field doesn't move the selection.
const visibleRowIds = computed<readonly number[]>(() =>
    visibleRows.value.map((row) => row.location.id)
);

function navigateRow(direction: 'up' | 'down'): void {
    const next = nextRowSelection({
        visibleIds: visibleRowIds.value,
        currentId: props.selectedId,
        direction
    });
    if (next != null) emit('open', next);
}

function toggleSelectedExpansion(): void {
    if (props.selectedId == null) return;
    if (hasChildren(props.selectedId)) toggle(props.selectedId);
}

useKeyboardShortcuts({
    bindings: [
        {key: 'ArrowDown', handler: () => navigateRow('down')},
        {key: 'ArrowUp', handler: () => navigateRow('up')},
        {key: 'Enter', handler: toggleSelectedExpansion}
    ]
});
</script>

<style scoped>
.lt {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-2) 0;
}
.lt__root-drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0 var(--gap-md) var(--space-2);
    padding: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    background: transparent;
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-md);
    transition:
        color var(--duration-fast),
        border-color var(--duration-fast);
}
.lt__root-drop--active {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.lt__empty {
    padding: var(--space-4) var(--gap-md);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.lt__row {
    --lt-depth: 0;
    /* Rail colour is --color-border-medium (10% white) per design tokens —
       low enough to guide the eye without competing with row text. */
    --lt-rail-color: var(--color-border-medium);
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--gap-md);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: grab;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
    /* Vertical rails: one 1px line at the centre of each ancestor's depth
       column, drawn via a repeating gradient masked to depth × space-5.
       For depth-0 rows, background-size collapses to 0 and no rail draws. */
    background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--space-5) / 2 - 0.5px),
        var(--lt-rail-color) calc(var(--space-5) / 2 - 0.5px),
        var(--lt-rail-color) calc(var(--space-5) / 2 + 0.5px),
        transparent calc(var(--space-5) / 2 + 0.5px),
        transparent var(--space-5)
    );
    background-position: var(--gap-md) 0;
    background-size: calc(var(--lt-depth) * var(--space-5)) 100%;
    background-repeat: no-repeat;
}
/* Elbow connector — horizontal stub from the immediate parent rail
   to the row's own chevron column. Only on child rows. */
.lt__row--child::before {
    content: '';
    position: absolute;
    top: 50%;
    left: calc(
        var(--gap-md) + (var(--lt-depth) - 1) * var(--space-5) +
            var(--space-5) / 2
    );
    width: calc(var(--space-5) / 2);
    height: 1px;
    background: var(--lt-rail-color);
    pointer-events: none;
}
.lt__row:hover {
    background: var(--color-surface-2);
}
.lt__row:active {
    cursor: grabbing;
}
.lt__row--dragging {
    opacity: 0.4;
}
.lt__row--drop-ok {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.lt__row--drop-bad {
    border-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 8%, transparent);
    cursor: not-allowed;
}
/* Selected — the single Shelly Blue stripe is the only "wire" connecting
   tree selection to the detail pane's last breadcrumb segment. */
.lt__row--selected {
    background: rgba(var(--color-primary-rgb), 0.08);
}
.lt__row--selected::after {
    content: '';
    position: absolute;
    left: 0;
    top: var(--space-1);
    bottom: var(--space-1);
    width: 2px;
    border-radius: var(--radius-xs);
    background: var(--color-primary);
}
.lt__row--selected .lt__name {
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
/* Add-child button — hidden until row hover, then fades in to the right
   of the row. Click adds an inline create input under that row. */
.lt__add {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: 0;
    background: transparent;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity var(--duration-fast),
        color var(--duration-fast),
        background var(--duration-fast);
}
.lt__row:hover .lt__add {
    opacity: 1;
}
.lt__add:hover {
    color: var(--color-primary);
    background: rgba(var(--color-primary-rgb), 0.08);
}
/* Delete button — sits just right of the add button, same hover-reveal
   behaviour but tinted danger. Opens the confirmation modal via @delete. */
.lt__delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: 0;
    background: transparent;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity var(--duration-fast),
        color var(--duration-fast),
        background var(--duration-fast);
}
.lt__row:hover .lt__delete {
    opacity: 1;
}
.lt__delete:hover {
    color: var(--color-danger);
    background: rgba(var(--color-danger-rgb), 0.1);
}
.lt__chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: transform var(--duration-fast);
}
.lt__chevron:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-3);
}
.lt__chevron--open {
    transform: rotate(90deg);
}
/* Leaf rows get no chevron, just a clean horizontal stub continuing the
   rail so the eye reads "this is a terminal node". */
.lt__chevron--leaf {
    cursor: default;
    color: transparent;
    background-image: linear-gradient(
        var(--lt-rail-color),
        var(--lt-rail-color)
    );
    background-size: 60% 1px;
    background-position: center;
    background-repeat: no-repeat;
}
.lt__chevron--leaf:hover {
    color: transparent;
    background: none;
    background-image: linear-gradient(
        var(--lt-rail-color),
        var(--lt-rail-color)
    );
    background-size: 60% 1px;
    background-position: center;
    background-repeat: no-repeat;
}
/* Kind dot — single coloured circle stands in for both the legacy
   location-pin icon and the trailing kind pill. Colour comes from
   kindDotColor() in helpers/location-kinds.ts. */
.lt__dot {
    flex-shrink: 0;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
}
.lt__name {
    flex: 1;
    min-width: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lt__name:hover {
    color: var(--color-primary);
}
</style>

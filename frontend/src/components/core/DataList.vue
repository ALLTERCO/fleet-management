<template>
    <!-- Desktop: standard sticky-header table -->
    <div v-if="!isSmall" class="dl-desktop" :class="`dl-desktop--${density}`">
        <table class="dl-table">
            <thead>
                <tr>
                    <th
                        v-for="col in columns"
                        :key="col.key"
                        :class="thClass(col)"
                        :style="col.width ? `width:${col.width}` : ''"
                        :scope="col.sortable ? 'col' : undefined"
                    >
                        <button
                            v-if="col.sortable"
                            type="button"
                            class="dl-sort"
                            :class="{'dl-sort--active': sortKey === col.key}"
                            @click="emit('sort', col.key)"
                        >
                            {{ col.label }}
                            <i
                                v-if="sortKey === col.key"
                                class="fas dl-sort-icon"
                                :class="sortAsc ? 'fa-arrow-up' : 'fa-arrow-down'"
                            />
                        </button>
                        <span v-else>{{ col.label }}</span>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="errorMessage">
                    <td :colspan="columns.length" class="dl-state dl-state--error">
                        <i class="fas fa-exclamation-triangle" /> {{ errorMessage }}
                    </td>
                </tr>
                <template v-else-if="loading">
                    <tr v-for="n in skeletonCount" :key="`sk-${n}`">
                        <td v-for="col in columns" :key="col.key" :class="tdClass(col)">
                            <Skeleton variant="text" />
                        </td>
                    </tr>
                </template>
                <tr v-else-if="rows.length === 0">
                    <td :colspan="columns.length" class="dl-state dl-state--empty">
                        <slot name="empty">{{ emptyMessage }}</slot>
                    </td>
                </tr>
                <tr
                    v-for="row in rows"
                    v-else
                    :key="resolveKey(row)"
                    :class="['dl-row', {'dl-row--clickable': clickable}]"
                    @click="clickable && emit('row-click', row)"
                >
                    <td v-for="col in columns" :key="col.key" :class="tdClass(col)">
                        <slot :name="`cell-${col.key}`" :row="row" :value="resolveValue(row, col)">
                            {{ resolveValue(row, col) }}
                        </slot>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- Mobile: role-driven cards -->
    <div v-else class="dl-mobile">
        <div v-if="errorMessage" class="dl-state dl-state--error">
            <i class="fas fa-exclamation-triangle" /> {{ errorMessage }}
        </div>
        <template v-else-if="loading">
            <div v-for="n in skeletonCount" :key="`sk-${n}`" class="dl-card">
                <Skeleton variant="row" />
            </div>
        </template>
        <div v-else-if="rows.length === 0" class="dl-state dl-state--empty">
            <slot name="empty">{{ emptyMessage }}</slot>
        </div>
        <article
            v-for="row in rows"
            v-else
            :key="resolveKey(row)"
            :class="['dl-card', {'dl-card--clickable': clickable}]"
            :tabindex="clickable ? 0 : undefined"
            @click="clickable && emit('row-click', row)"
            @keydown.enter="clickable && emit('row-click', row)"
        >
            <header v-if="primaryCol || statusCol" class="dl-card__head">
                <h3 v-if="primaryCol" class="dl-card__title">
                    <slot
                        :name="`cell-${primaryCol.key}`"
                        :row="row"
                        :value="resolveValue(row, primaryCol)"
                    >{{ resolveValue(row, primaryCol) }}</slot>
                </h3>
                <span v-if="statusCol" class="dl-card__status">
                    <slot
                        :name="`cell-${statusCol.key}`"
                        :row="row"
                        :value="resolveValue(row, statusCol)"
                    >{{ resolveValue(row, statusCol) }}</slot>
                </span>
            </header>
            <p v-if="secondaryCol" class="dl-card__sub">
                <slot
                    :name="`cell-${secondaryCol.key}`"
                    :row="row"
                    :value="resolveValue(row, secondaryCol)"
                >{{ resolveValue(row, secondaryCol) }}</slot>
            </p>
            <dl v-if="metaCols.length" class="dl-card__meta">
                <div v-for="col in metaCols" :key="col.key" class="dl-card__meta-row">
                    <dt>{{ col.label }}</dt>
                    <dd :class="{'dl-mono': col.mono}">
                        <slot
                            :name="`cell-${col.key}`"
                            :row="row"
                            :value="resolveValue(row, col)"
                        >{{ resolveValue(row, col) }}</slot>
                    </dd>
                </div>
            </dl>
            <footer v-if="actionCol" class="dl-card__actions" @click.stop>
                <slot :name="`cell-${actionCol.key}`" :row="row" :value="undefined" />
            </footer>
        </article>
    </div>
</template>

<script setup lang="ts" generic="T extends object">
import {computed} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import {small} from '@/helpers/ui';

export type ColumnRole =
    | 'primary'
    | 'secondary'
    | 'meta'
    | 'status'
    | 'action';

export interface DataColumn<R = object> {
    key: string;
    label: string;
    role?: ColumnRole;
    align?: 'left' | 'center' | 'right';
    mono?: boolean;
    sortable?: boolean;
    width?: string;
    accessor?: (row: R) => unknown;
}

const props = withDefaults(
    defineProps<{
        rows: readonly T[];
        columns: readonly DataColumn<T>[];
        rowKey: keyof T | ((row: T) => string | number);
        loading?: boolean;
        emptyMessage?: string;
        errorMessage?: string | null;
        sortKey?: string | null;
        sortAsc?: boolean;
        skeletonCount?: number;
        clickable?: boolean;
        /** Visual density. `comfortable` (default) matches the existing
         *  table rhythm; `compact` halves vertical row padding. Persisted
         *  by the caller via v-model:density. */
        density?: 'comfortable' | 'compact';
    }>(),
    {
        loading: false,
        emptyMessage: 'No items',
        errorMessage: null,
        sortKey: null,
        sortAsc: true,
        skeletonCount: 4,
        clickable: false,
        density: 'comfortable'
    }
);

const emit = defineEmits<{
    sort: [key: string];
    'row-click': [row: T];
}>();

const isSmall = small;

const primaryCol = computed(() =>
    props.columns.find((c) => c.role === 'primary')
);
const secondaryCol = computed(() =>
    props.columns.find((c) => c.role === 'secondary')
);
const statusCol = computed(() =>
    props.columns.find((c) => c.role === 'status')
);
const actionCol = computed(() =>
    props.columns.find((c) => c.role === 'action')
);
const metaCols = computed(() =>
    props.columns.filter((c) => !c.role || c.role === 'meta')
);

function resolveKey(row: T): string | number {
    if (typeof props.rowKey === 'function') return props.rowKey(row);
    const v = (row as Record<string, unknown>)[props.rowKey as string];
    return typeof v === 'string' || typeof v === 'number'
        ? v
        : JSON.stringify(v);
}

function resolveValue(row: T, col: DataColumn<T>): unknown {
    if (col.accessor) return col.accessor(row);
    const segments = col.key.split('.');
    let cur: unknown = row;
    for (const seg of segments) {
        if (cur && typeof cur === 'object' && seg in (cur as object)) {
            cur = (cur as Record<string, unknown>)[seg];
        } else {
            return undefined;
        }
    }
    return cur;
}

function thClass(col: DataColumn<T>): string[] {
    const out = ['dl-th'];
    if (col.align) out.push(`dl-th--${col.align}`);
    return out;
}
function tdClass(col: DataColumn<T>): string[] {
    const out = ['dl-td'];
    if (col.align) out.push(`dl-td--${col.align}`);
    if (col.mono) out.push('dl-mono');
    return out;
}
</script>

<style scoped>
/* ── Desktop table ── */
.dl-desktop {
    width: 100%;
    overflow-x: auto;
}
.dl-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
}
.dl-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
}
.dl-th {
    padding: var(--gap-sm) var(--gap-md);
    text-align: left;
    font-weight: var(--font-bold);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border-medium);
    background: var(--color-surface-2);
    white-space: nowrap;
}
.dl-th--center { text-align: center; }
.dl-th--right { text-align: right; }

.dl-td {
    padding: var(--gap-sm) var(--gap-md);
    border-bottom: 1px solid
        color-mix(in srgb, var(--color-border-medium) 50%, transparent);
    color: var(--color-text-secondary);
    vertical-align: middle;
}
.dl-td--center { text-align: center; }
.dl-td--right { text-align: right; }
.dl-mono { font-family: var(--font-mono); }

.dl-row { transition: background var(--duration-fast); }
.dl-row--clickable { cursor: pointer; }
.dl-row--clickable:hover {
    background: color-mix(in srgb, var(--color-text-tertiary) 4%, transparent);
}

/* Compact density: halve vertical row + header padding for power users. */
.dl-desktop--compact .dl-th,
.dl-desktop--compact .dl-td {
    padding-top: var(--gap-xs);
    padding-bottom: var(--gap-xs);
}

.dl-sort {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
}
.dl-sort:hover { color: var(--color-text-primary); }
.dl-sort--active { color: var(--color-text-primary); }
.dl-sort-icon { font-size: 0.75em; }

/* ── State rows / cells ── */
.dl-state {
    padding: var(--gap-lg);
    text-align: center;
    color: var(--color-text-tertiary);
}
.dl-state--error { color: var(--color-danger-text); }

/* ── Mobile cards ── */
.dl-mobile {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.dl-card {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--gap-sm) var(--gap-md);
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.dl-card--clickable { cursor: pointer; }
.dl-card--clickable:hover { background: var(--color-surface-2); }
.dl-card--clickable:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
}
.dl-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}
.dl-card__title {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    margin: 0;
}
.dl-card__status { flex-shrink: 0; }
.dl-card__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin: 0;
}
.dl-card__meta {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    margin: 0;
    padding-top: var(--gap-xs);
    border-top: 1px solid
        color-mix(in srgb, var(--color-border-default) 50%, transparent);
}
.dl-card__meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--gap-sm);
}
.dl-card__meta-row dt {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    font-weight: var(--font-semibold);
    margin: 0;
}
.dl-card__meta-row dd {
    text-align: right;
    color: var(--color-text-secondary);
    margin: 0;
}
.dl-card__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-xs);
    padding-top: var(--gap-xs);
    border-top: 1px solid
        color-mix(in srgb, var(--color-border-default) 50%, transparent);
}
</style>

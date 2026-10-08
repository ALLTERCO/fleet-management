<template>
    <div class="et-object">
        <div v-if="rows.length === 0" class="et-object__empty">No data</div>
        <div v-else class="et-object__tree">
            <div
                v-for="(r, i) in rows"
                :key="i"
                class="et-object__row"
                :style="{paddingLeft: `${r.depth * 14 + 12}px`}"
            >
                <span v-if="r.key !== ''" class="et-object__key">{{ r.key }}</span>
                <span v-if="r.branch" class="et-object__count">{{
                    branchLabel(r)
                }}</span>
                <span v-else class="et-object__val" :class="`is-${r.type}`">{{
                    r.display
                }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

// Read-only viewer for the Shelly "Object" virtual component: a structured
// JSON container (e.g. XT1, EV-charger phase_info). Object components carry no
// setter, so this shows the value as-is rather than offering an editor.
const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
}>();

type ValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
interface Row {
    key: string;
    depth: number;
    type: ValueType;
    branch: boolean;
    display: string;
    count: number;
}

const MAX_DEPTH = 8;

function branchLabel(row: Row): string {
    return row.type === 'array' ? `[${row.count}]` : `{${row.count}}`;
}

function classify(v: unknown): ValueType {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'object') return 'object';
    return typeof v as ValueType;
}

function display(v: unknown, type: ValueType): string {
    if (type === 'null') return 'null';
    if (type === 'string') return v as string;
    return String(v);
}

function walk(node: any, depth: number, out: Row[]): void {
    if (depth > MAX_DEPTH) return;
    const entries: [string, unknown][] = Array.isArray(node)
        ? node.map((v, i) => [String(i), v] as [string, unknown])
        : Object.entries(node);
    for (const [key, v] of entries) {
        const type = classify(v);
        if ((type === 'object' || type === 'array') && v) {
            const count = Array.isArray(v) ? v.length : Object.keys(v).length;
            out.push({key, depth, type, branch: true, display: '', count});
            walk(v, depth + 1, out);
        } else {
            out.push({
                key,
                depth,
                type,
                branch: false,
                display: display(v, type),
                count: 0
            });
        }
    }
}

const rows = computed<Row[]>(() => {
    const value = props.status?.value;
    if (value === undefined) return [];
    const type = classify(value);
    if (type === 'object' || type === 'array') {
        const out: Row[] = [];
        walk(value, 0, out);
        return out;
    }
    // A non-container value (rare) still shows as-is.
    return [{key: '', depth: 0, type, branch: false, display: display(value, type), count: 0}];
});
</script>

<style scoped>
.et-object {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2) 0;
    max-height: 260px;
    overflow: auto;
}
.et-object__empty {
    padding: var(--space-3);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.et-object__row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 3px var(--space-3) 3px 0;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: 1.5;
}
.et-object__key {
    color: var(--syntax-key);
    white-space: nowrap;
}
.et-object__key::after {
    content: ':';
    color: var(--color-text-tertiary);
    margin-left: 1px;
}
.et-object__count {
    color: var(--color-text-tertiary);
}
.et-object__val {
    color: var(--color-text-primary);
    word-break: break-word;
    font-variant-numeric: tabular-nums;
}
.et-object__val.is-string {
    color: var(--syntax-string);
}
.et-object__val.is-number {
    color: var(--syntax-number);
}
.et-object__val.is-boolean {
    color: var(--syntax-bool);
}
.et-object__val.is-null {
    color: var(--syntax-null);
    font-style: italic;
}
</style>

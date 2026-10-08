<template>
    <ul
        :id="ids.list"
        class="gs-results"
        role="listbox"
        aria-label="Search results"
    >
        <template v-for="row in drawn" :key="row.key">
            <li
                v-if="row.startsSection"
                class="gs-heading"
                role="presentation"
            >
                {{ row.heading }}
            </li>
            <li
                :id="row.index === activeIndex ? ids.activeRow : undefined"
                class="gs-row"
                :class="{'gs-row--active': row.index === activeIndex}"
                role="option"
                :aria-selected="row.index === activeIndex"
                @click="emit('choose', row.index)"
                @mousemove="emit('highlight', row.index)"
            >
                <span class="gs-row__label">
                    <component
                        :is="part.matched ? 'mark' : 'span'"
                        v-for="(part, at) in row.parts"
                        :key="at"
                    >{{ part.text }}</component>
                </span>
            </li>
        </template>
        <li v-if="!rows.length" class="gs-empty" role="presentation">
            {{ emptyMessage }}
        </li>
    </ul>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {SearchRange} from '@/helpers/searchMatch';

/**
 * How the palette's rows look. The palette itself owns what the rows are and
 * which one is highlighted, so this file only ever draws what it is handed.
 */

/** One row to draw. `index` runs across the headings, not within one. */
interface ResultRow {
    key: string;
    index: number;
    heading: string;
    /** True on the first row under its heading, which renders the heading. */
    startsSection: boolean;
    label: string;
    /** Where the query matched the label, so those letters can be bold. */
    ranges: readonly SearchRange[];
}

/** A run of the label, bold when the query matched it. */
interface LabelPart {
    text: string;
    matched: boolean;
}

const props = defineProps<{
    rows: readonly ResultRow[];
    activeIndex: number;
    /** Shown instead of rows, so an empty panel never happens. */
    emptyMessage: string;
    /** The palette names these, because its input has to point at them. */
    ids: {list: string; activeRow: string};
}>();

const emit = defineEmits<{
    choose: [index: number];
    highlight: [index: number];
}>();

/** The label cut into plain and matched runs, so a right row looks right. */
function labelParts(
    label: string,
    ranges: readonly SearchRange[]
): LabelPart[] {
    const parts: LabelPart[] = [];
    let at = 0;
    for (const range of ranges) {
        if (range.from > at) {
            parts.push({text: label.slice(at, range.from), matched: false});
        }
        parts.push({text: label.slice(range.from, range.to), matched: true});
        at = range.to;
    }
    if (at < label.length) parts.push({text: label.slice(at), matched: false});
    return parts;
}

const drawn = computed(() =>
    props.rows.map((row) => ({
        ...row,
        parts: labelParts(row.label, row.ranges)
    }))
);
</script>

<style scoped>
.gs-results {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

/* Same group-label language as the settings sidebar. */
.gs-heading {
    padding: var(--space-3) var(--space-2) var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
}

.gs-row {
    display: flex;
    min-height: var(--touch-target-min);
    align-items: center;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
}

.gs-row--active {
    background: var(--state-hover-bg-strong);
}

.gs-row__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* The letters that matched, so a right row does not look like a mistake. */
.gs-row mark {
    background: none;
    color: var(--color-primary);
    font-weight: var(--font-semibold);
}

.gs-empty {
    padding: var(--space-6) var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
</style>

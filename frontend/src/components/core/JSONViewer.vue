<template>
    <div class="json-viewer">
        <slot></slot>
        <div class="json-viewer__toolbar">
            <input
                v-model="filter"
                type="text"
                class="json-viewer__search"
                placeholder="Search keys..."
                aria-label="Search keys"
            />
            <CopyButton :text="jsonText" title="Copy JSON" />
        </div>
        <div
            class="json-viewer__output"
            :class="{'json-viewer__output--expand': expand}"
            v-html="highlightedJson"
        ></div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';
import CopyButton from './CopyButton.vue';

// expand: render at full content height (no inner scroll) so the parent is the
// single scroll container.
const props = defineProps<{data: object; expand?: boolean}>();
const source = toRef(props, 'data');

const filter = ref('');

const filteredData = computed(() => {
    if (!filter.value || filter.value.length === 0) {
        return source.value;
    }
    const needle = filter.value.toLocaleLowerCase().trim();
    const src = source.value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key in src) {
        if (key.toLocaleLowerCase().includes(needle)) result[key] = src[key];
    }
    return result;
});

const jsonText = computed(() => JSON.stringify(filteredData.value, undefined, 2));

const highlightedJson = computed(() =>
    jsonText.value ? colorize(jsonText.value) : ''
);

function colorize(json: string): string {
    // Escape HTML entities first
    const escaped = json
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Tokenize and colorize
    return escaped
        .replace(
            /("(?:\\.|[^"\\])*")\s*:/g, // keys
            '<span class="jv-key">$1</span>:'
        )
        .replace(
            /:\s*("(?:\\.|[^"\\])*")/g, // string values
            ': <span class="jv-string">$1</span>'
        )
        .replace(
            /:\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, // number values
            ': <span class="jv-number">$1</span>'
        )
        .replace(
            /:\s*(true|false)\b/g, // boolean values
            ': <span class="jv-bool">$1</span>'
        )
        .replace(
            /:\s*(null)\b/g, // null values
            ': <span class="jv-null">$1</span>'
        );
}

</script>

<style scoped>
.json-viewer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
    min-height: 0;
}

.json-viewer__toolbar {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.json-viewer__search {
    flex: 1;
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) 0.625rem;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    min-height: var(--touch-target-min);
}
.json-viewer__search:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
}
.json-viewer__search::placeholder {
    color: var(--color-text-disabled);
}

.json-viewer__output {
    flex: 1;
    min-height: 0;
    overflow: auto;
    white-space: pre;
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    line-height: 1.6;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    tab-size: 2;
}

.json-viewer__output--expand {
    flex: initial;
    min-height: 0;
    max-height: none;
    overflow: visible;
}
</style>

<!-- Unscoped: syntax highlight classes injected via v-html -->
<style>
.jv-key    { color: var(--syntax-key); }
.jv-string { color: var(--syntax-string); }
.jv-number { color: var(--syntax-number); }
.jv-bool   { color: var(--syntax-bool); }
.jv-null   { color: var(--syntax-null); font-style: italic; }
</style>

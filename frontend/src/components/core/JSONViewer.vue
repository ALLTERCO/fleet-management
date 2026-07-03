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
            <button
                class="json-viewer__copy"
                :title="copied ? 'Copied!' : 'Copy JSON'"
                aria-label="Copy JSON"
                @click="copyJson"
            >
                <i :class="copied ? 'fas fa-check' : 'fas fa-copy'" />
            </button>
        </div>
        <div class="json-viewer__output" v-html="highlightedJson"></div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';

const props = defineProps<{data: object}>();
const data = toRef(props, 'data');

const filter = ref('');
const copied = ref(false);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

const filteredData = computed(() => {
    if (!filter.value || filter.value.length === 0) {
        return data.value;
    }
    const needle = filter.value.toLocaleLowerCase().trim();
    const src = data.value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key in src) {
        if (key.toLocaleLowerCase().includes(needle)) result[key] = src[key];
    }
    return result;
});

const highlightedJson = computed(() => {
    const json = JSON.stringify(filteredData.value, undefined, 2);
    if (!json) return '';
    return colorize(json);
});

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

async function copyJson() {
    try {
        const text = JSON.stringify(filteredData.value, undefined, 2);
        await navigator.clipboard.writeText(text);
        copied.value = true;
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
            copied.value = false;
        }, 2000);
    } catch {
        // Fallback for insecure contexts
        const text = JSON.stringify(filteredData.value, undefined, 2);
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copied.value = true;
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
            copied.value = false;
        }, 2000);
    }
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

.json-viewer__copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: all 150ms ease;
    flex-shrink: 0;
}
.json-viewer__copy:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
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
</style>

<!-- Unscoped: syntax highlight classes injected via v-html -->
<style>
.jv-key    { color: var(--syntax-key); }
.jv-string { color: var(--syntax-string); }
.jv-number { color: var(--syntax-number); }
.jv-bool   { color: var(--syntax-bool); }
.jv-null   { color: var(--syntax-null); font-style: italic; }
</style>

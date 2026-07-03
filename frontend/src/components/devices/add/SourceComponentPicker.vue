<template>
    <div class="scp">
        <div
            v-if="selected"
            class="scp__chosen"
            :data-source="`${selected.deviceExternalId}|${selected.componentKey}`"
        >
            <div class="scp__chosen-meta">
                <span class="scp__chosen-device">
                    {{ selected.deviceExternalId }}
                </span>
                <span class="scp__chosen-component">
                    {{ selected.componentKey }}
                </span>
            </div>
            <button
                type="button"
                class="scp__clear"
                aria-label="Clear binding"
                @click="onClear"
            >
                <i class="fas fa-xmark" />
            </button>
        </div>

        <Input
            v-else
            v-model="query"
            type="search"
            placeholder="Search devices or components…"
            @update:model-value="onInput"
            @focus="ensureLoaded"
        />

        <div v-if="loading" class="scp__state">
            <Spinner size="sm" /> Loading candidates…
        </div>
        <div v-else-if="error" class="scp__state scp__state--error">
            {{ error }}
        </div>
        <ul v-else-if="!selected && candidates.length" class="scp__list">
            <li
                v-for="candidate in candidates"
                :key="`${candidate.deviceExternalId}|${candidate.componentKey}`"
            >
                <button
                    type="button"
                    class="scp__candidate"
                    :data-candidate="`${candidate.deviceExternalId}|${candidate.componentKey}`"
                    @click="onPick(candidate)"
                >
                    <span class="scp__candidate-device">
                        {{ candidate.deviceName }}
                    </span>
                    <span class="scp__candidate-component">
                        {{ candidate.componentKey }} ·
                        {{ candidate.componentType }}
                    </span>
                    <span
                        v-if="candidate.writable"
                        class="scp__candidate-pill"
                    >
                        Writable
                    </span>
                </button>
            </li>
        </ul>
        <div
            v-else-if="!selected && !candidates.length && query"
            class="scp__state scp__state--empty"
        >
            No matches.
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import {
    type SourceComponentCandidate,
    type SourceComponentRef,
    virtualDevices
} from '@host/virtualDevices';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';

const props = defineProps<{
    roleKey: string;
    selected: SourceComponentRef | null;
    candidateFilter?: (candidate: SourceComponentCandidate) => boolean;
}>();

const emit = defineEmits<{
    select: [SourceComponentRef];
    clear: [];
}>();

const query = ref('');
const candidates = ref<SourceComponentCandidate[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function load(q?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const res = await virtualDevices.bindings.listSources({
            roleKey: props.roleKey,
            query: q?.trim() || undefined,
            limit: 50
        });
        const filtered = props.candidateFilter
            ? res.items.filter(props.candidateFilter)
            : res.items;
        candidates.value = filtered.length > 0 ? filtered : res.items;
        loaded = true;
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        candidates.value = [];
    } finally {
        loading.value = false;
    }
}

function ensureLoaded(): void {
    if (!loaded && !loading.value) load();
}

function onInput(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => load(query.value), 250);
}

function onPick(candidate: SourceComponentCandidate): void {
    const source: SourceComponentRef = {
        deviceExternalId: candidate.deviceExternalId,
        componentKey: candidate.componentKey
    };
    if (candidate.dynamicCategory) {
        source.dynamicCategory = candidate.dynamicCategory;
    }
    emit('select', source);
}

function onClear(): void {
    query.value = '';
    emit('clear');
}

watch(
    () => props.selected,
    (val) => {
        if (val === null) {
            loaded = false;
            candidates.value = [];
        }
    }
);
</script>

<style scoped>
.scp {
    display: grid;
    gap: var(--gap-xs);
}
.scp__chosen {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 50%, transparent);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}
.scp__chosen-meta {
    flex: 1;
    display: grid;
    gap: 2px;
}
.scp__chosen-device {
    font-weight: var(--font-medium);
}
.scp__chosen-component {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.scp__clear {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: transparent;
    border: 0;
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.scp__clear:hover {
    color: var(--color-danger-text);
}
.scp__state {
    padding: var(--gap-sm);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.scp__state--error {
    color: var(--color-warning-text);
}
.scp__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
}
.scp__candidate {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'name pill' 'comp pill';
    gap: 2px var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.scp__candidate:hover {
    border-color: var(--color-border-focus);
    background: var(--color-surface-3);
}
.scp__candidate-device {
    grid-area: name;
    font-weight: var(--font-medium);
}
.scp__candidate-component {
    grid-area: comp;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.scp__candidate-pill {
    grid-area: pill;
    align-self: center;
    font-size: var(--type-caption);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-info) 16%, transparent);
    color: var(--color-info-text);
}
</style>

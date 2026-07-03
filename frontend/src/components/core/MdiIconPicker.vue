<template>
    <div class="mip">
        <FormField label="Search icons">
            <Input
                v-model="query"
                placeholder="e.g. lightbulb, freezer, gauge…"
                autocomplete="off"
            />
        </FormField>
        <div v-if="loadError" class="mip__state mip__state--error">
            {{ loadError }}
        </div>
        <div v-else-if="loading" class="mip__state">
            <Spinner size="sm" /> <span>Loading icon catalog…</span>
        </div>
        <div v-else-if="visible.length === 0" class="mip__state">
            No icons match "{{ debouncedQuery }}".
        </div>
        <span v-else-if="!hasQuery" class="mip__hint">Popular icons</span>
        <ul v-if="visible.length" class="mip__grid" :data-result-count="visible.length">
            <li
                v-for="icon in visible"
                :key="icon.name"
                class="mip__tile"
                :class="{'mip__tile--active': icon.name === selectedName}"
            >
                <button
                    type="button"
                    class="mip__tile-button"
                    :title="icon.name"
                    @click="emit('pick', `mdi mdi-${icon.name}`)"
                >
                    <i :class="['mdi', `mdi-${icon.name}`]" aria-hidden="true" />
                    <span class="mip__tile-label">{{ icon.name }}</span>
                </button>
            </li>
        </ul>
        <div
            v-if="!loading && hasQuery && visible.length === limit"
            class="mip__more"
        >
            Showing first {{ limit }} of {{ totalMatches }}. Refine to see more.
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {loadMdiCatalog, type MdiIcon, searchMdi} from '@/api/mdiCatalog';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';

const props = defineProps<{selected?: string | null}>();
const emit = defineEmits<{pick: [iconClass: string]}>();

const POPULAR = [
    'home', 'home-city', 'office-building', 'factory', 'lightbulb',
    'lightbulb-on', 'power-plug', 'power', 'flash', 'gauge', 'thermometer',
    'fan', 'snowflake', 'air-conditioner', 'radiator', 'heat-pump', 'fire',
    'water', 'water-pump', 'pump', 'valve', 'solar-power', 'battery',
    'battery-charging', 'ev-station', 'car', 'leaf', 'transmission-tower',
    'meter-electric', 'lock', 'door', 'window-closed', 'garage', 'bell',
    'motion-sensor', 'cctv', 'weather-sunny', 'weather-night', 'wifi',
    'bluetooth', 'lan', 'server', 'chip', 'cog', 'monitor', 'television',
    'speaker', 'washing-machine', 'fridge', 'stove', 'map-marker', 'alert',
    'check-circle', 'star', 'tag', 'folder'
];

// Catalog stores bare names; tolerate "mdi mdi-x", "mdi-x", or bare "x".
const selectedName = computed(
    () => props.selected?.replace(/^(?:mdi\s+)?mdi-/, '') ?? null
);

const catalog = ref<MdiIcon[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const query = ref('');
// Debounced view of `query` — keeps the O(catalog) filter off the keystroke
// path. ~7.5k entries × name + alias + tag scan per keystroke is real jank.
const debouncedQuery = ref('');
let queryTimer: ReturnType<typeof setTimeout> | undefined;
const limit = 200;

watch(query, (q) => {
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
        debouncedQuery.value = q;
    }, 150);
});
onUnmounted(() => {
    if (queryTimer) clearTimeout(queryTimer);
});

const hasQuery = computed(() => debouncedQuery.value.trim().length > 0);

const popular = computed(() => {
    if (catalog.value.length === 0) return [];
    const byName = new Map(catalog.value.map((i) => [i.name, i]));
    return POPULAR.map((n) => byName.get(n)).filter(
        (i): i is MdiIcon => i !== undefined
    );
});

const matches = computed(() =>
    hasQuery.value
        ? searchMdi(catalog.value, debouncedQuery.value, 10_000)
        : popular.value
);
const visible = computed(() => matches.value.slice(0, limit));
const totalMatches = computed(() => matches.value.length);

onMounted(async () => {
    loading.value = true;
    try {
        catalog.value = await loadMdiCatalog();
    } catch (err) {
        loadError.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
});
</script>

<style scoped>
.mip {
    display: grid;
    gap: var(--gap-md);
}
.mip__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.mip__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    min-height: 180px;
}
.mip__state--error {
    color: var(--color-warning-text);
    background: var(--color-warning-subtle);
    border-style: solid;
}
.mip__grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--gap-xs);
    max-height: 420px;
    overflow-y: auto;
}
.mip__tile {
    display: contents;
}
.mip__tile-button {
    display: grid;
    place-items: center;
    gap: 4px;
    aspect-ratio: 1 / 1;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    cursor: pointer;
    padding: 8px;
    transition: border-color var(--duration-fast);
}
.mip__tile-button:hover {
    border-color: var(--brand-blue);
}
.mip__tile--active .mip__tile-button {
    border-color: var(--brand-blue);
    box-shadow: var(--shadow-brand-glow);
}
.mip__tile-button .mdi {
    font-size: var(--type-subheading);
}
.mip__tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
    text-align: center;
}
.mip__more {
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>

<template>
    <div class="psf">
        <div class="psf__row">
            <select
                v-if="!hideCountryPicker"
                v-model="internalBias"
                class="psf__country core-input"
                :aria-label="'Country bias'"
            >
                <option :value="null">Any country</option>
                <option v-for="c in countries" :key="c.iso2" :value="c.iso2">
                    {{ c.name }}
                </option>
            </select>
            <input
                ref="inputRef"
                type="text"
                class="psf__input core-input"
                :placeholder="placeholder"
                :value="query"
                :aria-controls="listboxId"
                :aria-expanded="open"
                aria-autocomplete="list"
                role="combobox"
                autocomplete="off"
                spellcheck="false"
                @input="handleInput($event)"
                @keydown="handleKey($event)"
                @focus="onFocus"
                @blur="onBlur"
            />
        </div>
        <ul
            v-if="open && candidates.length > 0"
            :id="listboxId"
            class="psf__menu"
            role="listbox"
        >
            <li
                v-for="(c, i) in candidates"
                :key="candidateKey(c, i)"
                :class="['psf__option', i === focusedIndex && 'psf__option--focused']"
                role="option"
                :aria-selected="i === focusedIndex"
                @mousedown.prevent="pick(c)"
                @mouseover="focusedIndex = i"
            >
                <span class="psf__option-name">{{ c.name }}</span>
                <span class="psf__option-meta">{{ optionMeta(c) }}</span>
                <span :class="['psf__badge', `psf__badge--${badgeFor(c)}`]">
                    {{ badgeLabel(badgeFor(c)) }}
                </span>
            </li>
        </ul>
        <p v-if="open && !loading && candidates.length === 0 && query.length > 0" class="psf__empty">
            Couldn't find that. Try a different name, or drop a pin on the map below.
        </p>
        <p
            v-if="open && !loading && candidates.length === 0 && hasNonLatin(query)"
            class="psf__hint"
        >
            Tip: try the Latin spelling — GeoNames matches romanized names.
        </p>
        <p v-if="loading" class="psf__loading">Searching…</p>
        <p v-if="open" class="psf__attribution">
            Geographic data ©
            <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>
            (CC-BY 4.0)
        </p>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {nextTick, onBeforeUnmount, onMounted, ref, useId, watch} from 'vue';
import {hasNonLatin} from '@/helpers/asciiText';
import {
    type PlaceCandidate,
    type PlaceSource,
    searchPlaces
} from '@/helpers/placeSearch';
import {usePlacesStore} from '@/stores/places';

const DEBOUNCE_MS = 250;

interface Props {
    biasCountryCode?: string | null;
    limit?: number;
    placeholder?: string;
    hideCountryPicker?: boolean;
    precision?: 'place' | 'street';
}

const props = withDefaults(defineProps<Props>(), {
    biasCountryCode: null,
    limit: 5,
    placeholder: 'Search place…',
    hideCountryPicker: false,
    precision: 'place'
});

const placesStore = usePlacesStore();
const {countries} = storeToRefs(placesStore);
const internalBias = ref<string | null>(props.biasCountryCode);

watch(
    () => props.biasCountryCode,
    (v) => {
        internalBias.value = v;
    }
);

onMounted(() => {
    if (!props.hideCountryPicker) void placesStore.ensureCountries();
});

const emit = defineEmits<{
    pick: [candidate: PlaceCandidate];
    open: [];
    close: [];
}>();

const listboxId = useId();
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const candidates = ref<PlaceCandidate[]>([]);
const source = ref<PlaceSource | null>(null);
const loading = ref(false);
const open = ref(false);
const focusedIndex = ref(-1);

let pendingDebounce: ReturnType<typeof setTimeout> | undefined;
let activeRequest = 0;

onBeforeUnmount(() => {
    clearDebounce();
});

function clearDebounce(): void {
    if (pendingDebounce !== undefined) {
        clearTimeout(pendingDebounce);
        pendingDebounce = undefined;
    }
}

function handleInput(event: Event): void {
    query.value = (event.target as HTMLInputElement).value;
    focusedIndex.value = -1;
    scheduleSearch();
}

function scheduleSearch(): void {
    clearDebounce();
    const text = query.value.trim();
    if (text.length === 0) {
        candidates.value = [];
        loading.value = false;
        return;
    }
    pendingDebounce = setTimeout(() => runSearch(text), DEBOUNCE_MS);
}

async function runSearch(text: string): Promise<void> {
    loading.value = true;
    const requestId = ++activeRequest;
    try {
        const result = await searchPlaces({
            query: text,
            biasCountryCode: internalBias.value,
            limit: props.limit,
            precision: props.precision
        });
        // Stale response — newer keystroke already in flight.
        if (requestId !== activeRequest) return;
        candidates.value = result.candidates;
        source.value = result.source;
    } catch {
        if (requestId !== activeRequest) return;
        candidates.value = [];
        source.value = null;
    } finally {
        if (requestId === activeRequest) loading.value = false;
    }
}

function handleKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusedIndex.value = Math.min(
            focusedIndex.value + 1,
            candidates.value.length - 1
        );
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusedIndex.value = Math.max(focusedIndex.value - 1, 0);
        return;
    }
    if (event.key === 'Enter') {
        const c = candidates.value[focusedIndex.value];
        if (c) {
            event.preventDefault();
            pick(c);
        }
        return;
    }
    if (event.key === 'Escape') closeMenu();
}

function pick(c: PlaceCandidate): void {
    query.value = c.name;
    emit('pick', c);
    void nextTick(closeMenu);
}

function onFocus(): void {
    open.value = true;
    emit('open');
}

function onBlur(): void {
    // Delay so dropdown clicks fire pick() before blur closes the menu.
    setTimeout(closeMenu, 100);
}

function closeMenu(): void {
    if (open.value) {
        open.value = false;
        emit('close');
    }
}

function candidateKey(c: PlaceCandidate, index: number): string {
    return c.geonameid !== undefined
        ? `g-${c.geonameid}`
        : `${c.kind}-${c.countryCode}-${index}`;
}

function optionMeta(c: PlaceCandidate): string {
    const parts: string[] = [];
    if (c.adminName) parts.push(c.adminName);
    if (c.countryName) parts.push(c.countryName);
    return parts.join(' · ');
}

type Badge = 'verified' | 'verified-online' | 'best-guess';

function badgeFor(c: PlaceCandidate): Badge {
    if (source.value === 'nominatim') return 'verified-online';
    if (source.value === 'local-weak') return 'best-guess';
    if (c.score < 0.5) return 'best-guess';
    return 'verified';
}

function badgeLabel(b: Badge): string {
    if (b === 'verified') return 'Verified';
    if (b === 'verified-online') return 'Verified · online';
    return 'Best guess';
}
</script>

<style scoped>
.psf {
    position: relative;
    width: 100%;
}
.psf__row {
    display: flex;
    gap: var(--space-1);
}
.psf__country {
    flex: 0 0 12rem;
    max-width: 40%;
}
.psf__input {
    flex: 1 1 auto;
    min-width: 0;
}
.psf__menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 18rem;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
}
.psf__option {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--color-text-primary);
    transition: background var(--duration-fast);
}
.psf__option:hover,
.psf__option--focused {
    background: var(--color-surface-3);
}
.psf__option-name {
    font-weight: var(--font-semibold);
}
.psf__option-meta {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.psf__badge {
    font-size: var(--type-caption);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    white-space: nowrap;
}
.psf__badge--verified {
    background: color-mix(in srgb, var(--color-success) 25%, transparent);
    color: var(--color-success);
}
.psf__badge--verified-online {
    background: color-mix(in srgb, var(--color-success) 25%, transparent);
    color: var(--color-success);
}
.psf__badge--best-guess {
    background: color-mix(in srgb, var(--color-warning) 25%, transparent);
    color: var(--color-warning);
}
.psf__empty,
.psf__loading,
.psf__hint {
    margin: var(--space-1) 0 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.psf__hint {
    color: var(--color-warning, var(--color-text-secondary));
}
.psf__attribution {
    margin: var(--space-1) 0 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    opacity: 0.7;
}
.psf__attribution a {
    color: inherit;
    text-decoration: underline;
}
</style>

<template>
    <div ref="rootRef" class="did">
        <div
            v-if="picked && !isOpen"
            class="did__box did__box--picked"
            role="button"
            tabindex="0"
            :aria-label="`Change device — currently ${picked.name}`"
            @click="startEdit"
            @keydown.enter.prevent="startEdit"
        >
            <span
                class="did__dot"
                :class="picked.online ? 'did__dot--online' : 'did__dot--offline'"
            />
            <span class="did__name did__name--picked">{{ picked.name }}</span>
            <span v-if="picked.name !== picked.shellyId" class="did__id">
                {{ picked.shellyId }}
            </span>
            <button
                type="button"
                class="did__clear"
                aria-label="Clear device"
                @click.stop="clearPick"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
        <div v-else class="did__box" :class="{'did__box--open': isOpen}">
            <i class="fas fa-microchip did__icon" aria-hidden="true" />
            <input
                ref="inputRef"
                v-model="model"
                type="text"
                class="did__input"
                :placeholder="placeholder"
                :aria-expanded="isOpen"
                aria-haspopup="listbox"
                autocomplete="off"
                spellcheck="false"
                @focus="isOpen = true"
                @keydown.down.prevent="moveHighlight(1)"
                @keydown.up.prevent="moveHighlight(-1)"
                @keydown.enter.prevent="pickHighlighted"
                @keydown.escape="isOpen = false"
            />
        </div>

        <ul v-if="isOpen && matches.length" class="did__list" role="listbox">
            <li
                v-for="(device, index) in matches"
                :key="device.shellyId"
                class="did__option"
                :class="{'did__option--active': index === highlight}"
                role="option"
                :aria-selected="index === highlight"
                @mousedown.prevent="pick(device.shellyId)"
                @mouseenter="highlight = index"
            >
                <span
                    class="did__dot"
                    :class="
                        device.online ? 'did__dot--online' : 'did__dot--offline'
                    "
                />
                <span class="did__name">{{ device.name }}</span>
                <span
                    v-if="device.name !== device.shellyId"
                    class="did__id"
                >{{ device.shellyId }}</span>
            </li>
        </ul>

        <p v-else-if="isOpen && trimmed" class="did__free">
            No match. "{{ trimmed }}" will be used as the device ID.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {deviceMatchesQuery, getDeviceName} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';

const props = withDefaults(
    defineProps<{placeholder?: string; limit?: number}>(),
    {placeholder: 'Search a device, or type its ID', limit: 8}
);

// The model IS the Shelly ID: picking a device sets it, free text keeps it.
const model = defineModel<string>({default: ''});
const devicesStore = useDevicesStore();

const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const isOpen = ref(false);
const highlight = ref(0);

interface DeviceChoice {
    shellyId: string;
    name: string;
    online: boolean;
}

// Reuses the store + the shared name helper — no duplicate device-shape logic.
const knownDevices = computed<DeviceChoice[]>(() =>
    Object.values(devicesStore.devices)
        .map((dev) => ({
            shellyId: dev.shellyID,
            name: getDeviceName(dev.info, dev.shellyID) ?? dev.shellyID,
            online: dev.online === true
        }))
        .filter((device) => device.shellyId)
);

const trimmed = computed(() => (model.value ?? '').trim());

const matches = computed<DeviceChoice[]>(() =>
    knownDevices.value
        .filter((device) =>
            deviceMatchesQuery(
                {name: device.name, id: device.shellyId},
                trimmed.value
            )
        )
        .slice(0, props.limit)
);

// Keep the highlight in range when the list narrows.
watch(matches, () => {
    highlight.value = 0;
});

// Exact ID match drives the name-first picked display.
const picked = computed<DeviceChoice | null>(
    () =>
        knownDevices.value.find(
            (device) => device.shellyId === trimmed.value
        ) ?? null
);

function pick(shellyId: string): void {
    model.value = shellyId;
    isOpen.value = false;
}

function startEdit(): void {
    isOpen.value = true;
    void nextTick(() => inputRef.value?.focus());
}

function clearPick(): void {
    model.value = '';
    startEdit();
}

function pickHighlighted(): void {
    // Closed dropdown: keep the typed free-text ID.
    if (!isOpen.value) return;
    const device = matches.value[highlight.value];
    if (device) pick(device.shellyId);
    else isOpen.value = false;
}

function moveHighlight(delta: number): void {
    isOpen.value = true;
    const count = matches.value.length;
    if (!count) return;
    highlight.value = (highlight.value + delta + count) % count;
}

function closeOnOutside(event: PointerEvent): void {
    if (!rootRef.value?.contains(event.target as Node)) isOpen.value = false;
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutside));
onBeforeUnmount(() =>
    document.removeEventListener('pointerdown', closeOnOutside)
);
</script>

<style scoped>
.did {
    position: relative;
}
.did__box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    min-height: var(--touch-target-min);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
}
.did__box--open {
    border-color: var(--color-border-focus);
}
.did__icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.did__input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-text-primary);
    font: inherit;
}
.did__list {
    position: absolute;
    z-index: var(--z-overlay);
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    max-height: var(--dropdown-max-height);
    overflow-y: auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
}
.did__option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.did__option--active {
    background: rgba(var(--color-frost-rgb), 0.08);
}
.did__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    flex-shrink: 0;
}
.did__dot--online {
    background: var(--color-status-on);
}
.did__dot--offline {
    background: var(--color-text-disabled);
}
.did__name {
    color: var(--color-text-primary);
}
.did__box--picked {
    cursor: pointer;
    gap: var(--space-2);
}
.did__name--picked {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.did__clear {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.did__clear:hover {
    color: var(--color-text-primary);
}
.did__id {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.did__free {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
</style>

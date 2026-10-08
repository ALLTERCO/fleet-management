<template>
    <div class="fpi-sec">
        <p v-if="candidates.length === 0" class="fpi__hint">
            This drawing has no device markers. Add them as layers under a
            <code class="fpi__code">Devices</code> layer in your SVG editor.
        </p>

        <template v-else>
            <p class="fpi__hint">
                {{ candidates.length }} marker{{ candidates.length === 1 ? '' : 's' }}
                in the drawing. A marker name is not a device name — pick the
                device each one stands for. Anything left unpicked is skipped.
            </p>

            <ul class="fpi__list">
                <li v-for="c in candidates" :key="c.key" class="fpi__row">
                    <div class="fpi__row-hdr">
                        <span class="fpi__marker" :title="c.label">{{ c.label }}</span>
                        <span class="fpi__cat">{{ c.category }}</span>
                    </div>

                    <select
                        class="fpi__select"
                        :value="selections[c.key] ?? ''"
                        :aria-label="`Device for marker ${c.label}`"
                        @change="onSelect(c.key, ($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">— Not on the plan —</option>
                        <option
                            v-for="d in optionsFor(c)"
                            :key="d.placementId"
                            :value="d.placementId"
                            :disabled="isTakenElsewhere(c.key, d.placementId)"
                        >{{ optionLabel(d) }}</option>
                    </select>

                    <p v-if="noteFor(c)" class="fpi__note" :class="noteClass(c)">
                        {{ noteFor(c) }}
                    </p>
                </li>
            </ul>

            <div class="fpi__actions">
                <Button
                    type="blue"
                    size="sm"
                    :disabled="busy || chosenCount === 0"
                    @click="onConfirm"
                >
                    {{ confirmLabel }}
                </Button>
                <Button
                    v-if="chosenCount > 0"
                    type="blue-hollow"
                    size="sm"
                    :disabled="busy"
                    @click="clearAll"
                >
                    Clear
                </Button>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import type {
    ImportCandidate,
    ImportTargetDevice
} from '@/helpers/svg-device-import';
import {rankDevicesForMarker} from '@/helpers/svg-device-import';
import type {DevicePlacementMap} from '@/types/floor-plan';

const props = defineProps<{
    candidates: readonly ImportCandidate[];
    devices: readonly ImportTargetDevice[];
    /** Placements already saved — used to warn before a pin is moved. */
    existing: DevicePlacementMap;
    busy?: boolean;
}>();

const emit = defineEmits<{
    confirm: [selections: Record<string, string>];
}>();

// candidate key -> placementId. Seeded from the suggestions, then owned by
// the user.
const selections = ref<Record<string, string>>({});

// Re-seed only when a genuinely different drawing arrives. The candidate
// array is recomputed whenever any placement changes — dragging a pin on the
// canvas must not wipe half-finished choices in this panel.
const markerIdentity = computed(() =>
    props.candidates.map((c) => c.key).join(' ')
);

watch(
    markerIdentity,
    () => {
        const seeded: Record<string, string> = {};
        for (const c of props.candidates) {
            if (c.suggestedPlacementId) seeded[c.key] = c.suggestedPlacementId;
        }
        selections.value = seeded;
    },
    {immediate: true}
);

const deviceById = computed(() => {
    const map = new Map<string, ImportTargetDevice>();
    for (const d of props.devices) map.set(d.placementId, d);
    return map;
});

const chosenCount = computed(
    () => Object.values(selections.value).filter(Boolean).length
);

const confirmLabel = computed(() => {
    if (chosenCount.value === 0) return 'Pick a device to continue';
    return `Place ${chosenCount.value} device${chosenCount.value === 1 ? '' : 's'}`;
});

function optionsFor(candidate: ImportCandidate): ImportTargetDevice[] {
    return rankDevicesForMarker({marker: candidate, devices: props.devices});
}

function optionLabel(device: ImportTargetDevice): string {
    const placed = props.existing[device.placementId] !== undefined;
    return placed ? `${device.label} (already placed)` : device.label;
}

// One device cannot stand for two markers — the builder throws on it, so the
// picker takes the option away rather than letting the user reach that state.
function isTakenElsewhere(key: string, placementId: string): boolean {
    return Object.entries(selections.value).some(
        ([otherKey, chosen]) => otherKey !== key && chosen === placementId
    );
}

function onSelect(key: string, placementId: string): void {
    const next = {...selections.value};
    if (placementId) next[key] = placementId;
    else delete next[key];
    selections.value = next;
}

function clearAll(): void {
    selections.value = {};
}

function onConfirm(): void {
    if (chosenCount.value === 0) return;
    emit('confirm', {...selections.value});
    // Handed over to the parent. Clearing here keeps the rows from offering
    // to place the same devices a second time.
    selections.value = {};
}

function noteFor(candidate: ImportCandidate): string | null {
    const chosen = selections.value[candidate.key];
    if (chosen && props.existing[chosen] !== undefined) {
        const label = deviceById.value.get(chosen)?.label ?? chosen;
        return `${label} is already on the plan — this moves its pin.`;
    }
    if (chosen && chosen === candidate.suggestedPlacementId) {
        return candidate.evidence === 'name'
            ? 'Suggested: the device name matches the marker.'
            : 'Suggested: the only device of this type here.';
    }
    if (!chosen && candidate.placedMatchId) {
        const label =
            deviceById.value.get(candidate.placedMatchId)?.label ??
            candidate.placedMatchId;
        return `Looks like ${label}, which is already placed. Pick it to move that pin.`;
    }
    return null;
}

function noteClass(candidate: ImportCandidate): string {
    const chosen = selections.value[candidate.key];
    const moves = chosen ? props.existing[chosen] !== undefined : false;
    return moves ? 'fpi__note--warn' : '';
}
</script>

<style scoped>
.fpi-sec {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fpi__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: 1.5;
}

.fpi__code {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
}

.fpi__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fpi__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}

.fpi__row-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.fpi__marker {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fpi__cat {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    background: var(--color-surface-4);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

.fpi__select {
    width: 100%;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
}

.fpi__note {
    margin: 0;
    font-size: var(--type-caption);
    line-height: 1.4;
    color: var(--color-text-tertiary);
}

.fpi__note--warn {
    color: var(--color-status-warn);
}

.fpi__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
</style>

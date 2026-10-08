<template>
    <div v-if="canImport" class="fpi">
        <p v-if="state === 'loading'" class="fpi__hint">
            <i class="fas fa-circle-notch fa-spin" aria-hidden="true" />
            Reading the drawing…
        </p>

        <p v-else-if="state === 'error'" class="fpi__error" role="alert">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ error }}</span>
        </p>

        <p v-else-if="state === 'idle'" class="fpi__hint">
            Upload a layered SVG or a PDF to read devices and rooms out of the
            drawing.
        </p>

        <template v-else>
            <section class="fpi__part">
                <h4 class="fpi__part-title">
                    <i class="fas fa-plug" aria-hidden="true" />
                    Devices in the drawing
                </h4>
                <FloorPlanDeviceImportSection
                    :candidates="candidates"
                    :devices="devices"
                    :existing="existing"
                    :busy="busy"
                    @confirm="$emit('confirm', $event)"
                />
            </section>

            <section class="fpi__part">
                <h4 class="fpi__part-title">
                    <i class="fas fa-draw-polygon" aria-hidden="true" />
                    Rooms in the drawing
                </h4>
                <FloorPlanZoneImportSection
                    :geometry="geometry"
                    :reading="geometryReading"
                    :confirmed-keys="confirmedZoneKeys"
                    :error="zoneError"
                    :busy="busy"
                    @confirm="$emit('confirmZones', $event)"
                />
            </section>
        </template>
    </div>
</template>

<script setup lang="ts">
// The one confirmation step for everything read out of an uploaded drawing.
// Devices and rooms are two readings of the same file, so they share one
// permission gate, one read-failure message and one panel — a second import
// surface would be a second place for the two to disagree.

import FloorPlanDeviceImportSection from '@/components/locations/floorplan/FloorPlanDeviceImportSection.vue';
import FloorPlanZoneImportSection from '@/components/locations/floorplan/FloorPlanZoneImportSection.vue';
import type {SvgPlanReadState} from '@/composables/useSvgPlanImport';
import type {FloorPlanGeometryResolution} from '@/helpers/floor-plan-geometry-resolver';
import type {ZoneConfirmation} from '@/helpers/floor-plan-zone-import';
import type {
    ImportCandidate,
    ImportTargetDevice
} from '@/helpers/svg-device-import';
import type {DevicePlacementMap} from '@/types/floor-plan';

withDefaults(
    defineProps<{
        /** Mirrors the backend gate on location.Update. False = no import UI. */
        canImport: boolean;
        state: SvgPlanReadState;
        error: string | null;
        candidates: readonly ImportCandidate[];
        devices: readonly ImportTargetDevice[];
        /** Placements already saved — used to warn before a pin is moved. */
        existing: DevicePlacementMap;
        /** Walls and room candidates; null until the drawing has been read. */
        geometry?: FloorPlanGeometryResolution | null;
        geometryReading?: boolean;
        confirmedZoneKeys?: readonly string[];
        /** A refusal from the zone save path — shown, never swallowed. */
        zoneError?: string | null;
        busy?: boolean;
    }>(),
    {
        geometry: null,
        geometryReading: true,
        confirmedZoneKeys: () => [],
        zoneError: null,
        busy: false
    }
);

defineEmits<{
    confirm: [selections: Record<string, string>];
    confirmZones: [confirmations: ZoneConfirmation[]];
}>();
</script>

<style scoped>
.fpi {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.fpi__part {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fpi__part-title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-tertiary);
}

.fpi__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: 1.5;
}

.fpi__error {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    font-size: var(--type-caption);
    line-height: 1.5;
    color: var(--color-status-warn);
    background: var(--color-surface-2);
    border: 1px solid var(--color-status-warn);
    border-radius: var(--radius-md);
}
</style>

<template>
    <div class="lmm" :title="title">
        <svg
            class="lmm__svg"
            :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="title"
        >
            <!-- Bounding rectangle suggesting the world rectangle. -->
            <rect
                x="0.5"
                y="0.5"
                :width="WIDTH - 1"
                :height="HEIGHT - 1"
                rx="6"
                fill="var(--color-surface-2)"
                stroke="var(--color-border-default)"
                stroke-width="1"
            />

            <!-- Subtle equator + prime meridian guide lines. -->
            <line
                :x1="0"
                :y1="HEIGHT / 2"
                :x2="WIDTH"
                :y2="HEIGHT / 2"
                stroke="var(--color-border-subtle)"
                stroke-width="1"
                stroke-dasharray="2 3"
            />
            <line
                :x1="WIDTH / 2"
                :y1="0"
                :x2="WIDTH / 2"
                :y2="HEIGHT"
                stroke="var(--color-border-subtle)"
                stroke-width="1"
                stroke-dasharray="2 3"
            />

            <!-- Continent silhouettes — simplified abstract blobs sized to
                 hint at land mass distribution without claiming geographic
                 accuracy. Each shape is a rounded path in the surface-3
                 token so it reads as "land" against the surface-2 sea. -->
            <g :fill="`var(--color-surface-3)`" fill-opacity="0.9">
                <!-- Americas -->
                <path d="M 24,28 Q 30,18 38,22 L 42,46 Q 38,68 34,76 L 30,72 Q 22,60 24,40 Z" />
                <!-- Europe + Africa -->
                <path d="M 70,22 Q 86,18 92,28 L 90,40 Q 96,56 92,72 L 80,80 Q 70,68 70,52 Q 64,38 70,22 Z" />
                <!-- Asia + Australia -->
                <path d="M 96,24 Q 116,18 132,28 L 138,42 Q 134,52 124,52 L 120,68 Q 130,76 122,80 L 110,74 Q 100,60 96,40 Z" />
            </g>

            <!-- Dot at the location coordinates. -->
            <g v-if="hasPoint">
                <circle
                    :cx="x"
                    :cy="y"
                    r="6"
                    fill="rgba(var(--color-primary-rgb), 0.15)"
                />
                <circle
                    :cx="x"
                    :cy="y"
                    r="3"
                    fill="var(--color-primary)"
                />
            </g>
        </svg>
        <div v-if="hasPoint" class="lmm__coords">
            {{ lat!.toFixed(3) }}°, {{ lng!.toFixed(3) }}°
        </div>
        <div v-else class="lmm__empty">
            <i class="fas fa-location-crosshairs" />
            No coordinates
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

/**
 * Compact world-map thumbnail with a primary-colored dot at the given
 * lat/lon. Uses an equirectangular projection on an abstract continent
 * silhouette — not geographically accurate, just a visual cue. Drop into
 * detail-page summaries when location coordinates are known.
 *
 * Falls back to an empty state when lat/lng are missing so callers can
 * use it unconditionally — the surrounding panel doesn't need to reshape
 * based on whether geo is set.
 */

const WIDTH = 160;
const HEIGHT = 100;

const props = withDefaults(
    defineProps<{
        lat?: number | null;
        lng?: number | null;
    }>(),
    {
        lat: null,
        lng: null
    }
);

const hasPoint = computed(
    () =>
        props.lat != null &&
        props.lng != null &&
        Number.isFinite(props.lat) &&
        Number.isFinite(props.lng) &&
        props.lat >= -90 &&
        props.lat <= 90 &&
        props.lng >= -180 &&
        props.lng <= 180
);

/** Equirectangular projection of (lng, lat) into the SVG viewBox. */
const x = computed(() =>
    props.lng == null ? 0 : ((props.lng + 180) / 360) * WIDTH
);
const y = computed(() =>
    props.lat == null ? 0 : ((90 - props.lat) / 180) * HEIGHT
);

const title = computed(() =>
    hasPoint.value
        ? `Location: ${props.lat!.toFixed(3)}°, ${props.lng!.toFixed(3)}°`
        : 'No coordinates set'
);
</script>

<style scoped>
.lmm {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    width: 160px;
    flex-shrink: 0;
}
.lmm__svg {
    width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius-md);
}
.lmm__coords {
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
    text-align: center;
}
.lmm__empty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    text-align: center;
}
</style>

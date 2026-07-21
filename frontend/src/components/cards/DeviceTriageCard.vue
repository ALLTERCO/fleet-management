<template>
    <article
        class="dtc"
        :class="{'dtc--selected': selected, 'dtc--static': !interactive}"
        :tabindex="interactive ? 0 : undefined"
        @click="interactive && $emit('click')"
        @keydown.enter="interactive && $emit('click')"
        @keydown.space.prevent="interactive && $emit('click')"
    >
        <!-- Header: title + Gen chip + bottom hairline -->
        <header class="dtc-header">
            <h3 class="dtc-header__title" :title="title">{{ title }}</h3>
            <span
                v-if="sleeping"
                class="dtc-header__sleep"
                title="Sleeping device — wakes on a schedule to report"
                aria-label="Sleeping device"
            >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <path
                        d="M6 2a6 6 0 1 0 8 8A5 5 0 0 1 6 2z"
                        fill="currentColor"
                    />
                </svg>
            </span>
            <Pill v-if="gen" variant="neutral">Gen {{ gen }}</Pill>
        </header>

        <!-- Body: image + data list. Image takes the left region for visual
             identification; the data list sits beside it. -->
        <div class="dtc-body">
            <div class="dtc-image">
                <img :src="imageSrc" :alt="title" @error="onImageError" />
            </div>
            <dl class="dtc-data">
                <div
                    v-for="row in rows"
                    :key="row.label"
                    class="dtc-row"
                >
                    <dt>{{ row.label }}</dt>
                    <dd
                        :class="row.tone ? `dtc-row__value--${row.tone}` : undefined"
                        :title="row.title ?? String(row.value)"
                    >
                        {{ row.value }}
                    </dd>
                </div>
            </dl>
        </div>

        <!-- Free-form region between body and footer (badges, auth field). -->
        <div v-if="$slots.extra" class="dtc-extra" @click.stop>
            <slot name="extra" />
        </div>

        <!-- Footer: actions + top hairline -->
        <footer v-if="$slots.footer" class="dtc-footer" @click.stop>
            <slot name="footer" />
        </footer>
    </article>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Pill from '@/components/core/Pill.vue';
import {GENERIC_LOGO, getLogoFallback, getLogoFromModel} from '@/helpers/device';

// The triage card look — image, title, Gen chip, dt/dd rows, action footer.
// One shell for every "device knocking at the door" surface: waiting room,
// LAN scan hits, IP probe results.

export interface TriageRow {
    label: string;
    value: string | number;
    /** Optional value tint: good | ok | warn. */
    tone?: 'good' | 'ok' | 'warn';
    /** Hover tooltip; defaults to the value itself. */
    title?: string;
}

const props = withDefaults(
    defineProps<{
        title: string;
        rows: TriageRow[];
        /** CDN image key (device SKU or XT1 service type). Empty = generic logo. */
        imageKey?: string;
        /** Whether a bundled local image exists for the key. */
        imageLocalFallback?: boolean;
        gen?: number | string;
        sleeping?: boolean;
        selected?: boolean;
        /** Card reacts to click/keyboard (waiting room selection). */
        interactive?: boolean;
    }>(),
    {
        imageKey: '',
        imageLocalFallback: false,
        gen: undefined,
        sleeping: false,
        selected: false,
        interactive: false
    }
);

defineEmits<{click: []}>();

// CDN → bundled local image → generic logo, stepping down on load errors.
const imageStage = ref<'cdn' | 'local' | 'generic'>('cdn');

function onImageError(): void {
    if (imageStage.value === 'cdn' && props.imageLocalFallback) {
        imageStage.value = 'local';
    } else {
        imageStage.value = 'generic';
    }
}

watch(
    () => props.imageKey,
    () => {
        imageStage.value = 'cdn';
    }
);

const imageSrc = computed(() => {
    if (imageStage.value === 'generic' || !props.imageKey) return GENERIC_LOGO;
    if (imageStage.value === 'local') return getLogoFallback(props.imageKey);
    return getLogoFromModel(props.imageKey);
});
</script>

<style scoped>
/* ──────────────────────────────────────────────────────────
   Device triage card — bespoke 2×1 for device admission surfaces.
   Two device-card units side-by-side. Built from design tokens.
   Decoration mirrors .ec — subtle accent glow + gradient hairlines
   + soft hover lift.
   ────────────────────────────────────────────────────────── */

/* ── Shell ── */
.dtc {
    /* Spans exactly two device-card cells horizontally (2×1) inside the
     * devices grid; in a plain flow container the span is inert. */
    grid-column: span 2;
    grid-row: span 1;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    cursor: pointer;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-card);
    color: var(--color-text-secondary);
    position: relative;
    contain: layout style paint;
    transition:
        border-color var(--duration-normal) var(--ease-out-expo),
        background var(--duration-normal) var(--ease-out-expo),
        box-shadow var(--duration-normal) var(--ease-out-expo);
}
.dtc--static {
    cursor: default;
}
/* Subtle accent glow — mirrors .ec::after pattern. */
.dtc::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(
        ellipse 70% 60% at 30% 110%,
        rgba(var(--color-frost-rgb), 0.04),
        transparent 70%
    );
    pointer-events: none;
    z-index: 0;
}
.dtc:hover {
    border-color: var(--color-border-medium);
    background: rgba(249, 250, 250, 0.04);
}
.dtc:hover::after {
    background: radial-gradient(
        ellipse 70% 60% at 30% 110%,
        rgba(var(--color-frost-rgb), 0.08),
        transparent 70%
    );
}
.dtc:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.45);
}
.dtc:not(.dtc--static):active {
    transform: scale(0.99);
    filter: brightness(0.97);
}
.dtc--selected {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-primary);
}

/* ── Header (top): title + Gen chip + bottom gradient hairline ── */
.dtc-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    position: relative;
    z-index: 1;
}
.dtc-header::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 15%;
    right: 15%;
    height: 0.5px;
    background: linear-gradient(
        90deg,
        transparent,
        var(--divider-hairline),
        transparent
    );
}
.dtc-header__sleep {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    color: var(--color-text-tertiary);
    opacity: 0.85;
}
.dtc-header__title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    line-height: 1.25;
    letter-spacing: -0.2px;
    color: var(--color-text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
}
/* ── Body: image left, data list right. minmax(0, 1fr) lets values
       truncate rather than push the row past the card edge. ── */
.dtc-body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--split-minor) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    position: relative;
    z-index: 1;
}
.dtc-image {
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
}
.dtc-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    pointer-events: none;
}

.dtc-data {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    min-width: 0;
}
.dtc-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--type-caption);
    line-height: 1.4;
    min-width: 0;
}
.dtc-row dt {
    flex: 0 0 auto;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: var(--font-semibold);
}
.dtc-row dd {
    margin: 0;
    min-width: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dtc-row__value--good { color: var(--color-status-on); }
.dtc-row__value--ok   { color: var(--color-text-primary); }
.dtc-row__value--warn { color: var(--color-status-warn); }

/* ── Extra region (badges, auth input) ── */
.dtc-extra {
    flex: 0 0 auto;
    display: grid;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-2);
    position: relative;
    z-index: 1;
}

/* ── Footer (bottom): actions + top gradient hairline ── */
.dtc-footer {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    position: relative;
    z-index: 1;
}
.dtc-footer::before {
    content: "";
    position: absolute;
    top: 0;
    left: 15%;
    right: 15%;
    height: 0.5px;
    background: linear-gradient(
        90deg,
        transparent,
        var(--divider-hairline),
        transparent
    );
}
.dtc-footer :deep(.core-btn) {
    flex: 1;
}

/* ── Tablet / narrow desktop (≤768px) ── */
@media (max-width: 768px) {
    .dtc {
        height: auto;
        aspect-ratio: 2 / 1;
    }
}

/* ── Mobile (≤540px): collapse to image-only 1×1 thumbnail. ── */
@media (max-width: 540px) {
    .dtc {
        grid-column: span 1;
        aspect-ratio: 1 / 1;
    }
    .dtc-header,
    .dtc-footer,
    .dtc-extra,
    .dtc-data {
        display: none;
    }
    .dtc-body {
        padding: var(--space-3);
    }
}
</style>

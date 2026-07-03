<template>
    <article
        class="wrc"
        :class="{'wrc--selected': selected}"
        tabindex="0"
        @click="$emit('click')"
        @keydown.enter="$emit('click')"
        @keydown.space.prevent="$emit('click')"
    >
        <!-- Header: title + Gen chip + bottom hairline -->
        <header class="wrc-header">
            <h3 class="wrc-header__title" :title="info.title">{{ info.title }}</h3>
            <span
                v-if="info.sleeping"
                class="wrc-header__sleep"
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
            <Pill v-if="info.gen" variant="neutral">Gen {{ info.gen }}</Pill>
        </header>

        <!-- Body: image + data list. Image takes the upper region for visual
             identification; data list sits below. -->
        <div class="wrc-body">
            <div class="wrc-image">
                <img
                    :src="info.image"
                    :alt="info.title"
                    @error="onImageError"
                />
            </div>
            <dl class="wrc-data">
                <div class="wrc-row">
                    <dt>IP</dt>
                    <dd :title="info.ip || 'No IP'">{{ info.ip || '—' }}</dd>
                </div>
                <div class="wrc-row">
                    <dt>MAC</dt>
                    <dd :title="info.mac || 'No MAC'">{{ info.mac || '—' }}</dd>
                </div>
                <div v-if="info.ssid" class="wrc-row">
                    <dt>SSID</dt>
                    <dd :title="info.ssid">{{ info.ssid }}</dd>
                </div>
                <div v-if="info.rssi != null" class="wrc-row">
                    <dt>Signal</dt>
                    <dd :class="['wrc-row__rssi', `wrc-row__rssi--${rssiTier(info.rssi)}`]">
                        {{ info.rssi }} dBm
                    </dd>
                </div>
                <div class="wrc-row">
                    <dt>Firmware</dt>
                    <dd :title="info.firmware || 'No firmware'">{{ info.firmware || '—' }}</dd>
                </div>
                <div class="wrc-row wrc-row--freshness">
                    <dt>Seen</dt>
                    <dd :title="freshness.title">{{ freshness.label }}</dd>
                </div>
            </dl>
        </div>

        <!-- Footer: Reject + Allow + top hairline -->
        <footer class="wrc-footer">
            <Button
                v-if="showReject"
                type="red"
                size="xs"
                :disabled="!canReject || accepting"
                :title="!canReject ? noPermissionTitle : 'Reject device'"
                @click.stop="$emit('reject')"
            >
                Reject
            </Button>
            <Button
                type="green"
                size="xs"
                :loading="isAccepting"
                :disabled="!canAccept || accepting"
                :title="!canAccept ? noPermissionTitle : 'Allow device'"
                @click.stop="$emit('accept')"
            >
                Allow
            </Button>
        </footer>
    </article>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Pill from '@/components/core/Pill.vue';
import {useNowTicker} from '@/composables/useNowTicker';
import type {PendingDevice} from '@/composables/useWaitingRoomList';
import {
    formatMac,
    GENERIC_LOGO,
    getLogoFallback,
    getLogoFromModel,
    modelForCard,
    rssiTier
} from '@/helpers/device';
import {formatRelative, formatTime} from '@/helpers/format';

const noPermissionTitle = 'You do not have permission to perform this action';

const props = defineProps<{
    device: PendingDevice;
    selected?: boolean;
    canAccept: boolean;
    canReject: boolean;
    accepting?: boolean;
    isAccepting?: boolean;
    showReject: boolean;
}>();

defineEmits<{click: []; accept: []; reject: []}>();

const imageStage = ref<'cdn' | 'local' | 'generic'>('cdn');

function onImageError() {
    if (imageStage.value === 'cdn' && imageRef.value.hasLocalFallback) {
        imageStage.value = 'local';
    } else if (imageStage.value === 'local') imageStage.value = 'generic';
    else imageStage.value = 'generic';
}

// Image is keyed by SKU (the CDN serves by SKU). Empty SKU → generic logo.
function resolveImage(sku: string): string {
    if (imageStage.value === 'generic' || !sku) return GENERIC_LOGO;
    if (imageStage.value === 'local') return getLogoFallback(sku);
    return getLogoFromModel(sku);
}

// XT1: CDN key is service type (jwt.xt1.svc0.type), not model SKU.
const imageRef = computed(() => {
    const sys = props.device.status?.sys as
        | {
              app?: string;
              device?: {model?: string; xt1SvcType?: string};
          }
        | undefined;
    const xt1SvcType = sys?.device?.xt1SvcType?.trim();
    if (xt1SvcType) return {key: xt1SvcType, hasLocalFallback: false};
    if (sys?.app === 'XT1') return {key: '', hasLocalFallback: false};
    // No sys.device.model on sanitized ingress entries — fall back to the
    // shellyID-derived model so every card resolves a picture.
    return {
        key: modelForCard(props.device.shellyID, sys?.device?.model),
        hasLocalFallback: true
    };
});

// Reset fallback stage when the key changes (e.g. XT1 enrichment arrives after initial queue).
watch(
    () => imageRef.value.key,
    () => {
        imageStage.value = 'cdn';
    }
);

const info = computed(() => {
    const status = props.device.status ?? {};
    const wifi = status.wifi as
        | {sta_ip?: string; ssid?: string; rssi?: number}
        | undefined;
    const eth = status.eth as {ip?: string} | undefined;
    const sys = status.sys as
        | {
              mac?: string;
              ver?: string;
              gen?: number;
              app?: string;
              wakeup_period?: number;
              device?: {
                  name?: string;
                  profile?: string;
                  model?: string;
                  xt1SvcType?: string;
              };
          }
        | undefined;

    const deviceName = sys?.device?.name?.trim() ?? '';
    const appName = sys?.app?.trim() ?? '';
    const sku = sys?.device?.model?.trim() ?? '';

    return {
        title: deviceName || appName || sku || props.device.shellyID,
        model: sku,
        gen: sys?.gen,
        ip: eth?.ip || wifi?.sta_ip || '',
        mac: formatMac(sys?.mac ?? ''),
        ssid: wifi?.ssid || '',
        rssi: typeof wifi?.rssi === 'number' ? wifi.rssi : null,
        firmware: sys?.ver ?? '',
        // Battery devices report a wake interval — flag them so operators know
        // the card won't refresh in real time.
        sleeping: (sys?.wakeup_period ?? 0) > 0,
        image: resolveImage(imageRef.value.key)
    };
});

// Shared 1Hz ticker — one interval app-wide, not per-card.
const {now, release} = useNowTicker();
onBeforeUnmount(release);

const freshness = computed(() => {
    const t = props.device.touchedAt;
    return {label: formatRelative(t, now.value), title: formatTime(t)};
});
</script>

<style scoped>
/* ──────────────────────────────────────────────────────────
   Waiting Room Card — bespoke 2×1 (412×200) for device triage.
   Two device-card units side-by-side. Built from design tokens.
   dt/dd row pattern matches the modal (.wrd-row). Decoration
   mirrors .ec — subtle accent glow + gradient hairlines + soft
   hover lift.
   ────────────────────────────────────────────────────────── */

/* ── Shell ── */
.wrc {
    /* Spans exactly two device-card cells horizontally (2×1) and one cell
     * vertically. Width and height come from the parent grid (same grid as
     * the devices page), so this card is guaranteed to be the same height
     * as the device cards next to it at every viewport. */
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
/* Subtle accent glow — mirrors .ec::after pattern. */
.wrc::after {
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
.wrc:hover {
    border-color: var(--color-border-medium);
    background: rgba(249, 250, 250, 0.04);
}
.wrc:hover::after {
    background: radial-gradient(
        ellipse 70% 60% at 30% 110%,
        rgba(var(--color-frost-rgb), 0.08),
        transparent 70%
    );
}
.wrc:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.45);
}
.wrc:active {
    transform: scale(0.99);
    filter: brightness(0.97);
}
.wrc--selected {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-primary);
}

/* ── Header (top): title + Gen chip + bottom gradient hairline ── */
.wrc-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    position: relative;
    z-index: 1;
}
.wrc-header::after {
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
.wrc-header__sleep {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    color: var(--color-text-tertiary);
    opacity: 0.85;
}
.wrc-header__title {
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
/* ── Body: image left, data list right. Side-by-side because 200px tall is
       too short to stack image + 5 rows. minmax(0, 1fr) lets values truncate
       rather than push the row past the card edge. ── */
.wrc-body {
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
.wrc-image {
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
}
.wrc-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    pointer-events: none;
}

.wrc-data {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    min-width: 0;
}
.wrc-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--type-caption);
    line-height: 1.4;
    min-width: 0;
}
.wrc-row dt {
    flex: 0 0 auto;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: var(--font-semibold);
}
.wrc-row dd {
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
.wrc-row__rssi--good { color: var(--color-status-on); }
.wrc-row__rssi--ok   { color: var(--color-text-primary); }
.wrc-row__rssi--warn { color: var(--color-status-warn); }

/* ── Footer (bottom): Reject + Allow + top gradient hairline ── */
.wrc-footer {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    position: relative;
    z-index: 1;
}
.wrc-footer::before {
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
.wrc-footer :deep(.core-btn) {
    flex: 1;
}

/* ── Tablet / narrow desktop (≤768px): grid switches to minmax(160, 1fr).
       Height matches a single device cell via aspect-ratio 1/1 (since cells
       are square at this viewport). 2 cells wide + gap = aspect 2.06/1. ── */
@media (max-width: 768px) {
    .wrc {
        height: auto;
        aspect-ratio: 2 / 1;
    }
}

/* ── Mobile (≤540px): collapse to image-only 1×1 thumbnail (single cell). ── */
@media (max-width: 540px) {
    .wrc {
        grid-column: span 1;
        aspect-ratio: 1 / 1;
    }
    .wrc-header,
    .wrc-footer,
    .wrc-data {
        display: none;
    }
    .wrc-body {
        padding: var(--space-3);
    }
}
</style>

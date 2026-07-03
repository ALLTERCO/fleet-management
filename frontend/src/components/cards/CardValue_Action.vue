<template>
    <!-- ═══ 1x1: Icon circle + name + last-run badge + Run button ═══ -->
    <div
        v-if="size === '1x1'"
        class="ac"
        :class="{ 'ac-selected': selected }"
        tabindex="0"
        @click="$emit('open-detail')"
        @keydown.enter="$emit('open-detail')"
    >
        <!-- Body: icon + name -->
        <div class="ac-1x1-center">
            <div class="ac-1x1-icon" :class="iconCircleClass">
                <i v-if="isRunning" class="fas fa-spinner fa-spin ac-custom-icon" />
                <i v-else-if="runState === 'ok'" class="fas fa-check ac-custom-icon" />
                <i v-else-if="runState === 'error'" class="fas fa-xmark ac-custom-icon" />
                <i v-else-if="action.icon" :class="action.icon" class="ac-custom-icon" />
                <i v-else class="fas fa-play ac-custom-icon" />
            </div>
            <div class="ac-name">{{ action.name }}</div>
        </div>

        <!-- Footer: Run button -->
        <div class="ac-1x1-foot">
            <Button type="blue" :loading="isRunning" :disabled="isRunning" class="ac-run-btn" @click.stop="$emit('run')">
                <i class="fas fa-play" /> {{ isRunning ? 'Running…' : 'Run' }}
            </Button>
        </div>

        <!-- Edit overlay -->
        <div v-if="editMode" class="ac-edit-overlay" @click.stop>
            <button class="ac-edit-btn" title="Move left" @click.stop="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button class="ac-edit-btn" title="Move right" @click.stop="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button class="ac-edit-btn" title="Change size" @click.stop="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button class="ac-edit-btn danger" title="Remove" @click.stop="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- ═══ 2x1: Icon left + name/desc + step chips + Run button ═══ -->
    <div
        v-else-if="size === '2x1'"
        class="ac ec-wide"
        tabindex="0"
        @click="$emit('open-detail')"
        @keydown.enter="$emit('open-detail')"
    >
        <div class="ac-bar" :class="barClass" :style="barStyle" />

        <!-- Header: icon + name + description -->
        <div class="ac-2x1-header">
            <div class="ac-2x1-icon" :class="iconCircleClass">
                <i v-if="isRunning" class="fas fa-spinner fa-spin ac-custom-icon" />
                <i v-else-if="runState === 'ok'" class="fas fa-check ac-custom-icon" />
                <i v-else-if="runState === 'error'" class="fas fa-xmark ac-custom-icon" />
                <i v-else-if="action.icon" :class="action.icon" class="ac-custom-icon" />
                <i v-else class="fas fa-play ac-custom-icon" />
            </div>
            <div class="ac-2x1-text">
                <div class="ac-name">{{ action.name }}</div>
                <div v-if="stepSummary" class="ac-desc">{{ stepSummary }}</div>
            </div>
        </div>

        <!-- Step preview chips (first 3 steps) -->
        <div v-if="steps.length" class="ac-2x1-chips">
            <span v-for="(step, i) in previewSteps" :key="i" class="ac-chip">{{ formatStepChip(step) }}</span>
            <span v-if="steps.length > 3" class="ac-chip ac-chip--more">+{{ steps.length - 3 }} more</span>
        </div>

        <!-- Bottom: info chips + Run button -->
        <div class="ac-2x1-bottom">
            <div class="ac-2x1-info">
                <span class="ac-chip ac-chip--meta">{{ deviceCount }} device{{ deviceCount === 1 ? '' : 's' }} &middot; {{ steps.length }} step{{ steps.length === 1 ? '' : 's' }}</span>
                <span v-if="lastRunLabel" class="ac-chip" :class="lastRunChipClass">{{ lastRunLabel }}</span>
            </div>
            <Button type="blue" :loading="isRunning" :disabled="isRunning" size="sm" @click.stop="$emit('run')">
                <i class="fas fa-play" /> {{ isRunning ? 'Stop' : 'Run' }}
            </Button>
        </div>

        <!-- Edit overlay -->
        <div v-if="editMode" class="ac-edit-overlay" @click.stop>
            <button class="ac-edit-btn" title="Move left" @click.stop="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button class="ac-edit-btn" title="Move right" @click.stop="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button class="ac-edit-btn" title="Change size" @click.stop="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button class="ac-edit-btn danger" title="Remove" @click.stop="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- ═══ 2x2: Large hero — full command list + device chips ═══ -->
    <div
        v-else
        class="ac ec-hero"
        tabindex="0"
        @click="$emit('open-detail')"
        @keydown.enter="$emit('open-detail')"
    >
        <div class="ac-bar" :class="barClass" :style="barStyle" />

        <!-- Header -->
        <div class="ac-header">
            <div class="ac-hdr-left">
                <div class="ac-name">{{ action.name }}</div>
                <div v-if="stepSummary" class="ac-desc">{{ stepSummary }}</div>
            </div>
        </div>

        <!-- Command list -->
        <div class="ac-commands">
            <div class="ac-sec-label">Commands ({{ steps.length }})</div>
            <div class="ac-cmd-list">
                <div v-for="(step, i) in steps" :key="i" class="ac-cmd">
                    <div class="cmd-icon">
                        <i class="fas fa-play" />
                    </div>
                    <span class="cmd-device">{{ formatDeviceLabel(step) }}</span>
                    <span class="cmd-arrow">&rarr;</span>
                    <span class="cmd-action">{{ step.method }}</span>
                </div>
            </div>
        </div>

        <!-- Device chips -->
        <div v-if="uniqueDevices.length" class="ac-devices">
            <div class="ac-sec-label">Devices ({{ deviceCount }})</div>
            <div class="ac-device-grid">
                <div v-for="(dev, i) in visibleDevices" :key="i" class="ac-device-chip">
                    <div class="chip-dot on" />
                    {{ dev }}
                </div>
                <div v-if="uniqueDevices.length > maxVisibleDevices" class="ac-device-chip ac-device-chip--more">
                    +{{ uniqueDevices.length - maxVisibleDevices }} more
                </div>
            </div>
        </div>

        <!-- Footer: last run + Run button -->
        <div class="ac-footer">
            <div class="ac-last">
                <span v-if="lastRunLabel">
                    <span :class="lastRunDotClass">{{ lastRunDot }}</span>
                    Last run: <b>{{ lastRunTimeLabel }}</b>
                </span>
                <span v-else class="ac-last-none">No runs yet</span>
            </div>
            <Button type="blue" :loading="isRunning" :disabled="isRunning" size="sm" @click.stop="$emit('run')">
                <i class="fas fa-play" /> {{ isRunning ? 'Stop' : 'Run' }}
            </Button>
        </div>

        <!-- Edit overlay -->
        <div v-if="editMode" class="ac-edit-overlay" @click.stop>
            <button class="ac-edit-btn" title="Move left" @click.stop="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button class="ac-edit-btn" title="Move right" @click.stop="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button class="ac-edit-btn" title="Change size" @click.stop="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button class="ac-edit-btn danger" title="Remove" @click.stop="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import type {action_t} from '@/types';

/* ── Props & emits ── */

interface ActionLastRun {
    status: 'ok' | 'error' | 'running';
    ts: number;
}

interface ActionProps {
    action: action_t & {icon?: string; lastRun?: ActionLastRun};
    size: '1x1' | '2x1' | '2x2';
    editMode?: boolean;
    selected?: boolean;
    /** Inline run feedback: set by parent, auto-clears after timeout */
    runState?: 'running' | 'ok' | 'error';
}

const props = withDefaults(defineProps<ActionProps>(), {
    editMode: false,
    selected: false,
    runState: undefined
});

defineEmits<{
    'open-detail': [];
    delete: [];
    move: [direction: number];
    'cycle-size': [];
    run: [];
}>();

/* ── Derived data ── */

/** Normalized step list from the action's `actions` array */
const steps = computed(() => props.action.actions ?? []);

/** Count unique target devices across all steps */
const uniqueDevices = computed(() => {
    const ids = new Set<string>();
    for (const step of steps.value) {
        const dst = step.dst;
        if (Array.isArray(dst)) {
            for (const d of dst) ids.add(d);
        } else if (dst) {
            ids.add(dst);
        }
    }
    return [...ids];
});

const deviceCount = computed(() => uniqueDevices.value.length);

/** For the 2x2 device chip grid, cap visible chips */
const maxVisibleDevices = 7;
const visibleDevices = computed(() =>
    uniqueDevices.value.slice(0, maxVisibleDevices)
);

/** First 3 steps for the 2x1 chip preview */
const previewSteps = computed(() => steps.value.slice(0, 3));

/* ── Status helpers ── */

const lastRun = computed(
    () => (props.action as any).lastRun as ActionLastRun | undefined
);
const isRunning = computed(
    () => props.runState === 'running' || lastRun.value?.status === 'running'
);

const barClass = computed(() => {
    if (isRunning.value) return 'progress';
    return 'idle';
});

const barStyle = computed(() => {
    if (!isRunning.value) return {};
    return {'--prog': '65%'};
});

const iconCircleClass = computed(() => {
    if (props.runState === 'running') return 'ac-icon-running';
    if (props.runState === 'ok') return 'ac-icon-ok';
    if (props.runState === 'error') return 'ac-icon-error';
    if (isRunning.value) return 'ac-icon-running';
    if (lastRun.value?.status === 'error') return 'ac-icon-error';
    return 'ac-icon-idle';
});

/* ── Last run display ── */

const lastRunLabel = computed(() => {
    if (!lastRun.value) return '';
    if (isRunning.value) return 'Running\u2026';
    const prefix = lastRun.value.status === 'ok' ? 'Last: OK' : 'Last: Failed';
    const ago = timeAgo(lastRun.value.ts);
    return ago ? `${prefix} \u00b7 ${ago}` : prefix;
});

/** Chip class for 2x1 last-run indicator */
const lastRunChipClass = computed(() => {
    if (!lastRun.value) return '';
    if (lastRun.value.status === 'ok') return 'ac-chip--ok';
    if (lastRun.value.status === 'error') return 'ac-chip--err';
    return '';
});

/** Checkmark/cross for 2x2 footer */
const lastRunDot = computed(() => {
    if (!lastRun.value) return '';
    return lastRun.value.status === 'ok' ? '\u2713' : '\u2717';
});

const lastRunDotClass = computed(() => {
    if (!lastRun.value) return '';
    return lastRun.value.status === 'ok' ? 'ok' : 'err';
});

const lastRunTimeLabel = computed(() => {
    if (!lastRun.value?.ts) return '';
    return timeAgo(lastRun.value.ts) || 'just now';
});

/* ── Step formatting ── */

/** Short chip label for a step: "method" or truncated */
function formatStepChip(step: any): string {
    const method = step.method ?? 'unknown';
    const short = method.split('.').pop() ?? method;
    return short.length > 16 ? `${short.slice(0, 14)}\u2026` : short;
}

/** Device label for 2x2 command list rows */
function formatDeviceLabel(step: any): string {
    const dst = step.dst;
    if (!dst) return 'Unknown';
    if (Array.isArray(dst)) {
        if (dst.length === 1) return dst[0];
        return `${dst[0]} (+${dst.length - 1})`;
    }
    return dst;
}

/** Brief description from steps for 2x1/2x2 subtitle */
const stepSummary = computed(() => {
    const count = steps.value.length;
    if (count === 0) return '';
    const methods = steps.value
        .slice(0, 3)
        .map((s: any) => {
            const m = s.method ?? '';
            return m.split('.').pop() ?? m;
        })
        .join(', ');
    const suffix = count > 3 ? ` +${count - 3} more` : '';
    return methods + suffix;
});

/* ── Utilities ── */

function timeAgo(ts: number): string {
    if (!ts) return '';
    const diffS = Math.floor((Date.now() - ts) / 1000);
    if (diffS < 0) return '';
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
}
</script>

<style scoped>
/* ── 1x1 layout ── */
.ac[tabindex]:not(.ec-wide):not(.ec-hero) {
    display: flex;
    flex-direction: column;
    position: relative;
    height: var(--grid-cell, 200px);
    min-height: var(--grid-cell, 200px);
    border-radius: var(--dcard-radius);
    background: var(--dcard-bg);
    border: 1px solid var(--dcard-border);
    overflow: hidden;
    transition: box-shadow var(--duration-fast);
}
.ac[tabindex]:not(.ec-wide):not(.ec-hero):hover {
    box-shadow: var(--dcard-hover-shadow);
}

/* Selected state for the shared select-and-delete pattern. */
.ac.ac-selected {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 40%, transparent);
}
.ac[tabindex]:not(.ec-wide):not(.ec-hero).ac-selected {
    border-color: var(--color-primary);
}

.ac-1x1-center {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-sm);
    padding: var(--gap-md);
}
/* Clamp a long action name to 2 lines so the tile height stays fixed and the
   Run button below it never gets pushed out of place. */
.ac-1x1-center .ac-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: center;
    word-break: break-word;
}

.ac-1x1-icon {
    width: var(--gap-xl);
    height: var(--gap-xl);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
        background var(--duration-fast, 150ms),
        border-color var(--duration-fast, 150ms);
}

.ac-custom-icon {
    font-size: var(--type-subheading);
}

.ac-1x1-foot {
    padding: 0 var(--gap-sm) var(--gap-xs);
}
.ac-run-btn { width: 100%; }

/* ── 2x1 layout ── */
.ac-2x1-header {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md) 0;
}

.ac-2x1-icon {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
        background var(--duration-fast, 150ms),
        border-color var(--duration-fast, 150ms);
}

.ac-2x1-text {
    min-width: 0;
    flex: 1;
}
.ac-2x1-text .ac-name {
    font-size: var(--type-subheading);
    letter-spacing: -0.6px;
    text-align: left;
    margin-bottom: 0;
}
.ac-2x1-text .ac-desc {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-disabled);
    margin-top: var(--gap-xs);
}

.ac-2x1-chips {
    display: flex;
    gap: var(--gap-xs);
    padding: var(--gap-sm) var(--gap-md) 0;
    flex-wrap: wrap;
}

.ac-2x1-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--gap-md) var(--gap-sm);
    margin-top: auto;
}
.ac-2x1-info {
    display: flex;
    gap: var(--gap-xs);
}

.ac-2x1-bottom .ac-run {
    padding: var(--gap-xs) var(--gap-md);
    font-size: var(--type-body);
    width: auto;
}

/* ── Shared icon states ── */
.ac-icon-idle {
    background: rgba(var(--ar-action), 0.06);
    border: 1.5px solid rgba(var(--ar-action), 0.18);
    color: rgba(var(--ar-action), 0.8);
}
.ac-icon-running {
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
    box-shadow: 0 0 var(--gap-sm) color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
}
.ac-icon-ok {
    background: color-mix(in srgb, var(--color-status-on) 8%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--color-status-on) 25%, transparent);
    box-shadow: 0 0 var(--gap-sm) color-mix(in srgb, var(--color-status-on) 15%, transparent);
    color: var(--color-status-on);
    animation: ac-flash 0.3s ease-out;
}
.ac-icon-error {
    background: color-mix(in srgb, var(--color-status-off) 6%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--color-status-off) 18%, transparent);
    box-shadow: 0 0 var(--gap-sm) color-mix(in srgb, var(--color-status-off) 15%, transparent);
    color: var(--color-status-off);
    animation: ac-flash 0.3s ease-out;
}
@keyframes ac-flash {
    0% { transform: scale(1.2); }
    100% { transform: scale(1); }
}

/* ── Chip variants ── */
.ac-chip--meta {
    font-weight: 700;
    background: rgba(var(--ar-action), 0.08);
    border: 1px solid rgba(var(--ar-action), 0.15);
    color: rgba(var(--ar-action), 0.8);
}
.ac-chip--more {
    color: var(--color-text-disabled);
}
.ac-chip--ok {
    background: color-mix(in srgb, var(--color-status-on) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-status-on) 15%, transparent);
    color: var(--color-status-on);
}
.ac-chip--err {
    background: color-mix(in srgb, var(--color-status-off) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-status-off) 15%, transparent);
    color: var(--color-status-off);
}

/* ── 2x2 footer last run ── */
.ac-last-none {
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}

/* ── Edit overlay ── */
.ac-edit-overlay {
    position: absolute;
    inset: 0;
    background: var(--color-overlay-light);
    border-radius: inherit;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    z-index: 10;
}
.ac-edit-btn {
    width: var(--gap-lg);
    height: var(--gap-lg);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
        background var(--duration-fast, 150ms),
        color var(--duration-fast, 150ms);
}
.ac-edit-btn:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.ac-edit-btn:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
}
.ac-edit-btn.danger {
    color: var(--color-status-off);
}
.ac-edit-btn.danger:hover {
    background: color-mix(in srgb, var(--color-status-off) 15%, transparent);
    color: var(--color-status-off);
}
.ac-device-chip--more { opacity: 0.45; }
</style>

<template>
    <transition name="scrubber">
        <section
            v-if="visible"
            class="scrubber"
            role="group"
            aria-label="Time scrubber"
        >
            <button
                type="button"
                class="scrubber__play"
                :title="playing ? 'Pause replay' : playLabel"
                @click="togglePlay"
            >
                <i
                    :class="['fas', playing ? 'fa-pause' : 'fa-play']"
                    aria-hidden="true"
                />
            </button>
            <span class="scrubber__time">{{ pastLabel }}</span>
            <div
                ref="trackEl"
                class="scrubber__track"
                @click="onTrackClick"
            >
                <div class="scrubber__rail" />
                <div
                    class="scrubber__fill"
                    :style="{width: `${position * 100}%`}"
                />
                <span
                    v-for="tick in ticks"
                    :key="tick.id"
                    class="scrubber__tick"
                    :class="`scrubber__tick--${tick.tone}`"
                    :title="tick.label"
                    :style="{left: `${tick.position * 100}%`}"
                />
                <span
                    class="scrubber__handle"
                    :style="{left: `${position * 100}%`}"
                />
            </div>
            <span class="scrubber__time scrubber__time--now">
                {{ nowLabel }}
            </span>
            <span class="scrubber__hint">{{ hintLabel }}</span>
            <button
                type="button"
                class="scrubber__close"
                title="Hide scrubber"
                @click="onCloseClick"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </section>
    </transition>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import type {TimelinePlayback} from '@/composables/useTimelinePlayback';

export type ScrubberTickTone = 'alert' | 'warn' | 'info';

export interface ScrubberTick {
    id: string;
    position: number; // 0 — 1
    tone: ScrubberTickTone;
    label?: string;
}

const props = withDefaults(
    defineProps<{
        visible: boolean;
        pastLabel: string;
        nowLabel: string;
        playback: TimelinePlayback;
        playLabel?: string;
        hintLabel?: string;
        ticks?: readonly ScrubberTick[];
    }>(),
    {
        playLabel: 'Play replay',
        hintLabel: 'drag to replay',
        ticks: () => []
    }
);
const emit = defineEmits<{close: []}>();
function onCloseClick(): void {
    emit('close');
}

const position = computed(() => props.playback.position.value);
const playing = computed(() => props.playback.playing.value);
const trackEl = ref<HTMLElement | null>(null);

function togglePlay(): void {
    props.playback.toggle();
}

function onTrackClick(event: MouseEvent): void {
    const track = trackEl.value;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    props.playback.seek((event.clientX - rect.left) / rect.width);
}
</script>

<style scoped>
.scrubber {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    width: min(720px, calc(100vw - 160px));
    height: 56px;
    border-radius: var(--radius-xl);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--color-border-medium);
    box-shadow: var(--shadow-xl);
    padding: 10px var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    z-index: 4;
    transform: translateX(-50%);
}
.scrubber__play {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(var(--color-primary-rgb), 0.18);
    border: 1px solid rgba(var(--color-primary-rgb), 0.3);
    color: var(--color-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: var(--type-caption);
    transition: all var(--duration-normal) var(--ease-out-expo);
}
.scrubber__play:hover {
    background: rgba(var(--color-primary-rgb), 0.28);
    transform: scale(1.06);
}
.scrubber__time {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 44px;
}
.scrubber__time--now {
    color: var(--color-text-primary);
    font-weight: var(--font-bold);
}
.scrubber__track {
    flex: 1;
    position: relative;
    height: 36px;
    cursor: pointer;
}
.scrubber__rail {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 4px;
    border-radius: var(--radius-full);
    background: rgba(var(--color-frost-rgb), 0.08);
    transform: translateY(-50%);
}
.scrubber__fill {
    position: absolute;
    top: 50%;
    left: 0;
    height: 4px;
    border-radius: var(--radius-full);
    background: linear-gradient(
        90deg,
        rgba(var(--color-primary-rgb), 0.6),
        var(--color-primary)
    );
    transform: translateY(-50%);
}
.scrubber__tick {
    position: absolute;
    top: 50%;
    width: 2px;
    height: 12px;
    transform: translate(-50%, -50%);
    border-radius: 1px;
}
.scrubber__tick--alert {
    background: var(--color-status-off);
    box-shadow: 0 0 8px var(--color-status-off);
    height: 14px;
}
.scrubber__tick--warn {
    background: var(--color-status-warn);
}
.scrubber__tick--info {
    background: var(--color-primary);
}
.scrubber__handle {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid var(--color-primary);
    transform: translate(-50%, -50%);
    box-shadow:
        0 0 12px rgba(var(--color-primary-rgb), 0.6),
        0 2px 6px rgba(0, 0, 0, 0.5);
    cursor: grab;
    transition: transform 0.15s var(--ease-out-expo);
}
.scrubber__handle:hover {
    transform: translate(-50%, -50%) scale(1.15);
}
.scrubber__hint {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: var(--font-bold);
    flex-shrink: 0;
}
.scrubber__close {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: var(--type-caption);
    transition: all var(--duration-normal) var(--ease-out-expo);
    position: relative;
}
.scrubber__close::after {
    content: "";
    position: absolute;
    inset: -8px;
}
.scrubber__close:hover {
    color: var(--color-text-primary);
    background: rgba(var(--color-frost-rgb), 0.08);
}

.scrubber-enter-active,
.scrubber-leave-active {
    transition:
        opacity var(--duration-normal) var(--ease-out-expo),
        transform var(--duration-moderate) var(--ease-out-expo);
}
.scrubber-enter-from,
.scrubber-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
}
</style>

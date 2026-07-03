<template>
    <div class="pulse-strip" role="status" aria-label="Fleet pulse">
        <template v-for="(stat, index) in stats" :key="stat.id">
            <span v-if="index > 0" class="pulse-strip__sep" aria-hidden="true" />
            <span
                class="pulse-stat"
                :class="{
                    'pulse-stat--alert': stat.tone === 'alert',
                    'pulse-stat--solar': stat.tone === 'solar'
                }"
            >
                <span
                    v-if="stat.leading === 'live-dot'"
                    class="pulse-stat__live"
                    aria-hidden="true"
                />
                <span
                    v-else-if="stat.leading === 'icon' && stat.icon"
                    class="pulse-stat__ico"
                    :class="leadingClassFor(stat)"
                    aria-hidden="true"
                >
                    <i :class="['fas', stat.icon]" />
                </span>
                <span class="pulse-stat__v">
                    <TweenNumber :value="stat.value" :decimals="decimalsFor(stat)" />
                    <template v-if="stat.total !== undefined">
                        /<TweenNumber :value="stat.total" :decimals="decimalsFor(stat)" />
                    </template>
                    <span v-if="stat.unit" class="pulse-stat__unit">{{ stat.unit }}</span>
                </span>
                <span>{{ stat.label }}</span>
            </span>
        </template>
    </div>
</template>

<script setup lang="ts">
import TweenNumber from '@/components/core/TweenNumber.vue';

export type PulseTone = 'default' | 'alert' | 'solar';
export type PulseLeading = 'live-dot' | 'icon';

export interface PulseStat {
    id: string;
    label: string;
    value: number;
    total?: number;
    unit?: string;
    decimals?: number;
    leading?: PulseLeading;
    icon?: string;
    iconColor?: 'on' | 'warn' | 'off' | 'primary';
    tone?: PulseTone;
}

defineProps<{stats: readonly PulseStat[]}>();

function leadingClassFor(stat: PulseStat): string {
    return stat.iconColor ? `pulse-stat__ico--${stat.iconColor}` : '';
}

function decimalsFor(stat: PulseStat): number {
    return stat.decimals ?? 0;
}
</script>

<style scoped>
.pulse-strip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    height: 44px;
    padding: 0 var(--space-4);
    border-radius: 22px;
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    box-shadow: var(--shadow-lg);
}
.pulse-strip__sep {
    width: 1px;
    height: var(--space-4);
    background: var(--color-border-medium);
}
.pulse-stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    white-space: nowrap;
}
.pulse-stat__v {
    color: var(--color-text-primary);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
}
.pulse-stat__unit {
    margin-left: 2px;
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
}
.pulse-stat__ico {
    display: inline-flex;
    color: var(--color-text-quaternary);
    font-size: var(--type-caption);
}
.pulse-stat__ico--on { color: var(--color-status-on); }
.pulse-stat__ico--warn { color: var(--color-status-warn); }
.pulse-stat__ico--off { color: var(--color-status-off); }
.pulse-stat__ico--primary { color: var(--color-primary); }
.pulse-stat--alert .pulse-stat__v,
.pulse-stat--alert .pulse-stat__ico {
    color: var(--color-status-off);
}
.pulse-stat--alert .pulse-stat__ico {
    animation: blink-err 1.6s ease-in-out infinite;
}
.pulse-stat--solar .pulse-stat__v {
    color: var(--color-status-warn);
}
.pulse-stat__live {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-status-on);
    box-shadow: 0 0 6px var(--color-status-on);
    animation: blink-err 1.5s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
    .pulse-stat__live,
    .pulse-stat--alert .pulse-stat__ico {
        animation: none;
    }
}
</style>

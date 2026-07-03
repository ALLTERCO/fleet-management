<template>
    <div class="et-illum">
        <!-- Primary reading: lux (number) or illumination (string) -->
        <div v-if="lux !== null" class="et-illum__reading">
            <i class="fas fa-sun et-illum__icon" />
            <span class="et-illum__value">{{ lux.toFixed(0) }}</span>
            <span class="et-illum__unit">lux</span>
        </div>
        <div v-else-if="illumination" class="et-illum__state" :class="illumination === 'dark' ? 'et-illum__state--dark' : 'et-illum__state--bright'">
            <i :class="illumination === 'dark' ? 'fas fa-moon' : 'fas fa-sun'" />
            <span>{{ illumination.charAt(0).toUpperCase() + illumination.slice(1) }}</span>
        </div>

        <!-- Light level bar (lux mode only) -->
        <template v-if="lux !== null">
            <div class="et-illum__bar-track">
                <div class="et-illum__bar-fill" :style="{ width: barPercent + '%' }" />
            </div>
            <div class="et-illum__bar-labels">
                <span>Dark</span>
                <span>Bright</span>
            </div>
        </template>

        <!-- Extra metrics -->
        <div v-if="extras.length" class="et-illum__grid">
            <div v-for="m in extras" :key="m.label" class="et-illum__card">
                <span class="et-illum__card-value">{{ m.value }}</span>
                <span class="et-illum__card-label">{{ m.label }}</span>
            </div>
        </div>

        <!-- Settings (dark_thr, bright_thr) -->
        <div v-if="canExecute && shellyID && (settings?.dark_thr != null || settings?.bright_thr != null)" class="et-illum__section">
            <div class="et-illum__section-header" @click="showSettings = !showSettings">
                <i class="fas fa-gear" /> Thresholds
                <i class="fas" :class="showSettings ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showSettings">
                <div v-if="settings?.name != null" class="et-illum__row">
                    <span class="et-illum__label">Name</span>
                    <input type="text" class="et-illum__text" :value="settings.name" placeholder="Sensor name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})" />
                </div>
                <div v-if="settings?.dark_thr != null" class="et-illum__row">
                    <span class="et-illum__label">Dark threshold</span>
                    <input type="number" class="et-illum__num" :value="settings.dark_thr" min="0"
                        @change="(e: Event) => setConfig({dark_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-illum__unit-label">lux</span>
                </div>
                <div v-if="settings?.bright_thr != null" class="et-illum__row">
                    <span class="et-illum__label">Bright threshold</span>
                    <input type="number" class="et-illum__num" :value="settings.bright_thr" min="0"
                        @change="(e: Event) => setConfig({bright_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-illum__unit-label">lux</span>
                </div>
            </template>
        </div>

        <div v-if="configError" class="et-illum__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const configError = ref<string | null>(null);
const showSettings = ref(false);

const lux = computed(() => {
    const v = props.status?.lux;
    return typeof v === 'number' ? v : null;
});

const illumination = computed(() => {
    const v = props.status?.illumination;
    return typeof v === 'string' ? v : null;
});

const barPercent = computed(() => {
    if (lux.value === null || lux.value <= 0) return 0;
    const pct = (Math.log10(lux.value) / 4) * 100;
    return Math.min(100, Math.max(0, pct));
});

const SKIP_KEYS = new Set(['id', 'lux', 'illumination']);

const extras = computed(() => {
    const s = props.status;
    if (!s) return [];
    const out: {label: string; value: string}[] = [];
    for (const [k, v] of Object.entries(s)) {
        if (SKIP_KEYS.has(k)) continue;
        if (typeof v === 'number')
            out.push({
                label: k
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase()),
                value: String(v)
            });
        else if (typeof v === 'string' && v)
            out.push({
                label: k
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase()),
                value: v
            });
    }
    return out;
});

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Illuminance.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}
</script>

<style scoped>
.et-illum { display: flex; flex-direction: column; gap: var(--space-2); }
.et-illum__reading {
    display: flex; align-items: baseline; justify-content: center; gap: var(--space-2); padding: var(--space-3);
}
.et-illum__icon { font-size: var(--type-subheading); color: var(--color-warning-text); }
.et-illum__value { font-size: var(--type-subheading); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-illum__unit { font-size: var(--type-body); color: var(--color-text-tertiary); }
.et-illum__state {
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    padding: var(--space-3); border-radius: var(--radius-md); font-weight: var(--font-semibold); font-size: var(--type-body);
}
.et-illum__state--dark { background-color: var(--color-surface-3); color: var(--color-text-secondary); }
.et-illum__state--bright { background-color: var(--color-warning-subtle); color: var(--color-warning-text); }
.et-illum__bar-track { height: 6px; border-radius: var(--radius-xs); background-color: var(--color-surface-3); overflow: hidden; }
.et-illum__bar-fill { height: 100%; border-radius: var(--radius-xs); background: linear-gradient(90deg, var(--color-warning), var(--color-warning-text)); transition: width 0.3s ease; }
.et-illum__bar-labels { display: flex; justify-content: space-between; font-size: var(--type-body); color: var(--color-text-disabled); }
.et-illum__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: var(--space-1-5); }
.et-illum__card { display: flex; flex-direction: column; align-items: center; padding: var(--space-2); border-radius: var(--radius-md); background-color: var(--color-surface-2); }
.et-illum__card-value { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-illum__card-label { font-size: var(--type-body); color: var(--color-text-disabled); text-align: center; }
.et-illum__section {
    display: flex; flex-direction: column; gap: var(--space-1-5);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--space-2);
}
.et-illum__section-header {
    display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body);
    font-weight: var(--font-semibold); color: var(--color-text-tertiary); cursor: pointer; user-select: none;
}
.et-illum__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0; }
.et-illum__label { font-size: var(--type-body); color: var(--color-text-disabled); flex-shrink: 0; }
.et-illum__text {
    flex: 1; min-width: 0; font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-illum__text:focus { outline: none; border-color: var(--color-primary); }
.et-illum__num {
    width: 60px; padding: var(--space-1) var(--space-1-5); border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-3);
    color: var(--color-text-primary); font-size: var(--type-body); text-align: center;
}
.et-illum__unit-label { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-illum__error { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body); color: var(--color-danger-text); }
</style>

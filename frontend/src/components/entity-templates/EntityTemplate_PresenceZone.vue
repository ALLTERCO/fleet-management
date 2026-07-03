<template>
    <div class="et-pz">
        <!-- State -->
        <div class="et-pz__state" :class="isOccupied ? 'et-pz__state--occupied' : 'et-pz__state--empty'">
            <i :class="isOccupied ? 'fas fa-person' : 'fas fa-person-walking-dashed-line-arrow-right'" class="et-pz__state-icon" />
            <span>{{ isOccupied ? 'Occupied' : 'Empty' }}</span>
        </div>

        <!-- Object count -->
        <div v-if="status?.num_objects != null" class="et-pz__metric">
            <span class="et-pz__metric-value">{{ status.num_objects }}</span>
            <span class="et-pz__metric-label">object{{ status.num_objects !== 1 ? 's' : '' }} detected</span>
        </div>

        <!-- Mini radar map showing this zone -->
        <PresenceRadarMap
            v-if="zoneAreaSegments.length"
            :zones="[{id: zoneId, name: settings?.name, color: settings?.color, area: zoneAreaSegments, occupied: isOccupied, numObjects: status?.num_objects ?? 0}]"
            :highlight-zone-id="zoneId"
            :sensor-position="sensorPosition"
            compact
        />

        <!-- Settings -->
        <div v-if="canExecute && shellyID && settings" class="et-pz__section">
            <div class="et-pz__section-header" @click="showSettings = !showSettings">
                <i class="fas fa-gear" /> Settings
                <i class="fas" :class="showSettings ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showSettings">
                <div v-if="settings.name != null" class="et-pz__row">
                    <span class="et-pz__label">Name</span>
                    <input type="text" class="et-pz__text" :value="settings.name" placeholder="Zone name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})" />
                </div>
                <div v-if="settings.enable != null" class="et-pz__row">
                    <span class="et-pz__label">Enable</span>
                    <button class="et-pz__toggle" :class="settings.enable && 'et-pz__toggle--on'"
                        @click="setConfig({enable: !settings.enable})">
                        <i class="fas" :class="settings.enable ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <div v-if="settings.presence_thr != null || settings.presence_delay != null" class="et-pz__row">
                    <span class="et-pz__label">Presence threshold</span>
                    <input type="number" class="et-pz__num" :value="settings.presence_thr ?? settings.presence_delay ?? 0" min="0" max="3600" step="0.1"
                        @change="(e: Event) => setConfig({presence_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-pz__unit">sec</span>
                </div>
                <div v-if="settings.absence_thr != null || settings.absence_delay != null" class="et-pz__row">
                    <span class="et-pz__label">Absence threshold</span>
                    <input type="number" class="et-pz__num" :value="settings.absence_thr ?? settings.absence_delay ?? 0" min="0" max="3600" step="0.1"
                        @change="(e: Event) => setConfig({absence_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-pz__unit">sec</span>
                </div>
                <div v-if="settings.color" class="et-pz__row">
                    <span class="et-pz__label">Zone color</span>
                    <div class="et-pz__color-swatch" :style="{backgroundColor: `rgb(${settings.color.join(',')})`}" />
                    <input type="color" class="et-pz__color-input"
                        :value="rgbToHex(settings.color)"
                        @change="(e: Event) => setConfig({color: hexToRgb((e.target as HTMLInputElement).value)})" />
                </div>
            </template>
        </div>

        <!-- Zone area (raw coordinates, 1 tile = 0.5m) -->
        <div v-if="settings?.area?.length" class="et-pz__area">
            <span class="et-pz__area-label">Area (tiles, 0.5m each)</span>
            <div v-for="(seg, i) in settings.area" :key="i" class="et-pz__area-seg">
                [{{ seg.join(', ') }}]
            </div>
        </div>

        <!-- Delete zone -->
        <button
            v-if="canExecute && shellyID && !isMainZone"
            class="et-pz__delete"
            @click="deleteZone"
        >
            Delete Zone
        </button>

        <div v-if="configError" class="et-pz__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import PresenceRadarMap from '@/components/core/PresenceRadarMap.vue';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const deviceStore = useDevicesStore();
const configError = ref<string | null>(null);
const showSettings = ref(false);

const isOccupied = computed(() => props.status?.value === true);

const zoneId = computed(() => props.status?.id ?? props.settings?.id ?? 200);
const zoneAreaSegments = computed(() => props.settings?.area ?? []);
const device = computed(() =>
    props.shellyID ? deviceStore.devices[props.shellyID] : null
);
const presenceSettings = computed(() => {
    const s = device.value?.settings;
    return s?.['presence:0'] ?? s?.presence ?? null;
});
const sensorPosition = computed(
    () => presenceSettings.value?.sensor?.position ?? 'center'
);

const isMainZone = computed(() => {
    if (!props.shellyID) return true;
    const mainZone = presenceSettings.value?.main_zone;
    const myKey = `presencezone:${props.status?.id ?? 200}`;
    return mainZone === myKey || !mainZone;
});

async function deleteZone() {
    if (!props.shellyID) return;
    if (!window.confirm('Delete this zone? This cannot be undone.')) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.DeleteZone', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 200
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to delete zone';
    }
}

function rgbToHex(rgb: number[]): string {
    return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): number[] {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.Zone.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 200,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}
</script>

<style scoped>
.et-pz { display: flex; flex-direction: column; gap: var(--space-2); }
.et-pz__state {
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    padding: var(--space-3); border-radius: var(--radius-md);
    font-weight: var(--font-semibold); font-size: var(--type-body);
}
.et-pz__state--occupied { background-color: var(--color-warning-subtle); color: var(--color-warning-text); }
.et-pz__state--empty { background-color: var(--color-success-subtle); color: var(--color-success-text); }
.et-pz__state-icon { font-size: var(--type-subheading); }
.et-pz__metric {
    display: flex; align-items: center; justify-content: center; gap: var(--space-1-5);
    padding: var(--space-1-5); border-radius: var(--radius-md); background-color: var(--color-surface-2);
}
.et-pz__metric-value { font-size: var(--type-subheading); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-pz__metric-label { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-pz__section {
    display: flex; flex-direction: column; gap: var(--space-1-5);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--space-2);
}
.et-pz__section-header {
    display: flex; align-items: center; gap: var(--space-1-5);
    font-size: var(--type-body); font-weight: var(--font-semibold);
    color: var(--color-text-tertiary); cursor: pointer; user-select: none;
}
.et-pz__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0; }
.et-pz__label { font-size: var(--type-body); color: var(--color-text-disabled); flex-shrink: 0; }
.et-pz__text {
    flex: 1; min-width: 0; font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-pz__text:focus { outline: none; border-color: var(--color-primary); }
.et-pz__num {
    width: 60px; padding: var(--space-1) var(--space-1-5); border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-3);
    color: var(--color-text-primary); font-size: var(--type-body); text-align: center;
}
.et-pz__unit { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-pz__toggle { font-size: var(--type-subheading); color: var(--color-text-disabled); cursor: pointer; }
.et-pz__toggle--on { color: var(--color-success-text); }
.et-pz__color-swatch { width: 24px; height: 24px; border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); }
.et-pz__color-input { width: var(--touch-target-min); height: var(--touch-target-min); border: none; background: none; cursor: pointer; padding: 0; }
.et-pz__area { padding: var(--space-1-5) var(--space-2); border-radius: var(--radius-md); background-color: var(--color-surface-2); }
.et-pz__area-label { font-size: var(--type-body); color: var(--color-text-disabled); display: block; margin-bottom: var(--space-1); }
.et-pz__area-seg { font-size: var(--type-body); font-family: monospace; color: var(--color-text-tertiary); }
.et-pz__delete {
    display: flex; align-items: center; gap: var(--space-1); align-self: flex-start;
    padding: var(--space-1) 0.625rem; border-radius: var(--radius-sm);
    border: 1px solid var(--color-danger-text); background: transparent;
    color: var(--color-danger-text); font-size: var(--type-body); font-weight: var(--font-medium); cursor: pointer;
}
.et-pz__delete:hover { background-color: color-mix(in srgb, var(--color-danger) 10%, transparent); }
.et-pz__error { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body); color: var(--color-danger-text); }
</style>

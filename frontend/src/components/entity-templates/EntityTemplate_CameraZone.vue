<template>
    <div class="et-cz">
        <!-- Motion state -->
        <div class="et-cz__state" :class="hasMotion ? 'et-cz__state--motion' : 'et-cz__state--clear'">
            <i :class="hasMotion ? 'fas fa-person-walking' : 'fas fa-check-circle'" class="et-cz__state-icon" />
            <span>{{ hasMotion ? 'Motion Detected' : 'Clear' }}</span>
        </div>

        <!-- Settings -->
        <div v-if="canExecute && shellyID && settings" class="et-cz__section">
            <div class="et-cz__section-header" @click="showSettings = !showSettings">
                <i class="fas fa-gear" /> Settings
                <i class="fas" :class="showSettings ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showSettings">
                <div v-if="settings.name != null" class="et-cz__row">
                    <span class="et-cz__label">Name</span>
                    <input type="text" class="et-cz__text" :value="settings.name" placeholder="Zone name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})" />
                </div>
                <div v-if="settings.enable != null" class="et-cz__row">
                    <span class="et-cz__label">Enable</span>
                    <button class="et-cz__toggle" :class="settings.enable && 'et-cz__toggle--on'"
                        @click="setConfig({enable: !settings.enable})">
                        <i class="fas" :class="settings.enable ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <div v-if="settings.color" class="et-cz__row">
                    <span class="et-cz__label">Color</span>
                    <div class="et-cz__color-swatch" :style="{backgroundColor: `rgb(${settings.color.join(',')})`}" />
                    <input type="color" class="et-cz__color-input"
                        :value="rgbToHex(settings.color)"
                        @change="(e: Event) => setConfig({color: hexToRgb((e.target as HTMLInputElement).value)})" />
                </div>
            </template>
        </div>

        <!-- Zone coordinates -->
        <div v-if="settings?.coordinates?.length" class="et-cz__coords">
            <span class="et-cz__coords-label">Coordinates</span>
            <span class="et-cz__coords-value">[{{ settings.coordinates.join(', ') }}]</span>
        </div>

        <!-- Delete (non-main zones) -->
        <button v-if="canExecute && shellyID && (status?.id ?? 200) !== 200" class="et-cz__delete" @click="deleteZone">
            Delete Zone
        </button>

        <div v-if="configError" class="et-cz__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
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

const hasMotion = computed(() => props.status?.motion === true);

function rgbToHex(rgb: number[]): string {
    return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): number[] {
    return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16)
    ];
}

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.Zone.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 200,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}

async function deleteZone() {
    if (!props.shellyID) return;
    if (!window.confirm('Delete this detection zone?')) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.DeleteZone', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 200
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to delete zone';
    }
}
</script>

<style scoped>
.et-cz { display: flex; flex-direction: column; gap: var(--space-2); }
.et-cz__state {
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    padding: var(--space-3); border-radius: var(--radius-md);
    font-weight: var(--font-semibold); font-size: var(--type-body);
}
.et-cz__state--motion { background-color: var(--color-warning-subtle); color: var(--color-warning-text); }
.et-cz__state--clear { background-color: var(--color-success-subtle); color: var(--color-success-text); }
.et-cz__state-icon { font-size: var(--type-subheading); }
.et-cz__section {
    display: flex; flex-direction: column; gap: var(--space-1-5);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--space-2);
}
.et-cz__section-header {
    display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body);
    font-weight: var(--font-semibold); color: var(--color-text-tertiary); cursor: pointer; user-select: none;
}
.et-cz__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0; }
.et-cz__label { font-size: var(--type-body); color: var(--color-text-disabled); flex-shrink: 0; }
.et-cz__text {
    flex: 1; min-width: 0; font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-cz__text:focus { outline: none; border-color: var(--color-primary); }
.et-cz__toggle { font-size: var(--type-subheading); color: var(--color-text-disabled); cursor: pointer; }
.et-cz__toggle--on { color: var(--color-success-text); }
.et-cz__color-swatch { width: 24px; height: 24px; border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); }
.et-cz__color-input { width: var(--touch-target-min); height: var(--touch-target-min); border: none; background: none; cursor: pointer; padding: 0; }
.et-cz__coords { padding: var(--space-1-5) var(--space-2); border-radius: var(--radius-md); background-color: var(--color-surface-2); }
.et-cz__coords-label { font-size: var(--type-body); color: var(--color-text-disabled); display: block; margin-bottom: var(--space-0-5); }
.et-cz__coords-value { font-size: var(--type-body); font-family: monospace; color: var(--color-text-tertiary); }
.et-cz__delete {
    display: flex; align-items: center; gap: var(--space-1); align-self: flex-start;
    padding: var(--space-1) 0.625rem; border-radius: var(--radius-sm);
    border: 1px solid var(--color-danger-text); background: transparent;
    color: var(--color-danger-text); font-size: var(--type-body); font-weight: var(--font-medium); cursor: pointer;
}
.et-cz__delete:hover { background-color: color-mix(in srgb, var(--color-danger) 10%, transparent); }
.et-cz__error { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body); color: var(--color-danger-text); }
</style>

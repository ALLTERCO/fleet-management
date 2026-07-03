<template>
    <Input
        v-model="searchModel"
        class="wiz-search-input"
        placeholder="Search devices..."
    />
    <div v-if="filteredDevices.length > 0" class="cat-grid">
        <div
            v-for="dev in filteredDevices"
            :key="dev.shellyID"
            class="cat-dc"
            :class="{checked: isSelected(dev.shellyID)}"
            :style="accentVarStyle(dev.shellyID)"
            @click="toggleDevice(dev.shellyID)"
        >
            <div v-if="isSelected(dev.shellyID)" class="awm-dev-check">
                <i class="fas fa-check" />
            </div>
            <div
                class="cat-dc-bar"
                :style="{background: gradientFor(dev)}"
            />
            <div class="cat-dc-head">
                <span class="cat-dc-type">
                    {{ deviceMeta[dev.shellyID]?.label ?? 'DEVICE' }}
                </span>
                <div
                    class="cat-dc-dot"
                    :class="dev.online ? 'on' : 'off'"
                />
            </div>
            <div
                class="cat-dc-img"
                :class="{'cat-dc-img--off': !dev.online}"
            >
                <img
                    :src="getLogo(dev)"
                    :alt="dev.info?.model || 'Device'"
                    @error="handleDeviceImgError($event, dev.info?.model)"
                />
            </div>
            <div class="cat-dc-name">
                {{ getDeviceName(dev.info, dev.shellyID) }}
            </div>
        </div>
    </div>
    <div v-if="selected.length > 0" class="awm-sel-bar">
        <span class="sel-count">
            {{ selected.length }} device{{ selected.length > 1 ? 's' : '' }} selected
        </span>
    </div>
    <div v-if="filteredDevices.length === 0" class="awm-empty">
        <i class="fas fa-microchip" />
        <span>No devices found</span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';
import {devAccentGradient, useDeviceMeta} from '@/composables/useDeviceMeta';
import {
    getDeviceName,
    getLogo,
    handleDeviceImgError,
    isDiscovered
} from '@/helpers/device';
import {DEFAULT_ACCENT_RGB} from '@/helpers/widgetCatalog';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import type {shelly_device_t} from '@/types';

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const {deviceMeta} = useDeviceMeta();

const props = defineProps<{selected: string[]}>();
const searchModel = defineModel<string>('search', {required: true});
const emit = defineEmits<{'update:selected': [ids: string[]]}>();

function isSelected(shellyID: string): boolean {
    return props.selected.includes(shellyID);
}

function toggleDevice(shellyID: string): void {
    const next = isSelected(shellyID)
        ? props.selected.filter((id) => id !== shellyID)
        : [...props.selected, shellyID];
    emit('update:selected', next);
}

function accentVarStyle(shellyID: string): Record<string, string> {
    return {
        '--dev-accent':
            deviceMeta.value[shellyID]?.accentRgb ?? DEFAULT_ACCENT_RGB
    };
}

function gradientFor(dev: shelly_device_t): string {
    const rgb = deviceMeta.value[dev.shellyID]?.accentRgb ?? DEFAULT_ACCENT_RGB;
    return devAccentGradient({accentRgb: rgb, online: dev.online});
}

// Filter by device name OR by any owned entity name. Online first then
// alphabetical so the most-actionable devices surface to the top of the
// grid.
const filteredDevices = computed(() => {
    const all = Object.values(deviceStore.devices).filter(
        (d) => !isDiscovered(d.shellyID)
    );
    const q = searchModel.value.toLowerCase().trim();
    const filtered =
        q.length < 2
            ? all
            : all.filter((d) => {
                  const name = getDeviceName(d.info, d.shellyID).toLowerCase();
                  if (name.includes(q)) return true;
                  return Object.values(entityStore.entities).some(
                      (e) =>
                          e.source === d.shellyID &&
                          e.name.toLowerCase().includes(q)
                  );
              });

    return filtered.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return getDeviceName(a.info, a.shellyID).localeCompare(
            getDeviceName(b.info, b.shellyID)
        );
    });
});
</script>

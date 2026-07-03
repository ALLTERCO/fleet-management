<template>
    <div v-if="allEntities.length > 0" class="awm-stage2-bar">
        <label class="awm-comp awm-comp--all">
            <input
                type="checkbox"
                name="select-all-global"
                class="awm-check"
                :checked="
                    selected.length === allEntities.length &&
                    allEntities.length > 0
                "
                @change="toggleAllGlobal"
            />
            <span class="awm-comp-all-label">
                Select all ({{ allEntities.length }})
            </span>
        </label>
        <span v-if="selected.length > 0" class="sel-count">
            {{ selected.length }} selected
        </span>
    </div>

    <div class="awm-groups">
        <div
            v-for="group in groupedEntities"
            :key="group.device.shellyID"
            class="awm-device-group"
        >
            <div class="awm-group-hdr">
                <img
                    :src="getLogo(group.device)"
                    class="awm-group-img"
                    :alt="group.device.info?.model || 'Device'"
                    @error="handleDeviceImgError($event, group.device.info?.model)"
                />
                <span class="awm-group-name">
                    {{ getDeviceName(group.device.info, group.device.shellyID) }}
                </span>
                <label class="awm-group-all" @click.stop>
                    <input
                        type="checkbox"
                        name="select-all-device"
                        class="awm-check"
                        :checked="isDeviceFullySelected(group.device.shellyID)"
                        @change="toggleAllForDevice(group.device.shellyID)"
                    />
                    <span class="awm-group-all-label">All</span>
                </label>
            </div>

            <div class="awm-comp-list">
                <label
                    v-for="ent in group.entities"
                    :key="ent.id"
                    class="awm-comp"
                    :class="{'awm-comp--sel': selected.includes(ent.id)}"
                >
                    <input
                        type="checkbox"
                        name="entity-select"
                        class="awm-check"
                        :checked="selected.includes(ent.id)"
                        @change="toggleEntity(ent.id)"
                    />
                    <i
                        :class="getEntityIcon(ent.type, ent.properties)"
                        class="awm-comp-icon"
                    />
                    <span class="awm-comp-name">{{ ent.name }}</span>
                    <span class="awm-comp-type">{{ ent.type }}</span>
                </label>
            </div>
        </div>
    </div>

    <div v-if="allEntities.length === 0" class="awm-empty">
        <i class="fas fa-puzzle-piece" />
        <span>No components found</span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {getEntityIcon} from '@/config/entity-registry';
import {
    getDeviceName,
    getLogo,
    handleDeviceImgError
} from '@/helpers/device';
import type {entity_t, shelly_device_t} from '@/types';

const props = defineProps<{
    groupedEntities: Array<{device: shelly_device_t; entities: entity_t[]}>;
    selected: string[];
}>();
const emit = defineEmits<{'update:selected': [ids: string[]]}>();

// Flat list across every selected device so the global "Select all"
// can use a single length comparison.
const allEntities = computed(() =>
    props.groupedEntities.flatMap((g) => g.entities)
);

function toggleEntity(id: string): void {
    const next = props.selected.includes(id)
        ? props.selected.filter((x) => x !== id)
        : [...props.selected, id];
    emit('update:selected', next);
}

function isDeviceFullySelected(shellyID: string): boolean {
    const group = props.groupedEntities.find(
        (g) => g.device.shellyID === shellyID
    );
    if (!group || group.entities.length === 0) return false;
    return group.entities.every((e) => props.selected.includes(e.id));
}

function toggleAllForDevice(shellyID: string): void {
    const group = props.groupedEntities.find(
        (g) => g.device.shellyID === shellyID
    );
    if (!group) return;
    const deviceIds = group.entities.map((e) => e.id);
    if (isDeviceFullySelected(shellyID)) {
        emit('update:selected', props.selected.filter((id) => !deviceIds.includes(id)));
        return;
    }
    const fresh = deviceIds.filter((id) => !props.selected.includes(id));
    emit('update:selected', [...props.selected, ...fresh]);
}

function toggleAllGlobal(): void {
    const allIds = allEntities.value.map((e) => e.id);
    emit(
        'update:selected',
        props.selected.length === allIds.length ? [] : [...allIds]
    );
}
</script>

<template>
    <CardShell
        type="input"
        :name="entity.name"
        icon="fas fa-object-group"
        :size="size"
        :is-offline="isOffline"
        :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')"
        @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vg">
                <!-- The composite control lives in the entity template. -->
                <EntityTemplate_Group
                    :status="status"
                    :settings="settings"
                    :can-execute="canExecute"
                    :source="entity.source"
                    :members="members"
                />
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import EntityTemplate_Group from '@/components/entity-templates/EntityTemplate_Group.vue';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {virtual_group_entity} from '@/types';

const props = withDefaults(
    defineProps<{
        entity: virtual_group_entity;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const statusKey = computed(
    () => `group:${props.entity.properties.id}`
);

const status = computed(
    () => deviceStore.statusOf(props.entity.source, statusKey.value) ?? undefined
);

const settings = computed(
    () => device.value?.settings?.[statusKey.value] ?? undefined
);

const members = computed(() => props.entity.properties.members);
</script>

<style scoped>
.vg {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    gap: var(--space-2);
    overflow-y: auto;
}
</style>

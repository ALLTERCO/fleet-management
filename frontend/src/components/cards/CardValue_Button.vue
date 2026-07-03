<template>
    <!-- 1×1: 2-button pad -->
    <CardShell
        v-if="size === '1x1'"
        type="button"
        :name="entity.name"
        icon="fas fa-circle-dot"
        size="1x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-vpad ec-vpad--2x1">
                <button
                    class="ec-vbtn ec-vbtn--accent-blue"
                    :disabled="!canExecute"
                    @click.stop="press"
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-hand-pointer" /></div>
                    <div class="ec-vbtn-label">Press</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: 4-button pad -->
    <CardShell
        v-else-if="size === '2x1'"
        type="button"
        :name="entity.name"
        icon="fas fa-circle-dot"
        size="2x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-vpad ec-vpad--2x2">
                <button
                    class="ec-vbtn ec-vbtn--accent-blue"
                    :disabled="!canExecute"
                    @click.stop="press"
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-hand-pointer" /></div>
                    <div class="ec-vbtn-label">Press</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: 6-button pad -->
    <CardShell
        v-else
        type="button"
        :name="entity.name"
        icon="fas fa-circle-dot"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-vpad ec-vpad--3x2">
                <button
                    class="ec-vbtn ec-vbtn--accent-blue"
                    :disabled="!canExecute"
                    @click.stop="press"
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-hand-pointer" /></div>
                    <div class="ec-vbtn-label">Press</div>
                    <div class="ec-vbtn-src">{{ entity.source }}</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
                <button
                    class="ec-vbtn ec-vbtn--add ec-vbtn--accent-muted"
                    disabled
                >
                    <div class="ec-vbtn-icon"><i class="fas fa-plus" /></div>
                    <div class="ec-vbtn-label">Add</div>
                </button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
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
const rpc = useCardRpc();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

function press() {
    rpc.invokeAction(props.entity.id, 'press');
}
</script>

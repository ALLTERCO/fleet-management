<template>
    <div>
        <!-- Show position slider for covers or message for calibration -->
        <HorizontalSlider v-if="calibrated" :value="position" :saved="saved" @change="setPosition">
            <template #title> Position ({{ position }}%) </template>
        </HorizontalSlider>
        <p v-if="!calibrated" class="text-center font-semibold text-[var(--color-danger-text)]">
            Calibrate the device to have position control
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, toRefs} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';

const props = defineProps<{
    position: number;
    calibrated: boolean;
    favorites: number[];
}>();
const {position, calibrated, favorites} = toRefs(props);
const emit = defineEmits<{
    change: [value: number];
}>();

const saved = computed(() => {
    if (favorites.value.length === 0) {
        return null;
    }

    return Object.fromEntries(
        favorites.value.map((value) => [`${String(value)}%`, value])
    );
});

function setPosition(value: number) {
    emit('change', value);
}
</script>

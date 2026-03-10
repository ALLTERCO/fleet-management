<template>
    <div>
        <div class="w-full flex flex-row gap-2 text-center">
            <div
                v-for="(_, id) in Array(steps)"
                :key="id"
                class="flex-1 hover:cursor-pointer"
                @click="emit('click', id + 1)"
            >
                <slot :id="id + 1" name="stepTitle">
                    <span
                        class="font-semibold"
                        :class="{
                            'step-inactive': current != id + 1,
                        }"
                    >
                        Step {{ id + 1 }}
                    </span>
                </slot>
                <div
                    class="w-full h-2 rounded-lg mt-1"
                    :class="{
                        'step-bar--active': current == id + 1,
                        'step-bar--inactive': current != id + 1,
                    }"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {toRef} from 'vue';

const props = defineProps<{
    steps: number;
    current: number;
}>();

const steps = toRef(props, 'steps');

const emit = defineEmits<{
    click: [number];
}>();
</script>

<style scoped>
.step-inactive {
    color: var(--color-text-disabled);
}
.step-bar--active {
    background-color: var(--color-primary);
    box-shadow: 0 0 20px var(--color-primary);
}
.step-bar--inactive {
    background-color: var(--color-surface-4);
}
</style>

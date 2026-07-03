<template>
    <textarea
        ref="el"
        v-model="model"
        class="core-input textarea-autogrow border text-base rounded-lg block w-full p-2"
        rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        :maxlength="maxlength"
        @input="resize"
    />
</template>

<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from 'vue';

const model = defineModel<string>();
defineProps<{placeholder?: string; disabled?: boolean; maxlength?: number}>();

const el = ref<HTMLTextAreaElement | null>(null);

function resize(): void {
    const node = el.value;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
}

watch(model, () => nextTick(resize));
onMounted(resize);
</script>

<style scoped>
.textarea-autogrow {
    resize: none;
    overflow: hidden;
}
</style>

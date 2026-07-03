<template>
    <div class="apf">
        <Button type="white" size="sm" @click="pickerVisible = true">
            <i class="fas fa-images" aria-hidden="true" />
            {{ buttonLabel }}
        </Button>
        <AssetPickerModal
            v-if="pickerVisible"
            :visible="pickerVisible"
            :initial-selected-asset-id="modelValue"
            :allow-clear="!!modelValue"
            :default-context="context"
            :allow-icons="false"
            @close="pickerVisible = false"
            @select-asset="onSelect"
            @clear-asset="onClear"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import type {VisualAsset} from '@/api/assetRpc';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import Button from './Button.vue';

const props = defineProps<{
    modelValue: string | null;
    pickLabel?: string;
    replaceLabel?: string;
    context?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string | null];
}>();

const pickerVisible = ref(false);

const buttonLabel = computed(() =>
    props.modelValue
        ? (props.replaceLabel ?? 'Replace image from library')
        : (props.pickLabel ?? 'Pick image from library')
);

function onSelect(asset: VisualAsset): void {
    emit('update:modelValue', asset.id);
}

function onClear(): void {
    emit('update:modelValue', null);
}
</script>

<style scoped>
.apf {
    display: flex;
}
</style>

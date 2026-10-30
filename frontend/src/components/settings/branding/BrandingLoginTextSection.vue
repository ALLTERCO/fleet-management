<template>
    <BasicBlock darker title="Login screen text (per language)">
        <div class="br-form">
            <label>
                Language
                <input v-model="languageModel" type="text" placeholder="en" />
            </label>
            <button
                type="button"
                class="br-btn"
                :disabled="busy"
                @click="$emit('load')"
            >
                Load
            </button>
        </div>
        <textarea
            v-if="loaded"
            v-model="rawModel"
            class="br-textarea"
            rows="10"
            spellcheck="false"
        ></textarea>
        <div v-if="loaded" class="br-actions">
            <button
                type="button"
                class="br-btn"
                :disabled="busy"
                @click="$emit('save')"
            >
                Save
            </button>
            <button
                type="button"
                class="br-btn br-btn--danger"
                :disabled="busy"
                @click="$emit('reset')"
            >
                Reset
            </button>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';

defineProps<{
    loaded: boolean;
    busy: boolean;
}>();

const languageModel = defineModel<string>('language', {required: true});
const rawModel = defineModel<string>('raw', {required: true});

defineEmits<{load: []; save: []; reset: []}>();
</script>

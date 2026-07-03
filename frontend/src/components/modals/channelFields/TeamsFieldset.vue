<template>
    <div class="cfs">
        <FormField label="Teams workflow URL" :error="visibleErrors.url">
            <input
                v-model.trim="form.url"
                type="url"
                autocomplete="off"
                class="cfs__input"
                placeholder="https://prod-…logic.azure.com/workflows/…"
            />
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface TeamsFieldsetForm {
    url: string;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<TeamsFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

<template>
    <div class="cfs">
        <FormField label="Webhook URL" :error="visibleErrors.url">
            <input
                v-model.trim="form.url"
                type="url"
                autocomplete="off"
                class="cfs__input"
                placeholder="https://example.com/incoming"
            />
        </FormField>

        <FormField label="Signing secret (optional)">
            <input
                v-model="form.signingSecret"
                type="password"
                autocomplete="new-password"
                class="cfs__input"
            />
        </FormField>

        <FormField
            label="Timeout (ms)"
            :error="visibleErrors.timeoutMs"
            hint="Between 1000 and 60000."
        >
            <input
                v-model.number="form.timeoutMs"
                type="number"
                min="1000"
                max="60000"
                autocomplete="off"
                class="cfs__input"
            />
        </FormField>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface WebhookFieldsetForm {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<WebhookFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

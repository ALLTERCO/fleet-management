<template>
    <div class="cfs">
        <FormField label="Recipient (E.164)" :error="visibleErrors.to">
            <input
                v-model.trim="form.to"
                type="tel"
                autocomplete="off"
                class="cfs__input"
                placeholder="+15555550100"
            />
        </FormField>

        <FormField label="Twilio sender (E.164)" :error="visibleErrors.from">
            <input
                v-model.trim="form.from"
                type="tel"
                autocomplete="off"
                class="cfs__input"
                placeholder="+15555550199"
            />
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface SmsTwilioFieldsetForm {
    to: string;
    from: string;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<SmsTwilioFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

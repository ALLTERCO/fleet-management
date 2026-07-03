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

        <FormField label="Twilio caller (E.164)" :error="visibleErrors.from">
            <input
                v-model.trim="form.from"
                type="tel"
                autocomplete="off"
                class="cfs__input"
                placeholder="+15555550199"
            />
        </FormField>

        <FormField label="TwiML URL" :error="visibleErrors.twimlUrl">
            <input
                v-model.trim="form.twimlUrl"
                type="url"
                autocomplete="off"
                class="cfs__input"
                placeholder="https://your-studio-flow.twil.io/voice"
            />
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface VoiceTwilioFieldsetForm {
    to: string;
    from: string;
    twimlUrl: string;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<VoiceTwilioFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

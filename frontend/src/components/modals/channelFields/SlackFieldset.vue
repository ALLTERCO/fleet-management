<template>
    <div class="cfs">
        <FormField label="Slack webhook URL" :error="visibleErrors.url">
            <input
                v-model.trim="form.url"
                type="url"
                autocomplete="off"
                class="cfs__input"
                placeholder="https://hooks.slack.com/services/…"
            />
        </FormField>

        <FormField label="Channel override (optional)">
            <input
                v-model.trim="form.channelOverride"
                type="text"
                autocomplete="off"
                class="cfs__input"
                placeholder="#alerts"
            />
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface SlackFieldsetForm {
    url: string;
    channelOverride: string;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<SlackFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

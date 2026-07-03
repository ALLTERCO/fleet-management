<template>
    <div class="cfs">
        <FormField label="URL" :error="visibleErrors.url">
            <input
                v-model.trim="form.url"
                type="url"
                autocomplete="off"
                class="cfs__input"
                placeholder="https://your-receiver.example.com/alerts"
            />
        </FormField>

        <FormField label="HMAC secret" :error="visibleErrors.signingSecret">
            <div class="cfs__secret-row">
                <input
                    v-model="form.signingSecret"
                    :type="secretVisible ? 'text' : 'password'"
                    autocomplete="new-password"
                    class="cfs__input cfs__input--mono"
                    placeholder="At least 32 characters of entropy"
                />
                <button
                    type="button"
                    class="cfs__icon-btn"
                    :title="secretVisible ? 'Hide secret' : 'Show secret'"
                    @click="toggleSecretVisibility"
                >
                    <i :class="['fas', secretVisible ? 'fa-eye-slash' : 'fa-eye']" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    class="cfs__icon-btn"
                    title="Generate a fresh 32-byte secret"
                    @click="regenerateAndReveal"
                >
                    <i class="fas fa-shuffle" aria-hidden="true" />
                </button>
            </div>
        </FormField>

        <FormField label="Timeout (ms)" :error="visibleErrors.timeoutMs">
            <input
                v-model.number="form.timeoutMs"
                type="number"
                min="1000"
                max="60000"
                step="500"
                class="cfs__input"
            />
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';
import {generateHmacSecret} from '@/helpers/randomSecret';

export interface WebhookSignedFieldsetForm {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<WebhookSignedFieldsetForm>({required: true});
const secretVisible = ref(false);

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);

function regenerateAndReveal(): void {
    replaceSigningSecret(generateHmacSecret());
    revealSecret();
}

function replaceSigningSecret(value: string): void {
    form.value = {...form.value, signingSecret: value};
}

function revealSecret(): void {
    secretVisible.value = true;
}

function toggleSecretVisibility(): void {
    secretVisible.value = !secretVisible.value;
}
</script>

<style src="./channelFieldset.css"></style>

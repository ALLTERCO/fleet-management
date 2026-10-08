<template>
    <div class="cfs">
        <FormField label="Bot token" :error="visibleErrors.botToken">
            <input
                v-model.trim="form.botToken"
                type="password"
                autocomplete="new-password"
                class="cfs__input"
                :placeholder="botTokenPlaceholder"
            />
        </FormField>

        <FormField label="Chat ID" :error="visibleErrors.chatId">
            <input
                v-model.trim="form.chatId"
                type="text"
                autocomplete="off"
                class="cfs__input"
                placeholder="-100123456789"
            />
        </FormField>

        <FormField label="Parse mode (optional)">
            <select v-model="form.parseMode" class="cfs__input">
                <option value="">Plain text</option>
                <option value="MarkdownV2">MarkdownV2</option>
                <option value="HTML">HTML</option>
            </select>
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export interface TelegramFieldsetForm {
    botToken: string;
    chatId: string;
    parseMode: '' | 'MarkdownV2' | 'HTML';
}

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
    /** Masked stored secrets from Channel.Get, keyed by config path. */
    maskedFields?: Record<string, string>;
}>();

// A stored secret is never sent back; say so instead of showing an empty
// field that looks like it was lost.
const botTokenPlaceholder = computed(() =>
    props.maskedFields?.botToken ? 'Unchanged' : '123456789:ABCdef…'
);

const form = defineModel<TelegramFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

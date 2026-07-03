<template>
    <div class="cfs">
        <FormField label="Bot token" :error="visibleErrors.botToken">
            <input
                v-model="form.botToken"
                type="password"
                autocomplete="new-password"
                class="cfs__input"
                placeholder="123456789:ABCdef…"
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
}>();

const form = defineModel<TelegramFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);
</script>

<style src="./channelFieldset.css"></style>

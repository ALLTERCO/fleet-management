<template>
    <BasicBlock darker title="Email message text (per type+language)">
        <div class="br-form">
            <label>
                Type
                <select v-model="typeModel">
                    <option value="passwordreset">passwordreset</option>
                    <option value="verifyemail">verifyemail</option>
                    <option value="invite_user">invite_user</option>
                    <option value="password_change">password_change</option>
                </select>
            </label>
            <label>
                Language
                <input
                    v-model="languageModel"
                    type="text"
                    placeholder="en"
                />
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

        <!-- Structured form per Zitadel message_text fields. Placeholders
             below each field list Go-template vars Zitadel substitutes
             when sending the email. -->
        <div v-if="loaded" class="br-msg-form">
            <label
                v-for="field in fields"
                :key="field.key"
                class="br-msg-field"
            >
                <span class="br-msg-label">{{ field.label }}</span>
                <textarea
                    v-if="field.multiline"
                    v-model="draftModel[field.key]"
                    class="br-textarea"
                    rows="6"
                ></textarea>
                <input
                    v-else
                    v-model="draftModel[field.key]"
                    type="text"
                    class="br-msg-input"
                />
                <span
                    v-if="field.placeholders.length"
                    class="br-msg-hint"
                >
                    Placeholders: {{ field.placeholders.join(', ') }}
                </span>
            </label>
        </div>

        <p class="br-msg-foot-hint">
            Empty fields fall back to Zitadel's built-in text.
        </p>
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
import type {MessageTextField} from '@/helpers/zitadelMessageText';

defineProps<{
    fields: readonly MessageTextField[];
    loaded: boolean;
    busy: boolean;
}>();

const typeModel = defineModel<string>('type', {required: true});
const languageModel = defineModel<string>('language', {required: true});
const draftModel = defineModel<Record<string, string>>('draft', {required: true});

defineEmits<{load: []; save: []; reset: []}>();
</script>

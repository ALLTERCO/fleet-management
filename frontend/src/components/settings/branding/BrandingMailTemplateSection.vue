<template>
    <BasicBlock darker title="Custom email HTML template (advanced)">
        <p class="br-hint">
            Replace Zitadel's default email scaffold with your own HTML. Use
            Go-template placeholders
            <span v-pre>({{.Title}}, {{.Greeting}}, {{.Text}}, {{.URL}}, {{.ButtonText}}, {{.PrimaryColor}}, {{.LogoURL}}, {{.FooterText}})</span>.
            Reset to fall back to the built-in template.
        </p>
        <div class="br-actions">
            <button
                type="button"
                class="br-btn"
                :disabled="busy"
                @click="$emit('load')"
            >
                Load
            </button>
            <span v-if="isDefault" class="br-msg-hint">
                Currently using Zitadel default.
            </span>
        </div>
        <RichTextEditor
            v-if="templateModel !== null"
            v-model="templateModel"
            :tokens="ZITADEL_EMAIL_TOKENS"
            placeholder="Paste your email template HTML…"
        />
        <div v-if="templateModel !== null" class="br-actions">
            <button
                type="button"
                class="br-btn"
                :disabled="busy || empty"
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
                Reset to default
            </button>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';
import RichTextEditor from '@/components/core/RichTextEditor.vue';
import {ZITADEL_EMAIL_TOKENS} from '@/helpers/zitadelEmailTokens';

defineProps<{
    isDefault: boolean;
    empty: boolean;
    busy: boolean;
}>();

// Tiptap binds to the string|null directly so the parent's mailTemplate
// ref hydrates through the v-model on first load.
const templateModel = defineModel<string | null>('template', {required: true});

defineEmits<{load: []; save: []; reset: []}>();
</script>

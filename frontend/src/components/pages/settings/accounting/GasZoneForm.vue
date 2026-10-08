<template>
    <form class="ua-editor" @submit.prevent="emit('submit')">
        <div class="ua-editor__head">
            <div>
                <h3>Upsert pricing zone</h3>
                <p>The external code identifies the zone across revisions.</p>
            </div>
            <button
                type="button"
                class="ua-icon-button"
                aria-label="Close zone form"
                @click="emit('cancel')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
        <div class="ua-form-grid">
            <FormField label="Name">
                <Input v-model="draft.name" :maxlength="120" required />
            </FormField>
            <FormField label="Zone kind" hint="Letters, numbers, underscore, and hyphen.">
                <Input
                    v-model="draft.zoneKind"
                    :maxlength="64"
                    required
                    :spellcheck="false"
                />
            </FormField>
            <FormField label="External code">
                <Input
                    v-model="draft.externalCode"
                    :maxlength="120"
                    required
                    :spellcheck="false"
                />
            </FormField>
            <FormField label="IANA timezone">
                <Input
                    v-model="draft.timezone"
                    :maxlength="64"
                    required
                    placeholder="America/New_York"
                    :spellcheck="false"
                />
            </FormField>
            <FormField field-id="gas-zone-day-boundary" label="Gas-day boundary">
                <input
                    id="gas-zone-day-boundary"
                    v-model="draft.dayBoundary"
                    class="ua-input"
                    type="time"
                    step="1"
                    required
                />
            </FormField>
        </div>
        <EditorFooter
            :error="error"
            :saving="saving"
            save-label="Save zone"
            @cancel="emit('cancel')"
        />
    </form>
</template>

<script setup lang="ts">
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import type {GasZoneDraft} from './gasConversion';
import {EditorFooter} from './gasEditorChrome';

// The panel owns the draft: a closed editor must keep what was typed.
defineProps<{draft: GasZoneDraft; error: string; saving: boolean}>();
const emit = defineEmits<{submit: []; cancel: []}>();
</script>

<template>
    <form class="ua-editor" @submit.prevent="emit('submit')">
        <div class="ua-editor__head">
            <div>
                <h3>Add calorific-value revision</h3>
                <p>Record the published value for one zone and gas day.</p>
            </div>
            <button
                type="button"
                class="ua-icon-button"
                aria-label="Close calorific value form"
                @click="emit('cancel')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
        <div class="ua-form-grid">
            <FormField field-id="gas-value-pricing-zone" label="Pricing zone">
                <select
                    id="gas-value-pricing-zone"
                    v-model.number="draft.pricingZoneId"
                    class="ua-select"
                    required
                >
                    <option :value="0" disabled>Select zone</option>
                    <option v-for="zone in zones" :key="zone.id" :value="zone.id">
                        {{ zone.name }} · {{ zone.externalCode }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="gas-value-day" label="Gas day">
                <input
                    id="gas-value-day"
                    v-model="draft.gasDay"
                    class="ua-input"
                    type="date"
                    required
                />
            </FormField>
            <FormField field-id="gas-value-amount" label="Published value">
                <input
                    id="gas-value-amount"
                    v-model="draft.value"
                    class="ua-input"
                    type="number"
                    min="0"
                    step="any"
                    required
                />
            </FormField>
            <FormField field-id="gas-value-unit" label="Unit">
                <select id="gas-value-unit" v-model="draft.unit" class="ua-select">
                    <option value="MJ/m3">MJ/m³</option>
                    <option value="kWh/m3">kWh/m³</option>
                </select>
            </FormField>
            <FormField field-id="gas-value-weighting" label="Weighting">
                <select
                    id="gas-value-weighting"
                    v-model="draft.weighting"
                    class="ua-select"
                >
                    <option value="none">None</option>
                    <option value="quantity">Quantity weighted</option>
                </select>
            </FormField>
            <FormField field-id="gas-value-rounding" label="Rounding">
                <select
                    id="gas-value-rounding"
                    v-model="draft.roundingRule"
                    class="ua-select"
                >
                    <option value="none">None</option>
                    <option value="truncate_0_1">Truncate to 0.1</option>
                </select>
            </FormField>
            <FormField label="Revision">
                <Input v-model="draft.revision" type="number" :min="1" required />
            </FormField>
            <FormField field-id="gas-value-published-at" label="Published at">
                <input
                    id="gas-value-published-at"
                    v-model="draft.publishedAt"
                    class="ua-input"
                    type="datetime-local"
                    required
                />
            </FormField>
            <FormField label="Source reference">
                <Input v-model="draft.sourceReference" :maxlength="500" required />
            </FormField>
        </div>
        <EditorFooter
            :error="error"
            :saving="saving"
            save-label="Save value"
            @cancel="emit('cancel')"
        />
    </form>
</template>

<script setup lang="ts">
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import type {GasCalorificValueDraft, GasZone} from './gasConversion';
import {EditorFooter} from './gasEditorChrome';

// The panel owns the draft: a closed editor must keep what was typed.
defineProps<{
    draft: GasCalorificValueDraft;
    zones: GasZone[];
    error: string;
    saving: boolean;
}>();
const emit = defineEmits<{submit: []; cancel: []}>();
</script>

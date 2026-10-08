<template>
    <form class="ua-editor" @submit.prevent="emit('submit')">
        <div class="ua-editor__head">
            <div>
                <h3>Add conversion profile revision</h3>
                <p>
                    A profile binds one meter channel to a pricing zone and explicit conversion
                    rules.
                </p>
            </div>
            <button
                type="button"
                class="ua-icon-button"
                aria-label="Close profile form"
                @click="emit('cancel')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
        <div class="ua-form-grid">
            <FormField field-id="gas-profile-device" label="Device / meter">
                <select
                    id="gas-profile-device"
                    v-model="draft.deviceExternalId"
                    class="ua-select"
                    required
                >
                    <option value="" disabled>Select device</option>
                    <option
                        v-for="device in devices"
                        :key="device.shellyID"
                        :value="device.shellyID"
                    >
                        {{ gasDeviceLabel(device) }} · {{ device.shellyID }}
                    </option>
                </select>
            </FormField>
            <FormField
                field-id="gas-profile-channel"
                label="Channel"
                optional
                hint="Leave empty for the device default."
            >
                <select
                    id="gas-profile-channel"
                    v-model="draft.channel"
                    class="ua-select"
                >
                    <option value="">Device default</option>
                    <option
                        v-for="channel in selectedDeviceChannels"
                        :key="channel"
                        :value="channel"
                    >
                        Channel {{ channel }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="gas-profile-pricing-zone" label="Pricing zone">
                <select
                    id="gas-profile-pricing-zone"
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
            <FormField
                field-id="gas-profile-metered-unit"
                label="Metered unit"
                :hint="meteredUnitDefinition(draft.meteredUnit)"
            >
                <select
                    id="gas-profile-metered-unit"
                    v-model="draft.meteredUnit"
                    class="ua-select"
                >
                    <option value="m3">m³</option>
                    <option value="ft3">ft³</option>
                    <option value="ccf">CCF</option>
                </select>
                <p v-if="metricWarning" class="ua-form-warning" role="status">
                    {{ metricWarning }}
                </p>
            </FormField>
            <FormField
                field-id="gas-profile-billed-unit"
                label="Billed unit"
                :hint="billedUnitDefinition(draft.billedUnit)"
            >
                <select
                    id="gas-profile-billed-unit"
                    v-model="draft.billedUnit"
                    class="ua-select"
                >
                    <option value="kWh">kWh</option>
                    <option value="therm">therm</option>
                    <option value="MMBtu">MMBtu</option>
                    <option value="GJ">GJ</option>
                </select>
                <p v-if="divisorWarning" class="ua-form-warning" role="status">
                    {{ divisorWarning }}
                </p>
            </FormField>
            <FormField field-id="gas-profile-volume-state" label="Volume state">
                <select
                    id="gas-profile-volume-state"
                    v-model="draft.volumeState"
                    class="ua-select"
                >
                    <option value="corrected">Already corrected</option>
                    <option value="uncorrected">Uncorrected</option>
                </select>
            </FormField>
            <FormField field-id="gas-profile-correction-mode" label="Correction mode">
                <select
                    id="gas-profile-correction-mode"
                    v-model="draft.correctionMode"
                    class="ua-select"
                    :disabled="draft.volumeState === 'corrected'"
                >
                    <option value="none">None</option>
                    <option value="statutory_constant">Statutory constant</option>
                    <option value="altitude_formula">Altitude formula</option>
                    <option value="zone_table">Zone table</option>
                    <option value="computed_PZ">Computed PZ</option>
                    <option value="computed_TPZ">Computed TPZ</option>
                </select>
            </FormField>
            <FormField
                field-id="gas-profile-correction-factor"
                label="Correction factor"
                :optional="draft.volumeState === 'corrected'"
            >
                <input
                    id="gas-profile-correction-factor"
                    v-model="draft.correctionFactor"
                    class="ua-input"
                    type="number"
                    min="0"
                    step="any"
                    :disabled="draft.volumeState === 'corrected'"
                />
            </FormField>
            <FormField field-id="gas-profile-effective-from" label="Effective from">
                <input
                    id="gas-profile-effective-from"
                    v-model="draft.effectiveFrom"
                    class="ua-input"
                    type="date"
                    required
                />
            </FormField>
            <FormField
                field-id="gas-profile-effective-to"
                label="Effective to"
                optional
                hint="Exclusive."
            >
                <input
                    id="gas-profile-effective-to"
                    v-model="draft.effectiveTo"
                    class="ua-input"
                    type="date"
                />
            </FormField>
            <FormField label="Revision" optional>
                <Input v-model="draft.revision" type="number" :min="1" />
            </FormField>
            <FormField label="Source reference">
                <Input v-model="draft.sourceReference" :maxlength="500" required />
            </FormField>
        </div>
        <details class="ua-disclosure">
            <summary>
                <span>My supplier uses a different figure</span>
                <i class="fas fa-chevron-down ua-disclosure__caret" aria-hidden="true" />
            </summary>
            <div class="ua-form-grid">
                <FormField
                    field-id="gas-profile-metric-factor"
                    label="Conversion to m³"
                    :optional="draft.meteredUnit === 'm3'"
                >
                    <input
                        id="gas-profile-metric-factor"
                        v-model="draft.metricFactor"
                        class="ua-input"
                        type="number"
                        min="0"
                        step="any"
                        :disabled="draft.meteredUnit === 'm3'"
                    />
                </FormField>
                <FormField field-id="gas-profile-energy-divisor" label="Energy divisor">
                    <input
                        id="gas-profile-energy-divisor"
                        v-model="draft.energyDivisor"
                        class="ua-input"
                        type="number"
                        min="0"
                        step="any"
                    />
                </FormField>
            </div>
        </details>
        <EditorFooter
            :error="error"
            :saving="saving"
            save-label="Save profile"
            @cancel="emit('cancel')"
        />
    </form>
</template>

<script setup lang="ts">
import {computed, watch} from 'vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import {deviceChannelNumbers} from '@/helpers/utilityAccounting';
import type {shelly_device_t} from '@/types';
import {
    billedUnitDefinition,
    derivedEnergyDivisor,
    energyDivisorWarning,
    type GasProfileDraft,
    type GasZone,
    gasDeviceLabel,
    meteredUnitDefinition,
    metricFactorFieldValue,
    metricFactorWarning
} from './gasConversion';
import {EditorFooter} from './gasEditorChrome';

// The panel owns the draft: a closed editor must keep what was typed.
const props = defineProps<{
    draft: GasProfileDraft;
    devices: shelly_device_t[];
    zones: GasZone[];
    error: string;
    saving: boolean;
}>();
const emit = defineEmits<{submit: []; cancel: []}>();

const divisorWarning = computed(() => energyDivisorWarning(props.draft));
const metricWarning = computed(() => metricFactorWarning(props.draft));

const selectedDeviceChannels = computed(() =>
    deviceChannelNumbers(
        props.devices.find(
            (device) => device.shellyID === props.draft.deviceExternalId
        )?.status
    )
);

watch(
    () => props.draft.deviceExternalId,
    () => {
        props.draft.channel = '';
    }
);
watch(
    () => props.draft.volumeState,
    (state) => {
        if (state === 'corrected') {
            props.draft.correctionMode = 'none';
            props.draft.correctionFactor = '';
        } else if (props.draft.correctionMode === 'none')
            props.draft.correctionMode = 'statutory_constant';
    }
);
// The units decide both factors, so a unit change replaces whatever the
// supplier override held: a stale figure would bill the wrong amount.
watch(
    () => props.draft.meteredUnit,
    (unit) => {
        props.draft.metricFactor = metricFactorFieldValue(unit);
    }
);
watch(
    () => props.draft.billedUnit,
    (unit) => {
        props.draft.energyDivisor = derivedEnergyDivisor(unit);
    }
);
</script>

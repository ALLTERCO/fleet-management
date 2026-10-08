<template>
    <form
        v-if="open"
        ref="formRoot"
        class="ua-editor"
        aria-labelledby="tariff-editor-title"
        @submit.prevent="reviewAssignment"
    >
        <div class="ua-editor__head">
            <div>
                <h3 id="tariff-editor-title">Assign {{ direction }} tariff</h3>
                <p>{{ explanation }}</p>
            </div>
            <button
                type="button"
                class="ua-icon-button"
                aria-label="Close tariff assignment form"
                @click="emit('close')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>

        <div class="ua-form-grid">
            <FormField field-id="tariff-assignment-direction" label="Direction">
                <select id="tariff-assignment-direction" v-model="direction" class="ua-select">
                    <option v-for="option in DIRECTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="tariff-assignment-commodity" label="Commodity">
                <select id="tariff-assignment-commodity" v-model="commodity" class="ua-select">
                    <option v-for="value in commodities" :key="value" :value="value">
                        {{ titleCase(value) }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="tariff-assignment-billed-unit" label="Billed unit">
                <select id="tariff-assignment-billed-unit" v-model="billedUnit" class="ua-select">
                    <option v-for="unit in availableUnits" :key="unit" :value="unit">
                        {{ unit }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="tariff-assignment-tariff" label="Tariff" :error="editorErrors.tariff">
                <select id="tariff-assignment-tariff" v-model.number="tariffId" class="ua-select" required>
                    <option :value="null" disabled>Select tariff</option>
                    <option v-for="tariff in availableTariffs" :key="tariff.id" :value="tariff.id">
                        {{ tariff.name }} · {{ tariff.currency }}/{{ tariff.billedUnit }}
                    </option>
                </select>
            </FormField>
            <FormField field-id="tariff-assignment-scope" label="Scope">
                <select id="tariff-assignment-scope" v-model="scopeLevel" class="ua-select">
                    <option value="organization">Organization default</option>
                    <option value="location">Location</option>
                    <option value="device">Device / meter</option>
                    <option value="channel">Exact channel</option>
                </select>
            </FormField>
            <FormField
                v-if="scopeLevel === 'location'"
                field-id="tariff-assignment-location"
                label="Location"
                :error="editorErrors.target"
            >
                <select id="tariff-assignment-location" v-model.number="locationId" class="ua-select" required>
                    <option value="" disabled>Select location</option>
                    <option v-for="location in locations" :key="location.id" :value="location.id">
                        {{ location.name }} · {{ location.kind }} · ID {{ location.id }}
                    </option>
                </select>
            </FormField>
            <FormField
                v-if="scopeLevel === 'device' || scopeLevel === 'channel'"
                field-id="tariff-assignment-device"
                label="Device / meter"
                :error="editorErrors.target"
            >
                <select id="tariff-assignment-device" v-model="deviceExternalId" class="ua-select" required>
                    <option value="" disabled>Select device</option>
                    <option v-for="device in devices" :key="device.shellyID" :value="device.shellyID">
                        {{ deviceName(device) }} · {{ device.shellyID }}
                    </option>
                </select>
            </FormField>
            <FormField
                v-if="scopeLevel === 'channel'"
                field-id="tariff-assignment-channel"
                label="Channel"
                :error="editorErrors.channel"
            >
                <select id="tariff-assignment-channel" v-model.number="channel" class="ua-select" required>
                    <option value="" disabled>Select channel</option>
                    <option v-for="value in selectedDeviceChannels" :key="value" :value="value">Channel {{ value }}</option>
                </select>
            </FormField>
        </div>

        <div class="ua-coverage" role="status">
            <i class="fas fa-code-branch" aria-hidden="true" />
            <div>
                <strong>{{ scopeText }}</strong>
                <span>
                    Opposite-direction and narrower assignments remain unchanged.
                </span>
                <span v-if="direction === 'export'">
                    Export credits require a recorded returned-direction meter.
                    Gas injection uses the explicit returned-volume tag and is
                    never inferred from a consumption meter.
                </span>
            </div>
        </div>
        <div class="ua-editor__footer">
            <Button type="blue-hollow" size="sm" @click="emit('close')">Cancel</Button>
            <Button type="blue" size="sm" submit :disabled="availableTariffs.length === 0">
                Review assignment
            </Button>
        </div>
    </form>

    <section v-if="reviewOpen" class="ua-review" aria-labelledby="assignment-review-title">
        <div>
            <h3 id="assignment-review-title">Review assignment</h3>
            <p>
                <strong dir="auto">{{ selectedTariff?.name }}</strong>
                will become the {{ direction }} tariff for {{ scopeText.toLowerCase() }}.
                {{ impact }}
            </p>
        </div>
        <p v-if="applyError" class="ua-form-error" role="alert">{{ applyError }}</p>
        <div class="ua-editor__footer">
            <Button type="blue-hollow" size="sm" @click="reviewOpen = false">Back</Button>
            <Button type="green" size="sm" :loading="saving" @click="confirmAssignment">
                Confirm assignment
            </Button>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {deviceChannelNumbers} from '@/helpers/utilityAccounting';
import type {ApiLocation} from '@/stores/locations';
import {useToastStore} from '@/stores/toast';
import type {shelly_device_t} from '@/types/device';
import {
    type AssignmentDraft,
    type AssignmentTarget,
    type Commodity,
    DIRECTIONS,
    type Direction,
    type DraftIssues,
    deviceName,
    directionExplanation,
    draftIssues,
    draftTarget,
    findTariff,
    hasIssue,
    reviewImpact,
    type ScopeLevel,
    scopeSummary,
    type Tariff,
    titleCase
} from './tariffAssignmentView';
import {saveAssignment} from './tariffAssignmentWrites';

const props = defineProps<{
    /** The panel opens and closes the form; the draft outlives both. */
    open: boolean;
    tariffs: Tariff[];
    commodities: Commodity[];
    locations: ApiLocation[];
    devices: shelly_device_t[];
}>();

const emit = defineEmits<{close: []; saved: []}>();
const direction = defineModel<Direction>('direction', {required: true});
const commodity = defineModel<Commodity>('commodity', {required: true});

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();

const billedUnit = ref<Tariff['billedUnit']>('kWh');
const tariffId = ref<number | null>(null);
const scopeLevel = ref<ScopeLevel>('organization');
const locationId = ref<string | number>('');
const deviceExternalId = ref('');
const channel = ref<string | number>('');
const reviewOpen = ref(false);
const saving = ref(false);
const applyError = ref('');
const editorErrors = ref<DraftIssues>({tariff: '', target: '', channel: ''});
const formRoot = ref<HTMLFormElement | null>(null);

const availableUnits = computed(() => [
    ...new Set(
        props.tariffs
            .filter((tariff) => tariff.commodity === commodity.value)
            .map((tariff) => tariff.billedUnit)
    )
]);
const availableTariffs = computed(() =>
    props.tariffs.filter(
        (tariff) =>
            tariff.commodity === commodity.value &&
            tariff.billedUnit === billedUnit.value
    )
);
const selectedTariff = computed(() => findTariff(props.tariffs, tariffId.value));
const selectedDeviceChannels = computed(() =>
    deviceChannelNumbers(
        props.devices.find(
            (device) => device.shellyID === deviceExternalId.value
        )?.status
    )
);
const draft = computed<AssignmentDraft>(() => ({
    tariffId: tariffId.value,
    scopeLevel: scopeLevel.value,
    locationId: locationId.value,
    deviceExternalId: deviceExternalId.value,
    channel: channel.value
}));
const explanation = computed(() =>
    directionExplanation(direction.value, commodity.value)
);
const scopeText = computed(() => scopeSummary(draft.value));
const impact = computed(() => reviewImpact(scopeLevel.value));

watch([commodity, availableUnits], () => {
    if (!availableUnits.value.includes(billedUnit.value)) {
        billedUnit.value = availableUnits.value[0] ?? '';
    }
});

// The draft survives a close; only the review step starts again from the form.
watch(
    () => props.open,
    (open) => {
        reviewOpen.value = false;
        applyError.value = '';
        if (open) void nextTick(focusFirstControl);
    }
);

function focusFirstControl(): void {
    formRoot.value?.querySelector<HTMLElement>('input, select')?.focus();
}

function reviewAssignment(): void {
    editorErrors.value = draftIssues(draft.value, props.tariffs);
    if (hasIssue(editorErrors.value)) return;
    reviewOpen.value = true;
}

async function confirmAssignment(): Promise<void> {
    if (saving.value) return;
    const target = draftTarget(draft.value, direction.value);
    if (!target) return;
    saving.value = true;
    applyError.value = '';
    try {
        await applyAssignment(target);
    } catch (error) {
        applyError.value = rpcErrorMessage(
            error,
            'Could not save the assignment'
        );
    } finally {
        saving.value = false;
    }
}

// The panel owns the list, so it reloads once the write lands.
async function applyAssignment(target: AssignmentTarget): Promise<void> {
    await saveAssignment(target);
    toast.success(`${titleCase(direction.value)} tariff assignment saved`);
    emit('saved');
}
</script>

<template>
    <WizardShell
        v-model:current-index="stepIndex"
        :visible="visible"
        title="New alert"
        submit-label="Create alert"
        :steps="steps"
        requires-write
        :busy="saving"
        :error="saveError"
        xlarge
        @close="close"
        @submit="save"
    >
        <template #default="{step}">
            <WizardStep
                v-if="step?.id === 'alert'"
                name="alert"
                lede="Pick what you want to be told about. Everything else about the alert is already set up."
            >
                <div class="qam__search">
                    <Input
                        v-model="query"
                        type="search"
                        placeholder="Search alerts"
                    />
                </div>
                <BuiltinTemplateGallery :query="query" @pick="chooseTemplate" />
            </WizardStep>

            <WizardStep
                v-else-if="step?.id === 'devices'"
                name="devices"
                lede="Pick the devices, groups, locations or tags to watch. Leave it empty to watch the whole fleet."
            >
                <ScopeSelector
                    v-model="draft.scope"
                    :supported-scope-types="scopeTypes"
                    :kind="draft.template?.kind ?? undefined"
                    :kind-config="draft.template?.config"
                />
            </WizardStep>

            <WizardStep
                v-else-if="step?.id === 'notify'"
                name="notify"
                lede="Pick where this alert should land."
            >
                <ChannelPicker v-model="draft.channelIds" />

                <FormField label="Name">
                    <input
                        v-model.trim="draft.name"
                        type="text"
                        class="qam__input"
                        :placeholder="draft.template?.label ?? ''"
                    />
                </FormField>
            </WizardStep>
        </template>
    </WizardShell>
</template>

<script setup lang="ts">
// The quick path. A built-in template already answers the trigger, the
// condition, the severity, the timers and both message bodies — so the only
// questions left are which devices and who to tell. The name is optional
// because the template's own label is what most people would have typed.
import type {AlertRuleTemplate} from '@api/alert';
import {computed, ref, watch} from 'vue';
import BuiltinTemplateGallery from '@/components/core/BuiltinTemplateGallery.vue';
import ChannelPicker from '@/components/core/ChannelPicker.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import ScopeSelector from '@/components/core/ScopeSelector.vue';
import WizardShell from '@/components/core/wizard/WizardShell.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import {
    buildQuickAlertPayload,
    createQuickAlertDraft,
    isExecutableAlertTemplate,
    quickAlertScopeTypes,
    quickAlertSteps
} from '@/helpers/quickAlertDraft';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useAlertsStore} from '@/stores/alerts';
import {useToastStore} from '@/stores/toast';

const visible = defineModel<boolean>({required: true});

const emit = defineEmits<{created: [ruleId: number]}>();

const store = useAlertsStore();
const toast = useToastStore();

const draft = ref(createQuickAlertDraft());
// Forty-one ready-made alerts is a list you search, not scroll.
const query = ref('');
const stepIndex = ref(0);
const saving = ref(false);
const saveError = ref<string | null>(null);

const steps = computed(() => quickAlertSteps(draft.value));
const scopeTypes = computed(() => quickAlertScopeTypes(draft.value.template));

watch(visible, (open) => {
    if (!open) return;
    draft.value = createQuickAlertDraft();
    query.value = '';
    stepIndex.value = 0;
    saveError.value = null;
    void store.fetchTemplates();
});

// Choosing an alert is the whole of step one, so it moves the flow on rather
// than making the user reach for Next straight after clicking a card.
function chooseTemplate(template: AlertRuleTemplate): void {
    if (!isExecutableAlertTemplate(template)) return;
    draft.value = {...draft.value, template};
    stepIndex.value = 1;
}

function close(): void {
    visible.value = false;
}

async function save(): Promise<void> {
    const payload = buildQuickAlertPayload(draft.value);
    if (!payload || saving.value) return;
    saving.value = true;
    saveError.value = null;
    try {
        const rule = await store.createFromTemplate(payload);
        if (!rule) return;
        toast.success(`${rule.name} is now watching`);
        emit('created', rule.id);
        close();
    } catch (error) {
        saveError.value = rpcErrorMessage(error, 'Could not create the alert');
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.qam__search {
    max-width: 24rem;
    margin-bottom: var(--gap-md);
}

.qam__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
</style>

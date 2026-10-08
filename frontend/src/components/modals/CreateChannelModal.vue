<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>
            <span>{{ isEditing ? 'Edit channel' : 'New channel' }}</span>
        </template>

        <form class="ccm" @submit.prevent="onSave">
            <SectionCard title="Channel type">
                <ChannelTypePicker v-model="form.type" :locked="isEditing" />
                <p v-if="isEditing" class="ccm__hint">
                    A channel keeps its type for life. Create a new channel to
                    deliver through a different service.
                </p>
            </SectionCard>

            <SectionCard :title="detailsTitle">
                <FormField label="Name" :error="visibleErrors.name">
                    <input
                        v-model.trim="form.name"
                        type="text"
                        name="username"
                        autocomplete="username"
                        class="ccm__input"
                        required
                    />
                </FormField>

                <div class="ccm__divider" aria-hidden="true" />

                <EmailFieldset
                    v-if="form.type === 'email_smtp'"
                    v-model="form.config.email"
                    :show-errors="showErrors"
                    :errors="configErrors"
                    :masked-fields="maskedFields"
                />
                <WebhookFieldset
                    v-else-if="form.type === 'generic_webhook'"
                    v-model="form.config.webhook"
                    :show-errors="showErrors"
                    :errors="configErrors"
                />
                <SlackFieldset
                    v-else-if="form.type === 'slack_webhook'"
                    v-model="form.config.slack"
                    :show-errors="showErrors"
                    :errors="configErrors"
                    :masked-fields="maskedFields"
                />
                <TeamsFieldset
                    v-else-if="form.type === 'teams_workflow_webhook'"
                    v-model="form.config.teams"
                    :show-errors="showErrors"
                    :errors="configErrors"
                    :masked-fields="maskedFields"
                />
                <TelegramFieldset
                    v-else-if="form.type === 'telegram_bot'"
                    v-model="form.config.telegram"
                    :show-errors="showErrors"
                    :errors="configErrors"
                    :masked-fields="maskedFields"
                />
                <PushFcmFieldset
                    v-else-if="form.type === 'push_fcm'"
                    v-model="form.config.pushFcm"
                    :show-errors="showErrors"
                    :errors="configErrors"
                />
                <WebhookSignedFieldset
                    v-else-if="form.type === 'webhook_signed'"
                    v-model="form.config.webhookSigned"
                    :show-errors="showErrors"
                    :errors="configErrors"
                />
            </SectionCard>

            <SectionCard title="Quiet hours">
                <QuietHoursSummary v-model="quietHoursForm" />
            </SectionCard>
        </form>

        <template #footer>
            <div class="ccm__footer">
                <Button type="blue-hollow" size="md" @click="emit('close')">
                    Cancel
                </Button>
                <Button type="green" size="md" @click="onSave">
                    Save channel
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import ChannelTypePicker from '@/components/core/ChannelTypePicker.vue';
import FormField from '@/components/core/FormField.vue';
import QuietHoursSummary, {
    type QuietHoursForm
} from '@/components/core/QuietHoursSummary.vue';
import SectionCard from '@/components/core/SectionCard.vue';
import EmailFieldset from '@/components/modals/channelFields/EmailFieldset.vue';
import PushFcmFieldset from '@/components/modals/channelFields/PushFcmFieldset.vue';
import SlackFieldset from '@/components/modals/channelFields/SlackFieldset.vue';
import TeamsFieldset from '@/components/modals/channelFields/TeamsFieldset.vue';
import TelegramFieldset from '@/components/modals/channelFields/TelegramFieldset.vue';
import WebhookFieldset from '@/components/modals/channelFields/WebhookFieldset.vue';
import WebhookSignedFieldset from '@/components/modals/channelFields/WebhookSignedFieldset.vue';
import Modal from '@/components/modals/Modal.vue';
import {
    type ChannelDraft,
    createBlankChannelDraft
} from '@/helpers/channelDraft';
import {
    type ChannelType,
    describeChannelType,
    isChannelType
} from '@/helpers/channelTypes';
import {
    type ErrorMap,
    omitStoredSecretErrors, 
    validateChannelName,
    validateEmailForm,
    validatePushFcmForm,
    validateSlackForm,
    validateTeamsForm,
    validateTelegramForm,
    validateWebhookForm,
    validateWebhookSignedForm
} from '@/helpers/channelValidators';

export type {ChannelDraft};

const props = defineProps<{
    visible: boolean;
    initialDraft?: ChannelDraft;
    /** Masked stored secrets from Channel.Get, keyed by config path. */
    maskedFields?: Record<string, string>;
}>();

const emit = defineEmits<{
    close: [];
    save: [draft: ChannelDraft];
}>();

const form = reactive(createBlankChannelDraft());
const showErrors = ref(false);

const quietHoursForm = computed<QuietHoursForm>({
    get: () => form.quietHours,
    set: (next) => {
        form.quietHours = next;
    }
});

watch(
    () => props.visible,
    (open) => {
        if (open) syncFromProps();
        else showErrors.value = false;
    }
);

watch(
    () => props.initialDraft,
    () => {
        if (props.visible) syncFromProps();
    }
);

// Mounted-already-open case: parents passing :visible="true" literally
// never trigger the visible watcher above (mirrors Modal.vue's onMounted).
onMounted(() => {
    if (props.visible) syncFromProps();
});

const isEditing = computed(() => form.channelId !== null);

const detailsTitle = computed(
    () => `${describeChannelType(form.type).label} settings`
);


const nameError = computed(() => {
    const result = validateChannelName(form.name);
    return result.valid ? '' : result.message;
});

const configErrors = computed<ErrorMap>(() =>
    omitStoredSecretErrors(
        runValidatorFor(form.type, form.config),
        activeSection(form.type, form.config),
        props.maskedFields ?? {}
    )
);

const visibleErrors = computed(() => ({
    name: showErrors.value ? nameError.value : ''
}));

function syncFromProps(): void {
    Object.assign(form, props.initialDraft ?? createBlankChannelDraft());
    showErrors.value = false;
}

// The config section the active type edits; its field names are the error
// keys the validators produce and the paths the server masks secrets under.
function activeSection(type: ChannelType, config: ChannelDraft['config']): object {
    if (type === 'email_smtp') return config.email;
    if (type === 'generic_webhook') return config.webhook;
    if (type === 'slack_webhook') return config.slack;
    if (type === 'teams_workflow_webhook') return config.teams;
    if (type === 'telegram_bot') return config.telegram;
    if (type === 'push_fcm') return config.pushFcm;
    if (type === 'webhook_signed') return config.webhookSigned;
    return {};
}

function runValidatorFor(type: ChannelType, config: ChannelDraft['config']): ErrorMap {
    if (!isChannelType(type)) return {};
    if (type === 'email_smtp') return validateEmailForm(config.email);
    if (type === 'generic_webhook') return validateWebhookForm(config.webhook);
    if (type === 'slack_webhook') return validateSlackForm(config.slack);
    if (type === 'teams_workflow_webhook') return validateTeamsForm(config.teams);
    if (type === 'telegram_bot') return validateTelegramForm(config.telegram);
    if (type === 'push_fcm') return validatePushFcmForm(config.pushFcm);
    if (type === 'webhook_signed')
        return validateWebhookSignedForm(config.webhookSigned);
    return {};
}

function isFormValid(): boolean {
    if (nameError.value) return false;
    return Object.keys(configErrors.value).length === 0;
}

function onSave(): void {
    showErrors.value = true;
    if (!isFormValid()) return;
    emit('save', JSON.parse(JSON.stringify(form)) as ChannelDraft);
}

</script>

<style scoped>
.ccm {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.ccm__divider {
    height: 1px;
    background: linear-gradient(
        90deg,
        transparent,
        var(--color-border-subtle) 25%,
        var(--color-border-subtle) 75%,
        transparent
    );
    margin: var(--space-2) 0;
}

.ccm__input {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-medium, var(--color-border-subtle));
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    transition:
        border-color var(--duration-fast) var(--ease-out-expo),
        background-color var(--duration-fast) var(--ease-out-expo),
        box-shadow var(--duration-fast) var(--ease-out-expo);
}

.ccm__input:hover {
    border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border-subtle));
}

.ccm__input:focus {
    outline: none;
    border-color: var(--color-primary);
    background-color: var(--color-surface-2);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
}




.ccm__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}

/* Test sits opposite Cancel/Save so it reads as its own action, not a
   dismiss control. It was previously beside the modal's X. */


</style>

<style>
/* FormField label/hint/error overrides for the channel modal. Unscoped so
 * the rules penetrate FormField's own scoped data attribute — the proper
 * Vue mechanism since :deep() is biome-flagged across the codebase. */
.ccm .form-field__label {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-1-5);
    letter-spacing: 0.01em;
}

.ccm .form-field__hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    margin-top: var(--space-1);
}

.ccm .form-field__error {
    color: var(--color-input-error);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    margin-top: var(--space-1);
}
</style>

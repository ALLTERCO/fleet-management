<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>
            <div class="ccm__title">
                <span>{{ isEditing ? 'Edit channel' : 'New channel' }}</span>
                <button
                    v-if="canTest"
                    type="button"
                    class="ccm__test-btn"
                    :disabled="testingNow"
                    @click="onTest"
                >
                    <i
                        :class="
                            testingNow
                                ? 'fa-solid fa-spinner fa-spin'
                                : 'fa-solid fa-paper-plane'
                        "
                        aria-hidden="true"
                    />
                    {{ testingNow ? 'Sending…' : 'Send test' }}
                </button>
            </div>
        </template>

        <form class="ccm" @submit.prevent="onSave">
            <SectionCard title="Channel type">
                <ChannelTypePicker v-model="form.type" />
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
                />
                <TeamsFieldset
                    v-else-if="form.type === 'teams_workflow_webhook'"
                    v-model="form.config.teams"
                    :show-errors="showErrors"
                    :errors="configErrors"
                />
                <TelegramFieldset
                    v-else-if="form.type === 'telegram_bot'"
                    v-model="form.config.telegram"
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
import SlackFieldset from '@/components/modals/channelFields/SlackFieldset.vue';
import TeamsFieldset from '@/components/modals/channelFields/TeamsFieldset.vue';
import TelegramFieldset from '@/components/modals/channelFields/TelegramFieldset.vue';
import WebhookFieldset from '@/components/modals/channelFields/WebhookFieldset.vue';
import Modal from '@/components/modals/Modal.vue';
import {
    type ChannelType,
    canTestChannelType,
    describeChannelType,
    isChannelType
} from '@/helpers/channelTypes';
import {
    type ErrorMap,
    validateChannelName,
    validateEmailForm,
    validateSlackForm,
    validateTeamsForm,
    validateTelegramForm,
    validateWebhookForm
} from '@/helpers/channelValidators';
import {
    createEmailChannelConfigForm,
    type EmailChannelConfigForm
} from '@/helpers/notificationEmailConfig';

interface WebhookConfig {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}
interface SlackConfig {
    url: string;
    channelOverride: string;
}
interface TeamsConfig {
    url: string;
}
interface TelegramConfig {
    botToken: string;
    chatId: string;
    parseMode: '' | 'MarkdownV2' | 'HTML';
}

export interface ChannelDraft {
    channelId: number | null;
    name: string;
    type: ChannelType;
    config: {
        email: EmailChannelConfigForm;
        webhook: WebhookConfig;
        slack: SlackConfig;
        teams: TeamsConfig;
        telegram: TelegramConfig;
    };
    quietHours: QuietHoursForm;
}

const props = defineProps<{
    visible: boolean;
    initialDraft?: ChannelDraft;
    testingNow?: boolean;
}>();

const emit = defineEmits<{
    close: [];
    save: [draft: ChannelDraft];
    test: [];
}>();

const form = reactive(createBlankDraft());
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

const canTest = computed(
    () => isEditing.value && canTestChannelType(form.type)
);

const detailsTitle = computed(
    () => `${describeChannelType(form.type).label} settings`
);

const nameError = computed(() => {
    const result = validateChannelName(form.name);
    return result.valid ? '' : result.message;
});

const configErrors = computed<ErrorMap>(() =>
    runValidatorFor(form.type, form.config)
);

const visibleErrors = computed(() => ({
    name: showErrors.value ? nameError.value : ''
}));

function createBlankDraft(): ChannelDraft {
    return {
        channelId: null,
        name: '',
        type: 'email_smtp',
        config: {
            email: createEmailChannelConfigForm(),
            webhook: {url: '', signingSecret: '', timeoutMs: 10000},
            slack: {url: '', channelOverride: ''},
            teams: {url: ''},
            telegram: {botToken: '', chatId: '', parseMode: ''}
        },
        quietHours: {start: '', end: '', timezone: ''}
    };
}

function syncFromProps(): void {
    Object.assign(form, props.initialDraft ?? createBlankDraft());
    showErrors.value = false;
}

function runValidatorFor(type: ChannelType, config: ChannelDraft['config']): ErrorMap {
    if (!isChannelType(type)) return {};
    if (type === 'email_smtp') return validateEmailForm(config.email);
    if (type === 'generic_webhook') return validateWebhookForm(config.webhook);
    if (type === 'slack_webhook') return validateSlackForm(config.slack);
    if (type === 'teams_workflow_webhook') return validateTeamsForm(config.teams);
    if (type === 'telegram_bot') return validateTelegramForm(config.telegram);
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

function onTest(): void {
    emit('test');
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

.ccm__title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
}

.ccm__test-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    background-color: transparent;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
}

.ccm__test-btn:hover:not(:disabled) {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    border-color: var(--color-primary);
}

.ccm__test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ccm__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
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

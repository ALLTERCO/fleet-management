<template>
    <Modal :visible="visible" huge @close="close">
        <template #title>
            <ModalHeader
                :icon="headerIcon"
                :title="headerTitle"
                :description="headerDescription"
            >
                <template v-if="formProvider && canSwitchProvider" #badge>
                    <nav class="iem__crumbs" aria-label="Provider breadcrumb">
                        <button
                            type="button"
                            class="iem__crumb iem__crumb--link"
                            @click="resetProvider"
                        >
                            <i class="fas fa-arrow-left iem__crumb-arrow" />
                            All providers
                        </button>
                        <i
                            class="fas fa-chevron-right iem__crumb-sep"
                            aria-hidden="true"
                        />
                        <span class="iem__crumb iem__crumb--current">
                            <ProviderLogo :provider="formProvider" size="sm" />
                            {{ currentDescriptor?.label }}
                        </span>
                    </nav>
                </template>
            </ModalHeader>
        </template>

        <template #default>
            <form
                class="iem__form"
                autocomplete="off"
                @submit.prevent="handleSave"
            >
                <!-- Skeleton while provider catalogue loads -->
                <div v-if="providersLoading" class="iem__skeleton">
                    <div
                        v-for="n in 4"
                        :key="n"
                        class="iem__skeleton-tile"
                    />
                </div>

                <!-- Step 1: no provider selected yet (create mode only) -->
                <section
                    v-else-if="showPicker"
                    class="iem__picker"
                    aria-labelledby="iem-picker-heading"
                >
                    <h3 id="iem-picker-heading" class="sr-only">
                        Choose a provider
                    </h3>
                    <div class="iem__picker-grid">
                        <ProviderPickerTile
                            v-for="p in allTiles"
                            :key="p.key"
                            :provider="p.key"
                            :label="p.label"
                            :description="TILE_META[p.key]?.tagline"
                            :active="formProvider === p.key"
                            @select="selectProvider(p)"
                        />
                    </div>
                </section>

            <!-- Step 2: provider chosen — tab rail + content panel + preview -->
            <section v-else-if="formProvider" class="iem__stage">
                <header class="iem__identity">
                    <div class="iem__field iem__field--name">
                        <label class="iem__label" :for="nameInputId">
                            Name
                            <span class="iem__required" aria-hidden="true">*</span>
                        </label>
                        <Input
                            :id="nameInputId"
                            v-model="formName"
                            placeholder="e.g. #ops-alerts"
                            @blur="syncNameError"
                        />
                        <p v-if="nameError" class="iem__error" role="alert">
                            <i class="fas fa-circle-exclamation" />
                            {{ nameError }}
                        </p>
                        <p v-else class="iem__hint">
                            Shown in rule destinations and delivery logs.
                        </p>
                    </div>
                    <div class="iem__toggle-row">
                        <Checkbox
                            v-model="formEnabled"
                            label="Channel enabled"
                            hint="Disabled channels accept edits but skip delivery."
                        />
                    </div>
                </header>

                <div class="iem__layout">
                    <ModalTabRail
                        v-model="activeTab"
                        :tabs="availableTabs"
                        aria-label="Integration channel sections"
                    />

                    <div class="iem__panel" :class="{'iem__panel--no-preview': !showPreview}">
                        <!-- Email provider — route to EmailSmtpForm tab router -->
                        <template v-if="formProvider === 'email_smtp' && currentDescriptor">
                            <EmailSmtpForm
                                v-if="isEmailConfigTab"
                                v-model="formConfig"
                                :descriptor="currentDescriptor"
                                :channel="props.initial ?? null"
                                :tab="activeTab as EmailSmtpTab"
                            />
                            <div v-else-if="activeTab === 'templates'" class="iem__tab-content">
                                <header class="iem__section-hdr">
                                    <h3 class="iem__section-title">Message templates</h3>
                                    <p class="iem__section-desc">
                                        Edit the message body or pick a saved
                                        template from the library. Inline fields
                                        override the saved template field-by-field.
                                    </p>
                                </header>
                                <EmailTemplateBlock
                                    v-model="formConfig"
                                    :fields="templateFields"
                                    @update:validity="setTemplateValidity"
                                />
                                <header class="iem__section-hdr iem__section-hdr--spaced">
                                    <h3 class="iem__section-title">Attachments</h3>
                                    <p class="iem__section-desc">
                                        Upload an asset or reference a public URL.
                                        Use <code>cid</code> +
                                        <code>&lt;img src="cid:id"&gt;</code>
                                        for inline images. Server cap is
                                        <code>FM_EMAIL_MAX_ATTACHMENTS</code>.
                                    </p>
                                </header>
                                <EmailAttachmentEditor
                                    :model-value="attachments"
                                    @update:model-value="setAttachments"
                                />
                            </div>
                        </template>

                        <!-- Non-email providers -->
                        <template v-else>
                            <div v-if="activeTab === 'connection'" class="iem__tab-content">
                                <header class="iem__section-hdr">
                                    <h3 class="iem__section-title">Connection</h3>
                                    <p class="iem__section-desc">
                                        Delivery target + secret. Secrets stay
                                        on the server — leave blank on edit
                                        to keep the stored value.
                                    </p>
                                </header>
                                <div v-if="formProvider === 'telegram_bot'" class="iem__provider-hint">
                                    <i class="fab fa-telegram iem__provider-hint-icon" />
                                    <div class="iem__provider-hint-body">
                                        <p class="iem__provider-hint-title">Setup required before saving</p>
                                        <ol class="iem__provider-hint-steps">
                                            <li>Find your bot in Telegram and send it <code>/start</code> — bots can only message users who have started a chat first.</li>
                                            <li>Message <code>@userinfobot</code> on Telegram — it replies with your numeric Chat ID (e.g. <code>997757427</code>).</li>
                                            <li>Paste that number into the <strong>Chat ID</strong> field below. Usernames like <code>@you</code> will not work.</li>
                                        </ol>
                                    </div>
                                </div>
                                <SchemaForm
                                    v-if="nonTemplateSchema"
                                    v-model="formConfig"
                                    :schema="nonTemplateSchema"
                                    :has-secret-for="hasSecretFor"
                                />
                                <p v-else class="iem__hint">
                                    This provider does not expose configurable
                                    connection fields.
                                </p>
                            </div>
                            <div v-else-if="activeTab === 'content'" class="iem__tab-content">
                                <header class="iem__section-hdr">
                                    <h3 class="iem__section-title">
                                        {{ contentSectionTitle }}
                                    </h3>
                                    <p class="iem__section-desc">
                                        {{ contentSectionDesc }}
                                    </p>
                                </header>
                                <IntegrationTemplateEditor
                                    :model-value="formConfig"
                                    :fields="templateFields"
                                    @update:model-value="updateConfig"
                                    @update:validity="setTemplateValidity"
                                />
                            </div>
                        </template>
                    </div>

                    <aside v-if="showPreview" class="iem__preview">
                        <IntegrationPreviewPane
                            :provider="formProvider"
                            :channel-name="formName"
                            :subject="previewSubject"
                            :rendered="previewRenderedText"
                            :email-html="emailPreview?.html"
                            :email-text="emailPreview?.text"
                            :email-attachments="emailPreview?.attachments"
                            :webhook-url="(formConfig.url as string) ?? ''"
                            :loading="previewLoading"
                        />
                    </aside>
                </div>
            </section>
            </form>
        </template>

        <template #footer>
            <ModalFooter v-if="formProvider || props.mode === 'edit'">
                <template v-if="justSaved" #meta>
                    <span class="iem__flash">
                        <i class="fas fa-circle-check" />
                        {{ props.mode === 'create' ? 'Channel created' : 'Changes saved' }}
                    </span>
                </template>
                <template #secondary>
                    <Button type="blue-hollow" @click="close">
                        {{ props.mode === 'create' ? 'Discard' : 'Cancel' }}
                    </Button>
                </template>
                <template #primary>
                    <Button
                        type="blue"
                        :loading="saving"
                        :disabled="!canSave"
                        :requires-write="true"
                        @click="handleSave"
                    >
                        {{ primaryButtonLabel }}
                    </Button>
                </template>
            </ModalFooter>
            <ModalFooter v-else>
                <template #secondary>
                    <Button type="blue-hollow" @click="close">Cancel</Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {
    Channel,
    ChannelProvider,
    ChannelProviderDescriptor
} from '@api/channel';
import {
    computed,
    defineAsyncComponent,
    onBeforeUnmount,
    ref,
    useId,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import EmailAttachmentEditor from '@/components/core/EmailAttachmentEditor.vue';
import EmailSmtpForm, {
    type EmailSmtpTab
} from '@/components/core/EmailSmtpForm.vue';
import EmailTemplateBlock from '@/components/core/EmailTemplateBlock.vue';
import Input from '@/components/core/Input.vue';
import IntegrationPreviewPane from '@/components/core/IntegrationPreviewPane.vue';
import type {TemplateField} from '@/components/core/IntegrationTemplateEditor.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import ModalTabRail, {
    type TabRailItem
} from '@/components/core/ModalTabRail.vue';
import ProviderLogo from '@/components/core/ProviderLogo.vue';
import ProviderPickerTile from '@/components/core/ProviderPickerTile.vue';
import SchemaForm from '@/components/core/SchemaForm.vue';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {UI_CONFIG} from '@/config/ui';
import {
    contentMetaFor,
    PRIMARY_PROVIDERS,
    TEMPLATE_FIELDS_BY_PROVIDER,
    TILE_META, 
    telegramEditorMode,
    telegramHintFor
} from '@/helpers/integrationProviderConfig';
import {useChannelsStore} from '@/stores/channels';
import {
    type EmailAttachment,
    useNotificationsStore
} from '@/stores/notifications';
import Modal from './Modal.vue';

// IntegrationTemplateEditor is heavy (codemirror + JSON schema) — keep it
// async so the rest of the modal mounts fast.
const IntegrationTemplateEditor = defineAsyncComponent(
    () => import('@/components/core/IntegrationTemplateEditor.vue')
);

// Preview strategies — one entry per provider we can preview.
interface PreviewStrategy {
    run: () => Promise<void>;
}

// ── Component ──────────────────────────────────────────────────────────
const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: Channel | null;
}>();

const emit = defineEmits<{saved: [Channel]}>();

const channelsStore = useChannelsStore();
const notificationsStore = useNotificationsStore();

const nameInputId = useId();

const formProvider = ref<ChannelProvider | null>(null);
const formName = ref('');
const formEnabled = ref(true);
const formConfig = ref<Record<string, unknown>>({});
const providersLoading = ref(true);
const activeTab = ref<string>('basics');
const templateValidity = ref<Record<string, boolean>>({});

function setTemplateValidity(next: Record<string, boolean>) {
    templateValidity.value = next;
}

// True only when every JSON template field parses. Non-JSON fields report
// true regardless.
const areTemplatesValid = computed(() =>
    Object.values(templateValidity.value).every((ok) => ok !== false)
);

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);

const {saving, justSaved, runOptimisticSave} =
    useOptimisticSave<Channel>({
        onSuccess: (channel) => {
            emit('saved', channel);
            close();
        }
    });

type EmailPreview = Awaited<
    ReturnType<typeof notificationsStore.renderEmailPreview>
>;
type TemplatePreview = Awaited<
    ReturnType<typeof notificationsStore.renderTemplate>
>;

const previewLoading = ref(false);
const emailPreview = ref<EmailPreview>(null);
const jsonPreview = ref<TemplatePreview>(null);

const previewStrategies: Partial<
    Record<ChannelProvider, PreviewStrategy>
> = {
    email_smtp: {run: previewEmail},
    generic_webhook: {run: () => previewJsonTemplate('bodyTemplate')},
    slack_webhook: {run: () => previewJsonTemplate('blocksTemplate')},
    teams_workflow_webhook: {run: () => previewJsonTemplate('cardTemplate')},
    telegram_bot: {run: () => previewJsonTemplate('messageTemplate')}
};

// ── Derived provider/tile catalogues ───────────────────────────────────
const enabledProviders = computed(() =>
    channelsStore.providers.filter((p) => p.enabled)
);

// Single ordered list — primary providers first, others appended.
// Webhook used to live in a separate "Advanced" row; the visual split
// confused more than it helped, so all providers are equal tiles now.
const allTiles = computed(() => {
    const enabled = enabledProviders.value;
    const primary = enabled.filter((p) => PRIMARY_PROVIDERS.includes(p.key));
    const rest = enabled.filter((p) => !PRIMARY_PROVIDERS.includes(p.key));
    return [...primary, ...rest];
});

const currentDescriptor = computed<ChannelProviderDescriptor | null>(() =>
    formProvider.value
        ? (channelsStore.providers.find(
              (p) => p.key === formProvider.value
          ) ?? null)
        : null
);

const canSwitchProvider = computed(() => props.mode === 'create');
const showPicker = computed(
    () => props.mode === 'create' && !formProvider.value
);
const showPreview = computed(() => !!formProvider.value);

// ── Tab catalogue per provider ─────────────────────────────────────────
// Email has the deepest config surface. Non-email providers share a
// Connection + Content structure.
const EMAIL_TABS: readonly Omit<TabRailItem, 'invalid'>[] = [
    {key: 'basics', label: 'Basics', icon: 'fa-sliders', hint: 'Server + sender'},
    {key: 'recipients', label: 'Recipients', icon: 'fa-users', hint: 'To / Cc / Bcc'},
    {key: 'auth', label: 'Authentication', icon: 'fa-key', hint: 'Password or OAuth2'},
    {key: 'templates', label: 'Templates', icon: 'fa-envelope-open-text', hint: 'Subject, body, attachments'},
    {key: 'delivery', label: 'Advanced', icon: 'fa-gears', hint: 'TLS, timeouts, DKIM'},
    {key: 'test', label: 'Test', icon: 'fa-flask', hint: 'Dry-run + live send'}
];

const OTHER_TABS: readonly Omit<TabRailItem, 'invalid'>[] = [
    {key: 'connection', label: 'Connection', icon: 'fa-plug', hint: 'Where to deliver'},
    {key: 'content', label: 'Content', icon: 'fa-envelope-open-text', hint: 'Message template'}
];

const isEmailConfigTab = computed(
    () =>
        formProvider.value === 'email_smtp' &&
        activeTab.value !== 'templates'
);

const availableTabs = computed<TabRailItem[]>(() => {
    const base =
        formProvider.value === 'email_smtp' ? EMAIL_TABS : OTHER_TABS;
    return base.map((t) => ({
        ...t,
        invalid: tabValidators[t.key]?.() ?? false
    }));
});

// Per-tab required-field validator. Flat map so new tab = new entry.
type TabValidator = () => boolean;

const tabValidators: Record<string, TabValidator> = {
    basics: () => isEmail() && !stringAt('from'),
    recipients: () => isEmail() && arrayAt('toAddresses').length === 0,
    auth: () => isEmail() && !stringAt('auth', 'user'),
    templates: () => !areTemplatesValid.value,
    content: () =>
        (!isEmail() && schemaHasMissingRequired()) || !areTemplatesValid.value,
    connection: () => !isEmail() && schemaHasMissingRequired()
};

function isEmail(): boolean {
    return formProvider.value === 'email_smtp';
}

function stringAt(...path: string[]): string {
    const leaf = path.reduce<unknown>(
        (cursor, segment) =>
            cursor && typeof cursor === 'object'
                ? (cursor as Record<string, unknown>)[segment]
                : undefined,
        formConfig.value
    );
    return typeof leaf === 'string' ? leaf : '';
}

function arrayAt(key: string): unknown[] {
    const v = formConfig.value[key];
    return Array.isArray(v) ? v : [];
}

function schemaHasMissingRequired(): boolean {
    const schema = nonTemplateSchema.value;
    if (!schema) return false;
    const required = (schema as {required?: string[]}).required ?? [];
    return required.some((key) => isBlank(formConfig.value[key]));
}

function isBlank(v: unknown): boolean {
    return v === undefined || v === null || v === '';
}

// ── Header copy ────────────────────────────────────────────────────────
const headerIcon = computed(() => {
    if (!formProvider.value) return 'fa-plug';
    if (props.mode === 'edit') return 'fa-pen';
    return 'fa-plus';
});

const headerTitle = computed(() => {
    if (props.mode === 'edit' && props.initial) {
        return `Edit "${props.initial.name}"`;
    }
    if (!formProvider.value) {
        return 'New integration';
    }
    return `New ${currentDescriptor.value?.label ?? 'channel'}`;
});

const headerDescription = computed(() => {
    if (props.mode === 'edit') {
        return 'Update the channel configuration and save your changes.';
    }
    if (!formProvider.value) {
        return 'Choose how alerts should be delivered.';
    }
    return 'Configure the channel — preview updates live as you type.';
});

// ── Template fields + schema filtering (existing behavior) ────────────
const templateFields = computed<TemplateField[]>(() => {
    if (!formProvider.value) return [];
    const base = TEMPLATE_FIELDS_BY_PROVIDER[formProvider.value] ?? [];
    if (formProvider.value !== 'telegram_bot') return base;
    const parseMode = formConfig.value.parseMode;
    return base.map((field) =>
        field.key === 'messageTemplate'
            ? {
                  ...field,
                  mode: telegramEditorMode(parseMode),
                  hint: telegramHintFor(parseMode)
              }
            : field
    );
});

const templateKeysSet = computed<Set<string>>(
    () => new Set(templateFields.value.map((f) => f.key))
);

// SchemaForm renders connection fields only. Template fields go through
// IntegrationTemplateEditor / EmailTemplateBlock — stripping them here
// prevents duplicate editors for the same value.
const nonTemplateSchema = computed<Record<string, unknown> | null>(() => {
    const schema = currentDescriptor.value?.configSchema as
        | Record<string, unknown>
        | undefined;
    if (!schema) return null;
    const properties = schema.properties as
        | Record<string, unknown>
        | undefined;
    if (!properties) return schema;
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(properties)) {
        if (!templateKeysSet.value.has(k)) filtered[k] = v;
    }
    if (Object.keys(filtered).length === 0) return null;
    return {...schema, properties: filtered};
});

const contentSectionTitle = computed(
    () => contentMetaFor(formProvider.value).title
);
const contentSectionDesc = computed(
    () => contentMetaFor(formProvider.value).description
);

const attachments = computed<EmailAttachment[]>(() =>
    Array.isArray(formConfig.value.attachments)
        ? (formConfig.value.attachments as EmailAttachment[])
        : []
);

function setAttachments(list: EmailAttachment[]) {
    const next = {...formConfig.value};
    if (list.length > 0) next.attachments = list;
    else delete next.attachments;
    formConfig.value = next;
}

function updateConfig(next: Record<string, unknown>) {
    formConfig.value = next;
}

// ── Preview (existing behavior, debounced) ─────────────────────────────
const previewRenderedText = computed(() => jsonPreview.value?.rendered);
const previewSubject = computed(
    () =>
        emailPreview.value?.subject ??
        (formConfig.value.subjectTemplate as string | undefined) ??
        formName.value
);

let previewTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    [formProvider, formConfig, formName],
    () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(
            runTemplatePreview,
            UI_CONFIG.templatePreviewDebounceMs
        );
    },
    {deep: true}
);

// Prevents a wasted network call after teardown.
onBeforeUnmount(() => {
    clearTimeout(previewTimer);
});

async function runTemplatePreview() {
    const strategy =
        formProvider.value && previewStrategies[formProvider.value];
    if (!strategy) {
        resetPreview();
        return;
    }
    previewLoading.value = true;
    try {
        await strategy.run();
    } finally {
        previewLoading.value = false;
    }
}

async function previewEmail() {
    const cfg = formConfig.value;
    const templateId =
        typeof cfg.emailTemplateId === 'number'
            ? cfg.emailTemplateId
            : undefined;
    const attachmentsRaw = Array.isArray(cfg.attachments)
        ? (cfg.attachments as {
              filename: string;
              url: string;
              cid?: string;
              contentType?: string;
          }[])
        : undefined;
    const result = await notificationsStore.renderEmailPreview({
        subjectTemplate: cfg.subjectTemplate as string | undefined,
        htmlTemplate: cfg.htmlTemplate as string | undefined,
        textTemplate: cfg.textTemplate as string | undefined,
        ...(templateId ? {emailTemplateId: templateId} : {}),
        ...(attachmentsRaw && attachmentsRaw.length > 0
            ? {attachments: attachmentsRaw}
            : {}),
        ...(props.initial ? {channelId: props.initial.id} : {})
    });
    emailPreview.value = result;
    jsonPreview.value = null;
}

async function previewJsonTemplate(fieldName: string) {
    const template = formConfig.value[fieldName] as string | undefined;
    if (!template) return;
    const result = await notificationsStore.renderTemplate({template});
    jsonPreview.value = result;
    emailPreview.value = null;
}

function resetPreview() {
    emailPreview.value = null;
    jsonPreview.value = null;
}

// ── Secret handling (existing behavior) ────────────────────────────────
function hasSecretFor(path: string): boolean {
    if (
        props.mode !== 'edit' ||
        !props.initial?.secretState.hasSecretFields
    )
        return false;
    const desc = descriptionAt(
        currentDescriptor.value?.configSchema as
            | Record<string, unknown>
            | undefined,
        path
    );
    return !!desc?.toLowerCase().includes('secret field');
}

function descriptionAt(
    schema: Record<string, unknown> | undefined,
    path: string
): string | undefined {
    if (!schema) return undefined;
    let cursor: Record<string, unknown> | undefined = schema;
    for (const segment of path.split('.')) {
        const properties = cursor?.properties as
            | Record<string, Record<string, unknown>>
            | undefined;
        if (!properties?.[segment]) return undefined;
        cursor = properties[segment];
    }
    return cursor?.description as string | undefined;
}

// Backend redacts secrets on read. Empty value on edit would wipe the
// stored secret — drop empty secret keys instead. Recursive for nested
// config (e.g. auth.pass).
function stripStoredSecrets(
    config: Record<string, unknown>
): Record<string, unknown> {
    if (props.mode !== 'edit') return config;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
        if (hasSecretFor(key) && (value === '' || value == null)) continue;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = stripStoredSecrets(
                value as Record<string, unknown>
            );
        } else {
            out[key] = value;
        }
    }
    return out;
}

// ── Lifecycle ──────────────────────────────────────────────────────────
watch(() => visible.value, onModalOpen, {immediate: true});

async function onModalOpen(open: boolean) {
    if (!open) return;
    await loadProviderCatalogue();
    resetForm();
    resetPreview();
    defaultActiveTab();
}

async function loadProviderCatalogue() {
    providersLoading.value = true;
    try {
        await channelsStore.fetchProviders();
    } finally {
        providersLoading.value = false;
    }
}

function resetForm() {
    const t = props.initial;
    formProvider.value = t?.provider ?? null;
    formName.value = t?.name ?? '';
    formEnabled.value = t?.enabled ?? true;
    formConfig.value = t ? {...t.config} : {};
    templateValidity.value = {};
    resetNameError();
}

function defaultActiveTab() {
    activeTab.value = formProvider.value === 'email_smtp' ? 'basics' : 'connection';
}

function selectProvider(p: ChannelProviderDescriptor) {
    formProvider.value = p.key;
    resetPreview();
    defaultActiveTab();
}

function resetProvider() {
    if (!canSwitchProvider.value) return;
    formProvider.value = null;
    formConfig.value = {};
    resetPreview();
}

// ── Footer labels + save flow ──────────────────────────────────────────
const canSave = computed(
    () =>
        !saving.value &&
        !!formProvider.value &&
        isNameValid.value &&
        areTemplatesValid.value
);

const primaryButtonLabel = computed(() => {
    if (justSaved.value) {
        return props.mode === 'create' ? 'Created' : 'Saved';
    }
    if (saving.value) {
        return props.mode === 'create' ? 'Creating…' : 'Saving…';
    }
    return props.mode === 'create' ? 'Create channel' : 'Save changes';
});

// Sync first so Enter-key submit still surfaces the required-name message.
async function handleSave() {
    syncNameError();
    if (!formProvider.value || !isNameValid.value || saving.value) return;
    await runOptimisticSave(persistChannel);
}

function persistChannel(): Promise<Channel | null> {
    return props.mode === 'create' ? createChannel() : updateChannel();
}

function createChannel(): Promise<Channel | null> {
    if (!formProvider.value) return Promise.resolve(null);
    return channelsStore.createChannel({
        provider: formProvider.value,
        name: formName.value.trim(),
        enabled: formEnabled.value,
        config: stripStoredSecrets(formConfig.value)
    });
}

function updateChannel(): Promise<Channel | null> {
    if (!props.initial) return Promise.resolve(null);
    return channelsStore.updateChannel(props.initial.id, {
        name: formName.value.trim(),
        enabled: formEnabled.value,
        config: stripStoredSecrets(formConfig.value)
    });
}

function close() {
    visible.value = false;
}
</script>

<style scoped>
/* ==========================================================================
   Provider catalogue skeleton — tile-shaped shimmer matching the real grid.
   ========================================================================== */

.iem__skeleton {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--gap-sm);
    padding: var(--gap-xs) 0 var(--gap-md);
}

.iem__skeleton-tile {
    height: var(--provider-tile-min-height);
    border-radius: var(--provider-tile-radius);
    background: linear-gradient(
        90deg,
        var(--color-surface-1) 0%,
        var(--color-surface-3) 50%,
        var(--color-surface-1) 100%
    );
    background-size: 200% 100%;
    animation: iem-shimmer 1.4s ease-in-out infinite;
}

/* Left-to-right shimmer — matches every other skeleton in the app */
@keyframes iem-shimmer {
    0% {
        background-position: -200% 0;
    }
    100% {
        background-position: 200% 0;
    }
}

@media (max-width: 900px) {
    .iem__skeleton {
        grid-template-columns: repeat(2, 1fr);
    }
}

/* ==========================================================================
   Step 1 — provider picker
   Primary tiles are a hard 4-up grid on desktop (no auto-fit orphan).
   Advanced row sits below as full-width horizontal tiles.
   ========================================================================== */

.iem__picker {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-xs) 0 var(--gap-md);
}

.iem__picker-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--gap-sm);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: calc(-1 * var(--space-px));
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

@media (max-width: 1100px) {
    .iem__picker-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

@media (max-width: 720px) {
    .iem__picker-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 420px) {
    .iem__picker-grid {
        grid-template-columns: 1fr;
    }
}

/* ==========================================================================
   Step 2 — stage (identity + tab rail + panel + preview)
   ========================================================================== */

.iem__stage {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.iem__identity {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-xl);
}

.iem__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.iem__toggle-row {
    padding-top: var(--gap-xs);
    border-top: 1px solid var(--color-border-subtle);
}

.iem__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.iem__required {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.iem__error {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-danger-text);
    line-height: 1.4;
}

.iem__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

/* Layout — tab rail | panel | preview. 92rem modal canvas budgets:
     rail: 15rem (≈240px — "Authentication" fits with the hint)
     panel: 1.35fr  (form breathing room)
     preview: 1fr with 28rem min (≈448 px — realistic email width)
   ========================================================================== */

.iem__form {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
    padding: 0;
    margin: 0;
    border: 0;
    min-width: 0;
}

.iem__layout {
    /* rail | form | preview — form:preview is the golden ratio 1.618:1. */
    display: grid;
    grid-template-columns:
        var(--form-tab-rail-width)
        minmax(0, 1.618fr)
        minmax(24rem, 1fr);
    gap: var(--gap-md);
    align-items: flex-start;
}

.iem__panel {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
    padding: var(--form-panel-padding);
    background: var(--form-panel-bg);
    border-radius: var(--form-panel-radius);
    min-width: 0;
}

.iem__panel--no-preview {
    grid-column: 2 / -1;
}

.iem__tab-content {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}

.iem__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.iem__section-hdr--spaced {
    margin-top: var(--gap-md);
    padding-top: var(--gap-md);
    border-top: 1px solid var(--color-border-subtle);
}

.iem__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.iem__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.iem__section-desc code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.iem__preview {
    position: sticky;
    top: var(--gap-xs);
    min-width: 0;
    align-self: flex-start;
}

/* ==========================================================================
   Provider chip (header badge) — lets user switch provider in create mode
   ========================================================================== */

.iem__crumbs {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
}

.iem__crumb {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-1) var(--gap-xs);
    border-radius: var(--radius-md);
}

.iem__crumb--link {
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast),
        color var(--duration-fast);
}
.iem__crumb--link:hover {
    background: var(--color-surface-2);
    border-color: var(--color-primary);
    color: var(--color-primary);
}
.iem__crumb--link:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.iem__crumb-arrow {
    font-size: var(--type-caption);
}

.iem__crumb-sep {
    color: var(--color-text-disabled);
    font-size: var(--type-caption);
}

.iem__crumb--current {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}

/* ==========================================================================
   Footer flash — "Saved" meta message
   ========================================================================== */

.iem__flash {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-success-text);
    font-weight: var(--font-semibold);
    animation: iem-flash-in var(--duration-normal) var(--ease-out);
}

@keyframes iem-flash-in {
    from {
        opacity: 0;
        transform: translateY(-2px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* ==========================================================================
   Responsive breakpoints
   ========================================================================== */

@media (max-width: 1280px) {
    .iem__layout {
        grid-template-columns: var(--form-tab-rail-width) minmax(0, 1fr);
    }
    .iem__preview {
        grid-column: 1 / -1;
        position: static;
    }
    .iem__panel--no-preview {
        grid-column: auto;
    }
}

@media (max-width: 900px) {
    .iem__layout {
        grid-template-columns: 1fr;
        gap: var(--gap-sm);
    }
}

@media (max-width: 768px) {
    .iem__identity {
        padding: var(--gap-sm);
    }
    .iem__panel {
        padding: var(--gap-sm);
    }
}

/* ==========================================================================
   Provider-specific hint callout — shown in the Connection tab
   ========================================================================== */

.iem__provider-hint {
    display: flex;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-left: 3px solid var(--color-primary);
    border-radius: var(--radius-lg);
}

.iem__provider-hint-icon {
    flex-shrink: 0;
    font-size: var(--type-subheading);
    color: var(--color-primary);
    margin-top: var(--space-0-5);
}

.iem__provider-hint-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.iem__provider-hint-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.iem__provider-hint-steps {
    margin: 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
}

.iem__provider-hint-steps code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}
</style>

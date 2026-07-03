<template>
    <PageTemplate title="Identity SMTP" :tabs="tabs" fill>
        <div class="smtp-page">
            <h2 class="sr-only">Identity SMTP</h2>

            <header class="smtp-intro">
                <p class="smtp-intro__sub">
                    Outbound mail used by Zitadel for password resets, invite
                    emails and verification codes.
                </p>
                <div
                    class="smtp-status-strip"
                    :class="`smtp-status-strip--${statusTone}`"
                >
                    <span class="smtp-status-strip__dot" />
                    {{ statusLabel }}
                </div>
            </header>

            <form class="smtp-form" @submit.prevent="save">
                <section class="smtp-toggle-card">
                    <div class="smtp-toggle-card__body">
                        <Checkbox
                            v-model="form.enabled"
                            label="Enable SMTP provider"
                        />
                        <p class="smtp-toggle-card__hint">
                            Turn on to configure the fields below. While off,
                            Zitadel sends nothing.
                        </p>
                    </div>
                </section>

                <section class="smtp-section">
                    <header class="smtp-section__head">
                        <i class="fas fa-server smtp-section__icon" aria-hidden="true" />
                        <div>
                            <h3 class="smtp-section__title">Server</h3>
                            <p class="smtp-section__hint">
                                Where your outbound mail relay accepts connections.
                            </p>
                        </div>
                    </header>
                    <div class="smtp-grid smtp-grid--server" :class="{'smtp-grid--off': !form.enabled}">
                        <label class="smtp-field smtp-field--host">
                            <span class="smtp-field__label">SMTP host</span>
                            <input
                                v-model.trim="form.host"
                                class="core-input smtp-input"
                                type="text"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="smtp.example.com"
                                required
                            />
                        </label>
                        <label class="smtp-field smtp-field--port">
                            <span class="smtp-field__label">Port</span>
                            <input
                                v-model.number="form.port"
                                class="core-input smtp-input"
                                type="number"
                                min="1"
                                max="65535"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="587"
                            />
                        </label>
                        <label class="smtp-field smtp-field--encryption">
                            <span class="smtp-field__label">Encryption</span>
                            <select
                                v-model="form.encryption"
                                class="core-input smtp-input"
                                :disabled="!form.enabled"
                                @change="onEncryptionChange"
                            >
                                <option value="starttls">STARTTLS (recommended)</option>
                                <option value="ssl">SSL / TLS</option>
                                <option value="none">None (plain SMTP)</option>
                            </select>
                        </label>
                        <p
                            v-if="portWarning"
                            class="smtp-field__warn smtp-field--wide"
                        >
                            <i class="fas fa-circle-info" aria-hidden="true" />
                            {{ portWarning }}
                        </p>
                    </div>
                </section>

                <section class="smtp-section">
                    <header class="smtp-section__head">
                        <i class="fas fa-paper-plane smtp-section__icon" aria-hidden="true" />
                        <div>
                            <h3 class="smtp-section__title">Sender</h3>
                            <p class="smtp-section__hint">
                                The "From" address users see on every Zitadel email.
                            </p>
                        </div>
                    </header>
                    <div class="smtp-grid" :class="{'smtp-grid--off': !form.enabled}">
                        <label class="smtp-field">
                            <span class="smtp-field__label">From address</span>
                            <input
                                v-model.trim="form.senderAddress"
                                class="core-input smtp-input"
                                type="email"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="no-reply@example.com"
                                required
                            />
                        </label>
                        <label class="smtp-field">
                            <span class="smtp-field__label">From name</span>
                            <input
                                v-model.trim="form.senderName"
                                class="core-input smtp-input"
                                type="text"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="Fleet Manager"
                                required
                            />
                        </label>
                        <label class="smtp-field">
                            <span class="smtp-field__label">Reply-to (optional)</span>
                            <input
                                v-model.trim="form.replyToAddress"
                                class="core-input smtp-input"
                                type="email"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="support@example.com"
                            />
                        </label>
                    </div>
                </section>

                <section class="smtp-section">
                    <header class="smtp-section__head">
                        <i class="fas fa-key smtp-section__icon" aria-hidden="true" />
                        <div>
                            <h3 class="smtp-section__title">Authentication</h3>
                            <p class="smtp-section__hint">
                                Credentials for the SMTP relay. Pick None if
                                your relay accepts unauthenticated mail from
                                this host.
                            </p>
                        </div>
                    </header>
                    <div class="smtp-grid" :class="{'smtp-grid--off': !form.enabled}">
                        <label class="smtp-field">
                            <span class="smtp-field__label">Method</span>
                            <select
                                v-model="form.authMode"
                                class="core-input smtp-input"
                                :disabled="!form.enabled"
                            >
                                <option value="none">None</option>
                                <option value="plain">Username + password</option>
                            </select>
                        </label>
                        <label class="smtp-field">
                            <span class="smtp-field__label">Username</span>
                            <input
                                v-model.trim="form.user"
                                class="core-input smtp-input"
                                type="text"
                                autocomplete="off"
                                :disabled="!form.enabled || form.authMode === 'none'"
                            />
                        </label>
                        <label class="smtp-field">
                            <span class="smtp-field__label">Password</span>
                            <input
                                v-model="form.password"
                                class="core-input smtp-input"
                                type="password"
                                autocomplete="new-password"
                                :disabled="!form.enabled || form.authMode === 'none'"
                                :placeholder="passwordPlaceholder"
                            />
                        </label>
                    </div>
                </section>

                <section class="smtp-section">
                    <header class="smtp-section__head">
                        <i class="fas fa-flask smtp-section__icon" aria-hidden="true" />
                        <div>
                            <h3 class="smtp-section__title">Send a test email</h3>
                            <p class="smtp-section__hint">
                                Verify the credentials end-to-end before
                                saving.
                            </p>
                        </div>
                    </header>
                    <div class="smtp-grid" :class="{'smtp-grid--off': !form.enabled}">
                        <label class="smtp-field">
                            <span class="smtp-field__label">Test receiver</span>
                            <input
                                v-model.trim="form.testReceiver"
                                class="core-input smtp-input"
                                type="email"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="you@example.com"
                            />
                        </label>
                        <label class="smtp-field smtp-field--wide">
                            <span class="smtp-field__label">Description (internal note)</span>
                            <input
                                v-model.trim="form.description"
                                class="core-input smtp-input"
                                type="text"
                                autocomplete="off"
                                :disabled="!form.enabled"
                                placeholder="Production relay via SES, owned by platform team"
                            />
                        </label>
                    </div>
                </section>

                <footer class="smtp-actions">
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="busy"
                        :disabled="!canTest"
                        @click="test"
                    >
                        Send test email
                    </Button>
                    <Button
                        type="blue"
                        size="sm"
                        submit
                        :loading="busy"
                        :disabled="!canSave"
                    >
                        Save
                    </Button>
                </footer>
            </form>

            <p v-if="notice" class="smtp-notice" aria-live="polite">
                <i class="fas fa-circle-check" aria-hidden="true" />
                {{ notice }}
            </p>
            <p v-if="error" class="smtp-error" aria-live="assertive">
                <i class="fas fa-exclamation-triangle" aria-hidden="true" />
                {{ error }}
            </p>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {
    IdentitySetSmtpSettingsParams,
    IdentitySmtpSettings,
    IdentityTestSmtpSettingsParams
} from '@api/identity';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {
    defaultPortForEncryption,
    encryptionFromPort,
    isCommonSmtpPort,
    joinHostPort,
    splitHostPort
} from '@/helpers/smtp-host-port';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

type AuthMode = 'none' | 'plain';
type Encryption = 'none' | 'starttls' | 'ssl';

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const status = ref<IdentitySmtpSettings | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const form = reactive({
    enabled: false,
    authMode: 'none' as AuthMode,
    host: '',
    port: null as number | null,
    encryption: 'starttls' as Encryption,
    senderAddress: '',
    senderName: 'Fleet Manager',
    user: '',
    password: '',
    replyToAddress: '',
    description: 'Fleet Manager identity email',
    testReceiver: ''
});

const canSave = computed(() => {
    if (!form.enabled) return true;
    if (!form.host || !form.senderAddress || !form.senderName) return false;
    if (form.port === null || form.port < 1 || form.port > 65535) return false;
    if (form.authMode === 'plain' && !form.user) return false;
    if (
        form.authMode === 'plain' &&
        !status.value?.passwordSet &&
        !form.password
    ) {
        return false;
    }
    return true;
});

const portWarning = computed<string | null>(() => {
    if (!form.enabled) return null;
    if (form.port === null) return null;
    if (isCommonSmtpPort(form.port)) return null;
    return `Port ${form.port} is unusual for SMTP. Common: 587 STARTTLS · 465 SSL · 25 plain · 2525 fallback.`;
});

function onEncryptionChange(): void {
    if (form.port !== null && isCommonSmtpPort(form.port)) {
        // User already has a sensible port — don't override their choice.
        return;
    }
    form.port = defaultPortForEncryption(form.encryption);
}

const canTest = computed(() => {
    if (!form.enabled || !canSave.value) return false;
    if (form.authMode === 'plain' && !form.password) return false;
    return form.testReceiver.length > 0;
});

const passwordPlaceholder = computed(() =>
    status.value?.passwordSet
        ? 'Leave blank to keep current password'
        : 'Required'
);

const statusTone = computed<'on' | 'warn' | 'off'>(() => {
    if (status.value?.enabled && status.value.configured) return 'on';
    if (status.value?.configured) return 'warn';
    return 'off';
});

const statusLabel = computed<string>(() => {
    if (statusTone.value === 'on') return 'Active and configured';
    if (statusTone.value === 'warn') return 'Configured but disabled';
    return 'Not configured';
});

async function refresh(): Promise<void> {
    error.value = null;
    const current = await sendRPC<IdentitySmtpSettings>(
        'FLEET_MANAGER',
        'Identity.GetSmtpSettings',
        {}
    );
    status.value = current;
    const {host, port} = splitHostPort(current.host);
    Object.assign(form, {
        enabled: current.enabled,
        authMode: current.authMode,
        host,
        port: port ?? defaultPortForEncryption(encryptionFromPort(port, current.tls)),
        encryption: encryptionFromPort(port, current.tls),
        senderAddress: current.senderAddress,
        senderName: current.senderName || 'Fleet Manager',
        user: current.user ?? '',
        password: '',
        replyToAddress: current.replyToAddress ?? '',
        description: current.description ?? 'Fleet Manager identity email',
        testReceiver: form.testReceiver
    });
}

async function save(): Promise<void> {
    if (!canSave.value) return;
    busy.value = true;
    error.value = null;
    notice.value = null;
    try {
        await sendRPC(
            'FLEET_MANAGER',
            'Identity.SetSmtpSettings',
            savePayload()
        );
        await refresh();
        notice.value = 'Saved.';
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}

async function test(): Promise<void> {
    if (!canTest.value) return;
    busy.value = true;
    error.value = null;
    notice.value = null;
    try {
        await sendRPC(
            'FLEET_MANAGER',
            'Identity.TestSmtpSettings',
            testPayload()
        );
        notice.value = 'Test email accepted by Zitadel.';
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}

function savePayload(): IdentitySetSmtpSettingsParams {
    if (!form.enabled) {
        return {enabled: false, authMode: form.authMode};
    }
    return {
        enabled: true,
        ...smtpFields(),
        replyToAddress: emptyToUndefined(form.replyToAddress),
        description: emptyToUndefined(form.description)
    };
}

function testPayload(): IdentityTestSmtpSettingsParams {
    return {
        ...smtpFields(),
        id: status.value?.id,
        receiverAddress: form.testReceiver
    };
}

function smtpFields(): Omit<
    IdentityTestSmtpSettingsParams,
    'receiverAddress' | 'id'
> {
    return {
        authMode: form.authMode,
        host: joinHostPort({host: form.host, port: form.port}),
        senderAddress: form.senderAddress,
        senderName: form.senderName,
        tls: form.encryption !== 'none',
        user: form.authMode === 'plain' ? form.user : undefined,
        password:
            form.authMode === 'plain'
                ? emptyToUndefined(form.password)
                : undefined
    };
}

function emptyToUndefined(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

onMounted(() => {
    void refresh().catch((err) => {
        error.value = err instanceof Error ? err.message : String(err);
    });
});
</script>

<style scoped>
.smtp-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 920px;
    width: 100%;
    margin: 0 auto;
}

.smtp-intro {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}

.smtp-intro__sub {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-width: 60ch;
}

.smtp-status-strip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}

.smtp-status-strip__dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.smtp-status-strip--on .smtp-status-strip__dot { background: var(--color-status-on); }
.smtp-status-strip--warn .smtp-status-strip__dot { background: var(--color-status-warn); }
.smtp-status-strip--off .smtp-status-strip__dot { background: var(--color-status-off); }

.smtp-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.smtp-toggle-card {
    padding: var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
}

.smtp-toggle-card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.smtp-toggle-card__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.smtp-section {
    padding: var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.smtp-section__head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
}

.smtp-section__icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-primary-rgb), 0.12);
    color: var(--color-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--icon-size-sm);
}

.smtp-section__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.smtp-section__hint {
    margin: var(--space-0-5) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.smtp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
}

/* Server row: host (flex) · port (narrow) · encryption (medium). */
.smtp-grid--server {
    grid-template-columns: minmax(0, 2fr) minmax(0, 110px) minmax(0, 1.2fr);
}

@media (max-width: 720px) {
    .smtp-grid--server {
        grid-template-columns: 1fr;
    }
}

.smtp-grid--off {
    opacity: 0.55;
}

.smtp-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.smtp-field--wide {
    grid-column: 1 / -1;
}

.smtp-field__warn {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--color-status-warn-rgb), 0.1);
    border: 1px solid rgba(var(--color-status-warn-rgb), 0.3);
    color: var(--color-status-warn);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.smtp-field__label {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    letter-spacing: 0.02em;
}

.smtp-field__label em {
    color: var(--color-text-tertiary);
    font-style: normal;
    font-weight: var(--font-normal);
}

.smtp-field__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.smtp-field__hint code {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    padding: 0 var(--space-1);
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
}

.smtp-input {
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
}

.smtp-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding-top: var(--space-2);
}

.smtp-notice,
.smtp-error {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
}

.smtp-notice {
    color: var(--color-status-on);
    background: rgba(var(--color-status-on-rgb), 0.08);
    border: 1px solid rgba(var(--color-status-on-rgb), 0.25);
}

.smtp-error {
    color: var(--color-status-off);
    background: rgba(var(--color-status-off-rgb), 0.08);
    border: 1px solid rgba(var(--color-status-off-rgb), 0.25);
}
</style>

<template>
    <div class="esd">
        <section class="esd__section">
            <header class="esd__section-hdr">
                <h3 class="esd__section-title">TLS</h3>
                <p class="esd__section-desc">
                    Unset values fall back to server defaults
                    (<code>FM_SMTP_DEFAULT_TLS_MIN_VERSION</code>,
                    <code>FM_SMTP_DEFAULT_TLS_REJECT_UNAUTHORIZED</code>).
                </p>
            </header>
            <div class="esd__grid">
                <div class="esd__field">
                    <label class="esd__label" :for="tlsMinId">Minimum TLS version</label>
                    <select
                        :id="tlsMinId"
                        class="core-input esd__select"
                        :value="tlsMinVersion"
                        @change="onTlsMin(($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">Default (server)</option>
                        <option value="TLSv1.2">TLSv1.2</option>
                        <option value="TLSv1.3">TLSv1.3</option>
                    </select>
                </div>
                <div class="esd__field esd__field--inline">
                    <Checkbox
                        :model-value="tlsRejectUnauthorized"
                        label="Reject unauthorized certificates"
                        hint="Unset = server default. Uncheck to accept self-signed."
                        @update:model-value="onTlsReject"
                    />
                </div>
            </div>
        </section>

        <section class="esd__section">
            <header class="esd__section-hdr">
                <h3 class="esd__section-title">Timeouts</h3>
                <p class="esd__section-desc">Milliseconds. Empty = server defaults.</p>
            </header>
            <div class="esd__grid esd__grid--thirds">
                <div class="esd__field">
                    <Input
                        v-model="connectionTimeoutProxy"
                        label="Connection"
                        type="number"
                        :min="1000"
                        :max="300000"
                        placeholder="60000"
                    />
                </div>
                <div class="esd__field">
                    <Input
                        v-model="greetingTimeoutProxy"
                        label="Greeting"
                        type="number"
                        :min="1000"
                        :max="300000"
                        placeholder="30000"
                    />
                </div>
                <div class="esd__field">
                    <Input
                        v-model="socketTimeoutProxy"
                        label="Socket"
                        type="number"
                        :min="1000"
                        :max="300000"
                        placeholder="120000"
                    />
                </div>
            </div>
        </section>

        <section v-if="!isCustomPreset" class="esd__section">
            <header class="esd__section-hdr">
                <h3 class="esd__section-title">Preset overrides (optional)</h3>
                <p class="esd__section-desc">
                    Replace the preset's host/port. Leave blank to keep
                    preset defaults.
                </p>
            </header>
            <div class="esd__grid">
                <div class="esd__field esd__field--wide">
                    <Input
                        v-model="hostProxy"
                        label="Host override"
                        :placeholder="presetHost ?? ''"
                    />
                </div>
                <div class="esd__field">
                    <Input
                        v-model="portProxy"
                        label="Port override"
                        type="number"
                        :min="1"
                        :max="65535"
                        :placeholder="String(presetPort ?? '')"
                    />
                </div>
            </div>
        </section>

        <section class="esd__section">
            <header class="esd__section-hdr esd__section-hdr--inline">
                <div>
                    <h3 class="esd__section-title">DKIM signing</h3>
                    <p class="esd__section-desc">
                        Only useful when sending via your own MTA. Transactional
                        relays (SendGrid, Mailgun, SES, Postmark) sign outbound
                        on your behalf.
                    </p>
                </div>
                <Checkbox
                    :model-value="dkimEnabled"
                    label="Sign outgoing"
                    @update:model-value="setDkimEnabled"
                />
            </header>

            <div v-if="dkimEnabled" class="esd__grid">
                <div class="esd__field esd__field--wide">
                    <Input
                        v-model="dkimDomainProxy"
                        label="Signing domain *"
                        placeholder="acme.com"
                    />
                </div>
                <div class="esd__field">
                    <Input
                        v-model="dkimSelectorProxy"
                        label="Selector *"
                        placeholder="fleet2024"
                    />
                </div>
                <div class="esd__field esd__field--wide">
                    <Input
                        v-model="dkimPrivateKeyProxy"
                        label="Private key (PEM) *"
                        type="password"
                        :placeholder="
                            hasStoredDkimKey
                                ? '•••••• (stored) — leave blank to keep'
                                : ''
                        "
                    />
                </div>
            </div>
            <p v-if="dkimEnabled" class="esd__dkim-hint">
                Publish a DNS TXT record at
                <code>{{ dkimSelector || '<selector>' }}._domainkey.{{ dkimDomain || '<domain>' }}</code>
                with the public key. Signing domain must equal or be a parent
                of the <em>From</em> address domain.
            </p>
        </section>
    </div>
</template>

<script setup lang="ts">
import type {
    Channel,
    ChannelProviderDescriptor
} from '@api/channel';
import {computed, useId} from 'vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Input from '@/components/core/Input.vue';

interface SmtpPreset {
    key: string;
    host: string;
    port: number;
    secure: boolean;
}

const config = defineModel<Record<string, unknown>>({required: true});

const props = defineProps<{
    descriptor: ChannelProviderDescriptor;
    endpoint?: Channel | null;
}>();

const tlsMinId = useId();

const presets = computed<SmtpPreset[]>(() => {
    const raw = (props.descriptor as unknown as {smtpPresets?: SmtpPreset[]})
        .smtpPresets;
    return Array.isArray(raw) ? raw : [];
});

const preset = computed(() => (config.value.preset as string) ?? 'custom');
const selectedPreset = computed(() =>
    presets.value.find((p) => p.key === preset.value)
);
const isCustomPreset = computed(() => preset.value === 'custom');
const presetHost = computed(() => selectedPreset.value?.host);
const presetPort = computed(() => selectedPreset.value?.port);

function mergeConfig(patch: Record<string, unknown>) {
    const next = {...config.value};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
    }
    config.value = next;
}

function str(path: string): string {
    const v = config.value[path];
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function setString(path: string, value: string) {
    mergeConfig({[path]: value || undefined});
}
function num(path: string): string {
    const v = config.value[path];
    return typeof v === 'number' ? String(v) : '';
}
function setNumber(path: string, value: string | number) {
    const n = typeof value === 'number' ? value : Number(value);
    mergeConfig({[path]: Number.isFinite(n) && n > 0 ? n : undefined});
}

const hostProxy = computed({
    get: () => str('host'),
    set: (v: string | number) => setString('host', String(v))
});
const portProxy = computed({
    get: () => num('port'),
    set: (v: string | number) => setNumber('port', v)
});
const connectionTimeoutProxy = computed({
    get: () => num('connectionTimeoutMs'),
    set: (v: string | number) => setNumber('connectionTimeoutMs', v)
});
const greetingTimeoutProxy = computed({
    get: () => num('greetingTimeoutMs'),
    set: (v: string | number) => setNumber('greetingTimeoutMs', v)
});
const socketTimeoutProxy = computed({
    get: () => num('socketTimeoutMs'),
    set: (v: string | number) => setNumber('socketTimeoutMs', v)
});

// TLS nested object
const tlsConfig = computed<Record<string, unknown>>(() => {
    const v = config.value.tls;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
});
const tlsMinVersion = computed(
    () => (tlsConfig.value.minVersion as string | undefined) ?? ''
);
const tlsRejectUnauthorized = computed(() => tlsConfig.value.rejectUnauthorized === true);

function mergeTls(patch: Record<string, unknown>) {
    const next = {...tlsConfig.value, ...patch};
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
        if (v !== undefined) cleaned[k] = v;
    }
    mergeConfig({
        tls: Object.keys(cleaned).length > 0 ? cleaned : undefined
    });
}

function onTlsMin(value: string) {
    mergeTls({minVersion: value || undefined});
}
function onTlsReject(value: boolean) {
    mergeTls({rejectUnauthorized: value});
}

// DKIM nested object
const dkimConfig = computed<Record<string, unknown>>(() => {
    const v = config.value.dkim;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
});

const dkimEnabled = computed(
    () => config.value.dkim != null && typeof config.value.dkim === 'object'
);

function dkimStr(key: string): string {
    const v = dkimConfig.value[key];
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function setDkimEnabled(enabled: boolean) {
    if (enabled) {
        if (!dkimEnabled.value) mergeConfig({dkim: {}});
    } else {
        mergeConfig({dkim: undefined});
    }
}

function setDkimStr(key: string, value: string) {
    const next = {...dkimConfig.value, [key]: value || undefined};
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
        if (v !== undefined) cleaned[k] = v;
    }
    mergeConfig({dkim: cleaned});
}

const dkimDomainProxy = computed({
    get: () => dkimStr('domainName'),
    set: (v: string | number) => setDkimStr('domainName', String(v))
});
const dkimSelectorProxy = computed({
    get: () => dkimStr('keySelector'),
    set: (v: string | number) => setDkimStr('keySelector', String(v))
});
const dkimPrivateKeyProxy = computed({
    get: () => dkimStr('privateKey'),
    set: (v: string | number) => setDkimStr('privateKey', String(v))
});
const dkimDomain = computed(() => dkimStr('domainName'));
const dkimSelector = computed(() => dkimStr('keySelector'));

const hasStoredDkimKey = computed(
    () =>
        !!props.endpoint?.secretState?.hasSecretFields &&
        !dkimStr('privateKey')
);
</script>

<style scoped>
.esd {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.esd__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.esd__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.esd__section-hdr--inline {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
}

.esd__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esd__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.esd__section-desc code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.esd__grid {
    display: grid;
    grid-template-columns: minmax(0, 1.618fr) minmax(0, 1fr);
    gap: var(--space-3) var(--space-4);
}

.esd__grid--thirds {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.esd__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.esd__field--wide {
    grid-column: 1 / -1;
}

.esd__field--inline {
    justify-content: center;
}

.esd__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

/* Inherits border + focus ring from .core-input (global). */
.esd__select {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}

.esd__dkim-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
}

.esd__dkim-hint code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

@media (max-width: 640px) {
    .esd__grid,
    .esd__grid--thirds {
        grid-template-columns: 1fr;
    }
    .esd__section-hdr--inline {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>

<template>
    <div class="esa">
        <section class="esa__section">
            <p class="esa__section-desc">
                Personal and workspace mailboxes use an <b>app password</b>.
                Google and Microsoft 365 tenants use <b>OAuth2</b> for
                long-lived access.
            </p>

            <div class="esa__picker" role="radiogroup">
                <label
                    v-for="opt in AUTH_OPTIONS"
                    :key="opt.value"
                    class="esa__picker-opt"
                    :class="{'esa__picker-opt--active': authType === opt.value}"
                >
                    <input
                        type="radio"
                        :value="opt.value"
                        :checked="authType === opt.value"
                        class="esa__picker-input"
                        @change="setAuthType(opt.value)"
                    />
                    <i :class="`fas ${opt.icon} esa__picker-icon`" />
                    <span class="esa__picker-body">
                        <span class="esa__picker-label">{{ opt.label }}</span>
                        <span class="esa__picker-hint">{{ opt.hint }}</span>
                    </span>
                </label>
            </div>
        </section>

        <section class="esa__section">
            <p class="esa__section-desc">
                Secrets stay on the server. Leave blank on edit to keep the
                stored value.
            </p>

            <div class="esa__grid">
                <div class="esa__field esa__field--wide">
                    <Input
                        v-model="authUserProxy"
                        label="Mailbox / user *"
                        placeholder="alerts@acme.com"
                    />
                </div>
            </div>

            <div v-if="authType === 'password'" class="esa__grid">
                <div class="esa__field esa__field--wide">
                    <Input
                        v-model="authPassProxy"
                        label="Password / app password *"
                        type="password"
                        :placeholder="
                            hasStoredAuthSecret('pass')
                                ? '•••••• (stored) — leave blank to keep'
                                : ''
                        "
                    />
                </div>
            </div>

            <template v-else>
                <div class="esa__grid">
                    <div class="esa__field esa__field--wide">
                        <Input v-model="authClientIdProxy" label="Client ID *" />
                    </div>
                    <div class="esa__field esa__field--wide">
                        <Input
                            v-model="authClientSecretProxy"
                            label="Client secret *"
                            type="password"
                            :placeholder="
                                hasStoredAuthSecret('clientSecret')
                                    ? '•••••• (stored) — leave blank to keep'
                                    : ''
                            "
                        />
                    </div>
                    <div
                        v-if="authType === 'oauth2_microsoft'"
                        class="esa__field esa__field--wide"
                    >
                        <Input
                            v-model="authTenantProxy"
                            label="Tenant"
                            placeholder="common"
                        />
                    </div>
                </div>

                <div class="esa__consent" aria-live="polite">
                    <div class="esa__consent-row">
                        <Button
                            type="blue"
                            size="sm"
                            :disabled="!canConnect"
                            :loading="oauthStatus === 'connecting'"
                            @click="$emit('run-consent')"
                        >
                            <i class="fas fa-link" />
                            Connect with
                            {{ authType === 'oauth2_google' ? 'Google' : 'Microsoft' }}
                        </Button>
                        <span
                            v-if="hasStoredAuthSecret('refreshToken')"
                            class="esa__consent-ok"
                        >
                            <i class="fas fa-circle-check" />
                            Refresh token stored
                        </span>
                    </div>
                    <p v-if="!endpointId" class="esa__consent-hint">
                        Save the endpoint first — consent binds the refresh
                        token to the stored client secret.
                    </p>
                    <p
                        v-else-if="oauthStatus === 'success'"
                        class="esa__consent-msg esa__consent-msg--ok"
                    >
                        <i class="fas fa-circle-check" />
                        Connected — refresh token stored. You can now run the
                        test.
                    </p>
                    <p
                        v-else-if="oauthStatus === 'failed'"
                        class="esa__consent-msg esa__consent-msg--err"
                    >
                        <i class="fas fa-circle-xmark" />
                        {{ oauthError ?? 'Consent failed.' }}
                    </p>
                </div>
            </template>
        </section>
    </div>
</template>

<script setup lang="ts">
import type {Channel} from '@api/channel';
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';

type AuthType = 'password' | 'oauth2_google' | 'oauth2_microsoft';
type OAuthStatus = 'idle' | 'connecting' | 'success' | 'failed';

const config = defineModel<Record<string, unknown>>({required: true});

const props = defineProps<{
    endpoint?: Channel | null;
    oauthStatus: OAuthStatus;
    oauthError: string | null;
}>();

defineEmits<{'run-consent': []}>();

const AUTH_OPTIONS = [
    {
        value: 'password' as AuthType,
        label: 'Password / app password',
        icon: 'fa-key',
        hint: 'For Gmail, iCloud, Outlook app passwords, and workspace mailboxes.'
    },
    {
        value: 'oauth2_google' as AuthType,
        label: 'OAuth2 · Google',
        icon: 'fa-google',
        hint: 'Google Workspace and consumer Gmail via client-credentials.'
    },
    {
        value: 'oauth2_microsoft' as AuthType,
        label: 'OAuth2 · Microsoft',
        icon: 'fa-microsoft',
        hint: 'Microsoft 365 / Azure AD tenant with Mail.Send scope.'
    }
];

const authConfig = computed<Record<string, unknown>>(() => {
    const v = config.value.auth;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
});

const authType = computed<AuthType>(
    () => (authConfig.value.type as AuthType) ?? 'password'
);

const endpointId = computed(() => props.endpoint?.id);

function authStr(key: string): string {
    const v = authConfig.value[key];
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function mergeConfig(patch: Record<string, unknown>) {
    const next = {...config.value};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
    }
    config.value = next;
}

function mergeAuth(patch: Record<string, unknown>) {
    const next = {...authConfig.value, ...patch};
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
        if (v !== undefined && v !== '') cleaned[k] = v;
    }
    mergeConfig({auth: cleaned});
}

function setAuthType(t: AuthType) {
    if (t === 'password') {
        mergeAuth({
            type: t,
            clientId: undefined,
            clientSecret: undefined,
            refreshToken: undefined,
            tenant: undefined
        });
    } else {
        mergeAuth({type: t, pass: undefined});
    }
}

function setAuthStr(key: string, value: string) {
    mergeAuth({[key]: value || undefined});
}

const authUserProxy = computed({
    get: () => authStr('user'),
    set: (v: string | number) => setAuthStr('user', String(v))
});
const authPassProxy = computed({
    get: () => authStr('pass'),
    set: (v: string | number) => setAuthStr('pass', String(v))
});
const authClientIdProxy = computed({
    get: () => authStr('clientId'),
    set: (v: string | number) => setAuthStr('clientId', String(v))
});
const authClientSecretProxy = computed({
    get: () => authStr('clientSecret'),
    set: (v: string | number) => setAuthStr('clientSecret', String(v))
});
const authTenantProxy = computed({
    get: () => authStr('tenant'),
    set: (v: string | number) => setAuthStr('tenant', String(v))
});

function hasStoredAuthSecret(
    key: 'pass' | 'clientSecret' | 'refreshToken'
): boolean {
    if (!props.endpoint?.secretState?.hasSecretFields) return false;
    const v = authConfig.value[key];
    return v === undefined || v === '';
}

const canConnect = computed(() => {
    if (props.oauthStatus === 'connecting') return false;
    if (!endpointId.value) return false;
    if (authType.value === 'password') return false;
    if (!authStr('clientId').trim()) return false;
    if (
        !authStr('clientSecret').trim() &&
        !props.endpoint?.secretState?.hasSecretFields
    )
        return false;
    return true;
});
</script>

<style scoped>
.esa {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.esa__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.esa__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.esa__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esa__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.esa__picker {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-2);
}

.esa__picker-opt {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover);
}

.esa__picker-opt:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
}

.esa__picker-opt--active {
    border-color: var(--color-primary);
    background: color-mix(
        in srgb,
        var(--color-primary) 12%,
        var(--color-surface-2)
    );
    box-shadow: var(--shadow-brand-ring);
}

.esa__picker-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.esa__picker-icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-md);
    margin-top: var(--space-0-5);
}

.esa__picker-opt--active .esa__picker-icon {
    color: var(--color-primary-text);
}

.esa__picker-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.esa__picker-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esa__picker-hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

.esa__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
}

.esa__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.esa__field--wide {
    grid-column: 1 / -1;
}

.esa__consent {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}

.esa__consent-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.esa__consent-ok {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-success-text);
}

.esa__consent-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
}

.esa__consent-msg {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    line-height: 1.4;
}

.esa__consent-msg--ok {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}

.esa__consent-msg--err {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}

@media (max-width: 640px) {
    .esa__picker {
        grid-template-columns: 1fr;
    }
    .esa__grid {
        grid-template-columns: 1fr;
    }
}
</style>

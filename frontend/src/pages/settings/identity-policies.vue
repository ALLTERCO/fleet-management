<template>
    <PageTemplate title="Identity" :tabs="tabs" fill>
        <div class="ip-layout">
            <h2 class="sr-only">Identity</h2>

            <div
                v-if="!canAccessPlatformAdmin"
                class="ip-restricted"
                role="status"
            >
                <i class="fas fa-shield-halved ip-restricted__icon" aria-hidden="true" />
                <h3 class="ip-restricted__title">Restricted to provider support</h3>
                <p class="ip-restricted__sub">
                    Identity policies, IdPs, SCIM and JWT-intent settings are
                    managed by Shelly Group platform staff. Contact provider
                    support if you need a change here.
                </p>
            </div>

            <div
                v-else-if="loading"
                class="ip-loading"
                role="status"
                aria-live="polite"
            >
                <i class="fas fa-circle-notch fa-spin ip-loading__icon" aria-hidden="true" />
                <p class="ip-loading__sub">Loading identity policies…</p>
            </div>

            <div
                v-else-if="fetchFailed"
                class="ip-fetch-error"
                role="alert"
            >
                <i class="fas fa-circle-exclamation ip-fetch-error__icon" aria-hidden="true" />
                <h3 class="ip-fetch-error__title">Couldn't load identity policies</h3>
                <p class="ip-fetch-error__sub">{{ error }}</p>
                <button
                    type="button"
                    class="ip-btn"
                    :disabled="busy"
                    @click="refresh"
                >
                    <i class="fas fa-rotate" aria-hidden="true" /> Retry
                </button>
            </div>

            <template v-else>
            <BasicBlock darker title="Login">
                <pre
                    class="ip-block"
                    :class="{'ip-block--unavailable': info?.login === null}"
                >{{ render(info?.login) }}</pre>
            </BasicBlock>

            <BasicBlock darker title="Password complexity">
                <pre
                    class="ip-block"
                    :class="{
                        'ip-block--unavailable':
                            info?.passwordComplexity === null
                    }"
                >{{ render(info?.passwordComplexity) }}</pre>
            </BasicBlock>

            <BasicBlock darker title="Password expiry">
                <pre
                    class="ip-block"
                    :class="{
                        'ip-block--unavailable': info?.passwordExpiry === null
                    }"
                >{{ render(info?.passwordExpiry) }}</pre>
            </BasicBlock>

            <BasicBlock darker title="Lockout">
                <pre
                    class="ip-block"
                    :class="{'ip-block--unavailable': info?.lockout === null}"
                >{{ render(info?.lockout) }}</pre>
            </BasicBlock>

            <BasicBlock darker title="Security">
                <pre
                    class="ip-block"
                    :class="{'ip-block--unavailable': info?.security === null}"
                >{{ render(info?.security) }}</pre>
            </BasicBlock>

            <BasicBlock darker title="Branding">
                <pre
                    class="ip-block"
                    :class="{'ip-block--unavailable': info?.branding === null}"
                >{{ render(info?.branding) }}</pre>
                <p class="ip-hint">
                    Edit branding (logo, colors, fonts, icons) on the
                    <RouterLink to="/settings/branding">
                        Branding page
                    </RouterLink>.
                </p>
            </BasicBlock>

            <BasicBlock darker title="Identity providers">
                <ul v-if="idps.length" class="ip-list">
                    <li v-for="p in idps" :key="p.id" class="ip-list-row">
                        <span class="ip-list-name">{{ p.name }}</span>
                        <span class="ip-list-meta">
                            {{ p.type }} · {{ p.state }}
                        </span>
                        <button
                            v-if="canAccessPlatformAdmin"
                            type="button"
                            class="ip-btn ip-btn--danger"
                            :disabled="busy"
                            @click="onDeleteIdp(p.id)"
                        >
                            Remove
                        </button>
                    </li>
                </ul>
                <p v-else class="ip-empty">No external IdPs configured.</p>

                <details v-if="canAccessPlatformAdmin" class="ip-add-idp">
                    <summary>Add an OIDC identity provider</summary>
                    <form
                        class="ip-form"
                        autocomplete="off"
                        @submit.prevent="onAddIdp"
                    >
                        <label>
                            Display name
                            <input
                                v-model="newIdp.name"
                                type="text"
                                autocomplete="off"
                            />
                        </label>
                        <label>
                            Issuer URL
                            <input
                                v-model="newIdp.issuer"
                                type="url"
                                placeholder="https://accounts.example.com"
                                autocomplete="off"
                            />
                        </label>
                        <label>
                            Client ID
                            <input
                                v-model="newIdp.clientId"
                                type="text"
                                autocomplete="off"
                            />
                        </label>
                        <label>
                            Client secret
                            <input
                                v-model="newIdp.clientSecret"
                                type="password"
                                autocomplete="new-password"
                            />
                        </label>
                        <label class="ip-form-checkbox">
                            <input
                                v-model="newIdp.autoCreation"
                                type="checkbox"
                            />
                            Auto-create FM users on first sign-in
                        </label>
                        <button
                            type="submit"
                            class="ip-btn"
                            :disabled="busy || !canAddIdp"
                        >
                            Add provider
                        </button>
                    </form>
                </details>
            </BasicBlock>

            <BasicBlock darker title="SCIM v2 inbound provisioning">
                <label class="ip-form-checkbox">
                    <input
                        :checked="scim?.enabled"
                        type="checkbox"
                        :disabled="busy || !canAccessPlatformAdmin"
                        @change="onToggleScim(($event.target as HTMLInputElement).checked)"
                    />
                    Enabled (toggles immediately, no redeploy)
                </label>
                <p v-if="scim?.endpoint" class="ip-row">
                    <strong>Endpoint:</strong> <code>{{ scim.endpoint }}</code>
                </p>
                <p v-if="scim?.managementApiHint" class="ip-hint">
                    {{ scim.managementApiHint }}
                </p>
            </BasicBlock>

            <BasicBlock darker title="JWT IdP intent (service-to-service)">
                <p v-if="jwt?.tokenEndpoint" class="ip-row">
                    <strong>Token endpoint:</strong>
                    <code>{{ jwt.tokenEndpoint }}</code>
                </p>
                <p v-if="jwt?.grantType" class="ip-row">
                    <strong>Grant type:</strong>
                    <code>{{ jwt.grantType }}</code>
                </p>
                <p v-if="jwt?.documentation" class="ip-hint">
                    {{ jwt.documentation }}
                </p>
            </BasicBlock>

            <BasicBlock
                v-if="canAccessPlatformAdmin"
                darker
                title="Action V2 signing keys"
            >
                <p class="ip-hint">
                    Rotate the HMAC keys Zitadel uses to sign GDPR + grant-removed
                    webhook deliveries. New keys take effect immediately — no
                    redeploy required. Previous keys stay valid through the
                    replay window (<code>FM_ZITADEL_ACTION_REPLAY_SKEW_MS</code>,
                    default 5 min).
                </p>
                <button
                    type="button"
                    class="ip-btn ip-btn--warn"
                    :disabled="busy"
                    @click="onRotate"
                >
                    Rotate signing keys
                </button>
                <p v-if="rotateResult" class="ip-row">
                    <i class="fas fa-check-circle ok" />
                    Rotation complete at
                    <code>{{ rotateResult.rotatedAt }}</code> ·
                    correlation <code>{{ rotateResult.correlationId }}</code>.
                    GDPR target <code>{{ rotateResult.gdprTargetId }}</code>,
                    grant target <code>{{ rotateResult.grantTargetId }}</code>.
                </p>
            </BasicBlock>

            <p v-if="error" class="ip-error">
                <i class="fas fa-exclamation-triangle" /> {{ error }}
            </p>
            </template>
        </div>
        <ConfirmationModal ref="confirmModal" />
    </PageTemplate>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import {RouterLink} from 'vue-router';
import BasicBlock from '@/components/core/BasicBlock.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

interface IdentityPolicies {
    login: Record<string, unknown> | null;
    passwordComplexity: Record<string, unknown> | null;
    passwordExpiry: Record<string, unknown> | null;
    lockout: Record<string, unknown> | null;
    security: Record<string, unknown> | null;
    branding: Record<string, unknown> | null;
    identityProviders: Array<Record<string, unknown>> | null;
}

interface IdentityProvider {
    id: string;
    name: string;
    type: string;
    state: string;
}

interface ScimSettings {
    enabled: boolean;
    endpoint: string;
    managementApiHint?: string;
}

interface JwtIntentSettings {
    enabled: boolean;
    tokenEndpoint: string;
    grantType: string;
    documentation: string;
}

interface RotateResult {
    gdprTargetId: string;
    grantTargetId: string;
    rotatedAt: string;
    correlationId: string;
}

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const info = ref<IdentityPolicies | null>(null);
const idps = ref<IdentityProvider[]>([]);
const scim = ref<ScimSettings | null>(null);
const jwt = ref<JwtIntentSettings | null>(null);
const rotateResult = ref<RotateResult | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const toast = useToastStore();
const confirmModal = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);
const loading = ref(true);
const fetchFailed = ref(false);

const newIdp = reactive({
    name: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    autoCreation: true
});

const canAddIdp = computed(
    () =>
        newIdp.name.length > 0 &&
        newIdp.issuer.startsWith('http') &&
        newIdp.clientId.length > 0 &&
        newIdp.clientSecret.length > 0
);

function render(value: unknown): string {
    if (value === null) return '(unavailable — fetch failed)';
    if (value === undefined) return '(loading…)';
    if (Array.isArray(value) && value.length === 0) return '(empty)';
    if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value as Record<string, unknown>).length === 0
    ) {
        return '(empty)';
    }
    return JSON.stringify(value, null, 2);
}

const authStore = useAuthStore();
const {canAccessPlatformAdmin} = storeToRefs(authStore);

async function refresh(): Promise<void> {
    error.value = null;
    fetchFailed.value = false;
    if (!canAccessPlatformAdmin.value) {
        error.value =
            'Identity policies are restricted to provider support.';
        return;
    }
    loading.value = true;
    try {
        const [policies, idpList, scimRes, jwtRes] = await Promise.all([
            sendRPC<IdentityPolicies>(
                'FLEET_MANAGER',
                'permission.GetIdentityPolicies',
                {}
            ),
            sendRPC<IdentityProvider[]>(
                'FLEET_MANAGER',
                'Identity.ListIdentityProviders',
                {}
            ),
            sendRPC<ScimSettings>(
                'FLEET_MANAGER',
                'Identity.GetScimSettings',
                {}
            ),
            sendRPC<JwtIntentSettings>(
                'FLEET_MANAGER',
                'Identity.GetJwtIntentSettings',
                {}
            )
        ]);
        info.value = policies;
        idps.value = Array.isArray(idpList) ? idpList : [];
        scim.value = scimRes;
        jwt.value = jwtRes;
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Request failed');
        fetchFailed.value = true;
    } finally {
        loading.value = false;
    }
}

async function onAddIdp(): Promise<void> {
    if (!canAddIdp.value) return;
    busy.value = true;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Identity.AddOidcProvider', {
            name: newIdp.name,
            issuer: newIdp.issuer,
            clientId: newIdp.clientId,
            clientSecret: newIdp.clientSecret,
            autoCreation: newIdp.autoCreation
        });
        Object.assign(newIdp, {
            name: '',
            issuer: '',
            clientId: '',
            clientSecret: '',
            autoCreation: true
        });
        await refresh();
        toast.success('Identity provider added');
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Request failed');
    } finally {
        busy.value = false;
    }
}

function onDeleteIdp(id: string): void {
    confirmModal.value?.storeAction(
        async () => {
            busy.value = true;
            error.value = null;
            try {
                await sendRPC('FLEET_MANAGER', 'Identity.DeleteIdentityProvider', {
                    id
                });
                await refresh();
                toast.success('Identity provider removed');
            } catch (err) {
                error.value = rpcErrorMessage(err, 'Request failed');
            } finally {
                busy.value = false;
            }
        },
        {
            title: 'Remove identity provider',
            message: 'Users signing in through this provider lose access.',
            confirmLabel: 'Remove'
        }
    );
}

function onRotate(): void {
    confirmModal.value?.storeAction(
        async () => {
            busy.value = true;
            error.value = null;
            rotateResult.value = null;
            try {
                rotateResult.value = await sendRPC<RotateResult>(
                    'FLEET_MANAGER',
                    'Identity.RotateActionSigningKeys',
                    {}
                );
            } catch (err) {
                error.value = rpcErrorMessage(err, 'Request failed');
            } finally {
                busy.value = false;
            }
        },
        {
            title: 'Rotate signing keys',
            message:
                'Previous keys stay valid for the replay window so in-flight events keep verifying. No redeploy needed.',
            confirmLabel: 'Rotate'
        }
    );
}

async function onToggleScim(enabled: boolean): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Identity.SetScimEnabled', {enabled});
        const fresh = await sendRPC<ScimSettings>(
            'FLEET_MANAGER',
            'Identity.GetScimSettings',
            {}
        );
        scim.value = fresh;
        toast.success(enabled ? 'SCIM enabled' : 'SCIM disabled');
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Request failed');
    } finally {
        busy.value = false;
    }
}

onMounted(() => void refresh());
</script>

<style scoped>
.ip-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.ip-hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    margin-top: var(--space-2);
}

.ip-row {
    margin: var(--space-1) 0;
    font-size: var(--type-body);
}

.ip-row .ok {
    color: var(--color-status-on);
}

.ip-row .off {
    color: var(--color-text-tertiary);
}

.ip-block {
    margin: 0;
    padding: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    word-break: break-all;
}

.ip-block--unavailable {
    color: var(--color-status-off);
    border: 1px dashed var(--color-status-off);
    background: transparent;
}

.ip-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.ip-list-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
}

.ip-list-name {
    flex: 1;
    font-weight: var(--font-semibold);
}

.ip-list-meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.ip-empty {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.ip-add-idp {
    margin-top: var(--space-3);
}

.ip-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
}

.ip-form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ip-form input[type='text'],
.ip-form input[type='url'],
.ip-form input[type='password'] {
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.ip-form-checkbox {
    flex-direction: row;
    align-items: center;
    gap: var(--space-1);
}

.ip-btn {
    height: var(--btn-h-md);
    padding: 0 var(--space-4);
    background: var(--color-primary);
    color: var(--color-text-on-primary);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: 0.01em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    align-self: flex-start;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition:
        filter var(--duration-fast),
        transform var(--duration-fast);
}

.ip-btn:hover:not(:disabled) {
    filter: brightness(1.1);
}

.ip-btn:active:not(:disabled) {
    transform: translateY(1px);
}

.ip-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
}

.ip-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
}

.ip-btn--warn {
    background: var(--color-status-warn);
    border-color: var(--color-status-warn);
    color: var(--color-text-on-warn);
}

.ip-btn--danger {
    background: var(--color-status-off);
    border-color: var(--color-status-off);
    color: var(--color-text-on-danger);
}

.ip-error {
    color: var(--color-status-off);
}

.ip-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-tertiary);
}

.ip-loading__icon {
    font-size: var(--type-display);
    color: var(--color-primary);
}

.ip-loading__sub {
    margin: 0;
    font-size: var(--type-body);
}

.ip-fetch-error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    max-width: 56ch;
    margin: auto;
}

.ip-fetch-error__icon {
    font-size: var(--type-display);
    color: var(--color-status-off);
}

.ip-fetch-error__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.ip-fetch-error__sub {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.ip-restricted {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    margin: auto;
    max-width: 48ch;
    color: var(--color-text-secondary);
}

.ip-restricted__icon {
    font-size: var(--type-display);
    color: var(--color-text-quaternary);
}

.ip-restricted__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.ip-restricted__sub {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: var(--leading-relaxed);
}
</style>

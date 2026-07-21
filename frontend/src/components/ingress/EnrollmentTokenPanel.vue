<template>
    <div class="etp">
        <div v-if="!tokenResult" class="etp__form">
            <p class="etp__hint">
                One-time link. Valid for {{ validityLabel }}.
            </p>
            <div class="etp__fields">
                <FormField label="Security profile">
                    <Dropdown
                        :options="profileLabels"
                        :default="selectedProfileLabel"
                        @selected="onProfileSelected"
                    />
                </FormField>
                <FormField label="Valid for">
                    <Dropdown
                        :options="VALIDITY_LABELS"
                        :default="validityLabel"
                        @selected="onValiditySelected"
                    />
                </FormField>
                <Button
                    type="blue"
                    :loading="saving"
                    @click="generate"
                >
                    Generate
                </Button>
            </div>
        </div>

        <template v-else>
            <IngressSetupLink
                :url="tokenResult.url"
                :expires-at="tokenResult.expiresAt"
            />
            <div class="etp__actions">
                <Button type="blue-hollow" size="sm" @click="reset">
                    Generate another
                </Button>
            </div>
        </template>

        <section v-if="activeTokens.length" class="etp__active">
            <h5 class="etp__active-title">Active tokens</h5>
            <ul class="etp__token-list">
                <li
                    v-for="token in activeTokens"
                    :key="token.id"
                    class="etp__token"
                >
                    <CountdownRing
                        :start-at="token.createdAt"
                        :end-at="token.notAfter"
                        :now-ms="now"
                    />
                    <code class="etp__token-prefix">{{ token.tokenPrefix }}…</code>
                    <span class="etp__token-spacer" />
                    <div class="etp__token-actions">
                        <Button
                            v-if="sessionValueFor(token)"
                            type="blue-hollow"
                            size="xs"
                            narrow
                            title="Copy token"
                            aria-label="Copy token"
                            @click="copyToken(token)"
                        >
                            <i class="fas fa-copy" aria-hidden="true" />
                        </Button>
                        <Button
                            type="red"
                            size="xs"
                            narrow
                            :loading="revoking === token.id"
                            title="Revoke token"
                            aria-label="Revoke token"
                            @click="confirmRevoke(token)"
                        >
                            <i class="fas fa-ban" aria-hidden="true" />
                        </Button>
                    </div>
                </li>
            </ul>
        </section>
        <ConfirmationModal ref="revokeConfirm" />
    </div>
</template>

<script setup lang="ts">
import type {DeviceIngressProfileId} from '@api/deviceIngress';
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {
    createEnrollmentToken,
    type EnrollmentToken,
    type EnrollmentTokenSummary,
    type IngressProfile,
    listProfiles
} from '@/api/deviceIngressRpc';
import Button from '@/components/core/Button.vue';
import CountdownRing from '@/components/core/CountdownRing.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import IngressSetupLink from '@/components/ingress/IngressSetupLink.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {
    effectiveTokenState,
    rememberSessionToken,
    useEnrollmentTokens
} from '@/composables/useEnrollmentTokens';
import {useIngressMutation} from '@/composables/useIngressMutation';
import {SECOND_TICK_MS, useNowTicker} from '@/composables/useNowTicker';
import {useToastStore} from '@/stores/toast';

// The enrollment-token flow, the main way a physical device joins the
// fleet. One home for it; every surface embeds this panel.

const DEFAULT_PROFILE_LABEL = 'WSS + token';
const VALIDITY_MINUTES: Record<string, number> = {
    '15 minutes': 15,
    '1 hour': 60,
    '24 hours': 1440
};
const VALIDITY_LABELS = Object.keys(VALIDITY_MINUTES);

const toast = useToastStore();
const {saving, run} = useIngressMutation();
const {tokens, revoking, load, revoke, sessionValueFor} =
    useEnrollmentTokens();
const {now, release} = useNowTicker(SECOND_TICK_MS);
onBeforeUnmount(release);

const minutes = ref(15);
const tokenProfileId = ref<DeviceIngressProfileId | ''>('');
const profiles = ref<IngressProfile[]>([]);
const tokenResult = ref<EnrollmentToken | null>(null);

// Token surfaces must only offer token profiles.
const tokenProfiles = computed(() =>
    profiles.value.filter((p) => p.securityModel === 'direct_token')
);

const profileLabels = computed(() => [
    DEFAULT_PROFILE_LABEL,
    ...tokenProfiles.value.map((p) => p.name)
]);

const selectedProfileLabel = computed(
    () =>
        tokenProfiles.value.find((p) => p.id === tokenProfileId.value)?.name ??
        DEFAULT_PROFILE_LABEL
);

const validityLabel = computed(
    () =>
        VALIDITY_LABELS.find(
            (label) => VALIDITY_MINUTES[label] === minutes.value
        ) ?? VALIDITY_LABELS[0]
);

const activeTokens = computed(() =>
    tokens.value.filter(
        (t) => effectiveTokenState(t, now.value) === 'active'
    )
);

function onProfileSelected(label: string): void {
    tokenProfileId.value =
        tokenProfiles.value.find((p) => p.name === label)?.id ?? '';
}

function onValiditySelected(label: string): void {
    minutes.value = VALIDITY_MINUTES[label] ?? 15;
}

function generate(): void {
    void run(async () => {
        const result = await createEnrollmentToken(
            minutes.value,
            tokenProfileId.value || undefined
        );
        tokenResult.value = result;
        rememberSessionToken(result.tokenOnce);
        await load();
    }, 'Token ready');
}

function reset(): void {
    tokenResult.value = null;
}

const revokeConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);

function confirmRevoke(token: EnrollmentTokenSummary): void {
    revokeConfirm.value?.storeAction(() => revoke(token.id), {
        title: 'Revoke token',
        message: `Devices can no longer enroll with ${token.tokenPrefix}…`,
        confirmLabel: 'Revoke'
    });
}

function copyToken(token: EnrollmentTokenSummary): void {
    const value = sessionValueFor(token);
    if (!value) return;
    void navigator.clipboard?.writeText(value);
    toast.success('Token copied');
}

onMounted(async () => {
    void load();
    if (profiles.value.length === 0) {
        profiles.value = await listProfiles()
            .then((r) => r.items)
            .catch(() => []);
    }
});
</script>

<style scoped>
.etp {
    display: grid;
    gap: var(--gap-md);
    max-width: 44rem;
}
.etp__form {
    display: grid;
    gap: var(--gap-sm);
}
.etp__hint {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
/* Fields sized to their content, action aligned to the field row. */
.etp__fields {
    display: grid;
    grid-template-columns: minmax(16rem, 1.6fr) minmax(9rem, 1fr) auto;
    gap: var(--gap-sm);
    align-items: end;
}
.etp__actions {
    display: flex;
    justify-content: flex-start;
}
.etp__active {
    display: grid;
    gap: var(--gap-xs);
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--divider-hairline);
}
.etp__active-title {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.etp__token-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--gap-xs);
    /* ~5 rows, then the list scrolls instead of growing the modal. */
    max-height: 16rem;
    overflow-y: auto;
}
.etp__token {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    min-height: var(--space-10);
}
.etp__token-actions {
    display: flex;
    gap: var(--space-2);
}
/* Prefix chip — the value itself is never retrievable, only its start. */
.etp__token-prefix {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
}
.etp__token-spacer {
    flex: 1;
}

@media (max-width: 640px) {
    .etp__fields {
        grid-template-columns: minmax(0, 1fr);
        align-items: stretch;
    }
}
</style>

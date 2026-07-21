<template>
    <div class="usp">
        <div class="usp-toolbar">
            <div v-if="!userId" class="search-pill">
                <i class="fas fa-search search-pill__icon" />
                <input
                    v-model.trim="search"
                    type="text"
                    class="search-pill__input"
                    placeholder="Filter by user…"
                    aria-label="Filter sessions"
                />
            </div>
            <Button type="white" narrow @click="refresh">
                Refresh
            </Button>
        </div>

        <DataList
            :rows="filtered"
            :columns="columns"
            row-key="id"
            :loading="loading"
            empty-message="No active sessions."
        >
            <template #cell-user="{row}">
                <span>{{ row.user?.displayName ?? row.user?.loginName ?? '—' }}</span>
                <span
                    v-if="isCurrentUserSession(row)"
                    class="usp-self-badge"
                    title="One of your active sessions"
                >
                    you
                </span>
            </template>
            <template #cell-factors="{row}">
                <span class="usp-factors">
                    <span v-if="row.factors.password" class="usp-tag">pwd</span>
                    <span v-if="row.factors.webAuthN" class="usp-tag">passkey</span>
                    <span v-if="row.factors.totp" class="usp-tag">totp</span>
                    <span v-if="row.factors.otpSms" class="usp-tag">sms</span>
                    <span v-if="row.factors.otpEmail" class="usp-tag">email</span>
                    <span v-if="row.factors.intent" class="usp-tag">idp</span>
                </span>
            </template>
            <template #cell-userAgent="{row}">
                <span class="usp-mono">
                    {{ row.userAgent?.ip ?? '' }}
                    {{ row.userAgent?.description ?? '' }}
                </span>
            </template>
            <template #cell-creationDate="{row}">
                <span :title="timeTitle(row.creationDate)">
                    {{ createdLabel(row.creationDate) }}
                </span>
            </template>
            <template #cell-expirationDate="{row}">
                <span :title="timeTitle(row.expirationDate)">
                    {{ expiresLabel(row.expirationDate) }}
                </span>
            </template>
            <template #cell-actions="{row}">
                <button
                    v-if="canRevoke"
                    class="usp-revoke"
                    title="Revoke this session"
                    :disabled="revokingId === row.id"
                    @click="revoke(row.id)"
                >
                    <i class="fas fa-times" />
                    {{ revokingId === row.id ? 'Revoking…' : 'Revoke' }}
                </button>
            </template>
        </DataList>

        <p v-if="error" class="usp-error">
            <i class="fas fa-exclamation-triangle" /> {{ error }}
        </p>

        <ConfirmationModal ref="confirmRevokeRef">
            <template #title>
                <h3>Revoke this session? The user will be signed out.</h3>
            </template>
        </ConfirmationModal>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {formatRelative, formatTime, formatUntil} from '@/helpers/format';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/websocket';

interface SessionRow {
    id: string;
    creationDate?: string;
    changeDate?: string;
    expirationDate?: string;
    user?: {
        id: string;
        loginName?: string;
        displayName?: string;
        organizationId?: string;
    };
    factors: {
        password: boolean;
        webAuthN: boolean;
        totp: boolean;
        otpSms: boolean;
        otpEmail: boolean;
        intent: boolean;
        recoveryCode: boolean;
    };
    userAgent?: {
        fingerprintId?: string;
        ip?: string;
        description?: string;
    };
}

// userId=null → org-wide listing (admin-only column set with search).
// userId=string → that user's sessions only (no search field).
const props = defineProps<{userId: string | null}>();

const authStore = useAuthStore();
const rpc = useRpcPermissions();
const canRevoke = computed(() => rpc.canCall('User.DeleteSession'));
const currentUserSub = computed(() => authStore.zitadelUser?.sub ?? null);

const items = ref<SessionRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref('');
const revokingId = ref<string | null>(null);
const confirmRevokeRef = ref<InstanceType<typeof ConfirmationModal> | null>(null);

const columns = computed<DataColumn[]>(() => {
    const base: DataColumn[] = [
        {key: 'factors', label: 'Factors'},
        {key: 'userAgent', label: 'Origin'},
        {key: 'creationDate', label: 'Created'},
        {key: 'expirationDate', label: 'Expires'},
        {key: 'actions', label: ''}
    ];
    return props.userId ? base : [{key: 'user', label: 'User'}, ...base];
});

const filtered = computed(() => {
    if (props.userId || !search.value) return items.value;
    const q = search.value.toLowerCase();
    return items.value.filter((s) => {
        const fields = [
            s.user?.loginName,
            s.user?.displayName,
            s.user?.id,
            s.userAgent?.ip,
            s.userAgent?.description
        ];
        return fields.some((f) => f?.toLowerCase().includes(q));
    });
});

async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const params = props.userId ? {userId: props.userId} : {};
        const resp = await sendRPC<{items: SessionRow[]}>(
            'FLEET_MANAGER',
            'User.ListSessions',
            params
        );
        items.value = resp.items ?? [];
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Could not load sessions');
        items.value = [];
    } finally {
        loading.value = false;
    }
}

function timeTitle(value?: string): string {
    return value ? formatTime(value) : '';
}

function createdLabel(value?: string): string {
    return value ? formatRelative(value) : '—';
}

// Sessions normally expire in the future; a stale row past its
// expiry flips to "Nh ago" instead of going negative.
function expiresLabel(value?: string): string {
    if (!value) return '—';
    return new Date(value).getTime() > Date.now()
        ? formatUntil(value)
        : formatRelative(value);
}

function isCurrentUserSession(row: SessionRow): boolean {
    return !!currentUserSub.value && row.user?.id === currentUserSub.value;
}

function revoke(sessionId: string): void {
    confirmRevokeRef.value?.storeAction(async () => {
        revokingId.value = sessionId;
        try {
            await sendRPC('FLEET_MANAGER', 'User.DeleteSession', {sessionId});
            items.value = items.value.filter((s) => s.id !== sessionId);
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
        } finally {
            revokingId.value = null;
        }
    });
}

watch(() => props.userId, () => void refresh());
onMounted(() => void refresh());
</script>

<style scoped>
.usp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.usp-toolbar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
}
.usp-factors {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.usp-tag {
    font-size: var(--type-caption);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--color-primary-text);
    border: 1px solid var(--color-primary-text);
}
.usp-mono {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
.usp-revoke {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: transparent;
    color: var(--color-status-off);
    border: 1px solid var(--color-status-off);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--type-caption);
}
.usp-revoke:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.usp-error {
    color: var(--color-status-off);
}
.usp-self-badge {
    display: inline-block;
    margin-left: var(--space-2);
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background-color: var(--color-success-subtle);
    color: var(--color-success-text);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: lowercase;
}
</style>

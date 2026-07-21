// Enrollment token bookkeeping shared by the add-device token tab and the
// Security settings page — one loader, one revoke path, one expiry rule.

import {ref} from 'vue';
import {
    type EnrollmentTokenSummary,
    listEnrollmentTokens,
    revokeEnrollmentToken
} from '@/api/deviceIngressRpc';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';

// Tokens minted this app session, keyed by their one-time value. The value
// is only ever shown once by the backend, so this in-memory note is the
// only place a copy button can still be offered.
const sessionTokenValues = ref<string[]>([]);

export function rememberSessionToken(tokenOnce: string): void {
    sessionTokenValues.value = [...sessionTokenValues.value, tokenOnce];
}

/** Lifecycle state including client-side expiry of still-"active" rows. */
export function effectiveTokenState(
    token: EnrollmentTokenSummary,
    nowMs: number
): 'active' | 'consumed' | 'revoked' | 'expired' {
    if (token.state !== 'active') return token.state;
    return new Date(token.notAfter).getTime() > nowMs ? 'active' : 'expired';
}

export function useEnrollmentTokens() {
    const toast = useToastStore();
    const tokens = ref<EnrollmentTokenSummary[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const revoking = ref<string | null>(null);

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            tokens.value = (await listEnrollmentTokens()).items;
        } catch (err) {
            error.value = rpcErrorMessage(err, 'Failed to load tokens');
        } finally {
            loading.value = false;
        }
    }

    async function revoke(id: string): Promise<void> {
        revoking.value = id;
        try {
            await revokeEnrollmentToken(id);
            toast.success('Token revoked');
            await load();
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to revoke token'));
        } finally {
            revoking.value = null;
        }
    }

    /** The one-time value for a listed row, when minted this app session. */
    function sessionValueFor(token: EnrollmentTokenSummary): string | null {
        return (
            sessionTokenValues.value.find((value) =>
                value.startsWith(token.tokenPrefix)
            ) ?? null
        );
    }

    return {
        tokens,
        loading,
        error,
        revoking,
        load,
        revoke,
        sessionValueFor
    };
}

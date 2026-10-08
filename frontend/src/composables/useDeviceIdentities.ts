// Device credential identities: enable/disable and rotation entry point,
// paired with the soonest-expiring credential per identity for the UI badge.

import {computed, ref} from 'vue';
import {
    disableIdentity,
    enableIdentity,
    getAuthMethods,
    type IngressIdentity,
    listExpiringCredentials,
    listIdentities,
    PAGE_SIZE,
    startRotation
} from '@/api/deviceIngressRpc';
import {rpcErrorInfo, rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';

// The list is module-level so the page keeps one copy of it across remounts.
// Only the loader writes it; actions stay per caller.
const identities = ref<IngressIdentity[]>([]);
const expiring = ref<Map<string, string | null>>(new Map());
const loading = ref(false);
const error = ref<string | null>(null);
// How many identities exist, so the panel can say when it shows only some.
const total = ref(0);
// 0-based page, alongside the list it selects.
const page = ref(0);
// Null until the one-time AuthMethods load answers; false shows the notice.
const keysChecked = ref<boolean | null>(null);
// Bumped by every load and by the reset, so only the newest one may write.
let loadSeq = 0;
// AuthMethods does not change while the server runs, so it loads once.
let authMethodsLoaded = false;

// ResourceConflict: Rotation.Start refuses a batch when some identities in
// it cannot be rotated (already rotating, or not active).
const RESOURCE_CONFLICT_CODE = 1003;

/** Splits `ids` into runs of at most `size`, in order. */
function chunk<T>(ids: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < ids.length; i += size)
        chunks.push(ids.slice(i, i + size));
    return chunks;
}

/** The identityIds a ResourceConflict named unrotatable, or null otherwise. */
function blockedIdentityIds(err: unknown): string[] | null {
    const info = rpcErrorInfo(err);
    if (info?.code !== RESOURCE_CONFLICT_CODE) return null;
    const blocked = info.data?.details?.blocked;
    if (!Array.isArray(blocked)) return null;
    const ids: string[] = [];
    for (const entry of blocked) {
        const identityId = (entry as {identityId?: unknown} | null)?.identityId;
        if (typeof identityId === 'string') ids.push(identityId);
    }
    return ids;
}

/** Drops the cached list so rows can never outlive the session that read them. */
export function resetDeviceIdentities(): void {
    loadSeq += 1;
    identities.value = [];
    expiring.value = new Map();
    total.value = 0;
    page.value = 0;
    error.value = null;
    loading.value = false;
}

export function useDeviceIdentities() {
    const toast = useToastStore();
    const busy = ref<string | null>(null);
    // identityIds that never got a rotation job from the most recent rotate()
    // call: 1003-blocked ids plus every id of a chunk that failed with some
    // other error. The caller leaves these selected so a retry is possible.
    const rotationNotStarted = ref<Set<string>>(new Set());

    const hasPrev = computed(() => page.value > 0);
    const hasNext = computed(() => (page.value + 1) * PAGE_SIZE < total.value);

    /** True when this call was still the newest one and wrote its result. */
    async function fetchPage(): Promise<boolean> {
        const seq = ++loadSeq;
        loading.value = true;
        error.value = null;
        try {
            const [identityList, credentialList] = await Promise.all([
                listIdentities({
                    limit: PAGE_SIZE,
                    offset: page.value * PAGE_SIZE
                }),
                listExpiringCredentials()
            ]);
            if (seq !== loadSeq) return false;
            identities.value = identityList.items;
            total.value = identityList.total ?? identityList.items.length;
            const soonest = new Map<string, string | null>();
            for (const credential of credentialList.items) {
                const current = soonest.get(credential.identityId);
                if (
                    current === undefined ||
                    isSooner(credential.notAfter, current)
                ) {
                    soonest.set(credential.identityId, credential.notAfter);
                }
            }
            expiring.value = soonest;
        } catch (err) {
            if (seq !== loadSeq) return false;
            error.value = rpcErrorMessage(err, 'Failed to load identities');
        } finally {
            if (seq === loadSeq) loading.value = false;
        }
        return seq === loadSeq;
    }

    /** Loads AuthMethods once; a failure leaves keysChecked null (no notice). */
    async function loadAuthMethods(): Promise<void> {
        if (authMethodsLoaded) return;
        authMethodsLoaded = true;
        try {
            keysChecked.value = (await getAuthMethods()).keysChecked;
        } catch {
            authMethodsLoaded = false;
        }
    }

    async function load(): Promise<void> {
        void loadAuthMethods();
        const applied = await fetchPage();
        if (!applied || error.value !== null) return;
        // A shrunken fleet leaves the pager past the end; land on the last page.
        if (identities.value.length > 0 || page.value === 0) return;
        const last = Math.max(0, Math.ceil(total.value / PAGE_SIZE) - 1);
        if (last === page.value) return;
        page.value = last;
        await fetchPage();
    }

    async function enable(id: string): Promise<void> {
        busy.value = id;
        try {
            await enableIdentity(id);
            toast.success('Identity enabled');
            await load();
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to enable identity'));
        } finally {
            busy.value = null;
        }
    }

    async function disable(id: string): Promise<void> {
        busy.value = id;
        try {
            await disableIdentity(id);
            toast.success('Identity disabled');
            await load();
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to disable identity'));
        } finally {
            busy.value = null;
        }
    }

    /**
     * One startRotation call per PAGE_SIZE chunk, sequential so a large
     * fleet-wide selection never opens more than PAGE_SIZE jobs per request.
     * A chunk a ResourceConflict partly refuses is retried once, minus the
     * identities it named; those stay skipped rather than blocking the rest.
     */
    async function rotateChunk(
        ids: string[]
    ): Promise<{started: number; skipped: string[]}> {
        try {
            const result = await startRotation(ids);
            return {started: result.jobs.length, skipped: []};
        } catch (err) {
            const blocked = blockedIdentityIds(err);
            if (blocked === null) throw err;
            const blockedSet = new Set(blocked);
            const retryIds = ids.filter((id) => !blockedSet.has(id));
            if (retryIds.length === 0) return {started: 0, skipped: ids};
            const result = await startRotation(retryIds);
            return {
                started: result.jobs.length,
                skipped: ids.filter((id) => blockedSet.has(id))
            };
        }
    }

    /** True when at least one job was created, so the caller can clear its picks. */
    async function rotate(ids: string[]): Promise<boolean> {
        if (ids.length === 0) return false;
        rotationNotStarted.value = new Set();
        let started = 0;
        const blocked: string[] = [];
        const notStarted: string[] = [];
        let failure: unknown = null;
        const chunks = chunk(ids, PAGE_SIZE);
        for (const batch of chunks) {
            if (failure !== null) {
                // A chunk after the failed one never ran either.
                notStarted.push(...batch);
                continue;
            }
            try {
                const outcome = await rotateChunk(batch);
                started += outcome.started;
                blocked.push(...outcome.skipped);
                notStarted.push(...outcome.skipped);
            } catch (err) {
                failure = err;
                notStarted.push(...batch);
            }
        }
        rotationNotStarted.value = new Set(notStarted);
        if (failure !== null) {
            toast.error(rpcErrorMessage(failure, 'Failed to start rotation'));
        } else if (started > 0) {
            toast.success(`Rotation started for ${started} devices`);
        }
        if (blocked.length > 0) {
            toast.warning(
                `${blocked.length} skipped: already rotating or not active`
            );
        }
        if (started > 0 || failure === null) await load();
        return started > 0;
    }

    function next(): void {
        if (!hasNext.value) return;
        page.value += 1;
        void load();
    }

    function prev(): void {
        if (!hasPrev.value) return;
        page.value -= 1;
        void load();
    }

    return {
        identities,
        expiring,
        total,
        page,
        pageSize: PAGE_SIZE,
        hasPrev,
        hasNext,
        loading,
        error,
        busy,
        keysChecked,
        load,
        enable,
        disable,
        rotate,
        rotationNotStarted,
        next,
        prev
    };
}

/** True when `candidate` expires sooner than `current` (null sorts last). */
function isSooner(candidate: string | null, current: string | null): boolean {
    if (candidate === null) return false;
    if (current === null) return true;
    return new Date(candidate).getTime() < new Date(current).getTime();
}

// Search kinds the app never preloads: each needs one backend call nothing
// else already makes. The palette asks for them only once search activity
// starts, debounced so a fast typist does not fire eight RPCs per keystroke,
// and only once per kind while it is loading or has loaded — every RPC
// behind these returns its whole list, so asking again mid-flight would only
// ever duplicate the same request.
//
// A kind that failed goes back to idle, so the next pause in typing retries
// it instead of leaving that one kind permanently missing for the rest of
// the session. Every other kind's own store already guards a stale RPC reply
// with its own token (`createStaleGuard`); this composable only decides
// *when* to call each store, never re-checks that part of the work. A failed
// attempt reports through the app's existing toast (the same "one short
// line, nothing else changes" surface every other store failure already
// uses) and leaves whatever loaded before it untouched.

import {useDebounceFn} from '@vueuse/core';
import {reactive} from 'vue';
import {useAlertsStore} from '@/stores/alerts';
import {type TariffSummary, useBillingStore} from '@/stores/billing';
import {useChannelsStore} from '@/stores/channels';
import {useDashboardsStore} from '@/stores/dashboards';
import {useDestinationsStore} from '@/stores/destinations';
import {usePersonasStore} from '@/stores/personas';
import {useToastStore} from '@/stores/toast';
import {useUsersStore} from '@/stores/users';

export type LazySearchKind =
    | 'alertRule'
    | 'dashboard'
    | 'tariff'
    | 'persona'
    | 'user'
    | 'notificationChannel'
    | 'destinationGroup'
    | 'messageTemplate';

export type LazySearchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LazySource {
    status: LazySearchStatus;
}

// A pause this short still reads as "answers while I type" — it only exists
// to collapse a burst of keystrokes into one round of backend calls.
const DEBOUNCE_MS = 200;

export interface LazySearchSources {
    /** This kind's load state, for a caller that wants to show "loading". */
    statusOf: (kind: LazySearchKind) => LazySearchStatus;
    /** Tariffs have no local store cache, so this composable keeps its own. */
    tariffs: Readonly<Record<number, TariffSummary>>;
    /** Starts loading whatever has not loaded yet, debounced. Safe to call
     *  on every keystroke — idle and already-loading/-loaded kinds are the
     *  only two states this can be in when it fires. */
    triggerLoad: () => void;
}

export function useLazySearchSources(): LazySearchSources {
    const alerts = useAlertsStore();
    const dashboards = useDashboardsStore();
    const billing = useBillingStore();
    const personas = usePersonasStore();
    const users = useUsersStore();
    const channels = useChannelsStore();
    const destinations = useDestinationsStore();
    const toast = useToastStore();

    const tariffs = reactive<Record<number, TariffSummary>>({});

    async function loadTariffs(): Promise<void> {
        const items = await billing.listTariffs();
        for (const key of Object.keys(tariffs)) delete tariffs[Number(key)];
        for (const item of items) tariffs[item.id] = item;
    }

    // Every other kind already keeps a reactive store cache with its own
    // stale guard; this composable only has to decide *when* to call it.
    const FETCH: Record<LazySearchKind, () => Promise<unknown>> = {
        alertRule: () => alerts.fetchRules(),
        dashboard: () => dashboards.fetchAll(),
        tariff: loadTariffs,
        persona: () => personas.fetchAll(),
        user: () => users.fetchUsers(),
        notificationChannel: () => channels.fetchChannels(),
        destinationGroup: () => destinations.fetchDestinations(),
        messageTemplate: () => alerts.fetchTemplates()
    };

    // Only the tariff fetch throws on failure; every other store already
    // toasts its own error and swallows it. One line either way, never two.
    const FAILURE_MESSAGE: Record<LazySearchKind, string> = {
        alertRule: 'Could not load alert rules.',
        dashboard: 'Could not load dashboards.',
        tariff: 'Could not load tariffs.',
        persona: 'Could not load personas.',
        user: 'Could not load users.',
        notificationChannel: 'Could not load notification channels.',
        destinationGroup: 'Could not load destination groups.',
        messageTemplate: 'Could not load message templates.'
    };

    const sources = reactive<Record<LazySearchKind, LazySource>>({
        alertRule: {status: 'idle'},
        dashboard: {status: 'idle'},
        tariff: {status: 'idle'},
        persona: {status: 'idle'},
        user: {status: 'idle'},
        notificationChannel: {status: 'idle'},
        destinationGroup: {status: 'idle'},
        messageTemplate: {status: 'idle'}
    });

    async function load(kind: LazySearchKind): Promise<void> {
        const source = sources[kind];
        // Already loaded, or a load is already on the way — asking again
        // would only duplicate the same request. 'error' falls through the
        // same as 'idle', so the next debounce settle retries it.
        if (source.status === 'loading' || source.status === 'ready') return;
        source.status = 'loading';
        try {
            await FETCH[kind]();
            source.status = 'ready';
        } catch {
            source.status = 'error';
            toast.error(FAILURE_MESSAGE[kind]);
        }
    }

    const triggerLoad = useDebounceFn(() => {
        for (const kind of Object.keys(sources) as LazySearchKind[]) {
            void load(kind);
        }
    }, DEBOUNCE_MS);

    function statusOf(kind: LazySearchKind): LazySearchStatus {
        return sources[kind].status;
    }

    return {statusOf, tariffs, triggerLoad};
}

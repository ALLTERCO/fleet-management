import type {
    Channel,
    ChannelProvider,
    ChannelProviderDescriptor,
    ChannelTestResult
} from '@api/channel';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {
    Channel,
    ChannelProvider,
    ChannelProviderDescriptor,
    ChannelTestResult
};

const MAX_ENDPOINTS_PER_PAGE = 1000;

export interface CreateChannelParams {
    provider: ChannelProvider;
    name: string;
    enabled?: boolean;
    config: Record<string, unknown>;
}

export interface UpdateChannelPatch {
    name?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    quietHours?: {
        startHour: number;
        endHour: number;
        timezone: string;
    } | null;
}

export const useChannelsStore = defineStore('integrations', () => {
    const channels = ref<Record<number, Channel>>({});
    const providers = ref<ChannelProviderDescriptor[]>([]);
    const loading = ref(true);
    const toast = useToastStore();

    // Writes bump so an in-flight read can't clobber them; reads never bump.
    const channelsGuard = createStaleGuard();

    async function fetchProviders(): Promise<ChannelProviderDescriptor[]> {
        try {
            const res = await ws.sendRPC<{
                items: ChannelProviderDescriptor[];
            }>('FLEET_MANAGER', 'channel.listproviders', {});
            providers.value = res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load providers');
        }
        return providers.value;
    }

    async function fetchChannels() {
        loading.value = true;
        try {
            // List fetch: bump so the latest fetch wins between racing fetches.
            const token = channelsGuard.bump();
            const items = await paginate<Channel>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<Channel>>(
                        'FLEET_MANAGER',
                        'channel.list',
                        {limit: MAX_ENDPOINTS_PER_PAGE, offset}
                    ),
                MAX_ENDPOINTS_PER_PAGE
            );
            if (channelsGuard.isStale(token)) return;
            const next: Record<number, Channel> = {};
            for (const e of items) next[e.id] = e;
            channels.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load integration channels');
        } finally {
            loading.value = false;
        }
    }

    async function fetchChannel(id: number): Promise<Channel | null> {
        // Read: snapshot before the RPC; a write mid-flight discards the merge.
        const token = channelsGuard.current();
        try {
            const ep = await ws.sendRPC<Channel>(
                'FLEET_MANAGER',
                'channel.get',
                {id}
            );
            if (!channelsGuard.isStale(token)) {
                channels.value = {...channels.value, [ep.id]: ep};
            }
            return ep;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load channel');
            return null;
        }
    }

    async function createChannel(
        params: CreateChannelParams
    ): Promise<Channel | null> {
        try {
            const ep = await ws.sendRPC<Channel>(
                'FLEET_MANAGER',
                'channel.create',
                params
            );
            channelsGuard.bump();
            channels.value = {...channels.value, [ep.id]: ep};
            return ep;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create channel');
            return null;
        }
    }

    async function updateChannel(
        id: number,
        patch: UpdateChannelPatch
    ): Promise<Channel | null> {
        try {
            const ep = await ws.sendRPC<Channel>(
                'FLEET_MANAGER',
                'channel.update',
                {id, patch}
            );
            channelsGuard.bump();
            channels.value = {...channels.value, [ep.id]: ep};
            return ep;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update channel');
            return null;
        }
    }

    async function deleteChannel(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'channel.delete', {
                id
            });
            channelsGuard.bump();
            const next = {...channels.value};
            delete next[id];
            channels.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete channel');
            return false;
        }
    }

    async function testChannel(
        id: number,
        dryRun = true,
        payload?: {title?: string; message?: string}
    ): Promise<ChannelTestResult | null> {
        try {
            return await ws.sendRPC<ChannelTestResult>(
                'FLEET_MANAGER',
                'channel.test',
                {id, dryRun, ...(payload ? {payload} : {})}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to test channel');
            return null;
        }
    }

    return {
        channels,
        providers,
        loading,
        fetchProviders,
        fetchChannels,
        fetchChannel,
        createChannel,
        updateChannel,
        deleteChannel,
        testChannel
    };
});

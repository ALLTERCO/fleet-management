import type {
    Channel,
    ChannelTestResult,
    ChannelProvider,
    ChannelProviderDescriptor
} from '@api/channel';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {
    Channel,
    ChannelTestResult,
    ChannelProvider,
    ChannelProviderDescriptor
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
            const items = await paginate<Channel>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<Channel>>(
                        'FLEET_MANAGER',
                        'channel.list',
                        {limit: MAX_ENDPOINTS_PER_PAGE, offset}
                    ),
                MAX_ENDPOINTS_PER_PAGE
            );
            const next: Record<number, Channel> = {};
            for (const e of items) next[e.id] = e;
            channels.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load integration channels');
        } finally {
            loading.value = false;
        }
    }

    async function fetchChannel(
        id: number
    ): Promise<Channel | null> {
        try {
            const ep = await ws.sendRPC<Channel>(
                'FLEET_MANAGER',
                'channel.get',
                {id}
            );
            channels.value = {...channels.value, [ep.id]: ep};
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

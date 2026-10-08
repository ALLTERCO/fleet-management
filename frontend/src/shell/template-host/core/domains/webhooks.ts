// Outbound hooks fired by the device.
//
// `supported` first: which events a device can hook differs by model and
// firmware, so offering one it cannot emit produces a hook that never fires
// and no error to explain why.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type WebhookMethod = Extract<HostMethod, `webhook.${string}`>;

export type FleetWebhooksDomain = ReturnType<typeof createWebhooksDomain>;

export function createWebhooksDomain(access: FleetRpcAccess) {
    const webhook = namespaceCaller<WebhookMethod>(access);

    return {
        /** Events THIS device can hook. Ask before offering a choice. */
        supported: (params: HostParams<'webhook.listsupported'>) =>
            webhook('webhook.listsupported', params),
        /** Every event any device could hook, for building a picker. */
        allSupported: (params: HostParams<'webhook.listallsupported'>) =>
            webhook('webhook.listallsupported', params),
        list: (params: HostParams<'webhook.list'>) =>
            webhook('webhook.list', params),
        create: (params: HostParams<'webhook.create'>) =>
            webhook('webhook.create', params),
        update: (params: HostParams<'webhook.update'>) =>
            webhook('webhook.update', params),
        delete: (params: HostParams<'webhook.delete'>) =>
            webhook('webhook.delete', params),
        /** Clears every hook on the device. Use when reassigning it. */
        deleteAll: (params: HostParams<'webhook.deleteall'>) =>
            webhook('webhook.deleteall', params)
    };
}

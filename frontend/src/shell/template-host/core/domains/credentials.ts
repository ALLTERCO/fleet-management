// Device credential administration. Secret-bearing responses are never
// persisted by this domain; callers receive exactly the backend response.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type CredentialMethod = Extract<HostMethod, `credential.${string}`>;

export type FleetCredentialDomain = ReturnType<typeof createCredentialDomain>;

export function createCredentialDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<CredentialMethod>(access);

    return {
        list: (params: HostParams<'credential.list'> = {}) =>
            call('credential.list', params),
        get: (params: HostParams<'credential.get'>) =>
            call('credential.get', params),
        reveal: (params: HostParams<'credential.reveal'>) =>
            call('credential.reveal', params),
        rotate: (params: HostParams<'credential.rotate'>) =>
            call('credential.rotate', params),
        set: (params: HostParams<'credential.set'>) =>
            call('credential.set', params),
        clear: (params: HostParams<'credential.clear'>) =>
            call('credential.clear', params),
        retry: (params: HostParams<'credential.retry'>) =>
            call('credential.retry', params),
        confirmOld: (params: HostParams<'credential.confirmold'>) =>
            call('credential.confirmold', params),
        listFailed: (params: HostParams<'credential.listfailed'> = {}) =>
            call('credential.listfailed', params),
        pushStatus: (params: HostParams<'credential.pushstatus'>) =>
            call('credential.pushstatus', params),
        listPushes: (params: HostParams<'credential.listpushes'> = {}) =>
            call('credential.listpushes', params)
    };
}

// Scripts running on the device itself.
//
// A script keeps running after it is uploaded, so `stop` matters as much as
// `start`. `eval` runs arbitrary code inside a live script — it is here
// because debugging needs it, and flagged because it is the sharpest edge in
// this whole SDK.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type ScriptMethod = Extract<HostMethod, `script.${string}`>;

export type FleetScriptsDomain = ReturnType<typeof createScriptsDomain>;

export function createScriptsDomain(access: FleetRpcAccess) {
    const script = namespaceCaller<ScriptMethod>(access);

    return {
        list: (params: HostParams<'script.list'>) =>
            script('script.list', params),
        create: (params: HostParams<'script.create'>) =>
            script('script.create', params),
        delete: (params: HostParams<'script.delete'>) =>
            script('script.delete', params),
        getCode: (params: HostParams<'script.getcode'>) =>
            script('script.getcode', params),
        putCode: (params: HostParams<'script.putcode'>) =>
            script('script.putcode', params),
        getConfig: (params: HostParams<'script.getconfig'>) =>
            script('script.getconfig', params),
        setConfig: (params: HostParams<'script.setconfig'>) =>
            script('script.setconfig', params),
        status: (params: HostParams<'script.getstatus'>) =>
            script('script.getstatus', params),
        start: (params: HostParams<'script.start'>) =>
            script('script.start', params),
        /** A running script keeps running until this is called. */
        stop: (params: HostParams<'script.stop'>) =>
            script('script.stop', params),
        /** Runs arbitrary code inside a live script. Debugging only. */
        eval: (params: HostParams<'script.eval'>) =>
            script('script.eval', params)
    };
}

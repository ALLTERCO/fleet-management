import {
    fetchActionVariables,
    substituteVariablesSync
} from '@/helpers/substituteVariables';
import {sendRPC} from '@/tools/websocket';
import type {action_t} from '@/types';

async function runActionForDst(dst: string, method: string, params: any) {
    try {
        const resp = await sendRPC('FLEET_MANAGER', 'FleetManager.SendRPC', {
            dst,
            method,
            params: params ?? {}
        });

        const payload =
            resp && typeof resp === 'object' && dst in resp ? resp[dst] : resp;

        return {[dst]: payload};
    } catch (error: any) {
        if (error === undefined) {
            return {[dst]: {code: -1, message: 'RPC timeout'}};
        }
        if (typeof error === 'object' && 'code' in error) {
            return {[dst]: error};
        }
        return {[dst]: {code: -32700, message: String(error)}};
    }
}

export async function runAction(action: action_t) {
    const rawSteps = action.actions || [];

    // Fetch variables once, substitute all steps synchronously
    const vars = await fetchActionVariables();
    const steps = rawSteps.map((step) => substituteVariablesSync(step, vars));

    const promises: Promise<any>[] = [];
    for (const step of steps) {
        const {dst, method, params} = step as {
            dst: string | string[];
            method: string;
            params?: any;
        };

        const targets = Array.isArray(dst) ? dst : dst ? [dst] : [];
        for (const d of targets) {
            promises.push(runActionForDst(d, method, params));
        }
    }

    const settled = await Promise.allSettled(promises);
    const results: Record<string, any> = {};
    for (const res of settled) {
        const value = 'value' in res ? res.value : res.reason;
        const key = Object.keys(value)[0]!;
        const payload = value[key];
        payload.__promiseStatus = res.status;
        results[key] = payload;
    }
    return results;
}

// Vue provide/inject for the one runtime context the Fleet shell creates.
// Templates ask for the SDK; they never build a context or a transport.

import {type InjectionKey, inject, provide} from 'vue';
import type {FleetSdk, TemplateRuntimeContext} from '../core/types';

const FLEET_RUNTIME_KEY: InjectionKey<TemplateRuntimeContext> = Symbol(
    'fleet.runtime.context'
);

export function provideFleetRuntime(context: TemplateRuntimeContext): void {
    provide(FLEET_RUNTIME_KEY, context);
}

/** Fails loudly: a missing provider is a wiring bug, not a fallback case. */
export function useFleetRuntime(): TemplateRuntimeContext {
    const context = inject(FLEET_RUNTIME_KEY, null);
    if (!context) {
        throw new Error(
            'No Fleet runtime context. Mount the template through the Fleet template host.'
        );
    }
    return context;
}

export function useFleet(): FleetSdk {
    return useFleetRuntime().fleet;
}

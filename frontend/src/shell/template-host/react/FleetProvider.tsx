// The single React entry into the Fleet SDK. It receives a runtime context the
// shell already built; it never authenticates or opens a connection.

import {createContext, type ReactNode, useContext} from 'react';
import type {FleetSdk, TemplateRuntimeContext} from '../core/types';

const FleetRuntimeContext = createContext<TemplateRuntimeContext | null>(null);

export type FleetProviderProps = {
    context: TemplateRuntimeContext;
    children: ReactNode;
};

export function FleetProvider(props: FleetProviderProps) {
    return (
        <FleetRuntimeContext.Provider value={props.context}>
            {props.children}
        </FleetRuntimeContext.Provider>
    );
}

/** Fails loudly: a missing provider is a wiring bug, not a fallback case. */
export function useFleetRuntime(): TemplateRuntimeContext {
    const context = useContext(FleetRuntimeContext);
    if (!context) {
        throw new Error(
            'No Fleet runtime context. Wrap the template in <FleetProvider context={...}>.'
        );
    }
    return context;
}

export function useFleet(): FleetSdk {
    return useFleetRuntime().fleet;
}

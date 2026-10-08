import type {App, InjectionKey, Ref} from 'vue';
import {inject, ref} from 'vue';
import {
    EMPTY_OPERATIONAL_BINDINGS,
    OperationalBindingsError,
    validateOperationalBindings,
    type OperationalBindings
} from './template-host/core/operational-bindings';

export type {OperationalBindings};
export {EMPTY_OPERATIONAL_BINDINGS};

export const OPERATIONAL_BINDINGS_KEY: InjectionKey<
    Readonly<Ref<OperationalBindings>>
> = Symbol('fm-operational-bindings');

export {OperationalBindingsError, validateOperationalBindings};

async function fetchOperationalBindings(): Promise<unknown> {
    const response = await fetch('/operational-bindings.json', {
        cache: 'no-store',
        headers: {Accept: 'application/json'}
    });
    if (response.status === 404) return EMPTY_OPERATIONAL_BINDINGS;
    if (!response.ok) {
        throw new OperationalBindingsError(
            `operational-bindings.json failed with HTTP ${response.status}`
        );
    }
    return response.json();
}

export async function loadOperationalBindings(): Promise<OperationalBindings> {
    try {
        return validateOperationalBindings(await fetchOperationalBindings());
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error(
                '[operational-bindings] using empty development bindings:',
                error
            );
            return EMPTY_OPERATIONAL_BINDINGS;
        }
        throw error;
    }
}

export function installOperationalBindings(
    app: App,
    bindings: OperationalBindings
): void {
    app.provide(OPERATIONAL_BINDINGS_KEY, ref(bindings));
}

const EMPTY_BINDINGS_REF = ref(EMPTY_OPERATIONAL_BINDINGS);

export function useOperationalBindings(): Readonly<
    Ref<OperationalBindings>
> {
    return inject(OPERATIONAL_BINDINGS_KEY, EMPTY_BINDINGS_REF);
}

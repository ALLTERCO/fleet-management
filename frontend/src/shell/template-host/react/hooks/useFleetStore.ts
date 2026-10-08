// The store hook every other React hook is built on. useSyncExternalStore is
// React's own contract for third-party stores and handles tearing.

import {useSyncExternalStore} from 'react';
import type {ExternalStore} from '../../core/external-store';

export function useFleetStore<T>(store: ExternalStore<T>): T {
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        // Server snapshot: the client build never server-renders, but React
        // requires the third argument when a component is hydrated.
        store.getSnapshot
    );
}

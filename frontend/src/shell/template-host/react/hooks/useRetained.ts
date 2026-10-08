// One lifecycle rule for every host object a React hook holds: the object is
// attached while the mount owns it, and ends when the request that asked for it
// is replaced.

import {useEffect, useRef, useState} from 'react';
import type {HostLifecycle} from '../../core/types';

type Retained<T> = {request: readonly unknown[]; instance: T};

function sameRequest(a: readonly unknown[], b: readonly unknown[]): boolean {
    return (
        a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
    );
}

/**
 * Builds the object, attaches it on mount and releases it on cleanup. React
 * runs cleanup on trees it keeps mounted, so cleanup detaches rather than
 * disposes — which also means `create` must not acquire anything on its own,
 * because a render React throws away has no cleanup to run.
 */
export function useRetained<T extends HostLifecycle>(
    create: () => T,
    request: readonly unknown[]
): T {
    const [retained, setRetained] = useState<Retained<T>>(() => ({
        request,
        instance: create()
    }));

    let current = retained;
    if (!sameRequest(retained.request, request)) {
        current = {request, instance: create()};
        setRetained(current);
    }
    const instance = current.instance;
    const attached = useRef<T | null>(null);

    useEffect(() => {
        const replaced = attached.current;
        // The tree has moved on from it, so this one is over, not just idle.
        if (replaced !== null && replaced !== instance) replaced.dispose();
        attached.current = instance;
        instance.attach?.();
        return () => instance.detach?.();
    }, [instance]);

    return instance;
}

import {createExternalStore, type ExternalStore} from './external-store';
import {
    EMPTY_OPERATIONAL_BINDINGS,
    type OperationalBindings
} from './operational-binding-contract';
import type {FleetSessionIdentity} from './session';

export {
    EMPTY_OPERATIONAL_BINDINGS,
    listOperationalBindingKeys,
    MAX_OPERATIONAL_INTEGER_ID,
    OPERATIONAL_BINDING_SPECS,
    type OperationalBindingDeclarationType,
    type OperationalBindingKey,
    type OperationalBindings,
    OperationalBindingsError,
    VIRTUAL_DEVICE_EXTERNAL_ID_MAX_LENGTH,
    VIRTUAL_DEVICE_EXTERNAL_ID_MIN_LENGTH,
    VIRTUAL_DEVICE_EXTERNAL_ID_PATTERN,
    VIRTUAL_DEVICE_ROLE_KEY_MAX_LENGTH,
    VIRTUAL_DEVICE_ROLE_KEY_MIN_LENGTH,
    VIRTUAL_DEVICE_ROLE_KEY_PATTERN,
    validateOperationalBindings
} from './operational-binding-contract';

export type SessionBoundOperationalBindings = {
    store: ExternalStore<OperationalBindings>;
    dispose(): void;
};

/** A deployment binding is exposed only to the first established tenant of
 * this runtime. A sign-out or tenant switch clears it synchronously. The
 * backend remains authoritative for every referenced organization resource. */
export function createSessionBoundOperationalBindings(options: {
    source: ExternalStore<OperationalBindings>;
    session: ExternalStore<FleetSessionIdentity>;
}): SessionBoundOperationalBindings {
    const store = createExternalStore<OperationalBindings>(
        EMPTY_OPERATIONAL_BINDINGS
    );
    let ownerOrganizationId: string | null = null;

    function refresh(): void {
        const organizationId = options.session.getSnapshot().organizationId;
        if (organizationId && ownerOrganizationId === null) {
            ownerOrganizationId = organizationId;
        }
        const next =
            organizationId && organizationId === ownerOrganizationId
                ? options.source.getSnapshot()
                : EMPTY_OPERATIONAL_BINDINGS;
        if (store.getSnapshot() !== next) store.setSnapshot(next);
    }

    const releaseSource = options.source.subscribe(refresh);
    const releaseSession = options.session.subscribe(refresh);
    refresh();

    return {
        store,
        dispose() {
            releaseSource();
            releaseSession();
            store.setSnapshot(EMPTY_OPERATIONAL_BINDINGS);
        }
    };
}

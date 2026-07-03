import {defineStore} from 'pinia';
import {computed, ref, shallowRef, triggerRef} from 'vue';
import {predictedStatusPatchFor} from '@/helpers/entityCommandCatalog';
import * as ws from '../tools/websocket';
import type {entity_t} from '../types';
import {useDevicesStore} from './devices';
import {createRefreshCoordinator} from './refreshCoordinator';

export const useEntityStore = defineStore('entities', () => {
    const entities = shallowRef<Record<string, entity_t>>({});
    // Version counter to force reactivity when entities change (shallowRef doesn't track deep changes)
    const version = ref(0);
    const eventListeners: Map<string, Array<(event: string) => void>> = new Map<
        string,
        Array<(event: string) => void>
    >();

    const entityRefresh = createRefreshCoordinator(refreshEntities);

    async function fetchEntities() {
        await entityRefresh.request();
    }

    async function refreshEntities(): Promise<void> {
        const collected: Record<string, entity_t> = {};
        await ws.listEntitiesChunked((chunk) => {
            Object.assign(collected, chunk);
        });
        entities.value = collected;
        version.value++;
    }

    async function addEntity(id: string, force = false) {
        // Skip if entity already loaded (e.g. by fetchEntities bulk load)
        if (!force && entities.value[id]) return;
        try {
            const entity = await ws.getEntityInfo(id);
            if (entity) {
                entities.value[entity.id] = entity;
                triggerRef(entities);
                version.value++;
            }
        } catch (err) {
            if (import.meta.env.DEV)
                console.warn(
                    `[addEntity] Failed to get entity info for ${id}:`,
                    err
                );
        }
    }

    function removeEntities(oldEntities: string[]) {
        for (const id of oldEntities) {
            delete entities.value[id];
            eventListeners.delete(id);
        }
        triggerRef(entities);
        version.value++;
    }

    function upsertEntities(nextEntities: entity_t[]) {
        for (const entity of nextEntities) {
            entities.value[entity.id] = entity;
        }
        triggerRef(entities);
        version.value++;
    }

    async function updateEntity(entityID: string) {
        return await addEntity(entityID, true);
    }

    async function invokeAction(
        entityID: string,
        action: string,
        params?: Record<string, unknown>
    ) {
        const entity = entities.value[entityID];
        if (entity === undefined) {
            return Promise.reject(new Error('Entity not found'));
        }

        const devicesStore = useDevicesStore();
        const handle = paintOptimistic(devicesStore, entity, action, params);

        try {
            return await ws.sendRPC('FLEET_MANAGER', 'Entity.InvokeAction', {
                id: entityID,
                action,
                params
            });
        } catch (err) {
            if (handle && shouldIgnoreOptimisticFailure(handle)) return;
            handle?.revert();
            throw err;
        }
    }

    // Tolerates missing real status — mergeOverlay handles undefined, so the
    // first interaction with a freshly-mounted device still paints optimism.
    function paintOptimistic(
        devicesStore: ReturnType<typeof useDevicesStore>,
        entity: entity_t,
        action: string,
        params: Record<string, unknown> | undefined
    ) {
        const statusObj = devicesStore.devices[entity.source]?.status;
        const statusKey = actionStatusKey(entity, action, params, statusObj);
        if (statusKey === null) return null;
        const currentStatus =
            devicesStore.statusOf(entity.source, statusKey) ?? {};

        const patch = predictedStatusPatchFor(
            entity.type,
            action,
            params,
            currentStatus
        );
        if (!patch) return null;
        return devicesStore.applyOptimistic(entity.source, statusKey, patch);
    }

    function shouldIgnoreOptimisticFailure(handle: {
        isConfirmed(): boolean;
        isSuperseded(): boolean;
    }): boolean {
        return handle.isConfirmed() || handle.isSuperseded();
    }

    function actionStatusKey(
        entity: entity_t,
        action: string,
        params: Record<string, unknown> | undefined,
        statusObj: Record<string, unknown> | undefined
    ): string | null {
        if (entity.type === 'service' && action === 'setVariable') {
            return typeof params?.key === 'string' ? params.key : null;
        }

        const internalId = (entity as {properties?: {id?: number | string}})
            .properties?.id;
        const candidates =
            internalId !== undefined
                ? [`${entity.type}:${internalId}`, entity.type]
                : [entity.type, `${entity.type}:0`];
        // Fall back to canonical key when status hasn't loaded — blocks
        // null-return that would skip the first interaction's overlay.
        return (
            candidates.find((k) => statusObj?.[k] !== undefined) ??
            candidates[0]
        );
    }

    function addListener(entityId: string, callback: (event: string) => void) {
        if (!eventListeners.has(entityId)) {
            eventListeners.set(entityId, []);
        }

        eventListeners.get(entityId)?.push(callback);

        return () => removeListener(entityId, callback);
    }

    function removeListener(
        entityId: string,
        callback: (event: string) => void
    ) {
        const listeners = eventListeners.get(entityId);

        if (!listeners) {
            return;
        }

        const index = listeners.indexOf(callback);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
        if (listeners.length === 0) {
            eventListeners.delete(entityId);
        }
    }

    function notifyEvent(
        entityId: string,
        event: 'single_push' | 'double_push' | 'long_push'
    ) {
        const listeners = eventListeners.get(entityId);

        if (!listeners) {
            return;
        }

        for (const listener of listeners) {
            listener(event);
        }
    }

    // Pre-indexed entity types by device shellyID — O(1) lookup per device
    const typesBySource = computed(() => {
        // Force dependency on version so this recomputes when entities change
        version.value;
        const map = new Map<string, Set<string>>();
        for (const e of Object.values(entities.value)) {
            let types = map.get(e.source);
            if (!types) {
                types = new Set();
                map.set(e.source, types);
            }
            types.add(e.type);
        }
        return map;
    });

    return {
        entities,
        version,
        typesBySource,
        fetchEntities,
        invokeAction,
        addEntity,
        upsertEntities,
        removeEntities,
        updateEntity,
        notifyEvent,
        addListener
    } as const;
});

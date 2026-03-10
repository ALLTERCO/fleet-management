import {defineStore} from 'pinia';
import {ref, shallowRef, triggerRef} from 'vue';
import * as ws from '../tools/websocket';
import type {entity_t} from '../types';

export const useEntityStore = defineStore('entities', () => {
    const entities = shallowRef<Record<string, entity_t>>({});
    // Version counter to force reactivity when entities change (shallowRef doesn't track deep changes)
    const version = ref(0);
    const eventListeners: Map<string, Array<(event: string) => void>> = new Map<
        string,
        Array<(event: string) => void>
    >();

    async function fetchEntities() {
        // Collect all chunks into a single object, then assign once
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

    async function removeEntities(oldEntities: string[]) {
        for (const id of oldEntities) {
            delete entities.value[id];
            eventListeners.delete(id);
        }
        triggerRef(entities);
        version.value++;
    }

    async function updateEntity(entityID: string) {
        return await addEntity(entityID, true);
    }

    async function sendRPC(entityID: string, method: string, params?: any) {
        const entity = entities.value[entityID];
        if (entity == undefined) {
            return Promise.reject(new Error('Entity not found'));
        }

        if (!entity.type) {
            return Promise.reject(new Error('Entity has no type'));
        }

        if (
            method.split('.')[0].toLocaleLowerCase() !==
            entity.type.toLocaleLowerCase()
        ) {
            return Promise.reject(new Error('Method not supported by entity'));
        }

        if (params == undefined) {
            params = {};
        }

        params['id'] = 'id' in entity.properties ? entity.properties.id : 0;

        return ws.sendRPC(entity.source, method, params);
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

    return {
        entities,
        version,
        fetchEntities,
        sendRPC,
        addEntity,
        removeEntities,
        updateEntity,
        notifyEvent,
        addListener
    } as const;
});

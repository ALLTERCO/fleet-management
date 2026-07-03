import type {
    PersonaCreateParams,
    PersonaResponse,
    PersonaStatement,
    PersonaUpdateParams
} from '@api/persona';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {PersonaResponse, PersonaStatement};

export const usePersonasStore = defineStore('personas', () => {
    const personas = ref<Record<string, PersonaResponse>>({});
    const loading = ref(false);
    const toast = useToastStore();

    async function fetchAll(includeSystem = true): Promise<PersonaResponse[]> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: PersonaResponse[]}>(
                'FLEET_MANAGER',
                'persona.list',
                {includeSystem}
            );
            const next: Record<string, PersonaResponse> = {};
            for (const p of res.items) next[p.id] = p;
            personas.value = next;
            return res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load personas');
            return [];
        } finally {
            loading.value = false;
        }
    }

    async function fetch(id: string): Promise<PersonaResponse | null> {
        try {
            const p = await ws.sendRPC<PersonaResponse>(
                'FLEET_MANAGER',
                'persona.get',
                {id}
            );
            personas.value = {...personas.value, [p.id]: p};
            return p;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load persona');
            return null;
        }
    }

    async function create(
        params: PersonaCreateParams
    ): Promise<PersonaResponse | null> {
        try {
            const p = await ws.sendRPC<PersonaResponse>(
                'FLEET_MANAGER',
                'persona.create',
                params
            );
            personas.value = {...personas.value, [p.id]: p};
            return p;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create persona');
            return null;
        }
    }

    async function update(
        params: PersonaUpdateParams
    ): Promise<PersonaResponse | null> {
        try {
            const p = await ws.sendRPC<PersonaResponse>(
                'FLEET_MANAGER',
                'persona.update',
                params
            );
            personas.value = {...personas.value, [p.id]: p};
            return p;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update persona');
            return null;
        }
    }

    async function remove(id: string): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'persona.delete', {id});
            const next = {...personas.value};
            delete next[id];
            personas.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete persona');
            return false;
        }
    }

    return {personas, loading, fetchAll, fetch, create, update, remove};
});

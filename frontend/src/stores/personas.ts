import type {
    PersonaCreateParams,
    PersonaResponse,
    PersonaStatement,
    PersonaUpdateParams
} from '@api/persona';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {PersonaResponse, PersonaStatement};

export const usePersonasStore = defineStore('personas', () => {
    const personas = ref<Record<string, PersonaResponse>>({});
    const loading = ref(false);
    const toast = useToastStore();

    // Writes bump so an in-flight read can't clobber them; reads never bump.
    const personasGuard = createStaleGuard();

    async function fetchAll(includeSystem = true): Promise<PersonaResponse[]> {
        loading.value = true;
        try {
            // List fetch: bump so the latest fetch wins between racing fetches.
            const token = personasGuard.bump();
            const res = await ws.sendRPC<{items: PersonaResponse[]}>(
                'FLEET_MANAGER',
                'persona.list',
                {includeSystem}
            );
            if (personasGuard.isStale(token)) return res.items;
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
        // Read: snapshot before the RPC; a write mid-flight discards the merge.
        const token = personasGuard.current();
        try {
            const p = await ws.sendRPC<PersonaResponse>(
                'FLEET_MANAGER',
                'persona.get',
                {id}
            );
            if (!personasGuard.isStale(token)) {
                personas.value = {...personas.value, [p.id]: p};
            }
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
            personasGuard.bump();
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
            personasGuard.bump();
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
            personasGuard.bump();
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

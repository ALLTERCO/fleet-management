import type {
    AssignmentCreateParams,
    AssignmentResourceType,
    AssignmentResponse,
    AssignmentScope,
    AssignmentSubjectType
} from '@api/assignment';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '../tools/websocket';
import {createStaleGuard, type StaleGuard} from './staleGuard';
import {useToastStore} from './toast';

export type {
    AssignmentResourceType,
    AssignmentResponse,
    AssignmentScope,
    AssignmentSubjectType
};

const subjectKey = (subjectType: AssignmentSubjectType, subjectId: string) =>
    `${subjectType}:${subjectId}`;

export const useAssignmentsStore = defineStore('assignments', () => {
    const bySubject = ref<Record<string, AssignmentResponse[]>>({});
    const byPersona = ref<Record<string, AssignmentResponse[]>>({});
    const loading = ref(false);
    const toast = useToastStore();
    // Latest-wins per list key: an older same-key fetch discards itself.
    const subjectGuards = new Map<string, StaleGuard>();
    const personaGuards = new Map<string, StaleGuard>();

    function guardFor(
        guards: Map<string, StaleGuard>,
        key: string
    ): StaleGuard {
        let guard = guards.get(key);
        if (!guard) {
            guard = createStaleGuard();
            guards.set(key, guard);
        }
        return guard;
    }

    async function listForSubject(
        subjectType: AssignmentSubjectType,
        subjectId: string
    ): Promise<AssignmentResponse[]> {
        const key = subjectKey(subjectType, subjectId);
        const guard = guardFor(subjectGuards, key);
        const token = guard.bump();
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: AssignmentResponse[]}>(
                'FLEET_MANAGER',
                'assignment.listforsubject',
                {subjectType, subjectId}
            );
            if (!guard.isStale(token)) {
                bySubject.value = {
                    ...bySubject.value,
                    [key]: res.items
                };
            }
            return res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load assignments');
            return [];
        } finally {
            loading.value = false;
        }
    }

    async function listForPersona(
        personaId: string
    ): Promise<AssignmentResponse[]> {
        const guard = guardFor(personaGuards, personaId);
        const token = guard.bump();
        try {
            const res = await ws.sendRPC<{items: AssignmentResponse[]}>(
                'FLEET_MANAGER',
                'assignment.listforpersona',
                {personaId}
            );
            if (!guard.isStale(token)) {
                byPersona.value = {...byPersona.value, [personaId]: res.items};
            }
            return res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load persona assignments');
            return [];
        }
    }

    // Returns null on error so callers can render an error state distinct
    // from "no shares" (an empty array).
    async function listForResource(
        resourceType: AssignmentResourceType,
        resourceId: string | number
    ): Promise<AssignmentResponse[] | null> {
        try {
            const res = await ws.sendRPC<{items: AssignmentResponse[]}>(
                'FLEET_MANAGER',
                'assignment.listforresource',
                {resourceType, resourceId}
            );
            return res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load shares');
            return null;
        }
    }

    async function create(
        params: AssignmentCreateParams
    ): Promise<AssignmentResponse | null> {
        try {
            const a = await ws.sendRPC<AssignmentResponse>(
                'FLEET_MANAGER',
                'assignment.create',
                params
            );
            // Refetch the affected subject + persona lists. Avoids the race
            // where a concurrent listForSubject snapshotted before the server
            // commit completed and would clobber an optimistic push.
            await Promise.all([
                listForSubject(a.subject_type, a.subject_id),
                listForPersona(a.persona_id)
            ]);
            return a;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create assignment');
            return null;
        }
    }

    async function remove(id: string): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'assignment.delete', {id});
            const subjNext: Record<string, AssignmentResponse[]> = {};
            for (const [k, v] of Object.entries(bySubject.value)) {
                subjNext[k] = v.filter((a) => a.id !== id);
            }
            bySubject.value = subjNext;
            const persNext: Record<string, AssignmentResponse[]> = {};
            for (const [k, v] of Object.entries(byPersona.value)) {
                persNext[k] = v.filter((a) => a.id !== id);
            }
            byPersona.value = persNext;
            // Delete touches every key: in-flight lists must not resurrect it.
            for (const guard of subjectGuards.values()) guard.bump();
            for (const guard of personaGuards.values()) guard.bump();
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete assignment');
            return false;
        }
    }

    return {
        bySubject,
        byPersona,
        loading,
        listForSubject,
        listForPersona,
        listForResource,
        create,
        remove
    };
});

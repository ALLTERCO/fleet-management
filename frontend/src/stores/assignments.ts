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

    async function listForSubject(
        subjectType: AssignmentSubjectType,
        subjectId: string
    ): Promise<AssignmentResponse[]> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: AssignmentResponse[]}>(
                'FLEET_MANAGER',
                'assignment.listforsubject',
                {subjectType, subjectId}
            );
            bySubject.value = {
                ...bySubject.value,
                [subjectKey(subjectType, subjectId)]: res.items
            };
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
        try {
            const res = await ws.sendRPC<{items: AssignmentResponse[]}>(
                'FLEET_MANAGER',
                'assignment.listforpersona',
                {personaId}
            );
            byPersona.value = {...byPersona.value, [personaId]: res.items};
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

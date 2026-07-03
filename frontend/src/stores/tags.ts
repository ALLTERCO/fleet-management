import type {Tag as ApiTag, TagAssignmentRef, TagSubjectType} from '@api/tag';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {subjectRefKey} from '@/helpers/subjectRefs';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {ApiTag, TagAssignmentRef, TagSubjectType};

// Match backend schema maxima.
const MAX_TAGS_PER_PAGE = 1000;
const MAX_ASSIGNMENTS_PER_PAGE = 1000;

type AssignmentMutationMode = 'assign' | 'unassign';

export const useTagsStore = defineStore('tags', () => {
    const tags = ref<Record<number, ApiTag>>({});
    const assignments = ref<Record<number, TagAssignmentRef[]>>({});
    const loading = ref(true);
    const toast = useToastStore();

    async function fetchTags() {
        loading.value = true;
        try {
            const items = await paginate<ApiTag>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<ApiTag>>(
                        'FLEET_MANAGER',
                        'tag.list',
                        {limit: MAX_TAGS_PER_PAGE, offset}
                    ),
                MAX_TAGS_PER_PAGE
            );
            const next: Record<number, ApiTag> = {};
            for (const t of items) next[t.id] = t;
            tags.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load tags');
        } finally {
            loading.value = false;
        }
    }

    async function fetchTag(id: number): Promise<ApiTag | null> {
        try {
            const tag = await ws.sendRPC<ApiTag>('FLEET_MANAGER', 'tag.get', {
                id,
                includeSummary: true
            });
            tags.value = {...tags.value, [tag.id]: tag};
            return tag;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load tag');
            return null;
        }
    }

    async function createTag(params: {
        name: string;
        key?: string;
        description?: string | null;
        color?: string | null;
        icon?: string | null;
        imageAssetId?: string | null;
        metadata?: Record<string, unknown>;
    }): Promise<ApiTag | null> {
        try {
            const tag = await ws.sendRPC<ApiTag>(
                'FLEET_MANAGER',
                'tag.create',
                params
            );
            tags.value = {...tags.value, [tag.id]: tag};
            return tag;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create tag');
            return null;
        }
    }

    async function updateTag(
        id: number,
        patch: {
            name?: string;
            description?: string | null;
            color?: string | null;
            icon?: string | null;
            imageAssetId?: string | null;
            metadata?: Record<string, unknown>;
        }
    ): Promise<ApiTag | null> {
        try {
            const tag = await ws.sendRPC<ApiTag>(
                'FLEET_MANAGER',
                'tag.update',
                {id, patch}
            );
            tags.value = {...tags.value, [tag.id]: tag};
            return tag;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update tag');
            return null;
        }
    }

    async function deleteTag(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'tag.delete', {id});
            const next = {...tags.value};
            delete next[id];
            tags.value = next;
            const nextAssign = {...assignments.value};
            delete nextAssign[id];
            assignments.value = nextAssign;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete tag');
            return false;
        }
    }

    async function fetchAssignments(id: number): Promise<TagAssignmentRef[]> {
        try {
            const items = await paginate<TagAssignmentRef>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<TagAssignmentRef>>(
                        'FLEET_MANAGER',
                        'tag.listassignments',
                        {id, limit: MAX_ASSIGNMENTS_PER_PAGE, offset}
                    ),
                MAX_ASSIGNMENTS_PER_PAGE
            );
            assignments.value = {...assignments.value, [id]: items};
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load tag assignments');
            return [];
        }
    }

    async function assignSubjects(
        id: number,
        subjects: TagAssignmentRef[]
    ): Promise<boolean> {
        return mutateAssignments({
            id,
            subjects,
            mode: 'assign',
            method: 'tag.assign',
            failureMessage: 'Failed to assign subjects'
        });
    }

    async function unassignSubjects(
        id: number,
        subjects: TagAssignmentRef[]
    ): Promise<boolean> {
        return mutateAssignments({
            id,
            subjects,
            mode: 'unassign',
            method: 'tag.unassign',
            failureMessage: 'Failed to unassign subjects'
        });
    }

    async function mutateAssignments(input: {
        id: number;
        subjects: TagAssignmentRef[];
        mode: AssignmentMutationMode;
        method: 'tag.assign' | 'tag.unassign';
        failureMessage: string;
    }): Promise<boolean> {
        if (input.subjects.length === 0) return true;
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotAssignments(input.id),
                apply: () => applyAssignmentMutation(input),
                commit: () => commitAssignmentMutation(input),
                rollback: (previous) => restoreAssignments(input.id, previous),
                reconcile: async () => {
                    await fetchAssignments(input.id);
                },
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch {
            return false;
        }
    }

    function snapshotAssignments(id: number): TagAssignmentRef[] | undefined {
        return assignments.value[id];
    }

    function restoreAssignments(
        id: number,
        previous: TagAssignmentRef[] | undefined
    ): void {
        if (!previous) return;
        assignments.value = {...assignments.value, [id]: previous};
    }

    function applyAssignmentMutation(input: {
        id: number;
        subjects: TagAssignmentRef[];
        mode: AssignmentMutationMode;
    }): void {
        const current = assignments.value[input.id] ?? [];
        const next =
            input.mode === 'assign'
                ? withAssignedSubjects(current, input.subjects)
                : withoutAssignedSubjects(current, input.subjects);
        assignments.value = {...assignments.value, [input.id]: next};
    }

    function withAssignedSubjects(
        current: TagAssignmentRef[],
        subjects: TagAssignmentRef[]
    ): TagAssignmentRef[] {
        const keys = new Set(current.map(subjectRefKey));
        const next = [...current];
        for (const subject of subjects) {
            const key = subjectRefKey(subject);
            if (keys.has(key)) continue;
            keys.add(key);
            next.push(subject);
        }
        return next;
    }

    function withoutAssignedSubjects(
        current: TagAssignmentRef[],
        subjects: TagAssignmentRef[]
    ): TagAssignmentRef[] {
        const remove = new Set(subjects.map(subjectRefKey));
        return current.filter((subject) => !remove.has(subjectRefKey(subject)));
    }

    async function commitAssignmentMutation(input: {
        id: number;
        subjects: TagAssignmentRef[];
        method: 'tag.assign' | 'tag.unassign';
    }): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', input.method, {
            id: input.id,
            subjects: input.subjects
        });
    }

    const toDeviceSubjects = (ids: string[]): TagAssignmentRef[] =>
        ids.map((subjectId) => ({subjectType: 'device', subjectId}));

    async function assignDevices(
        tagIds: number[],
        deviceIds: string[]
    ): Promise<boolean> {
        if (tagIds.length === 0 || deviceIds.length === 0) return true;
        const subjects = toDeviceSubjects(deviceIds);
        for (const tagId of tagIds) {
            const ok = await assignSubjects(tagId, subjects);
            if (!ok) return false;
        }
        return true;
    }

    async function unassignDevices(
        tagIds: number[],
        deviceIds: string[]
    ): Promise<boolean> {
        if (tagIds.length === 0 || deviceIds.length === 0) return true;
        const subjects = toDeviceSubjects(deviceIds);
        for (const tagId of tagIds) {
            const ok = await unassignSubjects(tagId, subjects);
            if (!ok) return false;
        }
        return true;
    }

    async function listTagsForSubject(
        subjectType: TagSubjectType,
        subjectId: string
    ): Promise<number[]> {
        try {
            const resp = await ws.sendRPC<{tagIds: number[]}>(
                'FLEET_MANAGER',
                'tag.listforsubject',
                {subjectType, subjectId}
            );
            return resp?.tagIds ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load tags');
            return [];
        }
    }

    return {
        tags,
        assignments,
        loading,
        fetchTags,
        fetchTag,
        createTag,
        updateTag,
        deleteTag,
        fetchAssignments,
        assignSubjects,
        unassignSubjects,
        assignDevices,
        unassignDevices,
        listTagsForSubject
    };
});

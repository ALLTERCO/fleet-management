// Reverse index: (subjectType, subjectId) → tagIds[]. Built once per
// org by walking tagsStore.assignments (which the tag detail page +
// alert-rule scope populate). Cheap O(N) compute, memoized by Vue.

import {type ComputedRef, computed} from 'vue';
import type {TagSubjectType} from '@/stores/tags';
import {useTagsStore} from '@/stores/tags';

export interface TagsBySubject {
    /** (subjectType:subjectId) → ordered tag IDs. Empty if no tags attached. */
    index: ComputedRef<Map<string, number[]>>;
    keyFor: (subjectType: TagSubjectType, subjectId: string) => string;
    tagIdsFor: (subjectType: TagSubjectType, subjectId: string) => number[];
}

export function useTagsBySubject(): TagsBySubject {
    const tagsStore = useTagsStore();

    function keyFor(subjectType: TagSubjectType, subjectId: string): string {
        return `${subjectType}:${subjectId}`;
    }

    const index = computed(() => {
        const map = new Map<string, number[]>();
        for (const [tagIdStr, refs] of Object.entries(tagsStore.assignments)) {
            const tagId = Number(tagIdStr);
            for (const ref of refs) {
                const key = keyFor(ref.subjectType, ref.subjectId);
                const prev = map.get(key) ?? [];
                prev.push(tagId);
                map.set(key, prev);
            }
        }
        return map;
    });

    function tagIdsFor(
        subjectType: TagSubjectType,
        subjectId: string
    ): number[] {
        return index.value.get(keyFor(subjectType, subjectId)) ?? [];
    }

    return {index, keyFor, tagIdsFor};
}

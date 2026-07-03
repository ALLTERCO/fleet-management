import {computed, type Ref} from 'vue';
import {useGroupsStore} from '@/stores/groups';

/**
 * Shared group tree navigation — breadcrumbs + child groups.
 * Used by GroupPreviewModal and EditGroupModal to avoid duplication.
 */
export function useGroupBreadcrumbs(groupId: Ref<number | undefined | null>) {
    const groupStore = useGroupsStore();

    return computed(() => {
        const id = groupId.value;
        if (id == null) return [];
        const trail: {id: number; name: string}[] = [];
        let current: number | null = id;
        const visited = new Set<number>();
        while (current != null && !visited.has(current)) {
            visited.add(current);
            const g = groupStore.groups[current];
            if (!g) break;
            trail.unshift({id: g.id, name: g.name ?? `#${g.id}`});
            current = g.parentGroupId as number;
        }
        return trail;
    });
}

export function useChildGroups(parentGroupId: Ref<number | undefined | null>) {
    const groupStore = useGroupsStore();

    return computed(() => {
        const id = parentGroupId.value;
        if (id == null) return [];
        return Object.values(groupStore.groups)
            .filter((g: any) => g.parentGroupId === id)
            .sort((a: any, b: any) =>
                (a.name ?? '').localeCompare(b.name ?? '')
            );
    });
}

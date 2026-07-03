import type {OrderedId} from '@/helpers/dashboardOrder';

// Sort selected keys by visible-index so bulkMove never asks reorderById
// to step a row past another row from the same selection.
export function orderForBulkMove(
    visibleIds: readonly OrderedId[],
    selectedKeys: readonly string[],
    direction: -1 | 1
): readonly string[] {
    const indexOf = (key: string): number =>
        visibleIds.findIndex((id) => String(id) === key);
    return selectedKeys
        .filter((key) => indexOf(key) >= 0)
        .sort((a, b) =>
            direction === -1 ? indexOf(a) - indexOf(b) : indexOf(b) - indexOf(a)
        );
}

// Sequentially attempt removals and return only the ids whose remover
// answered true. Lets callers purge order / clear selection / toast
// against the precise list that actually succeeded.
export async function collectSuccessfulRemovals<TId>(
    ids: readonly TId[],
    remove: (id: TId) => Promise<boolean>
): Promise<readonly TId[]> {
    const successful: TId[] = [];
    for (const id of ids) {
        if (await remove(id)) successful.push(id);
    }
    return successful;
}

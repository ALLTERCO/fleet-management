import {moveToFront} from '@/helpers/recentList';

export type DashboardId = number | string;

// Ids arrive both as numbers and as strings, so the text of an id is what
// makes two of them the same dashboard.
export function pushRecent(
    previous: readonly DashboardId[],
    id: DashboardId,
    limit = 8
): readonly DashboardId[] {
    return moveToFront({list: previous, entry: id, identify: String, limit});
}

export function removeRecent(
    previous: readonly DashboardId[],
    id: DashboardId
): readonly DashboardId[] {
    const target = String(id);
    return previous.filter((existing) => String(existing) !== target);
}

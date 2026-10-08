// The sentences the alert builder reads back: what a rule watches, and who
// it tells.
//
// Pulled out of EditAlertRuleModal so the flow's rules can be read on their
// own. Pure — the component owns the refs and the store lookups, and hands the
// answers in already resolved.
//
// `describeScopeBreakdown` deliberately differs from the quick path's
// `describeScope` (helpers/quickAlertDraft.ts), which flattens everything to a
// device count and says "Every device" when nothing is picked. The custom flow
// shows the breakdown and stays silent when empty. They read alike and answer
// different questions, so they stay apart.

import type {ScopeSelector} from '@api/alert';

// Naming beats counting while the names still fit; past that a count is
// quicker to read than a list.
const NAMES_WORTH_READING = 2;

interface ScopeCount {
    readonly ids: readonly unknown[] | undefined;
    readonly one: string;
    readonly many: string;
}

/** What a rule watches, broken down by kind. Empty scope says nothing. */
export function describeScopeBreakdown(scope: ScopeSelector): string {
    const counts: ScopeCount[] = [
        {ids: scope.deviceIds, one: 'device', many: 'devices'},
        {ids: scope.componentIds, one: 'sensor', many: 'sensors'},
        {ids: scope.groupIds, one: 'group', many: 'groups'},
        {ids: scope.locationIds, one: 'location', many: 'locations'},
        {ids: scope.tagIds, one: 'tag', many: 'tags'}
    ];
    return counts
        .map(({ids, one, many}) => {
            const n = ids?.length ?? 0;
            return n > 0 ? `${n} ${n === 1 ? one : many}` : '';
        })
        .filter(Boolean)
        .join(' and ');
}

/** Who a rule tells. Names while they fit, a count once they do not. */
export function describeChannels(chosen: {
    names: readonly string[];
    groupCount: number;
}): string {
    const {names, groupCount} = chosen;
    if (names.length === 0 && groupCount === 0) return '';
    if (names.length <= NAMES_WORTH_READING && groupCount === 0) {
        return names.join(' and ');
    }
    const parts: string[] = [];
    if (names.length) parts.push(`${names.length} channels`);
    if (groupCount) {
        parts.push(`${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`);
    }
    return parts.join(' and ');
}

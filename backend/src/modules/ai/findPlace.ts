/**
 * Turn a place name into something the rest of the API can use.
 *
 * An operator says "the kitchen". Every method here wants a numeric id, and a
 * place can be a location, a group or a tag. Without this an agent had to call
 * location.list, then group.list, then tag.list, match the name itself, then
 * list devices and filter them — five round trips of scaffolding before the
 * first useful call, repeated for every request, with a wrong guess reading to
 * the operator as "we have no kitchen".
 *
 * Returns both things the follow-up needs: the `scope` energy.Query accepts,
 * and the devices an action would touch.
 *
 * Read-only. Acting on those devices is still a write, still previewed, still
 * approved.
 */

export type PlaceKind = 'location' | 'group' | 'tag';

export interface PlaceDevice {
    externalId: string;
    name?: string;
}

export interface PlaceMatch {
    kind: PlaceKind;
    id: number;
    name: string;
    /** Exactly what energy.Query wants: one of locationId / groupId / tagId. */
    scope: Record<string, number>;
    /** Only populated for a location, where device membership is direct. */
    devices?: PlaceDevice[];
}

export interface FindPlaceResult {
    matches: PlaceMatch[];
    /** More than one equally good match. Guessing is how the wrong room goes dark. */
    ambiguous?: boolean;
    /** Present only when nothing matched: why, and what to try. */
    hint?: string;
}

type Executor = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;

const SOURCES: {kind: PlaceKind; method: string; scopeKey: string}[] = [
    {kind: 'location', method: 'location.List', scopeKey: 'locationId'},
    {kind: 'group', method: 'group.List', scopeKey: 'groupId'},
    {kind: 'tag', method: 'tag.List', scopeKey: 'tagId'}
];

function rowsOf(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    const items = (value as {items?: unknown})?.items;
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/**
 * Exact name first, then prefix, then contains. "Kitchen" must win over
 * "Kitchen Store" — an operator who says the shorter name means the shorter
 * name.
 */
function rank(name: string, query: string): number | null {
    const a = name.trim().toLowerCase();
    const b = query.trim().toLowerCase();
    if (!a) return null;
    if (a === b) return 0;
    if (a.startsWith(b)) return 1;
    if (a.includes(b)) return 2;
    return null;
}

export async function findPlace(
    input: {query?: unknown},
    execute: Executor
): Promise<FindPlaceResult> {
    const query = String(input?.query ?? '').trim();
    if (!query) {
        return {
            matches: [],
            hint: 'Name the place to look for, e.g. "kitchen" or "Store 12".'
        };
    }

    const found: {match: PlaceMatch; score: number}[] = [];
    for (const source of SOURCES) {
        let rows: Record<string, unknown>[];
        try {
            rows = rowsOf(await execute(source.method, {query, limit: 50}));
        } catch {
            // One refused or failing lookup must not lose the others: a key
            // scoped to devices can still resolve a location.
            continue;
        }
        for (const row of rows) {
            const name = String(row.name ?? '');
            const id = Number(row.id);
            const score = rank(name, query);
            if (score === null || !Number.isInteger(id)) continue;
            found.push({
                score,
                match: {
                    kind: source.kind,
                    id,
                    name,
                    scope: {[source.scopeKey]: id}
                }
            });
        }
    }

    if (found.length === 0) {
        return {
            matches: [],
            hint: `Nothing is called "${query}". Try list_namespaces for the areas, or a shorter name — places are locations, groups or tags.`
        };
    }

    found.sort(
        (a, b) => a.score - b.score || a.match.name.localeCompare(b.match.name)
    );
    const best = found[0].score;
    const matches = found.filter((f) => f.score === best).map((f) => f.match);

    // Devices hang off a location directly, so fill them in — that is the half
    // an action needs, and a second lookup here saves the agent a round trip.
    for (const match of matches) {
        if (match.kind !== 'location') continue;
        try {
            const devices = rowsOf(
                await execute('device.List', {
                    filters: {locationId: match.id},
                    limit: 500
                })
            );
            match.devices = devices
                // The filter is applied server-side, but a permissive filter
                // implementation could return more; keep only this location's.
                .filter(
                    (d) =>
                        d.locationId === undefined ||
                        Number(d.locationId) === match.id
                )
                .map((d) => ({
                    externalId: String(d.externalId ?? d.shellyID ?? ''),
                    name: d.name === undefined ? undefined : String(d.name)
                }))
                .filter((d) => d.externalId);
        } catch {
            // Same reasoning: the scope is still useful without the devices.
        }
    }

    return matches.length > 1 ? {matches, ambiguous: true} : {matches};
}

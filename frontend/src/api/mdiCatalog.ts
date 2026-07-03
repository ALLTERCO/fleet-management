// MDI catalog loader. Fetches /mdi/meta.json once per session, builds a
// searchable index keyed by name + tags + aliases.

export interface MdiIcon {
    name: string;
    tags: string[];
    aliases: string[];
}

interface MdiMetaEntry {
    name: string;
    tags?: string[];
    aliases?: string[];
}

let cache: Promise<MdiIcon[]> | null = null;

export function loadMdiCatalog(): Promise<MdiIcon[]> {
    if (cache) return cache;
    cache = fetch('/mdi/meta.json')
        .then((r) => {
            if (!r.ok) throw new Error(`MDI meta load failed (${r.status})`);
            return r.json() as Promise<MdiMetaEntry[]>;
        })
        .then((entries) =>
            entries
                .map((e) => ({
                    name: e.name,
                    tags: e.tags ?? [],
                    aliases: e.aliases ?? []
                }))
                // Stable empty-query order: alphabetical by name.
                .sort((a, b) => a.name.localeCompare(b.name))
        )
        .catch((err) => {
            cache = null;
            throw err;
        });
    return cache;
}

// HA-style: match by name (prefix), then aliases, then tags. Returns up to
// `limit` icons sorted by match quality (name-prefix > alias > tag > substring).
export function searchMdi(
    icons: readonly MdiIcon[],
    query: string,
    limit = 200
): MdiIcon[] {
    const q = query.trim().toLowerCase();
    if (!q) return icons.slice(0, limit);
    const exact: MdiIcon[] = [];
    const prefix: MdiIcon[] = [];
    const alias: MdiIcon[] = [];
    const tag: MdiIcon[] = [];
    const substring: MdiIcon[] = [];
    for (const icon of icons) {
        const name = icon.name.toLowerCase();
        if (name === q) {
            exact.push(icon);
            continue;
        }
        if (name.startsWith(q)) {
            prefix.push(icon);
            continue;
        }
        if (icon.aliases.some((a) => a.toLowerCase().includes(q))) {
            alias.push(icon);
            continue;
        }
        if (icon.tags.some((t) => t.toLowerCase().includes(q))) {
            tag.push(icon);
            continue;
        }
        if (name.includes(q)) substring.push(icon);
    }
    return [...exact, ...prefix, ...alias, ...tag, ...substring].slice(
        0,
        limit
    );
}

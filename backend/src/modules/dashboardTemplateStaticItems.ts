// Pure normalization for template seed.staticItems. Extracted from
// DashboardRegistry.materializeTemplateItems so the static-items contract
// is unit-testable without the DB-touching scope/device chain.

interface SeededItem {
    order?: number;
    size?: string;
    mobileLayout?: unknown;
    [k: string]: unknown;
}

export function normalizeStaticItems(seed: unknown): SeededItem[] {
    const raw = Array.isArray((seed as any)?.staticItems)
        ? ((seed as any).staticItems as SeededItem[])
        : [];
    const out: SeededItem[] = [];
    let order = 0;
    for (const it of raw) {
        out.push({
            ...it,
            order: typeof it.order === 'number' ? it.order : order++,
            size: it.size ?? '1x1',
            mobileLayout: it.mobileLayout ?? null
        });
        order = Math.max(order, (it.order ?? -1) + 1);
    }
    return out;
}

export function getDetectsEntityTypes(seed: unknown): string[] {
    return Array.isArray((seed as any)?.detectsEntityTypes)
        ? ((seed as any).detectsEntityTypes as string[])
        : [];
}

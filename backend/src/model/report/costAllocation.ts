// Splits one device's cost across the targets it serves (departments, tenants,
// cost centers). Pure single-level math: weighted when the serves links carry
// weights, equal otherwise, and a configurable fallback when a device serves
// nothing. Recursion into group members is the caller's job — this stays one
// function doing one thing. Sum of allocated + unallocated always equals the
// device cost (no leakage).

export interface ServesLink {
    targetType: string;
    targetId: string;
    weight?: number | null;
}

export interface AllocationInput {
    deviceCost: number;
    serves: readonly ServesLink[];
    fallback: 'unallocated' | 'device_location';
    deviceLocationId?: string | null;
}

export interface AllocationResult {
    perTarget: Map<string, number>;
    unallocated: number;
}

export function allocateCost(input: AllocationInput): AllocationResult {
    if (input.serves.length === 0) return fallbackAllocation(input);
    const weighted = input.serves.some((link) => link.weight != null);
    const perTarget = weighted
        ? splitWeighted(input.deviceCost, input.serves)
        : splitEqual(input.deviceCost, input.serves);
    return {perTarget, unallocated: 0};
}

// No serves link: cost goes to the device's location, or the unallocated bucket.
function fallbackAllocation(input: AllocationInput): AllocationResult {
    if (input.fallback === 'device_location' && input.deviceLocationId) {
        return {
            perTarget: new Map([[input.deviceLocationId, input.deviceCost]]),
            unallocated: 0
        };
    }
    return {perTarget: new Map(), unallocated: input.deviceCost};
}

function splitEqual(
    cost: number,
    links: readonly ServesLink[]
): Map<string, number> {
    const share = cost / links.length;
    return accumulate(links, () => share);
}

// Weighted split; treats a missing weight as 0. Falls back to equal when no
// link carries usable weight (all zero/negative).
function splitWeighted(
    cost: number,
    links: readonly ServesLink[]
): Map<string, number> {
    const total = links.reduce((sum, link) => sum + weightOf(link), 0);
    if (total <= 0) return splitEqual(cost, links);
    return accumulate(links, (link) => cost * (weightOf(link) / total));
}

function weightOf(link: ServesLink): number {
    const weight = link.weight ?? 0;
    return weight > 0 ? weight : 0;
}

// Sum each link's share into its target (two links to one target combine).
function accumulate(
    links: readonly ServesLink[],
    shareOf: (link: ServesLink) => number
): Map<string, number> {
    const perTarget = new Map<string, number>();
    for (const link of links) {
        perTarget.set(
            link.targetId,
            (perTarget.get(link.targetId) ?? 0) + shareOf(link)
        );
    }
    return perTarget;
}

// Roll-up tree for location/group/tag breakdowns: parent = sum of its subtree.

import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';

export interface ScopeNode {
    id: number;
    name: string;
    parentId: number | null;
}

export interface DeviceContribution {
    // Directly-assigned nodes ([] = unassigned); credited to each + ancestors.
    nodeIds: number[];
    kWh: number;
    cost: number;
}

export interface DeviceUsage {
    externalId: string;
    kWh: number;
    cost: number;
}

// Partition (location): each device counts once, in its deepest node.
export function partitionContributions(
    devices: readonly DeviceUsage[],
    deviceNodes: ReadonlyMap<string, number[]>,
    depth: Map<number, number>
): DeviceContribution[] {
    return devices.map((d) => {
        const deepest = pickDeepestNode(
            deviceNodes.get(d.externalId) ?? [],
            depth
        );
        return {
            nodeIds: deepest != null ? [deepest] : [],
            kWh: d.kWh,
            cost: d.cost
        };
    });
}

// Overlap (group, tag): a device counts in every node it belongs to.
export function overlapContributions(
    devices: readonly DeviceUsage[],
    deviceNodes: ReadonlyMap<string, number[]>
): DeviceContribution[] {
    return devices.map((d) => ({
        nodeIds: [...(deviceNodes.get(d.externalId) ?? [])],
        kWh: d.kWh,
        cost: d.cost
    }));
}

interface NodeTotal {
    totalKWh: number;
    totalCost: number;
}

export interface ScopeRollup {
    byId: Map<number, NodeTotal>;
    unassignedKWh: number;
    unassignedCost: number;
    fleetKWh: number;
    fleetCost: number;
}

const MAX_DEPTH = 64; // matches the DB location-depth cap; guards cycles
const USAGE_EPSILON = 1e-3; // below display precision (3 dp) — skip phantom rows
const DEFAULT_MAX_ROWS = 60;

function parentMap(nodes: readonly ScopeNode[]): Map<number, number | null> {
    return new Map(nodes.map((n) => [n.id, n.parentId]));
}

// Depth = ancestor count; 0 at a root.
export function buildDepthMap(
    nodes: readonly ScopeNode[]
): Map<number, number> {
    const parent = parentMap(nodes);
    const depth = new Map<number, number>();
    for (const n of nodes) {
        let d = 0;
        let cur: number | null = n.id;
        const seen = new Set<number>();
        while (cur != null && !seen.has(cur) && d <= MAX_DEPTH) {
            seen.add(cur);
            const p: number | null = parent.get(cur) ?? null;
            if (p == null || !parent.has(p)) break;
            cur = p;
            d++;
        }
        depth.set(n.id, d);
    }
    return depth;
}

// Deepest assigned node; ties break to lowest id; unknown ids ignored.
export function pickDeepestNode(
    nodeIds: readonly number[],
    depth: Map<number, number>
): number | null {
    let best: number | null = null;
    let bestDepth = -1;
    for (const id of nodeIds) {
        if (!depth.has(id)) continue;
        const d = depth.get(id) ?? 0;
        if (
            d > bestDepth ||
            (d === bestDepth && (best === null || id < best))
        ) {
            bestDepth = d;
            best = id;
        }
    }
    return best;
}

// Each assigned node plus its ancestors, deduped (parent credited once).
function creditSet(
    nodeIds: readonly number[],
    parent: Map<number, number | null>,
    known: Map<number, NodeTotal>
): Set<number> {
    const credit = new Set<number>();
    for (const start of nodeIds) {
        if (!known.has(start)) continue; // stale assignment to a deleted node
        let cur: number | null = start;
        let steps = 0;
        while (cur != null && !credit.has(cur) && steps <= MAX_DEPTH) {
            credit.add(cur);
            const p: number | null = parent.get(cur) ?? null;
            if (p == null || !known.has(p)) break;
            cur = p;
            steps++;
        }
    }
    return credit;
}

export function rollupScope(input: {
    nodes: readonly ScopeNode[];
    contributions: readonly DeviceContribution[];
}): ScopeRollup {
    const parent = parentMap(input.nodes);
    const byId = new Map<number, NodeTotal>();
    for (const n of input.nodes) {
        byId.set(n.id, {totalKWh: 0, totalCost: 0});
    }
    let unassignedKWh = 0;
    let unassignedCost = 0;
    let fleetKWh = 0;
    let fleetCost = 0;
    for (const c of input.contributions) {
        fleetKWh += c.kWh;
        fleetCost += c.cost;
        const credit = creditSet(c.nodeIds, parent, byId);
        if (credit.size === 0) {
            unassignedKWh += c.kWh;
            unassignedCost += c.cost;
            continue;
        }
        for (const id of credit) {
            const t = byId.get(id);
            if (!t) continue;
            t.totalKWh += c.kWh;
            t.totalCost += c.cost;
        }
    }
    return {
        byId,
        unassignedKWh: +unassignedKWh.toFixed(3),
        unassignedCost: +unassignedCost.toFixed(2),
        fleetKWh: +fleetKWh.toFixed(3),
        fleetCost: +fleetCost.toFixed(2)
    };
}

function childrenOf(
    nodes: readonly ScopeNode[]
): Map<number | null, ScopeNode[]> {
    const ids = new Set(nodes.map((n) => n.id));
    const out = new Map<number | null, ScopeNode[]>();
    for (const n of nodes) {
        // Orphans (parent gone) are treated as roots.
        const key =
            n.parentId != null && ids.has(n.parentId) ? n.parentId : null;
        const arr = out.get(key) ?? [];
        arr.push(n);
        out.set(key, arr);
    }
    return out;
}

function used(total: NodeTotal | undefined): boolean {
    if (!total) return false;
    return total.totalKWh > USAGE_EPSILON || total.totalCost > USAGE_EPSILON;
}

function scopeRow(
    title: string,
    name: string,
    total: NodeTotal,
    fleetKWh: number,
    currencySymbol: string
): EnergyReportRow {
    const share =
        fleetKWh > 0 ? Math.round((total.totalKWh / fleetKWh) * 100) : 0;
    return energyRow({
        section: title,
        device: name,
        consumption_kwh: +total.totalKWh.toFixed(3),
        cost: `${currencySymbol}${total.totalCost.toFixed(2)}`,
        share_pct: `${share}%`
    });
}

// Depth-first, siblings ranked by usage; skips unused subtrees; caps rows.
export function appendScopeSection(req: {
    rows: EnergyReportRow[];
    title: string;
    nodes: readonly ScopeNode[];
    rollup: ScopeRollup;
    currencySymbol: string;
    maxRows?: number;
    // Share denominator; overlap dims pass true fleet kWh.
    shareBaseKWh?: number;
}): boolean {
    const r = req.rollup;
    const shareBase = req.shareBaseKWh ?? r.fleetKWh;
    // Skip a dimension nobody is assigned to (Unassigned-only adds nothing).
    const anyUsed = req.nodes.some((n) => used(r.byId.get(n.id)));
    if (!anyUsed) return false;
    const hasUnassigned =
        r.unassignedKWh > USAGE_EPSILON || r.unassignedCost > USAGE_EPSILON;

    const children = childrenOf(req.nodes);
    const roots = children.get(null) ?? [];
    const cap = req.maxRows ?? DEFAULT_MAX_ROWS;
    const lines: Array<{name: string; total: NodeTotal}> = [];

    // visited guards the DFS against malformed (cyclic) tree data.
    const visited = new Set<number>();
    const walk = (node: ScopeNode, depth: number): void => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        const total = r.byId.get(node.id);
        if (!used(total) || !total) return;
        lines.push({name: `${'  '.repeat(depth)}${node.name}`, total});
        const kids = (children.get(node.id) ?? [])
            .filter((c) => used(r.byId.get(c.id)))
            .sort(
                (a, b) =>
                    (r.byId.get(b.id)?.totalKWh ?? 0) -
                    (r.byId.get(a.id)?.totalKWh ?? 0)
            );
        for (const kid of kids) walk(kid, depth + 1);
    };
    for (const root of [...roots].sort(
        (a, b) =>
            (r.byId.get(b.id)?.totalKWh ?? 0) -
            (r.byId.get(a.id)?.totalKWh ?? 0)
    )) {
        walk(root, 0);
    }

    req.rows.push(scopeHeader(req.title));
    const shown = lines.slice(0, cap);
    for (const line of shown) {
        req.rows.push(
            scopeRow(
                req.title,
                line.name,
                line.total,
                shareBase,
                req.currencySymbol
            )
        );
    }
    const dropped = lines.length - shown.length;
    if (dropped > 0) {
        req.rows.push(scopeNote(req.title, `... ${dropped} more not shown`));
    }
    if (hasUnassigned) {
        req.rows.push(
            scopeRow(
                req.title,
                'Unassigned',
                {totalKWh: r.unassignedKWh, totalCost: r.unassignedCost},
                shareBase,
                req.currencySymbol
            )
        );
    }
    req.rows.push({...energyRowBlank()});
    return true;
}

function scopeHeader(title: string): EnergyReportRow {
    return energyRow({section: title});
}

function scopeNote(title: string, note: string): EnergyReportRow {
    return energyRow({section: title, notes: note});
}

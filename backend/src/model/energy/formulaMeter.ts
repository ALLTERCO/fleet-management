// Virtual (formula) meter evaluation: a meter's value is a signed, shared
// linear combination of other meters' energy. It owns no points; it combines
// the attributed rows of the physical meters it references. Terms reference
// physical meters only — a missing or nested reference throws, never a silent
// zero (which would understate a bill).

import RpcError from '../../rpc/RpcError';
import type {EnergyLogicalMeter, EnergyQueryRow} from '../../types/api/energy';

// The distinct physical meters the formulas reference, for the caller to
// attribute alongside the selected meters. Throws on a missing or nested ref.
export function resolveFormulaReferences(
    formulas: readonly EnergyLogicalMeter[],
    all: readonly EnergyLogicalMeter[]
): EnergyLogicalMeter[] {
    const byId = new Map(all.map((m) => [m.id, m]));
    const refs = new Map<number, EnergyLogicalMeter>();
    for (const f of formulas) {
        for (const term of f.virtualFormula?.terms ?? []) {
            const ref = byId.get(term.meterId);
            if (!ref) {
                throw RpcError.InvalidParams(
                    `formula meter ${f.id} references meter ${term.meterId}, which does not exist in your organization`
                );
            }
            if (ref.aggregationMode === 'formula') {
                throw RpcError.InvalidParams(
                    `formula meter ${f.id} references another formula meter ${ref.id}; nested formulas are not supported yet`
                );
            }
            refs.set(ref.id, ref);
        }
    }
    return [...refs.values()];
}

// A formula combines its referenced meters. If the caller cannot read every
// device a referenced meter measures for the requested tags, that term would be
// partial or zero — fail loud, never silently undercount a bill.
export function assertFormulaInputsAccessible(
    referenced: readonly EnergyLogicalMeter[],
    allowedDeviceIds: ReadonlySet<number>,
    tags: readonly string[]
): void {
    const tagSet = new Set(tags);
    for (const m of referenced) {
        for (const p of m.points) {
            if (tagSet.has(p.tag) && !allowedDeviceIds.has(p.deviceId)) {
                throw RpcError.Domain('PermissionDenied');
            }
        }
    }
}

// Combine attributed physical rows into formula-meter rows. For each formula
// meter and each (bucket, tag) any referenced meter has, the value is
// Σ sign · share · referencedValue (a missing reference contributes 0).
export function evaluateFormulaMeters(
    formulas: readonly EnergyLogicalMeter[],
    physicalRows: readonly EnergyQueryRow[]
): EnergyQueryRow[] {
    const byKey = new Map<string, number>();
    const bucketTags = new Set<string>();
    for (const r of physicalRows) {
        byKey.set(`${r.meterId}|${r.bucket}|${r.tag}`, r.value);
        bucketTags.add(`${r.bucket}|${r.tag}`);
    }

    const out: EnergyQueryRow[] = [];
    for (const f of formulas) {
        const terms = f.virtualFormula?.terms ?? [];
        const slots = bucketTagsForTerms(terms, physicalRows);
        for (const bt of slots) {
            const [bucket, tag] = splitBucketTag(bt);
            let value = 0;
            for (const term of terms) {
                const v = byKey.get(`${term.meterId}|${bt}`);
                if (v === undefined) continue;
                value += term.sign * (term.share ?? 1) * v;
            }
            out.push({
                bucket,
                meterId: f.id,
                device: 0,
                shellyID: null,
                tag: tag as EnergyQueryRow['tag'],
                // Logical meters aggregate electric energy — ac_mains.
                domain: 'ac_mains',
                value
            });
        }
    }
    return out;
}

// The (bucket, tag) slots a formula must emit: every slot any of its referenced
// meters has data in.
function bucketTagsForTerms(
    terms: readonly {meterId: number}[],
    physicalRows: readonly EnergyQueryRow[]
): Set<string> {
    const wanted = new Set(terms.map((t) => t.meterId));
    const slots = new Set<string>();
    for (const r of physicalRows) {
        if (wanted.has(r.meterId ?? -1)) slots.add(`${r.bucket}|${r.tag}`);
    }
    return slots;
}

// Bucket ISO strings contain no '|', so the last segment is the tag.
function splitBucketTag(key: string): [string, string] {
    const i = key.lastIndexOf('|');
    return [key.slice(0, i), key.slice(i + 1)];
}

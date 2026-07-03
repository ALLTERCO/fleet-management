// Routes a single (component, field, value) tuple to the em-stats queue.
// Mode picks v1 (legacy regex), v2 (classifier), or v1+parallelWrite
// (legacy drives, classifier runs for parity counters only). Pure
// function — pass the queue + the parity sink + the cache + the
// per-device config resolver in, no globals.

import type {EmStatsQueue} from './emStatsQueue';
import {
    type ClassificationResult,
    classify,
    classifyFromOverride,
    pickConfigClassifier
} from './energyClassifier';
import type {EnergyClassifierCache} from './energyClassifierCache';
import type {EnergyOverrideCache} from './energyOverrideCache';
import type {LifetimeQueue} from './lifetimeQueue';

export interface EnergyRowInput {
    componentKey: string;
    fieldName: string;
    deviceId: number;
    // Cache key + handle for the parent device's component config.
    // Empty string acceptable for unit tests that only exercise tier 2.
    shellyId: string;
    value: number;
    lastValue: unknown;
    ts: number;
}

export interface ClassifierMode {
    version: 'v1' | 'v2';
    parallelWrite: boolean;
}

export interface ParitySink {
    record(
        outcome: 'both_null' | 'v2_only' | 'legacy_only' | 'match' | 'mismatch'
    ): void;
}

interface ResolvedRow {
    tag: string;
    domain: string;
    phase: string;
    channel: number;
    isDelta: boolean;
    scale: number;
}

// Returns the parent device's component config (entry from
// Shelly.GetConfig). Null when not yet known — the next frame retries.
export type ComponentConfigResolver = (
    shellyId: string,
    componentKey: string
) => unknown | null;

export interface CaptureDeps {
    queue: EmStatsQueue;
    lifetimeQueue: LifetimeQueue;
    legacyResolve: (input: EnergyRowInput) => ResolvedRow | null;
    parity: ParitySink;
    classifierCache: EnergyClassifierCache;
    componentConfigResolver: ComponentConfigResolver;
    // Tier 1 — operator overrides. v2 path only; legacy stays legacy.
    overrideCache: EnergyOverrideCache;
}

// A single capture invocation — bundles the row, the mode that picks
// the strategy, and the deps the strategy needs. Keeps strategy
// signatures at 1 arg.
interface CaptureCall {
    input: EnergyRowInput;
    mode: ClassifierMode;
    deps: CaptureDeps;
}

const CAPTURE_STRATEGIES: Readonly<
    Record<'v1' | 'v2', (call: CaptureCall) => void>
> = {
    v1: captureLegacy,
    v2: captureV2
};

export function captureEnergyRow(
    input: EnergyRowInput,
    mode: ClassifierMode,
    deps: CaptureDeps
): void {
    CAPTURE_STRATEGIES[mode.version]({input, mode, deps});
}

function captureV2(call: CaptureCall): void {
    const resolved = resolveViaClassifier(call.input, call.deps);
    if (resolved) {
        emitIfValuePresent({resolved, input: call.input}, call.deps);
    }
}

function captureLegacy(call: CaptureCall): void {
    const legacy = call.deps.legacyResolve(call.input);
    if (legacy) {
        emitIfValuePresent({resolved: legacy, input: call.input}, call.deps);
    }
    if (call.mode.parallelWrite) {
        const v2 = resolveViaClassifier(call.input, call.deps);
        recordParity({legacy, v2}, call.deps.parity);
    }
}

// Comparison pair passed to recordParity — keeps the function at 2
// args without losing which side is which.
interface ParityCompare {
    legacy: ResolvedRow | null;
    v2: ResolvedRow | null;
}

// Stats row + (when delta-typed) lifetime cumulative — the two emit
// paths always fire together so the lifetime counter never drifts
// from the stats it was derived from.
interface ResolvedInput {
    resolved: ResolvedRow;
    input: EnergyRowInput;
}

interface EmitContext extends ResolvedInput {
    value: number;
}

function emitIfValuePresent(ri: ResolvedInput, deps: CaptureDeps): void {
    const value = computeStoredValue(ri.resolved, ri.input);
    if (value === null) return;
    const ctx: EmitContext = {...ri, value};
    enqueueStatsRow(ctx, deps.queue);
    recordCumulativeIfDelta(ctx, deps.lifetimeQueue);
}

function resolveViaClassifier(
    input: EnergyRowInput,
    deps: CaptureDeps
): ResolvedRow | null {
    const tier1 = resolveOperatorOverride(input, deps);
    if (tier1) return toResolvedRow(tier1, input.componentKey);

    const tier2 = classify({
        componentKey: input.componentKey,
        fieldName: input.fieldName
    });
    if (tier2) return toResolvedRow(tier2, input.componentKey);

    const fallthrough = resolveConfigDependent(input, deps);
    if (fallthrough) return toResolvedRow(fallthrough, input.componentKey);
    return null;
}

// Tier 1 lookup — pure cache read. If the operator has declared this
// component, every other tier is bypassed.
function resolveOperatorOverride(
    input: EnergyRowInput,
    deps: CaptureDeps
): ClassificationResult | null {
    const override = deps.overrideCache.get(input.deviceId, input.componentKey);
    if (!override) return null;
    return classifyFromOverride(override, input.fieldName);
}

function resolveConfigDependent(
    input: EnergyRowInput,
    deps: CaptureDeps
): ClassificationResult | null {
    if (!input.shellyId) return null;
    const classifierFn = pickConfigClassifier(
        input.componentKey,
        input.fieldName
    );
    if (!classifierFn) return null;
    return resolveFromCacheOrConfig({input, classifierFn}, deps);
}

// Per-row task for the tier-3/4 fall-through. Bundles the row + the
// classifier function that was picked for it, so the cache-or-config
// step stays at 2 args (task, deps).
interface ConfigResolveTask {
    input: EnergyRowInput;
    classifierFn: (cfg: unknown) => ClassificationResult | null;
}

function resolveFromCacheOrConfig(
    task: ConfigResolveTask,
    deps: CaptureDeps
): ClassificationResult | null {
    const {input, classifierFn} = task;
    const cached = deps.classifierCache.get(input.shellyId, input.componentKey);
    if (cached !== undefined) return cached;
    const cfg = deps.componentConfigResolver(
        input.shellyId,
        input.componentKey
    );
    if (!cfg) return null;
    const result = classifierFn(cfg);
    deps.classifierCache.set(input.shellyId, input.componentKey, result);
    return result;
}

function toResolvedRow(
    r: ClassificationResult,
    componentKey: string
): ResolvedRow {
    return {
        tag: r.tag,
        domain: r.domain,
        phase: r.phase,
        isDelta: r.isDelta,
        // Tier 1 sets r.channel from the operator override; tiers 2/3/4
        // leave it undefined and we fall back to parsing componentKey.
        channel: r.channel ?? parseChannel(componentKey),
        scale: r.scale
    };
}

function parseChannel(componentKey: string): number {
    const colon = componentKey.indexOf(':');
    if (colon === -1) return 0;
    return Number.parseInt(componentKey.slice(colon + 1), 10) || 0;
}

// Side-effect — pushes one row into the em-stats queue.
function enqueueStatsRow(ctx: EmitContext, queue: EmStatsQueue): void {
    queue.enqueue({
        deviceId: ctx.input.deviceId,
        tag: ctx.resolved.tag,
        domain: ctx.resolved.domain,
        phase: ctx.resolved.phase,
        channel: ctx.resolved.channel,
        ts: Math.trunc(ctx.input.ts),
        value: ctx.value
    });
}

// Side-effect — for delta-tagged rows, pushes the absolute cumulative
// reading into the lifetime queue so the lifetime counter advances in
// lockstep with the stats row that gave it the delta.
function recordCumulativeIfDelta(ctx: EmitContext, queue: LifetimeQueue): void {
    if (!ctx.resolved.isDelta) return;
    queue.enqueue({
        deviceId: ctx.input.deviceId,
        channel: ctx.resolved.channel,
        tag: ctx.resolved.tag,
        cumulativeWh: scaleValue(ctx.input.value, ctx.resolved.scale),
        ts: Math.trunc(ctx.input.ts)
    });
}

function computeStoredValue(
    resolved: ResolvedRow,
    input: EnergyRowInput
): number | null {
    const scaledCurrent = scaleValue(input.value, resolved.scale);
    if (!resolved.isDelta) return scaledCurrent;
    if (typeof input.lastValue !== 'number') return null;
    const scaledLast = scaleValue(input.lastValue, resolved.scale);
    return positiveDelta(scaledCurrent, scaledLast);
}

function scaleValue(v: number, scale: number): number {
    return scale === 1 ? v : v * scale;
}

// Cumulative counters only contribute when they advance. First
// reading (no prev) and resets (current < prev) both produce no row.
function positiveDelta(current: number, last: number): number | null {
    const delta = current - last;
    return delta > 0 ? delta : null;
}

function recordParity(compare: ParityCompare, sink: ParitySink): void {
    sink.record(parityOutcome(compare));
}

function parityOutcome(
    compare: ParityCompare
): 'both_null' | 'v2_only' | 'legacy_only' | 'match' | 'mismatch' {
    const {legacy, v2} = compare;
    if (legacy === null && v2 === null) return 'both_null';
    if (legacy === null) return 'v2_only';
    if (v2 === null) return 'legacy_only';
    return rowsEqual(legacy, v2) ? 'match' : 'mismatch';
}

function rowsEqual(a: ResolvedRow, b: ResolvedRow): boolean {
    return (
        a.tag === b.tag &&
        a.domain === b.domain &&
        a.phase === b.phase &&
        a.isDelta === b.isDelta &&
        a.channel === b.channel
    );
}

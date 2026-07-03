// Per-device, per-component classifier cache. Tiers 3 (BTHome) and 4
// (VC heuristic) need parent-device config — cheap to compute but not free
// per value-frame. Survives until cfg_rev jumps or the device reconnects;
// both invalidate via invalidateDevice(). A cached null = "tried, no
// classification" (distinct from never-looked-up).

import type {ClassificationResult} from './energyClassifier';
import {NullableDeviceCache} from './util/nullableDeviceCache';

export class EnergyClassifierCache extends NullableDeviceCache<
    string,
    ClassificationResult
> {}

export const energyClassifierCache = new EnergyClassifierCache();

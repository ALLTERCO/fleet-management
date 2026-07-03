// UNIT — initLevel returns the right default per persisted state.
// INTEGRATION — runtime config + legacy localStorage shape both honoured.
// SYSTEM — fresh install (no storage) baselines at Light.
// REGRESSION — malformed stored values fall through to the default.

import {beforeEach, describe, expect, it, vi} from 'vitest';

declare global {
    interface Window {
        __FM_RUNTIME_CONFIG__?: {observability?: boolean};
    }
}

async function importInitLevel() {
    vi.resetModules();
    const mod = await import('@/tools/observability');
    return mod.getObsLevel();
}

beforeEach(() => {
    localStorage.clear();
    window.__FM_RUNTIME_CONFIG__ = undefined;
    vi.resetModules();
});

// ─── UNIT — persisted-state cases ───

describe('observability initLevel', () => {
    it('returns the stored value when fm_obs_level is set', async () => {
        localStorage.setItem('fm_obs_level', '2');
        expect(await importInitLevel()).toBe(2);
    });

    it('clamps invalid stored numbers and falls through to the default', async () => {
        localStorage.setItem('fm_obs_level', '99');
        expect(await importInitLevel()).toBe(1);
    });

    it('falls through to the default for non-numeric junk', async () => {
        localStorage.setItem('fm_obs_level', 'banana');
        expect(await importInitLevel()).toBe(1);
    });
});

// ─── INTEGRATION — alternative inputs ───

describe('observability initLevel — alternative inputs', () => {
    it('legacy fm_observability flag maps to Medium (2)', async () => {
        localStorage.setItem('fm_observability', '1');
        expect(await importInitLevel()).toBe(2);
    });

    it('runtime-config observability=true maps to Medium (2)', async () => {
        window.__FM_RUNTIME_CONFIG__ = {observability: true};
        expect(await importInitLevel()).toBe(2);
    });
});

// ─── SYSTEM — OOTB baseline ───

describe('observability initLevel — fresh install', () => {
    it('with no storage and no runtime config, defaults to Light (1)', async () => {
        expect(await importInitLevel()).toBe(1);
    });
});

// ─── REGRESSION — precedence ───

describe('observability initLevel — precedence', () => {
    it('stored fm_obs_level wins over legacy fm_observability', async () => {
        localStorage.setItem('fm_obs_level', '0');
        localStorage.setItem('fm_observability', '1');
        expect(await importInitLevel()).toBe(0);
    });

    it('explicit zero still wins — user can disable the always-on default', async () => {
        localStorage.setItem('fm_obs_level', '0');
        expect(await importInitLevel()).toBe(0);
    });
});

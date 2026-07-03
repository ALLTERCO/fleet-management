import {describe, expect, it} from 'vitest';
import {__testing} from '@/composables/useStaleness';

const {levelFor, labelFor, snapshot} = __testing;

describe('levelFor', () => {
    it('reports fresh when age is below 2x the expected interval', () => {
        expect(levelFor(1_500, 1_000)).toBe('fresh');
    });
    it('reports warn between 2x and 5x', () => {
        expect(levelFor(3_000, 1_000)).toBe('warn');
        expect(levelFor(4_999, 1_000)).toBe('warn');
    });
    it('reports stale at 5x and above', () => {
        expect(levelFor(5_000, 1_000)).toBe('stale');
        expect(levelFor(60_000, 1_000)).toBe('stale');
    });
});

describe('labelFor', () => {
    it('treats anything under 5 seconds as just now', () => {
        expect(labelFor(0)).toBe('just now');
        expect(labelFor(4_999)).toBe('just now');
    });
    it('reports seconds when under one minute', () => {
        expect(labelFor(45_000)).toBe('45s ago');
    });
    it('reports minutes between one minute and one hour', () => {
        expect(labelFor(5 * 60_000)).toBe('5m ago');
    });
    it('reports hours past one hour', () => {
        expect(labelFor(3 * 60 * 60_000)).toBe('3h ago');
    });
});

describe('snapshot', () => {
    it('combines age, level, and label', () => {
        const snap = snapshot(45_000, 1_000);
        expect(snap.ageMs).toBe(45_000);
        expect(snap.level).toBe('stale');
        expect(snap.label).toBe('45s ago');
    });
});

describe('lastSeenTs sentinel handling', () => {
    it('useStaleness treats 0 as the unknown sentinel (returns null)', async () => {
        const {ref} = await import('vue');
        const {useStaleness} = await import('@/composables/useStaleness');
        const {mount} = await import('@vue/test-utils');
        const {defineComponent, h} = await import('vue');

        let captured: ReturnType<typeof useStaleness> | null = null;
        const Host = defineComponent({
            setup() {
                const stamp = ref(0);
                captured = useStaleness(stamp, {expectedIntervalMs: 1_000});
                return () => h('div');
            }
        });
        mount(Host);
        expect(captured?.value).toBeNull();
    });
});

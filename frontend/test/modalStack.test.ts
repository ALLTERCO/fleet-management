/** Unit tests for helpers/modalStack — one assertion per behaviour. */

import {beforeEach, describe, expect, it} from 'vitest';
import {
    _resetModalStackForTests,
    lockBodyScroll,
    openModalDepthCount,
    releaseModalDepth,
    reserveModalDepth,
    unlockBodyScroll
} from '@/helpers/modalStack';

beforeEach(() => {
    _resetModalStackForTests();
    document.body.style.overflow = '';
});

describe('reserveModalDepth', () => {
    it('returns one for the first modal opened in a clean session', () => {
        expect(reserveModalDepth()).toBe(1);
    });

    it('returns a strictly higher depth for each subsequent modal', () => {
        const first = reserveModalDepth();
        const second = reserveModalDepth();
        const third = reserveModalDepth();
        expect(second).toBeGreaterThan(first);
        expect(third).toBeGreaterThan(second);
    });

    it('never reuses a depth that is still in use by another modal', () => {
        const first = reserveModalDepth();
        const second = reserveModalDepth();
        expect(second).not.toBe(first);
    });

    it('starts from one again after every modal has been released', () => {
        const first = reserveModalDepth();
        releaseModalDepth(first);
        expect(reserveModalDepth()).toBe(1);
    });

    it('keeps issuing higher depths even when an earlier slot was released', () => {
        const first = reserveModalDepth();
        const second = reserveModalDepth();
        releaseModalDepth(first);
        const third = reserveModalDepth();
        expect(third).toBeGreaterThan(second);
    });
});

describe('releaseModalDepth', () => {
    it('removes the depth from the active set', () => {
        const depth = reserveModalDepth();
        releaseModalDepth(depth);
        expect(openModalDepthCount()).toBe(0);
    });

    it('does nothing when called with a depth that is not active', () => {
        releaseModalDepth(999);
        expect(openModalDepthCount()).toBe(0);
    });

    it('allows out-of-order release without breaking the rest of the stack', () => {
        const first = reserveModalDepth();
        const second = reserveModalDepth();
        releaseModalDepth(first);
        expect(openModalDepthCount()).toBe(1);
        releaseModalDepth(second);
        expect(openModalDepthCount()).toBe(0);
    });
});

describe('openModalDepthCount', () => {
    it('returns zero in a clean session', () => {
        expect(openModalDepthCount()).toBe(0);
    });

    it('reflects the number of modals currently reserved', () => {
        reserveModalDepth();
        reserveModalDepth();
        reserveModalDepth();
        expect(openModalDepthCount()).toBe(3);
    });
});

describe('lockBodyScroll', () => {
    it('sets body overflow to hidden when the first lock is acquired', () => {
        lockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('keeps body overflow hidden when a second lock is acquired', () => {
        lockBodyScroll();
        lockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('preserves any overflow value that was already on the body', () => {
        document.body.style.overflow = 'scroll';
        lockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('scroll');
    });
});

describe('unlockBodyScroll', () => {
    it('restores the original overflow when the last lock is released', () => {
        lockBodyScroll();
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('');
    });

    it('keeps body overflow locked while at least one lock remains', () => {
        lockBodyScroll();
        lockBodyScroll();
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('does nothing when called without a matching lock', () => {
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('');
    });
});

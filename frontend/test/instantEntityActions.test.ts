import {describe, expect, it} from 'vitest';
import {isInstantEntityAction} from '@/helpers/instantEntityActions';

describe('isInstantEntityAction', () => {
    it('allows cataloged instant commands to render immediately', () => {
        expect(isInstantEntityAction('switch', 'toggle')).toBe(true);
        expect(isInstantEntityAction('light', 'toggle')).toBe(true);
        expect(isInstantEntityAction('boolean', 'setValue')).toBe(true);
        expect(isInstantEntityAction('camera', 'setPrivacy')).toBe(true);
        expect(isInstantEntityAction('service', 'setVariable')).toBe(true);
        expect(isInstantEntityAction('cury', 'setCuryMode')).toBe(true);
        expect(isInstantEntityAction('media', 'playFavourite')).toBe(true);
        expect(isInstantEntityAction('media', 'radioStop')).toBe(true);
    });

    it('keeps non-optimistic actions in the blocking request path', () => {
        expect(isInstantEntityAction('switch', 'resetCounters')).toBe(false);
        expect(isInstantEntityAction('cover', 'open')).toBe(false);
        expect(isInstantEntityAction('service', 'trigger')).toBe(false);
        expect(isInstantEntityAction('blutrv', 'startBoost')).toBe(false);
        expect(isInstantEntityAction('ui', 'swipe')).toBe(false);
        expect(isInstantEntityAction('light', 'setDaliGroup')).toBe(false);
        expect(isInstantEntityAction('ledstrip', 'setLedStripField')).toBe(
            false
        );
        expect(isInstantEntityAction('ledstrip', 'nextLedStripEffect')).toBe(
            false
        );
    });
});

import {describe, expect, it} from 'vitest';
import {isApplePlatform, modKeyLabel} from '@/helpers/platform';

function fakeNav(opts: {uaPlatform?: string; userAgent: string}): Navigator {
    return {
        userAgent: opts.userAgent,
        userAgentData: opts.uaPlatform ? {platform: opts.uaPlatform} : undefined
    } as unknown as Navigator;
}

describe('isApplePlatform', () => {
    it('uses userAgentData when available — macOS', () => {
        const nav = fakeNav({uaPlatform: 'macOS', userAgent: 'whatever'});
        expect(isApplePlatform(nav)).toBe(true);
    });

    it('uses userAgentData when available — Windows', () => {
        const nav = fakeNav({uaPlatform: 'Windows', userAgent: 'Macintosh'});
        expect(isApplePlatform(nav)).toBe(false);
    });

    it('falls back to user-agent string when userAgentData is missing', () => {
        const nav = fakeNav({
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605'
        });
        expect(isApplePlatform(nav)).toBe(true);
    });

    it('matches iPhone/iPad/iPod via the fallback', () => {
        expect(
            isApplePlatform(fakeNav({userAgent: 'Mozilla/5.0 (iPhone) Safari'}))
        ).toBe(true);
        expect(
            isApplePlatform(fakeNav({userAgent: 'Mozilla/5.0 (iPad) Safari'}))
        ).toBe(true);
    });

    it('returns false on Linux / Windows fallback', () => {
        expect(
            isApplePlatform(
                fakeNav({userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'})
            )
        ).toBe(false);
    });
});

describe('modKeyLabel', () => {
    it('returns the command symbol on Apple', () => {
        expect(modKeyLabel(fakeNav({uaPlatform: 'macOS', userAgent: ''}))).toBe(
            '⌘'
        );
    });

    it('returns Ctrl elsewhere', () => {
        expect(
            modKeyLabel(fakeNav({uaPlatform: 'Windows', userAgent: ''}))
        ).toBe('Ctrl');
    });
});

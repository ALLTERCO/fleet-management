import {describe, expect, it} from 'vitest';
import {
    extractEntryModuleSrc,
    isNewBundleServed
} from '@/tools/bundleVersion';

const PAGE = (hash: string) =>
    `<!doctype html><html><head>` +
    `<link rel="modulepreload" href="/assets/vendor-zzz.js">` +
    `<script type="module" crossorigin src="/assets/index-${hash}.js"></script>` +
    `</head><body></body></html>`;

describe('deployed bundle entry-hash detection', () => {
    it('extracts the entry module src from served HTML', () => {
        expect(extractEntryModuleSrc(PAGE('AAAA'))).toBe('/assets/index-AAAA.js');
    });

    it('handles attribute order (src before type)', () => {
        const html =
            '<script src="/assets/index-BBBB.js" type="module"></script>';
        expect(extractEntryModuleSrc(html)).toBe('/assets/index-BBBB.js');
    });

    it('returns null when there is no module entry script', () => {
        expect(extractEntryModuleSrc('<html><body>no scripts</body></html>')).toBe(
            null
        );
    });

    it('reports a new bundle only when the served entry hash differs', () => {
        const running = '/assets/index-AAAA.js';
        expect(isNewBundleServed(running, PAGE('BBBB'))).toBe(true);
        expect(isNewBundleServed(running, PAGE('AAAA'))).toBe(false);
    });

    it('does not claim a new bundle when inputs are missing (transient failure)', () => {
        expect(isNewBundleServed(null, PAGE('BBBB'))).toBe(false);
        expect(isNewBundleServed('/assets/index-AAAA.js', null)).toBe(false);
    });
});

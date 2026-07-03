import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// Regression for the MDI icon 404: the css lived at /mdi/ but its @font-face
// url is ../fonts/, which resolved to /fonts/ (missing). Moving it under
// /mdi/css/ makes ../fonts/ resolve to /mdi/fonts/ where the fonts are.
// vitest runs with the frontend package as cwd.
const root = process.cwd();

describe('MDI icon font assets resolve', () => {
    it('index.html links the css under /mdi/css/', () => {
        const html = readFileSync(join(root, 'index.html'), 'utf8');
        expect(html).toContain('/mdi/css/materialdesignicons.min.css');
        expect(html).not.toContain('"/mdi/materialdesignicons.min.css"');
    });

    it('the css exists and points fonts at ../fonts/', () => {
        const css = readFileSync(
            join(root, 'public/mdi/css/materialdesignicons.min.css'),
            'utf8'
        );
        expect(css).toMatch(/\.\.\/fonts\/materialdesignicons-webfont\.woff2/);
    });

    it('the woff/woff2 exist where ../fonts/ resolves (mdi/fonts)', () => {
        const fonts = join(root, 'public/mdi/fonts');
        expect(
            existsSync(join(fonts, 'materialdesignicons-webfont.woff2'))
        ).toBe(true);
        expect(
            existsSync(join(fonts, 'materialdesignicons-webfont.woff'))
        ).toBe(true);
    });
});

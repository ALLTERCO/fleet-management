import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

describe('branding component routing boundary', () => {
    it('keeps internal sections out of file-based page discovery', () => {
        const pageFiles = readdirSync(join(process.cwd(), 'src/pages/settings'));
        expect(
            pageFiles.filter((file) => /^Branding.*Section\.vue$/.test(file))
        ).toEqual([]);

        const components = readdirSync(
            join(process.cwd(), 'src/components/settings/branding')
        );
        expect(components.filter((file) => /^Branding.*Section\.vue$/.test(file)))
            .toHaveLength(9);
    });

    it('keeps generated router types free from standalone branding sections', () => {
        const generated = readFileSync(join(process.cwd(), 'typed-router.d.ts'), 'utf8');
        expect(generated).not.toMatch(/\/settings\/Branding\w+Section/);
        expect(generated).toContain("'/settings/branding'");
    });
});

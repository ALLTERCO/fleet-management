// Regression: commit 532fb007 changed `import MapCanvas` to
// `import type MapCanvas` in WorldMap.vue. Type-only imports are erased
// at runtime, so `<MapCanvas>` in the template referenced an undefined
// identifier — Vue then invoked the consumer's scoped slot with no
// props, causing `Cannot destructure property 'loaded' of 'undefined'`
// at runtime on the Locations page.
//
// This static-analysis check pins that every Vue SFC referenced as a
// template component is imported as a value, not a type. If the
// regression returns, this test fails in CI instead of in a user's
// browser.

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

const FRONTEND_SRC = join(__dirname, '..', 'src');

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.vue')) yield full;
    }
}

interface Offence {
    file: string;
    importedName: string;
}

function findTypeImportsUsedAsComponents(file: string): Offence[] {
    const src = readFileSync(file, 'utf8');
    const templateMatch = src.match(/<template>([\s\S]*?)<\/template>/);
    if (!templateMatch) return [];
    const template = templateMatch[1];

    const out: Offence[] = [];
    const importRe =
        /^\s*import\s+type\s+(\w+)\s+from\s+['"][^'"]+\.vue['"];?\s*$/gm;
    let m: RegExpExecArray | null = importRe.exec(src);
    while (m !== null) {
        const name = m[1];
        // Used as a template tag like <Name> or </Name> or <Name ...>?
        const tagRe = new RegExp(`<\\/?${name}(?:\\s|>|\\/>)`);
        if (tagRe.test(template)) {
            out.push({file, importedName: name});
        }
        m = importRe.exec(src);
    }
    return out;
}

describe('Vue SFCs imported as types but used as components', () => {
    it('finds zero offenders across frontend/src', () => {
        const offences: Offence[] = [];
        for (const file of walk(FRONTEND_SRC)) {
            offences.push(...findTypeImportsUsedAsComponents(file));
        }
        if (offences.length > 0) {
            const detail = offences
                .map(
                    (o) =>
                        `  - ${o.file.replace(FRONTEND_SRC, 'src')}: ${o.importedName}`
                )
                .join('\n');
            expect.fail(
                `Type-only imports referenced as template components — runtime tag will be undefined and slots will receive no props. Drop \`type\` from these imports:\n${detail}`
            );
        }
        expect(offences).toHaveLength(0);
    });
});

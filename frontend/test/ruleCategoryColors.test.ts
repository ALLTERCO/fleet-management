// Guard: the alert-rule category colour tokens must resolve to real colours.
// Regression for the bug where --rule-color-safety/measurement pointed at
// undefined --state-* tokens and --rule-color-operation used a raw RGB triplet
// as a colour, leaving the kind-picker dots invisible.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const css = readFileSync(
    resolve(__dirname, '..', 'src/styles/design-tokens.css'),
    'utf8'
);

const definedTokens = new Set(
    [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1])
);

const ruleColorDefs = [
    ...css.matchAll(/(--rule-color-[a-z]+)\s*:\s*([^;]+);/g)
].map(([, name, value]) => ({name, value}));

describe('rule-category colour tokens', () => {
    it('defines all four categories', () => {
        expect(ruleColorDefs.map((d) => d.name).sort()).toEqual([
            '--rule-color-connectivity',
            '--rule-color-measurement',
            '--rule-color-operation',
            '--rule-color-safety'
        ]);
    });

    it('only reference custom properties that are actually defined', () => {
        for (const {name, value} of ruleColorDefs) {
            const refs = [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(
                (m) => m[1]
            );
            for (const ref of refs) {
                expect(definedTokens.has(ref), `${name} → ${ref}`).toBe(true);
            }
        }
    });

    it('wrap RGB-triplet accent tokens in rgb() so they render as colours', () => {
        for (const {name, value} of ruleColorDefs) {
            if (/var\(\s*--accent-[a-z]+/.test(value)) {
                expect(value.includes('rgb('), name).toBe(true);
            }
        }
    });
});

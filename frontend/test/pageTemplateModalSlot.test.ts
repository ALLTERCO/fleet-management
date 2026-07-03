// Guard against a real footgun: PageTemplate only renders its default `<slot />`
// in bare / non-list mode. In list mode the ListSourceRenderer branch wins and
// the default slot is skipped (PageTemplate.vue). A modal placed as default-slot
// content of PageTemplate therefore never mounts — its open flag flips but
// nothing shows. Modals must live in the always-rendered `#modals` slot.
//
// This test parses every .vue under src and fails if any *Modal element sits in
// a PageTemplate default slot, so the mistake can't reappear on any page.

import {readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parse as parseDom} from '@vue/compiler-dom';
import {parse as parseSfc} from '@vue/compiler-sfc';
import {describe, expect, it} from 'vitest';

const SRC = resolve(__dirname, '../src');
const ELEMENT = 1;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;
const MODAL_TAG = /Modal$/;
// A PageTemplate renders its default slot in content/bare mode, but NOT in list
// mode (items/source drives the ListSourceRenderer branch instead). Only list
// mode strands a default-slot modal, so that is what we flag.
const LIST_PROPS = new Set(['items', 'source']);

interface Node {
    type: number;
    tag?: string;
    props?: Array<{type: number; name: string; arg?: {content?: string}}>;
    children?: Node[];
}

// The slot a `<template #name>` targets, or null if the node isn't a slot
// wrapper. A bare `<template>` with no slot directive is default-slot content.
function slotTarget(node: Node): string | null {
    if (node.type !== ELEMENT || node.tag !== 'template') return null;
    const dir = (node.props ?? []).find(
        (p) => p.type === DIRECTIVE && p.name === 'slot'
    );
    if (!dir) return null;
    return dir.arg?.content ?? 'default';
}

// A PageTemplate is in list mode when it binds `items` or `source` (static or
// bound) — that is when its default slot stops rendering.
function isListMode(node: Node): boolean {
    return (node.props ?? []).some((p) => {
        if (p.type === ATTRIBUTE) return LIST_PROPS.has(p.name);
        if (p.type === DIRECTIVE && p.name === 'bind')
            return LIST_PROPS.has(p.arg?.content ?? '');
        return false;
    });
}

function eachElement(node: Node | null, visit: (n: Node) => void): void {
    if (!node) return;
    if (node.type === ELEMENT) visit(node);
    for (const child of node.children ?? []) eachElement(child, visit);
}

// Walk a subtree that starts in PageTemplate's default slot. Entering a named
// slot other than `default` (e.g. #modals, #item) leaves the default region and
// is safe. Any *Modal reached while still in the default region is stranded.
function collectStranded(node: Node, inDefault: boolean, out: string[]): void {
    const slot = slotTarget(node);
    const stillDefault =
        slot === null || slot === 'default' ? inDefault : false;
    if (
        stillDefault &&
        node.type === ELEMENT &&
        node.tag &&
        MODAL_TAG.test(node.tag)
    ) {
        out.push(node.tag);
    }
    for (const child of node.children ?? [])
        collectStranded(child, stillDefault, out);
}

/** Modal tags sitting in a PageTemplate default slot in this SFC source. */
export function strandedModals(source: string): string[] {
    const template = parseSfc(source).descriptor.template?.content;
    if (!template) return [];
    const ast = parseDom(template) as unknown as Node;
    const out: string[] = [];
    eachElement(ast, (node) => {
        if (node.tag !== 'PageTemplate' || !isListMode(node)) return;
        for (const child of node.children ?? [])
            collectStranded(child, true, out);
    });
    return out;
}

function vueFilesUnder(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...vueFilesUnder(full));
        else if (entry.name.endsWith('.vue')) files.push(full);
    }
    return files;
}

describe('strandedModals (detector)', () => {
    it('flags a modal in the default slot', () => {
        const src =
            '<template><PageTemplate :items="x"><BarModal/></PageTemplate></template>';
        expect(strandedModals(src)).toEqual(['BarModal']);
    });

    it('accepts a modal in the #modals slot', () => {
        const src =
            '<template><PageTemplate :items="x"><template #modals><BarModal/></template></PageTemplate></template>';
        expect(strandedModals(src)).toEqual([]);
    });

    it('flags a modal nested inside default-slot markup', () => {
        const src =
            '<template><PageTemplate :items="x"><div><BarModal/></div></PageTemplate></template>';
        expect(strandedModals(src)).toEqual(['BarModal']);
    });

    it('treats #default the same as the default slot', () => {
        const src =
            '<template><PageTemplate :items="x"><template #default><BarModal/></template></PageTemplate></template>';
        expect(strandedModals(src)).toEqual(['BarModal']);
    });

    it('ignores content-mode pages (no items/source), where the slot renders', () => {
        const src =
            '<template><PageTemplate title="X" fill><BarModal/></PageTemplate></template>';
        expect(strandedModals(src)).toEqual([]);
    });
});

describe('no page strands a modal in PageTemplate default slot', () => {
    const offenders = vueFilesUnder(SRC)
        .map((file) => ({file, tags: strandedModals(readFileSync(file, 'utf8'))}))
        .filter((r) => r.tags.length > 0);

    it('every .vue keeps modals in the #modals slot', () => {
        const report = offenders
            .map((o) => `  ${o.file}: ${o.tags.join(', ')}`)
            .join('\n');
        expect(
            offenders,
            `Modals in a PageTemplate default slot never render in list mode. ` +
                `Move them into <template #modals>:\n${report}`
        ).toHaveLength(0);
    });
});

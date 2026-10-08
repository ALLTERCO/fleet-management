// DOMPurify (SVG profile), server-side via jsdom.

import createDOMPurify from 'dompurify';
import {JSDOM} from 'jsdom';

const jsdomWindow = new JSDOM('').window;
const purify = createDOMPurify(jsdomWindow as any);

const SVG_PROFILE = {USE_PROFILES: {svg: true, svgFilters: true}};

const ELEMENT_NODE = 1;

// DOMPurify drops every attribute in an unknown namespace, so an uploaded
// Inkscape plan would lose the layer identity the floor-plan reader needs
// (which group is "Base", which is "Devices"). Mirror those attributes onto
// data-* names, which the SVG profile keeps.
const LAYER_ATTRIBUTE_MIRRORS: ReadonlyArray<{from: string; to: string}> = [
    {from: 'inkscape:label', to: 'data-layer'},
    {from: 'inkscape:groupmode', to: 'data-groupmode'}
];

// beforeSanitizeAttributes, not after: the mirrored value must still pass
// through DOMPurify's own attribute validation.
purify.addHook('beforeSanitizeAttributes', (node) => {
    // DOMPurify calls this hook with text nodes too, despite the Element type.
    if (node.nodeType !== ELEMENT_NODE) return;
    for (const mirror of LAYER_ATTRIBUTE_MIRRORS) {
        const value = node.getAttribute(mirror.from);
        if (value) node.setAttribute(mirror.to, value);
    }
});

export function sanitizeSvg(bytes: Buffer): Buffer {
    const dirty = bytes.toString('utf8');
    const clean = purify.sanitize(dirty, SVG_PROFILE);
    return Buffer.from(clean, 'utf8');
}

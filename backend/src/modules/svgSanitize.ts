// DOMPurify (SVG profile), server-side via jsdom.

import createDOMPurify from 'dompurify';
import {JSDOM} from 'jsdom';

const jsdomWindow = new JSDOM('').window;
const purify = createDOMPurify(jsdomWindow as any);

const SVG_PROFILE = {USE_PROFILES: {svg: true, svgFilters: true}};

export function sanitizeSvg(bytes: Buffer): Buffer {
    const dirty = bytes.toString('utf8');
    const clean = purify.sanitize(dirty, SVG_PROFILE);
    return Buffer.from(clean, 'utf8');
}

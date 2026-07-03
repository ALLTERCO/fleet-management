/** One behavioural rule per test for the SVG floor-plan adapter. */

import {describe, expect, it} from 'vitest';
import {
    extractDevicesFromSvg,
    stripInkscapeBaseLayer
} from '@/helpers/svg-floorplan';

const SVG_WITH_BASE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100" viewBox="0 0 100 100">
  <g inkscape:label="Base">
    <rect x="0" y="0" width="100" height="100" fill="#ffffff"/>
  </g>
  <g inkscape:label="Floor">
    <path d="M 10 10 L 90 10" stroke="#000"/>
  </g>
</svg>`;

const SVG_WITH_DEVICES = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200" height="200" viewBox="0 0 200 200">
  <g inkscape:label="Floor">
    <g inkscape:label="Devices">
      <g inkscape:label="Light">
        <g inkscape:label="Light1">
          <circle cx="40" cy="60" r="5"/>
        </g>
        <g inkscape:label="Light2">
          <circle cx="160" cy="120" r="5"/>
        </g>
      </g>
      <g inkscape:label="DoorWindow">
        <g inkscape:label="Door1">
          <circle cx="100" cy="180" r="3"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;

const SVG_WITHOUT_INKSCAPE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path d="M 0 0 L 100 100" stroke="#000"/>
</svg>`;

describe('stripInkscapeBaseLayer', () => {
    it('removes the Base layer when present so the white background does not render', () => {
        const result = stripInkscapeBaseLayer(SVG_WITH_BASE);
        expect(result).not.toMatch(/inkscape:label="Base"/);
        expect(result).not.toMatch(/#ffffff/);
    });

    it('keeps every non-Base layer intact', () => {
        const result = stripInkscapeBaseLayer(SVG_WITH_BASE);
        expect(result).toMatch(/inkscape:label="Floor"/);
        expect(result).toMatch(/M 10 10 L 90 10/);
    });

    it('returns the input unchanged when there is no Base layer to strip', () => {
        const result = stripInkscapeBaseLayer(SVG_WITHOUT_INKSCAPE);
        expect(result).toBe(SVG_WITHOUT_INKSCAPE);
    });

    it('returns the input unchanged on malformed SVG so callers can still render the original', () => {
        const malformed = '<svg><not-closed';
        const result = stripInkscapeBaseLayer(malformed);
        expect(result).toBe(malformed);
    });
});

describe('extractDevicesFromSvg — devices normalized to 0..1', () => {
    it('extracts a device for every labelled circle group under a Devices layer', () => {
        const devices = extractDevicesFromSvg(SVG_WITH_DEVICES);
        expect(devices.map((d) => d.label)).toEqual([
            'Light1',
            'Light2',
            'Door1'
        ]);
    });

    it('assigns the parent layer label as the category', () => {
        const devices = extractDevicesFromSvg(SVG_WITH_DEVICES);
        expect(devices.find((d) => d.label === 'Light1')?.category).toBe(
            'Light'
        );
        expect(devices.find((d) => d.label === 'Door1')?.category).toBe(
            'DoorWindow'
        );
    });

    it('normalizes the circle center against the SVG dimensions to a 0..1 coord', () => {
        const devices = extractDevicesFromSvg(SVG_WITH_DEVICES);
        const light1 = devices.find((d) => d.label === 'Light1');
        expect(light1?.x).toBeCloseTo(40 / 200, 4);
        expect(light1?.y).toBeCloseTo(60 / 200, 4);
    });

    it('clamps positions to 0..1 when the source is mildly out-of-bounds (Inkscape rounding)', () => {
        const overshoot = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100" viewBox="0 0 100 100">
            <g inkscape:label="Devices"><g inkscape:label="Light">
              <g inkscape:label="Far"><circle cx="200" cy="-10"/></g>
            </g></g>
        </svg>`;
        const devices = extractDevicesFromSvg(overshoot);
        expect(devices[0]).toEqual(expect.objectContaining({x: 1, y: 0}));
    });

    it('returns an empty list when no Devices layer is present', () => {
        expect(extractDevicesFromSvg(SVG_WITH_BASE)).toEqual([]);
    });

    it('returns an empty list when the SVG has no Inkscape labels at all', () => {
        expect(extractDevicesFromSvg(SVG_WITHOUT_INKSCAPE)).toEqual([]);
    });

    it('returns an empty list on malformed SVG so callers can fall back gracefully', () => {
        expect(extractDevicesFromSvg('<svg><not-closed')).toEqual([]);
    });
});

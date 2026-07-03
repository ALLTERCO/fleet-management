import {describe, expect, it} from 'vitest';

import {normalizeToFloor, parseFloorPlanSvg} from '@/helpers/floor-plan-svg';

const NS_SODI =
    'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';
const NS_INK = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

// Minimal Inkscape-flavored SVG with one floor outline, two rooms, and
// two device markers (one per type) — mirrors the layout convention
// documented in floor-plan-svg.ts.
const SAMPLE_SVG = `<?xml version="1.0"?>
<svg ${NS_INK} ${NS_SODI} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1050 720">
  <g inkscape:groupmode="layer" inkscape:label="Floor">
    <g inkscape:groupmode="layer" inkscape:label="Levels">
      <g inkscape:groupmode="layer" inkscape:label="Level1">
        <g inkscape:groupmode="layer" inkscape:label="View">
          <path d="M 0,0 H 1050 V 720 H 0 V 0"/>
        </g>
        <g inkscape:groupmode="layer" inkscape:label="Rooms">
          <g inkscape:groupmode="layer" inkscape:label="Kitchen">
            <g inkscape:groupmode="layer" inkscape:label="View">
              <path d="M 100,100 H 400 V 300 H 100 V 100"/>
            </g>
            <g inkscape:groupmode="layer" inkscape:label="Devices">
              <g inkscape:groupmode="layer" inkscape:label="Lights">
                <g inkscape:groupmode="layer" inkscape:label="View">
                  <circle cx="250" cy="200" r="10"/>
                </g>
              </g>
            </g>
          </g>
          <g inkscape:groupmode="layer" inkscape:label="Bedroom1">
            <g inkscape:groupmode="layer" inkscape:label="View">
              <path d="M 500,100 H 800 V 400 H 500 V 100"/>
            </g>
            <g inkscape:groupmode="layer" inkscape:label="Devices">
              <g inkscape:groupmode="layer" inkscape:label="DoorWindow">
                <g inkscape:groupmode="layer" inkscape:label="View">
                  <circle cx="650" cy="100" r="10"/>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  </g>
</svg>`;

describe('parseFloorPlanSvg', () => {
    it('parses the floor outline bounding box', () => {
        const plan = parseFloorPlanSvg(SAMPLE_SVG);
        expect(plan.floorOutline.length).toBeGreaterThan(0);
        expect(plan.floorBox).toEqual({x: 0, y: 0, width: 1050, height: 720});
    });

    it('extracts each labeled room with its device markers', () => {
        const plan = parseFloorPlanSvg(SAMPLE_SVG);
        const names = plan.rooms.map((r) => r.name);
        expect(names).toEqual(['Kitchen', 'Bedroom1']);

        const kitchen = plan.rooms[0];
        expect(kitchen.outline.length).toBeGreaterThan(0);
        expect(kitchen.devices).toEqual([{type: 'Lights', x: 250, y: 200}]);

        const bedroom = plan.rooms[1];
        expect(bedroom.devices).toEqual([{type: 'DoorWindow', x: 650, y: 100}]);
    });

    it('falls back to viewBox when the Floor outline is missing', () => {
        const svg = `<svg ${NS_INK} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>`;
        const plan = parseFloorPlanSvg(svg);
        expect(plan.floorBox).toEqual({x: 0, y: 0, width: 800, height: 600});
        expect(plan.rooms).toEqual([]);
    });

    it('rejects non-SVG input', () => {
        expect(() => parseFloorPlanSvg('<html></html>')).toThrow(/Not an SVG/);
    });
});

describe('normalizeToFloor', () => {
    it('maps SVG-space points to 0..1 against the floor box', () => {
        const box = {x: 0, y: 0, width: 1000, height: 500};
        expect(normalizeToFloor({x: 250, y: 250}, box)).toEqual({
            x: 0.25,
            y: 0.5
        });
    });

    it('returns 0,0 when the floor box is degenerate', () => {
        expect(
            normalizeToFloor({x: 10, y: 10}, {x: 0, y: 0, width: 0, height: 0})
        ).toEqual({x: 0, y: 0});
    });
});

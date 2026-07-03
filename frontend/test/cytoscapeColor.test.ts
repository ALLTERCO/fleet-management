// Pin the only thing toCytoscapeColor is allowed to do: convert
// 8-digit `#RRGGBBAA` hex (which cytoscape's hex2tuple rejects) into
// the rgba() form cytoscape accepts, and pass every other valid color
// format through unchanged. The bug it guards: cytoscape's stylesheet
// silently drops invalid colors and logs `The style property
// border-color: #f9fafa12 is invalid`, leaving the graph unstyled.

import {describe, expect, it} from 'vitest';
import {toCytoscapeColor} from '@/helpers/cytoscapeColor';

describe('toCytoscapeColor', () => {
    it('passes 6-digit hex through unchanged', () => {
        expect(toCytoscapeColor('#334155')).toBe('#334155');
        expect(toCytoscapeColor('#abc123')).toBe('#abc123');
    });

    it('passes 3-digit hex through unchanged', () => {
        expect(toCytoscapeColor('#fff')).toBe('#fff');
    });

    it('passes named colors through unchanged', () => {
        expect(toCytoscapeColor('red')).toBe('red');
        expect(toCytoscapeColor('transparent')).toBe('transparent');
    });

    it('passes rgb() through unchanged', () => {
        expect(toCytoscapeColor('rgb(51, 65, 85)')).toBe('rgb(51, 65, 85)');
    });

    it('passes rgba() through unchanged', () => {
        expect(toCytoscapeColor('rgba(51, 65, 85, 0.5)')).toBe(
            'rgba(51, 65, 85, 0.5)'
        );
    });

    it('passes the empty string through unchanged', () => {
        // chartColors getters return '' in SSR contexts; cytoscape will
        // ignore it the same way — we don't need to invent a default here.
        expect(toCytoscapeColor('')).toBe('');
    });

    // The actual regression: cytoscape's hex2tuple rejected this exact
    // value at runtime on test3-fleet.shelly.cloud (border, line, and
    // target-arrow all driven by --chart-tooltip-border).
    it('converts the deployed-failure case #f9fafa12 to rgba', () => {
        expect(toCytoscapeColor('#f9fafa12')).toBe(
            'rgba(249, 250, 250, 0.071)'
        );
    });

    it('converts fully-opaque 8-digit hex (alpha = ff) to rgba 1.000', () => {
        expect(toCytoscapeColor('#334155ff')).toBe('rgba(51, 65, 85, 1.000)');
    });

    it('converts fully-transparent 8-digit hex (alpha = 00) to rgba 0.000', () => {
        expect(toCytoscapeColor('#33415500')).toBe('rgba(51, 65, 85, 0.000)');
    });

    it('handles uppercase 8-digit hex', () => {
        expect(toCytoscapeColor('#F9FAFA12')).toBe(
            'rgba(249, 250, 250, 0.071)'
        );
    });
});

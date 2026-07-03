// Cytoscape's parser only accepts 3/6-digit hex, named colors, and
// rgb()/rgba(). 8-digit `#RRGGBBAA` (from rgba() tokens) is dropped.

const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function toCytoscapeColor(color: string): string {
    const m = color.match(HEX8);
    if (!m) return color;
    const r = Number.parseInt(m[1], 16);
    const g = Number.parseInt(m[2], 16);
    const b = Number.parseInt(m[3], 16);
    const a = Number.parseInt(m[4], 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

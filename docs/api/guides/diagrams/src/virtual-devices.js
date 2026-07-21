// Editable source for ../virtual-devices.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/virtual-devices.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK, tint, BORDER} = k;

let g = k.svg({
    w: 960, h: 520,
    title: 'Virtual devices: one device built from parts of other real devices',
    desc: 'A virtual device is one device you build from parts of other real devices. It works like a normal device and keeps its own history. For example, a Fireplace can be made from three parts: on/off comes from a relay, temperature comes from a sensor, and power used comes from a meter. Each part points to one real component on a real device. If you swap a real device for a new one, the Fireplace stays the same and keeps its history.',
    heading: 'Virtual devices',
    sub: 'One device built from parts of other real devices. It works like a normal device.'
});

g += `<text x="40" y="96" font-size="12" font-weight="600" fill="${MUT}">Example: a Fireplace built from a relay, a sensor, and a meter. Each part points to one real component.</text>`;

// the virtual device: a Fireplace (left), centered header
g += `<rect x="60" y="132" width="320" height="336" rx="14" fill="${tint(ROLE.core, 93)}" stroke="${ROLE.core}" stroke-width="1.6"/>`;
g += k.tile(220, 176, 'box', ROLE.core, 18);
g += `<text x="220" y="210" text-anchor="middle" font-size="15" font-weight="700" fill="${INK}">Fireplace</text>`;
g += `<text x="220" y="229" text-anchor="middle" font-size="12" fill="${MUT}">a virtual device that keeps its history</text>`;

const parts = [['on / off', 284], ['temperature', 354], ['power used', 424]];
for (const [t, y] of parts) {
    g += `<rect x="86" y="${y - 24}" width="268" height="48" rx="9" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`;
    g += `<text x="220" y="${y + 5}" text-anchor="middle" font-size="14.5" font-weight="600" fill="${INK}">${t}</text>`;
}

// real sources (right), centered 3-line cards
function source(x, y, name, key, dev) {
    const cx = x + 115;
    let s = `<rect x="${x}" y="${y - 34}" width="230" height="68" rx="10" fill="${tint(ROLE.client, 92)}" stroke="${ROLE.client}" stroke-width="1.3"/>`;
    s += `<text x="${cx}" y="${y - 11}" text-anchor="middle" font-size="14" font-weight="700" fill="${INK}">${name}</text>`;
    s += `<text x="${cx}" y="${y + 8}" text-anchor="middle" font-size="12.5" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">${key}</text>`;
    s += `<text x="${cx}" y="${y + 26}" text-anchor="middle" font-size="11.5" fill="${MUT}">${dev}</text>`;
    return s;
}
g += source(650, 284, 'a relay', 'switch:0', 'device A');
g += source(650, 354, 'a sensor', 'temperature:0', 'device B');
g += source(650, 424, 'a meter', 'em:0', 'device C');

g += k.link([[380, 284], [650, 284]], {color: MUT});
g += k.link([[380, 354], [650, 354]], {color: MUT});
g += k.link([[380, 424], [650, 424]], {color: MUT});
g += k.pill('points to', 515, 354, {color: ROLE.core});

g += `<text x="480" y="504" text-anchor="middle" font-size="12.5" fill="${MUT}">Swap a real device for a new one and the Fireplace stays the same, and keeps its history.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'virtual-devices.svg'), g);
console.log('wrote ../virtual-devices.svg', Math.round(g.length / 1024) + 'KB');

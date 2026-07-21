// Editable source for ../organizations.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/organizations.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK, tint} = k;

let g = k.svg({
    w: 980, h: 610,
    title: 'Organizations and locations, with a real example',
    desc: 'Take a facilities company, Acme Facilities. It is the organization and owns everything. Location is the top-level place hierarchy: an AC unit lives at HQ, Block A, Floor 2, Room 204, which are 4 of the 14 location kinds from continent down to zone. On top of location, groups and tags give other ways to reach the same device. The AC unit is in the Meeting-room ACs group, so you can act on every AC together even though they are in different rooms. It is also tagged critical, which marks important devices wherever they are. Each is a different way to find and scope the same device.',
    heading: 'Organizations and locations',
    sub: 'Example: Acme Facilities and one AC unit. Location says where it is; groups and tags are other ways to reach it.'
});

g += k.chip(130, 96, 320, 96, {title: 'Organization', color: ROLE.identity, icon: 'building',
    body: ['Acme Facilities owns everything']});
g += k.link([[290, 192], [290, 236]], {color: MUT});

// Location: the top-level hierarchy (left)
g += `<rect x="60" y="236" width="460" height="330" rx="14" fill="${tint(ROLE.core, 93)}" stroke="${ROLE.core}" stroke-width="1.6"/>`;
g += k.tile(100, 281, 'mappin', ROLE.core, 18);
g += `<text x="138" y="278" font-size="15" font-weight="700" fill="${INK}">Location</text>`;
g += `<text x="138" y="298" font-size="12" fill="${MUT}">the top-level place hierarchy</text>`;

const tree = [['HQ', 100, 'site'], ['Block A', 130, 'building'], ['Floor 2', 160, 'floor'], ['Room 204', 190, 'room']];
let ty = 338;
for (const [name, x, kind] of tree) {
    g += `<text x="${x}" y="${ty}" font-size="13.5" font-family="ui-monospace,Menlo,monospace" fill="${INK}">${x > 100 ? '› ' : ''}${name}</text>`;
    g += `<text x="360" y="${ty}" font-size="11" fill="${MUT}">${kind}</text>`;
    ty += 26;
}
g += `<circle cx="228" cy="${ty - 4}" r="4" fill="${ROLE.delivery}"/>`;
g += `<text x="242" y="${ty}" font-size="13.5" font-weight="700" fill="${INK}">AC unit</text>`;
g += `<text x="360" y="${ty}" font-size="11" fill="${MUT}">the device</text>`;

g += `<text x="100" y="514" font-size="11.5" fill="${MUT}">14 kinds, from continent down to zone.</text>`;
g += `<text x="100" y="534" font-size="11.5" fill="${MUT}">Every device, entity, and group has one location.</text>`;

// Groups and Tags stacked together (other ways to reach the device)
g += k.chip(560, 236, 360, 150, {title: 'Groups', color: ROLE.warn, icon: 'grid',
    body: ['“Meeting-room ACs”', 'every AC, across rooms', 'act on them together']});
g += k.chip(560, 412, 360, 150, {title: 'Tags', color: ROLE.warn, icon: 'tag',
    body: ['“critical”', 'marks important devices', 'wherever they are']});
g += k.link([[520, 311], [560, 311]], {color: MUT});
g += k.link([[520, 487], [560, 487]], {color: MUT});
g += `<text x="540" y="300" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">also</text>`;

g += `<text x="490" y="596" text-anchor="middle" font-size="12.5" fill="${MUT}">The AC unit lives in Room 204, is in the Meeting-room ACs group, and is tagged critical: three ways to find and scope it.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'organizations.svg'), g);
console.log('wrote ../organizations.svg', Math.round(g.length / 1024) + 'KB');

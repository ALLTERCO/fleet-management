// Editable source for ../energy-model.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/energy-model.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 1480, h: 470,
    title: 'The energy model: from device meters to the meaning you set',
    desc: 'Fleet Manager auto-detects the facts and you add the meaning. A device is a physical Shelly. Its metering parts are the EM (three-phase), EM1 (single-phase), and PM1 components. Each gives measurement points, one reading on a channel like em:0.a_total_act_energy, carrying facts such as phase and electricalDomain. A logical meter is the meaning you give it: a physical meter sums its points, or a calculated meter is a formula over other meters, and it carries a role like grid, pv, or battery. A group or location says where it belongs. You read it all with Energy.Query, grouped by meter, role, kind, or utility.',
    heading: 'The energy model',
    sub: 'Auto-detected facts on the left become the meaning you set on the right.'
});

g += `<text x="425" y="96" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="0.05em" fill="${ROLE.core}">FACTS · AUTO-DETECTED</text>`;
g += `<text x="1120" y="96" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="0.05em" fill="${ROLE.identity}">MEANING · YOU SET</text>`;

g += k.chip(50, 150, 180, 148, {title: 'Device', color: ROLE.core, icon: 'cpu',
    body: ['a physical Shelly', 'model, app, profile']});
g += k.chip(270, 150, 220, 148, {title: 'Meter parts', color: ROLE.core, icon: 'gauge',
    body: ['EM · EM1 · PM1', 'the metering components']});
g += k.chip(530, 150, 270, 148, {title: 'Measurement point', color: ROLE.core, icon: 'activity',
    body: ['one reading on a channel', 'em:0.a_total_act_energy']});

g += k.plain([[830, 128], [830, 330]], {color: MUT, dash: true});

g += k.chip(870, 150, 320, 148, {title: 'Logical meter', color: ROLE.identity, icon: 'layers',
    body: ['physical: sums its points, or', 'calculated: a formula', 'role: grid, pv, battery']});
g += k.chip(1230, 150, 200, 148, {title: 'Group / location', color: ROLE.identity, icon: 'building',
    body: ['where it belongs', 'site, building, tenant']});

g += k.link([[230, 224], [270, 224]], {color: MUT});
g += k.link([[490, 224], [530, 224]], {color: MUT});
g += k.link([[800, 224], [870, 224]], {color: MUT});
g += k.link([[1190, 224], [1230, 224]], {color: MUT});

g += `<text x="740" y="424" text-anchor="middle" font-size="12.5" fill="${MUT}">electricalDomain (ac_mains, dc_pv, dc_battery) is physics, a fact. role (grid, pv, battery) is meaning, and you set it.</text>`;
g += `<text x="740" y="446" text-anchor="middle" font-size="12.5" fill="${MUT}">Read it with Energy.Query, grouped by meter, role, kind, or utility.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'energy-model.svg'), g);
console.log('wrote ../energy-model.svg', Math.round(g.length / 1024) + 'KB');

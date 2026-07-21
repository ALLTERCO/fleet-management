// Editable source for ../energy-storage.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/energy-storage.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 820, h: 600,
    title: 'Where energy data is kept: live in memory, a one-month raw window, and the durable 15-minute rollup',
    desc: 'Device readings arrive over NotifyStatus. The newest value stays live in memory with no database. Raw full-resolution stats are a hot window kept about one month, then dropped. The durable long-term store is the 15-minute rollup: it holds all history and billing, and the app and reports read it.',
    heading: 'Where energy data is kept',
    sub: 'Live in memory, a one-month raw window, and the 15-minute rollup as the durable long-term store.'
});

g += k.chip(60, 230, 250, 150, {title: 'Device readings', color: ROLE.core, icon: 'bolt',
    body: ['from NotifyStatus', 'raw device status']});

g += k.chip(400, 100, 360, 110, {title: 'Live status', color: ROLE.warn, icon: 'activity',
    body: ['the newest value · in memory, no DB']});
g += k.chip(400, 250, 360, 110, {title: 'Raw stats', color: ROLE.client, icon: 'database',
    body: ['full detail · ~1 month, then dropped']});
g += k.chip(400, 400, 360, 120, {title: '15-minute rollup', color: ROLE.core, icon: 'database',
    body: ['the durable long-term store', 'all history and billing']});
g += k.pill('main store', 690, 412, {color: ROLE.core});

g += k.plain([[310, 305], [360, 305]], {color: MUT});
g += k.plain([[360, 155], [360, 460]], {color: MUT});
g += k.link([[360, 155], [400, 155]], {color: MUT});
g += k.link([[360, 305], [400, 305]], {color: MUT});
g += k.link([[360, 460], [400, 460]], {color: MUT});

g += `<text x="410" y="570" text-anchor="middle" font-size="12.5" fill="${MUT}">The app and reports read the 15-minute rollup for all history and billing.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'energy-storage.svg'), g);
console.log('wrote ../energy-storage.svg', Math.round(g.length / 1024) + 'KB');

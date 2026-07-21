const fs = require('node:fs');

const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK} = k;

let g = k.svg({
    w: 1360, h: 700,
    title: 'The device model: the device says what it can do, and there are three ways to act on it',
    desc: 'The Shelly device says what it can do. Fleet Manager reads that and tidies it into a ready-to-use list. There are three ways to act on a device. The first is simple commands that work on any device, like on, off, open, and dim. The second is the device own commands, which give more control and reach settings. The third is a raw command for advanced cases. All three become one command to the device, which is checked and logged. A device is physical, bluetooth, or a virtual one.',
    heading: 'The device model',
    sub: 'The device says what it can do. Fleet Manager tidies it up. Then you act on it, three ways.'
});

// what the device is
g += k.chip(60, 110, 210, 124, {title: 'Device', color: ROLE.core, icon: 'cpu',
    body: ['one id: shellyID', 'nothing else to track']});
g += k.chip(430, 110, 230, 124, {title: 'Components', color: ROLE.core, icon: 'blocks',
    body: ['what the device can do', 'found automatically']});
g += k.chip(820, 110, 220, 124, {title: 'Entities', color: ROLE.core, icon: 'grid',
    body: ['the same list, tidied up', 'ready to use']});
g += k.link([[270, 172], [430, 172]], {color: MUT});
g += k.pill('reads the device', 350, 172, {color: MUT});
g += k.link([[660, 172], [820, 172]], {color: MUT});
g += k.pill('tidied up', 740, 172, {color: MUT});

// three ways to act, in plain words
g += `<text x="660" y="316" text-anchor="middle" font-size="14" font-weight="700" fill="${INK}">Three ways to act on a device</text>`;
g += `<text x="660" y="336" text-anchor="middle" font-size="12" fill="${MUT}">easy and works everywhere  ·  more control  ·  raw</text>`;
g += k.chip(60, 356, 360, 124, {title: 'Entity.InvokeAction', mono: true, color: ROLE.delivery, icon: 'bolt',
    body: ['simple commands for any device', 'on, off, open, dim']});
g += k.chip(500, 356, 340, 124, {title: '&lt;Component&gt;.Method', mono: true, color: ROLE.core, icon: 'code',
    body: ['the device’s own commands', 'more control, and settings']});
g += k.chip(920, 356, 340, 124, {title: 'Device.Call', mono: true, color: ROLE.client, icon: 'terminal',
    body: ['a raw command', 'only if you must']});

// all become one command
g += k.chip(480, 580, 400, 92, {title: 'One command to the device', color: ROLE.core, icon: 'shieldcheck',
    body: ['checked and logged']});
g += k.link([[240, 480], [240, 542], [590, 542], [590, 580]], {color: MUT});
g += k.link([[670, 480], [670, 580]], {color: MUT});
g += k.link([[1090, 480], [1090, 542], [770, 542], [770, 580]], {color: MUT});

g += `<text x="680" y="694" text-anchor="middle" font-size="12.5" fill="${MUT}">A device is physical, bluetooth, or a virtual one (extracted, composed, or connector).</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'device-model.svg'), g);
console.log('wrote ../device-model.svg', Math.round(g.length / 1024) + 'KB');

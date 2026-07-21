// Editable source for ../entities.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/entities.js
//
// Verified against entity.ts + EntityComponent.ts + SwitchComponent.ts: the six
// fields, the id format shellyID_channel:type, GetCapabilities = the type's
// declared actions kept only where the device advertises the method, InvokeAction
// re-checks the action and rejects EntityCapabilityUnknown, toggle maps to
// Switch.Toggle, and config goes to the component (Switch.SetConfig). The order
// (discover, then run) is the recommended flow; the hard rule is only that the
// action must be a valid capability.
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;
const lbl = (x, y, t, anc = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anc}" font-size="11.5" fill="${MUT}">${t}</text>`;

let g = k.svg({
    w: 1400, h: 340,
    title: 'Entities: the shape, then discover its actions, then run one',
    desc: 'An entity is Fleet Manager’s normalized view of one part of a device, with the fields id, name, type, source, online, and properties; the id looks like shellyID_channel:type. First call Entity.GetCapabilities to list the actions the entity supports, only the ones the device’s own methods allow, and Entity.GetActionSchema for one action’s params. Then call Entity.InvokeAction to run one of those actions, for example toggle, which the backend maps to the device RPC such as Switch.Toggle. The action you run must be one that GetCapabilities listed. Configuration is changed on the component itself, such as Switch.SetConfig.',
    heading: 'Anatomy of an entity',
    sub: 'One typed shape. Discover its actions with GetCapabilities, then run one.'
});

// a left-to-right sequence, roomy cards
g += k.chip(50, 100, 400, 170, {title: 'An entity', color: ROLE.core, icon: 'grid',
    body: [
        'id, name, type, source,',
        'online, and properties',
        'id like shellyplus…_0:out'
    ]});
g += k.chip(500, 100, 400, 170, {title: 'What can it do?', color: ROLE.delivery, icon: 'list',
    body: [
        'GetCapabilities lists its actions,',
        'only the ones the device allows.',
        'GetActionSchema gives the params.'
    ]});
g += k.chip(950, 100, 400, 170, {title: 'Run one', color: ROLE.core, icon: 'send',
    body: [
        'InvokeAction runs one action,',
        'for example { action: "toggle" },',
        'mapped to Switch.Toggle.'
    ]});

// arrows: strictly one after another
g += k.link([[450, 185], [500, 185]], {color: MUT});
g += k.link([[900, 185], [950, 185]], {color: MUT});
g += lbl(475, 175, 'then');
g += lbl(925, 175, 'then');

g += lbl(700, 314, 'The action you run must be one GetCapabilities listed. Change configuration on the component (Switch.SetConfig).');

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'entities.svg'), g);
console.log('wrote ../entities.svg', Math.round(g.length / 1024) + 'KB');

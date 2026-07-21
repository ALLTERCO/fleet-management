// Editable source for ../provisioning.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/provisioning.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 1120, h: 520,
    title: 'Provisioning: connect and enroll a device',
    desc: 'Provisioning points a Shelly device at Fleet Manager. You set the device outbound WebSocket config with WS.SetConfig so its server is wss://your-host/shelly, optionally carrying a token in the query string. The device then opens that WebSocket; Fleet Manager reads the device identity from the src field of its first status frame. If the device presents a known token it is recognized and routed to its organization, either accepted or placed in that organization waiting room. If it has no token it is an unknown device and waits in the waiting room for an operator to accept, or is refused if the waiting room is turned off. Once accepted it becomes a managed device.',
    heading: 'Provisioning: connect and enroll a device',
    sub: 'Point the device at Fleet Manager. With a known token it is recognized; without one it waits for an operator.'
});

// linear part: configure, then the device connects
g += k.chip(40, 178, 248, 152, {title: '1 · Configure the device', color: ROLE.core, icon: 'code',
    body: ['WS.SetConfig sets its server', 'wss://host/shelly', 'optionally a ?token']});
g += k.chip(320, 194, 210, 124, {title: '2 · The device connects', color: ROLE.core, icon: 'plug',
    body: ['it opens the WebSocket', 'its src field is its identity']});

// the branch: known token is recognized, no token waits in the room
g += k.chip(636, 92, 272, 152, {title: 'Known token', color: ROLE.core, icon: 'key',
    body: ['Fleet Manager recognizes it', 'routed to its organization', 'accepted, or its org’s room']});
g += k.chip(636, 300, 272, 168, {title: 'No token', color: ROLE.warn, icon: 'hourglass',
    body: ['an unknown device', 'waits in the waiting room', 'an operator accepts it', 'or refused if the room is off']});

// both paths converge on a managed device
g += k.chip(940, 196, 164, 124, {title: 'Managed device', color: ROLE.delivery, icon: 'circlecheck',
    body: ['now under', 'fleet management']});

// arrows, with the branch turn parked in the middle of the wide gap so the labels clear the boxes
g += k.link([[288, 255], [320, 255]], {color: MUT});
g += k.link([[530, 246], [584, 246], [584, 168], [636, 168]], {color: MUT});
g += k.link([[530, 266], [584, 266], [584, 384], [636, 384]], {color: ROLE.warn});
g += k.link([[908, 168], [924, 168], [924, 240], [940, 240]], {color: MUT});
g += k.link([[908, 384], [924, 384], [924, 276], [940, 276]], {color: MUT});
g += k.pill('has a token', 584, 206, {color: ROLE.core});
g += k.pill('no token', 584, 340, {color: ROLE.warn});

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'provisioning.svg'), g);
console.log('wrote ../provisioning.svg', Math.round(g.length / 1024) + 'KB');

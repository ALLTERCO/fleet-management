// Editable source for ../device-admission.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/device-admission.js
//
// Verified against admissionGate.ts + shellyIngressGate.ts: "the gate" is a
// slow-start rate limiter — over-cap connections have the socket closed and the
// device reconnects with backoff, they are NOT moved to the terminal DENIED
// record state. DENIED (control_access = 2) is reached by an operator reject or
// a bad/expired credential. That is why there is no "blocked at the gate -> Denied"
// edge; the footer states the throttle explicitly.
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK} = k;

let g = k.svg({
    w: 1140, h: 556,
    title: 'Device admission: how a device becomes accepted, waiting, or denied',
    desc: 'A device connects to /shelly. Fleet Manager checks how it is secured and decides. A device with a known token or certificate that matches its own id is accepted straight away and can be controlled. A new or enrolling device goes to the waiting room, where it is read-only until an operator accepts it. A device with a bad or expired credential, or the wrong id, is denied and its socket is closed. From the waiting room an operator accepts the device, which allows control, or rejects it, which denies it. On reconnect a trusted device skips the wait and a denied device stays denied. Too many connections at once are throttled at the gate, not denied. The three record states are PENDING, ALLOWED, and DENIED.',
    heading: 'Device admission: the waiting room',
    sub: 'A new device is read-only until an operator accepts it. Only then is it written to the database.'
});

g += `<circle cx="32" cy="277" r="6" fill="${INK}"/>`;

// states, each with a filled gradient icon tile
g += k.chip(56, 214, 210, 126, {title: 'Device connects', color: ROLE.client, icon: 'plug',
    body: ['it opens a socket', 'at /shelly']});
g += k.chip(430, 214, 230, 126, {title: 'Waiting room', color: ROLE.warn, icon: 'clock',
    body: ['PENDING', 'read-only, no control']});
g += k.chip(840, 66, 250, 126, {title: 'Accepted', color: ROLE.delivery, icon: 'check',
    body: ['ALLOWED', 'can be controlled']});
g += k.chip(840, 382, 250, 126, {title: 'Denied', color: ROLE.danger, icon: 'shield',
    body: ['DENIED', 'connection closed']});

// transitions
g += k.link([[44, 277], [56, 277]], {color: MUT});
g += k.link([[161, 214], [161, 129], [840, 129]], {color: MUT});
g += k.link([[266, 277], [430, 277]], {color: MUT});
g += k.link([[161, 340], [161, 445], [840, 445]], {color: MUT});
g += k.link([[545, 214], [545, 165], [840, 165]], {color: ROLE.delivery});
g += k.link([[545, 340], [545, 409], [840, 409]], {color: ROLE.danger});

// transition labels
g += `<text x="500" y="119" text-anchor="middle" font-size="12" fill="${MUT}">a known token or cert for this device</text>`;
g += k.pill('new or enrolling', 348, 277, {color: MUT});
g += `<text x="500" y="435" text-anchor="middle" font-size="12" fill="${MUT}">a bad or expired credential, or the wrong id</text>`;
g += `<text x="700" y="155" text-anchor="middle" font-size="12" font-weight="600" fill="${ROLE.delivery}">operator accepts</text>`;
g += `<text x="700" y="399" text-anchor="middle" font-size="12" font-weight="600" fill="${ROLE.danger}">operator rejects</text>`;

// footer facts
g += `<text x="440" y="530" text-anchor="middle" font-size="12.5" fill="${MUT}">On reconnect a trusted device skips the wait; a denied device stays denied.</text>`;
g += `<text x="440" y="548" text-anchor="middle" font-size="12.5" fill="${MUT}">Too many connections at once are throttled at the gate, not denied.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'device-admission.svg'), g);
console.log('wrote ../device-admission.svg', Math.round(g.length / 1024) + 'KB');

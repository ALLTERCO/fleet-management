// Editable source for ../alerts.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/alerts.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK} = k;

let g = k.svg({
    w: 1480, h: 760,
    title: 'The life of an alert: pending, firing, acknowledged, cleared, resolved',
    desc: 'When a rule fires it opens one alert per target. The alert waits in pending until the problem lasts long enough, then it is firing (active). Ack and Unack move it between firing and acknowledged; it is still firing either way. For latched alarms the condition clearing moves it to cleared (cleared_unack or cleared_ack), where it stays visible until an operator resolves it by hand. Most alerts resolve on their own the moment the condition clears. In-between states, recovering, no data, and evaluation error, cover a settling reading, a quiet sensor, or a rule that cannot be checked; they can go back to firing or resolve. Silence mutes notifications without changing the state.',
    heading: 'The life of an alert',
    sub: 'One alert per rule and target. It moves through these states (the code value is shown under each).'
});

g += `<circle cx="48" cy="288" r="6" fill="${INK}"/>`;

// firing row
g += k.chip(80, 230, 190, 116, {title: 'Pending', color: ROLE.client, icon: 'hourglass', body: ['pending']});
g += k.chip(400, 230, 190, 116, {title: 'Firing', color: ROLE.danger, icon: 'bell', body: ['active']});
g += k.chip(700, 230, 225, 116, {title: 'Acknowledged', color: ROLE.warn, icon: 'bell', body: ['acknowledged']});
// cleared row
g += k.chip(400, 490, 190, 116, {title: 'Cleared', color: ROLE.core, icon: 'belloff', body: ['cleared_unack']});
g += k.chip(700, 490, 225, 116, {title: 'Cleared, acked', color: ROLE.delivery, icon: 'belloff', body: ['cleared_ack']});
// resolved
g += k.chip(1240, 340, 200, 130, {title: 'Resolved', color: ROLE.data, icon: 'circlecheck', body: ['resolved']});

// in-between states, spelled out in plain words
g += k.group(80, 476, 300, 150, 'IN-BETWEEN STATES');
g += `<text x="230" y="524" text-anchor="middle" font-size="11.5" fill="${MUT}">recovering: a reading settling</text>`;
g += `<text x="230" y="548" text-anchor="middle" font-size="11.5" fill="${MUT}">no_data: the sensor is quiet</text>`;
g += `<text x="230" y="572" text-anchor="middle" font-size="11.5" fill="${MUT}">evaluation_error: rule can’t run</text>`;

// transitions
g += k.link([[56, 288], [80, 288]], {color: MUT});
g += k.link([[270, 288], [400, 288]], {color: MUT});
g += k.pill('it fires', 335, 288, {color: MUT});

g += k.link([[590, 274], [700, 274]], {color: MUT});
g += `<text x="645" y="264" text-anchor="middle" font-size="11.5" fill="${MUT}">Ack</text>`;
g += k.link([[700, 302], [590, 302]], {color: MUT});
g += `<text x="645" y="318" text-anchor="middle" font-size="11.5" fill="${MUT}">Unack</text>`;

g += k.link([[495, 346], [495, 490]], {color: MUT});
g += k.pill('clears · latched', 495, 418, {color: MUT});
g += k.link([[812, 346], [812, 490]], {color: MUT});
g += k.pill('clears · latched', 812, 418, {color: MUT});

g += k.link([[590, 532], [700, 532]], {color: MUT});
g += `<text x="645" y="522" text-anchor="middle" font-size="11.5" fill="${MUT}">Ack</text>`;
g += k.link([[700, 560], [590, 560]], {color: MUT});
g += `<text x="645" y="576" text-anchor="middle" font-size="11.5" fill="${MUT}">Unack</text>`;

// auto-resolve from the firing row
g += k.link([[540, 230], [540, 190], [1200, 190], [1200, 375], [1240, 375]], {color: MUT, dash: true});
g += `<text x="870" y="182" text-anchor="middle" font-size="12" fill="${MUT}">condition clears (most alerts resolve on their own)</text>`;
g += k.link([[925, 274], [1120, 274], [1120, 405], [1240, 405]], {color: MUT, dash: true});
// manual resolve from cleared, acked
g += k.link([[925, 548], [1160, 548], [1160, 435], [1240, 435]], {color: MUT});
g += k.pill('resolved by hand', 1042, 548, {color: MUT});

// in-between <-> firing
g += k.link([[230, 476], [230, 435], [420, 435], [420, 346]], {color: MUT, both: true});
g += k.pill('settling ⇌ fires', 325, 435, {color: MUT});

g += `<text x="740" y="690" text-anchor="middle" font-size="12.5" fill="${MUT}">Ack and Unack keep it firing, just seen. Cleared is only for latched alarms (smoke, flood); other alerts go straight to resolved.</text>`;
g += `<text x="740" y="710" text-anchor="middle" font-size="12.5" fill="${MUT}">Silence mutes the notifications without changing the state. A re-fire within the dedupe window reuses the same alert.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'alerts.svg'), g);
console.log('wrote ../alerts.svg', Math.round(g.length / 1024) + 'KB');

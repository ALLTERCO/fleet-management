// Editable source for ../transport-sequence.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/transport-sequence.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK} = k;

let g = k.svg({
    w: 980, h: 592,
    title: 'Transport: one WebSocket over time',
    desc: 'A single WebSocket carries everything. The client sends a call with an id (for example id 7, Switch.Set); Fleet Manager replies with a result that carries the same id 7, so the client can match it. Fleet Manager also pushes a NotifyStatus event on its own, with no id, because nothing asked for it. When the client sends a bad call (id 8), Fleet Manager replies with an error that carries id 8 and an error code.',
    heading: 'Transport: one socket over time',
    sub: 'One WebSocket carries calls, id-matched replies, pushed events, and errors.'
});

g += k.lane(210, 196, 548);
g += k.lane(770, 196, 548);
g += k.actor(210, 120, 'code', ROLE.client, 'Client');
g += k.actor(770, 120, 'activity', ROLE.core, 'Fleet Manager');
g += `<text x="210" y="182" text-anchor="middle" font-size="10.5" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">"my-client"</text>`;
g += `<text x="770" y="182" text-anchor="middle" font-size="10.5" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">"FLEET_MANAGER"</text>`;

g += k.msg(238, 742, 236, {num: 1, label: 'call · id 7 · Switch.Set', color: ROLE.core});
g += k.msg(742, 238, 298, {num: 2, label: 'result · id 7', color: ROLE.delivery});
g += k.msg(742, 238, 380, {num: 3, label: 'NotifyStatus · pushed', color: ROLE.data});
g += k.msg(238, 742, 452, {num: 4, label: 'call · id 8', color: ROLE.core});
g += k.msg(742, 238, 514, {num: 5, label: 'error · id 8 · code', color: ROLE.warn});

g += `<text x="490" y="273" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">same id → the client matches the reply</text>`;
g += `<text x="490" y="357" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">no id → the server pushed it, unprompted</text>`;
g += `<text x="490" y="491" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">same id → the error is for that call</text>`;

const mono = `font-family="ui-monospace,Menlo,monospace" font-weight="700" fill="${INK}"`;
g += `<text x="490" y="574" text-anchor="middle" font-size="12" fill="${MUT}">a frame's <tspan ${mono}>src</tspan> and <tspan ${mono}>dst</tspan> are these two names; the arrow points from <tspan ${mono}>src</tspan> to <tspan ${mono}>dst</tspan></text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'transport-sequence.svg'), g);
console.log('wrote ../transport-sequence.svg', Math.round(g.length / 1024) + 'KB');

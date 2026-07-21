// Editable source for ../frame-anatomy.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/frame-anatomy.js
//
// Every field here was verified live against a running instance (:7011) by
// capturing the four frame types over a real WebSocket, not read from the
// builders: request, success reply, and error reply all carry jsonrpc 2.0;
// only the server push omits it and instead carries a streamId. The push dst
// is the literal FM_CLIENT marker, not the caller's own client id.
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK, tint} = k;
const MONO = 'ui-monospace,Menlo,monospace';

let g = k.svg({
    w: 1240, h: 860,
    title: 'Anatomy of a frame: request, success reply, error reply, and server push',
    desc: 'One connection carries four kinds of message, and the id tells a reply apart from a push. A request has an id you choose, a src naming your client, a dst of FLEET_MANAGER or a device id, a method, and params. A success reply comes back with the same id and the answer in result. An error reply comes back with the same id but an error object with a code and message instead of result. All three carry jsonrpc 2.0. A server push has no id and no jsonrpc: the server sends it on its own with method NotifyStatus, a dst of FM_CLIENT, and a streamId you can save to catch up later.',
    heading: 'Anatomy of a frame',
    sub: 'One connection carries four kinds of message. The id tells a reply apart from a push.'
});

function card(y, color, title, dir, badge, json, note) {
    let s = `<rect x="60" y="${y}" width="1120" height="150" rx="12" fill="#FBFCFE" stroke="#E4EBF3" stroke-width="1"/>`;
    s += `<rect x="60" y="${y}" width="6" height="150" rx="3" fill="${color}"/>`;
    s += `<circle cx="98" cy="${y + 42}" r="7" fill="${color}"/>`;
    s += `<text x="118" y="${y + 47}"><tspan font-size="16" font-weight="700" fill="${INK}">${title}</tspan><tspan font-size="13.5" fill="${MUT}">   ·   ${dir}</tspan></text>`;
    const bw = badge.length * 7 + 24;
    s += `<rect x="${1156 - bw}" y="${y + 22}" width="${bw}" height="26" rx="13" fill="${tint(color, 86)}"/>`;
    s += `<text x="${1156 - bw / 2}" y="${y + 39}" text-anchor="middle" font-size="12" font-weight="700" fill="${color}">${badge}</text>`;
    s += `<text x="118" y="${y + 92}" font-size="14" font-family="${MONO}" fill="${INK}">${json}</text>`;
    s += `<text x="118" y="${y + 122}" font-size="12.5" fill="${MUT}">${note}</text>`;
    return s;
}
const hi = (c, t) => `<tspan font-weight="700" fill="${c}">${t}</tspan>`;
const m = (t) => `<tspan font-family="${MONO}">${t}</tspan>`;

g += card(130, ROLE.core, 'Request', 'you → Fleet Manager', 'request',
    `{ "jsonrpc": "2.0", ${hi(ROLE.core, '"id": 1')}, "src": "my-client", ${hi(ROLE.core, '"dst": "FLEET_MANAGER"')}, "method": "device.List", "params": {} }`,
    `You choose the ${m('id')} and ${m('src')}. Send ${m('dst')} as FLEET_MANAGER, or a device id to reach that device.`);

g += card(310, ROLE.delivery, 'Success reply', 'Fleet Manager → you', 'reply · id-matched',
    `{ "jsonrpc": "2.0", ${hi(ROLE.delivery, '"id": 1')}, "src": "FLEET_MANAGER", "dst": "my-client", ${hi(ROLE.delivery, '"result"')}: { … } }`,
    `The ${m('id')} matches your request, so this is its reply. The answer is in ${m('result')}.`);

g += card(490, ROLE.danger, 'Error reply', 'Fleet Manager → you', 'reply · id-matched',
    `{ "jsonrpc": "2.0", ${hi(ROLE.danger, '"id": 1')}, "src": "FLEET_MANAGER", "dst": "my-client", ${hi(ROLE.danger, '"error"')}: { "code": -32601, "message": "…" } }`,
    `Same ${m('id')}, but you get ${m('error')} instead of ${m('result')}: here ${m('code')} -32601, ${m('message')} "Method not found".`);

g += card(670, ROLE.identity, 'Server push', 'Fleet Manager → you', 'push · no id',
    `{ "src": "FLEET_MANAGER", "dst": "FM_CLIENT", ${hi(ROLE.identity, '"method": "NotifyStatus"')}, "params": { "ts": …, … }, ${hi(ROLE.identity, '"streamId"')}: "1783…-0" }`,
    `No ${m('id')} and no ${m('jsonrpc')}: the server sends this on its own, any time. ${m('dst')} is FM_CLIENT, not your id. Save the last ${m('streamId')} to catch up.`);

g += `<text x="620" y="846" text-anchor="middle" font-size="12.5" fill="${MUT}">Every request and reply carries "jsonrpc": "2.0". Only the server push leaves it out.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'frame-anatomy.svg'), g);
console.log('wrote ../frame-anatomy.svg', Math.round(g.length / 1024) + 'KB');

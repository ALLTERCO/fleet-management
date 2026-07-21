// Editable source for ../connection.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/connection.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 1120, h: 680,
    title: 'Ways in: how each caller connects to Fleet Manager',
    desc: 'Four callers reach Fleet Manager, each with its own token and its own way of sending it. A browser signs in with OIDC and passes its access token as the WebSocket subprotocol on the client socket at wss://host/, a two-way channel that stays open for live events and RPC calls. A mobile app (the Shelly Fleet Assistant) holds a scoped token (a PAT) and sends it as an Authorization Bearer header on that same wss://host/ socket. A server or script uses a PAT as a Bearer header, usually on the HTTP fallback POST /rpc for single calls without events, though it can also use wss://host/ for live events. A Shelly device puts an enrollment token in the query string, or nothing, and connects to wss://host/shelly, an open socket where an unknown device waits in the waiting room until it is accepted. All tokens are verified against Zitadel.',
    heading: 'Ways in',
    sub: 'Four callers, three endpoints, and how each one proves who it is.'
});

// column captions
g += `<text x="135" y="112" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="0.06em" fill="${MUT}">WHO · WHAT TOKEN</text>`;
g += `<text x="360" y="112" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="0.06em" fill="${MUT}">HOW IT'S SENT</text>`;
g += `<text x="822" y="112" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="0.06em" fill="${MUT}">WHERE IT LANDS · WHAT YOU GET</text>`;

// Fleet Manager boundary, top edge lines up with the Browser icon (y=165)
g += k.group(540, 165, 555, 512, 'FLEET MANAGER', {strong: true});
g += k.chip(580, 210, 475, 100, {title: 'wss://host/', mono: true, align: 'start', color: ROLE.core,
    body: ['Client WebSocket · two-way, stays open', 'live events and RPC calls', 'Browser: OIDC · app: PAT']});
g += k.chip(580, 410, 475, 92, {title: 'POST /rpc', mono: true, align: 'start', color: ROLE.core,
    body: ['HTTP fallback', 'single calls, no events']});
g += k.chip(580, 540, 475, 92, {title: 'wss://host/shelly', mono: true, align: 'start', color: ROLE.warn,
    body: ['Device ingress · open by design', 'unknown device → waiting room']});

// note bridging the gap
g += `<text x="817" y="360" text-anchor="middle" font-size="12" font-style="italic" fill="${MUT}">a server can also use wss://host/ above for live events</text>`;

// caller → endpoint (Browser + Mobile angle symmetrically into the live socket)
g += k.link([[170, 195], [512, 195], [512, 245], [578, 245]], {color: ROLE.core});
g += k.link([[170, 325], [512, 325], [512, 275], [578, 275]], {color: ROLE.core});
g += k.link([[170, 456], [578, 456]], {color: ROLE.core});
g += k.link([[170, 586], [578, 586]], {color: ROLE.warn});
g += k.pill('as subprotocol', 355, 195, {color: ROLE.core});
g += k.pill('as Bearer header', 355, 325, {color: ROLE.core});
g += k.pill('as Bearer header', 355, 456, {color: ROLE.core});
g += k.pill('?token=  or  none', 355, 586, {color: ROLE.warn});

// callers
g += k.node(135, 195, 'monitor', ROLE.client, 'Browser', 'OIDC access token');
g += k.node(135, 325, 'phone', ROLE.client, 'Mobile app', 'scoped token (PAT)');
g += k.node(135, 456, 'server', ROLE.client, 'Server / script', 'scoped token (PAT)');
g += k.node(135, 586, 'cpu', ROLE.warn, 'Shelly device', 'enrollment token');

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'connection.svg'), g);
console.log('wrote ../connection.svg', Math.round(g.length / 1024) + 'KB');

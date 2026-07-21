// Editable source for ../fm-internals.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/fm-internals.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;
const core = ROLE.core, indigo = ROLE.data;

let g = k.svg({
    w: 1120, h: 730,
    title: 'Inside Fleet Manager: transport, dispatch, domain, and platform',
    desc: 'A call enters through the transport layer (the WebSocket controller or the HTTP /rpc endpoint), is dispatched by the Commander which routes the RPC and audits it, then runs in a domain module: devices and entities, the waiting room, the alert engine, or energy. Each of those modules checks its own per-method permission against the authz resolver during dispatch. Modules lean on platform services: the event distributor for session streams and replay, the delivery outbox for notification channels and retries, and the authz resolver for personas and assignments. State is persisted in TimescaleDB and streamed and cached via Redis.',
    heading: 'Inside Fleet Manager',
    sub: 'One call’s path: transport → dispatch → domain module → platform service.'
});

const lane = (t, y) => `<text x="1085" y="${y}" text-anchor="end" font-size="11" font-weight="600" letter-spacing="0.08em" fill="${MUT}">${t}</text>`;
g += lane('TRANSPORT', 134) + lane('DISPATCH', 282) + lane('DOMAIN', 446) + lane('PLATFORM', 610);

// TRANSPORT
g += k.chip(250, 92, 232, 98, {title: 'WebSocket controller', color: core, icon: 'activity'});
g += k.chip(512, 92, 232, 98, {title: 'HTTP · /rpc', mono: true, color: core, icon: 'globe'});
// DISPATCH
g += k.chip(340, 232, 322, 112, {title: 'Commander', color: core, icon: 'route', body: ['routes RPC · audits']});
// DOMAIN
g += k.chip(40, 396, 214, 112, {title: 'Devices &amp; entities', color: core, icon: 'grid', body: ['components · composer']});
g += k.chip(268, 396, 214, 112, {title: 'Waiting room', color: core, icon: 'hourglass', body: ['device ingress']});
g += k.chip(496, 396, 214, 112, {title: 'Alert engine', color: core, icon: 'siren', body: ['evaluators · sweep']});
g += k.chip(724, 396, 214, 112, {title: 'Energy', color: core, icon: 'bolt', body: ['meters · rollups']});
// PLATFORM
g += k.chip(96, 560, 250, 112, {title: 'Event distributor', color: indigo, icon: 'radio', body: ['session streams · replay']});
g += k.chip(376, 560, 250, 112, {title: 'Delivery outbox', color: indigo, icon: 'send', body: ['channels · retries']});
g += k.chip(656, 560, 250, 112, {title: 'Authz resolver', color: indigo, icon: 'shieldcheck', body: ['personas · assignments']});

// transport -> dispatch
g += k.link([[366, 190], [366, 232]], {color: MUT});
g += k.link([[628, 190], [628, 232]], {color: MUT});
// dispatch -> domain (fan out through a shared bus)
[147, 375, 603, 831].forEach((x) => {
    g += k.link([[501, 344], [501, 372], [x, 372], [x, 396]], {color: MUT});
});
// domain -> platform
g += k.link([[147, 508], [147, 534], [221, 534], [221, 560]], {color: MUT});
g += k.link([[603, 508], [603, 534], [501, 534], [501, 560]], {color: MUT});
// domain modules -> authz resolver: the permission check is per-method, inside
// each component, not in the Commander, so the arrow leaves the domain layer
g += k.link([[938, 452], [982, 452], [982, 616], [906, 616]], {color: indigo, dash: true});
g += k.pill('permission', 982, 505, {color: indigo});

g += `<text x="501" y="700" text-anchor="middle" font-size="12" fill="${MUT}">Each domain module checks its own per-method permission against the authz resolver.</text>`;
g += `<text x="501" y="720" text-anchor="middle" font-size="12" fill="${MUT}">Persisted in TimescaleDB · streamed and cached via Redis.</text>`;
g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'fm-internals.svg'), g);
console.log('wrote ../fm-internals.svg', Math.round(g.length / 1024) + 'KB');

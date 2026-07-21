// Editable source for ../api-client.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/api-client.js
//
// This diagram owns the DISCOVER stage of building a client. Authentication is
// owned by the "Ways in" diagram (connection.svg) and the call/frame mechanics
// by transport-sequence.svg + frame-anatomy.svg, so this one does not repeat
// tokens or WebSocket-vs-HTTP: it hands off to those guides instead.
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 1120, h: 452,
    title: 'Discover the API: browse it, download it, or introspect it at runtime',
    desc: 'A client is any program that talks to Fleet Manager, and it needs no SDK because the API describes itself three ways. Browse it: the docs page at /api/docs lists every method with its inputs, outputs, and the permission it needs. Download it: the same list is an OpenAPI 3.1 file at /api/docs/openapi.json, with the servers field set to that host, for codegen and tooling. Introspect it: every namespace answers a Describe call that returns its method, parameter, and response schemas plus permissions, so a client can validate against the live contract. Once you know the method you want, get a token (see Authentication) and open a connection to call it (see Transport and framing).',
    heading: 'Discover the API',
    sub: 'A client needs no SDK: the API describes itself three ways. Then you authenticate and call.'
});

// three ways the API describes itself
g += k.chip(40, 120, 336, 182, {title: 'Browse it', color: ROLE.core, icon: 'windw',
    body: ['/api/docs', 'every method with its', 'inputs, outputs, and the', 'permission it needs']});
g += k.chip(392, 120, 336, 182, {title: 'Download it', color: ROLE.core, icon: 'code',
    body: ['/api/docs/openapi.json', 'OpenAPI 3.1, servers set', 'to this host, for codegen', 'and other tooling']});
g += k.chip(744, 120, 336, 182, {title: 'Introspect it', color: ROLE.core, icon: 'terminal',
    body: ['Describe, per namespace', 'returns schemas and the', 'permissions, so you check', 'against the live contract']});

// handoff: this diagram stops here; the next stages live in other guides
g += `<text x="560" y="356" text-anchor="middle" font-size="13" fill="${MUT}">Once you know the method you want:</text>`;
g += k.pill('get a token', 442, 392, {color: ROLE.core});
g += k.link([[506, 392], [614, 392]], {color: MUT});
g += k.pill('connect and call', 690, 392, {color: ROLE.core});
g += `<text x="560" y="426" text-anchor="middle" font-size="11.5" fill="${MUT}">get a token: see Authentication · connect and call: see Transport and framing</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'api-client.svg'), g);
console.log('wrote ../api-client.svg', Math.round(g.length / 1024) + 'KB');

// Editable source for ../events.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/events.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT, INK} = k;

let g = k.svg({
    w: 980, h: 668,
    title: 'Events: subscribe, receive, and replay after a reconnect',
    desc: 'Events are opt-in over the WebSocket. The client calls system.Subscribe with the event names it wants; Fleet Manager replies with listener ids and a connectionId. Events then push as they happen, each carrying a streamId, the client keeps the last one it handled. When the connection drops, the client reconnects, signs in, and subscribes again, this time sending the connectionId and its last lastSeenStreamId. Fleet Manager replays the events that were missed, or tells the client to refetch with resyncRequired.',
    heading: 'Events: subscribe, receive, replay',
    sub: 'Subscribe once; the server pushes updates; after a reconnect it replays what you missed.'
});

g += k.lane(210, 196, 618);
g += k.lane(770, 196, 618);
g += k.actor(210, 120, 'monitor', ROLE.client, 'Client');
g += k.actor(770, 120, 'activity', ROLE.core, 'Fleet Manager');
g += `<text x="210" y="182" text-anchor="middle" font-size="10.5" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">"my-client"</text>`;
g += `<text x="770" y="182" text-anchor="middle" font-size="10.5" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">"FLEET_MANAGER"</text>`;

g += k.msg(238, 742, 235, {num: 1, label: 'system.Subscribe · events', color: ROLE.core});
g += k.msg(742, 238, 292, {num: 2, label: 'ids + connectionId', color: ROLE.delivery});
g += k.msg(742, 238, 365, {num: 3, label: 'event push · streamId', color: ROLE.data});
g += `<text x="490" y="342" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">keep the last streamId you handled</text>`;

g += k.plain([[180, 430], [800, 430]], {color: ROLE.warn, dash: true});
g += k.pill('4 · connection drops → reconnect + sign in', 490, 430, {color: ROLE.warn});

g += k.msg(238, 742, 510, {num: 5, label: 'system.Subscribe · connectionId + lastSeenStreamId', color: ROLE.core});
g += k.msg(742, 238, 575, {num: 6, label: 'replay the missed events', color: ROLE.delivery});
g += `<text x="490" y="600" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUT}">or resyncRequired → refetch the current state</text>`;

const mono = `font-family="ui-monospace,Menlo,monospace" font-weight="700" fill="${INK}"`;
g += `<text x="490" y="648" text-anchor="middle" font-size="12" fill="${MUT}">a frame's <tspan ${mono}>src</tspan> and <tspan ${mono}>dst</tspan> are these two names; the arrow points from <tspan ${mono}>src</tspan> to <tspan ${mono}>dst</tspan></text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'events.svg'), g);
console.log('wrote ../events.svg', Math.round(g.length / 1024) + 'KB');

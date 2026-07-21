// Editable source for ../webhooks.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/webhooks.js
//
// Verified against webhook.ts + channel.ts + delivery/adapters/webhookSigning.ts:
// device webhooks are firmware-fired and managed through the relayed webhook
// namespace (20/device, 10 for battery, device-enforced); alert-delivery
// webhooks use channel providers generic_webhook / webhook_signed, and the signed
// header is fm-signature: t=<unix>,v1=HMAC-SHA256(secret,"<t>.<body>"), rejected
// past DEFAULT_MAX_AGE_SEC = 300 (5 min), compared in constant time.
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;
const lbl = (x, y, t, anc = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anc}" font-size="11.5" fill="${MUT}">${t}</text>`;

let g = k.svg({
    w: 1180, h: 500,
    title: 'Webhooks: device-fired webhooks versus Fleet-Manager-sent alert-delivery webhooks',
    desc: 'Two different things share the name webhook. Device webhooks are fired by the Shelly device: on a device event the firmware POSTs to your URL. You manage them fleet-wide through the relayed webhook namespace (webhook.Create with shellyID, event, and urls), but the event names and templating belong to the firmware and about 20 hooks fit per device. Alert-delivery webhooks are sent by Fleet Manager: when an alert fires it is delivered through a channel you register with channel.Create, using provider generic_webhook for a plain JSON POST or webhook_signed for an HMAC-signed POST. The signed variant adds an fm-signature header t and v1 where v1 is HMAC-SHA256 of the secret over t dot body; verify it in constant time and reject if t is older than about five minutes.',
    heading: 'Webhooks',
    sub: 'Two different things share the name. One fires from the device; one is sent by Fleet Manager.'
});

// divider
g += `<line x1="590" y1="112" x2="590" y2="446" stroke="#D3DDEA" stroke-width="1.25" stroke-dasharray="5 4"/>`;

// LEFT: device-fired
g += k.group(40, 96, 512, 350, 'FIRED BY THE DEVICE');
g += k.node(150, 210, 'cpu', ROLE.client, 'Shelly device', 'firmware');
g += k.node(430, 210, 'globe', ROLE.delivery, 'Your endpoint', 'your URL');
g += k.link([[188, 210], [392, 210]], {color: MUT});
g += lbl(290, 196, 'device event → POST');
g += lbl(296, 330, 'Manage fleet-wide with webhook.Create');
g += lbl(296, 350, '{ shellyID, event, urls[] }, relayed to the device.');
g += lbl(296, 370, 'Event names and templating are the firmware’s.');
g += lbl(296, 388, 'About 20 hooks per device (10 if battery).');

// RIGHT: FM-sent
g += k.group(628, 96, 512, 350, 'SENT BY FLEET MANAGER');
g += k.node(720, 210, 'siren', ROLE.warn, 'Alert fires', 'a rule matched');
g += k.node(900, 210, 'send', ROLE.core, 'Channel', 'webhook / signed');
g += k.node(1070, 210, 'globe', ROLE.delivery, 'Your endpoint', 'your URL');
g += k.link([[758, 210], [864, 210]], {color: MUT});
g += k.link([[936, 210], [1034, 210]], {color: MUT});
g += lbl(985, 196, 'HTTP POST');
g += lbl(884, 330, 'Register with channel.Create');
g += lbl(884, 350, '(generic_webhook or webhook_signed).');
g += lbl(884, 370, 'Signed adds fm-signature: t,v1 = HMAC-SHA256(secret,"t.body")');
g += lbl(884, 388, 'verify in constant time, reject if t older than ~5 min.');

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'webhooks.svg'), g);
console.log('wrote ../webhooks.svg', Math.round(g.length / 1024) + 'KB');

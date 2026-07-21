// Editable source for ../system-architecture.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/system-architecture.js
//
// The deployment view: what runs where, on which port, over which protocol.
// Ports sit on the listening service; the wire carries the protocol. Wall
// Displays use plain ws:// on /shelly (their firmware pins the Allterco CA and
// rejects Let's Encrypt), verified against the public Traefik routes.
//
// Glyphs are inlined here on purpose: this diagram predates the shared kit's
// glyph refresh and was approved with these exact shapes, so it keeps its own
// copy rather than drift when kit.js changes.
const fs = require('node:fs');
const path = require('node:path');

const G = {
    monitor: "<rect x=\"2\" y=\"3\" width=\"20\" height=\"14\" rx=\"1.6\"/><path d=\"M8 21h8M12 17v4\"/>",
    phone: "<rect x=\"6\" y=\"2\" width=\"12\" height=\"20\" rx=\"2.2\"/><path d=\"M10 18.5h4\"/>",
    cpu: "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"1.6\"/><rect x=\"9\" y=\"9\" width=\"6\" height=\"6\" rx=\"1\"/><path d=\"M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3\"/>",
    wall: "<rect x=\"2\" y=\"3\" width=\"20\" height=\"16\" rx=\"1.8\"/><path d=\"M6 22h12\"/><circle cx=\"12\" cy=\"11\" r=\"2.4\"/>",
    shield: "<path d=\"M12 2l8 3.5v5.5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V5.5z\"/>",
    activity: "<path d=\"M2 12h4.5l3-8 5 16 3-8H21\"/>",
    windw: "<rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><path d=\"M2 9h20M6 6.5h.01M9 6.5h.01\"/>",
    key: "<circle cx=\"8\" cy=\"12\" r=\"4\"/><path d=\"M12 12h10M18.5 12v3.4M15.5 12v2.4\"/>",
    database: "<ellipse cx=\"12\" cy=\"5.5\" rx=\"8\" ry=\"3.2\"/><path d=\"M4 5.5v13c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-13\"/><path d=\"M4 12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2\"/>",
    bolt: "<path d=\"M13 2L5 13h6l-1 9 9-12h-6z\"/>",
    bell: "<path d=\"M5 9a7 7 0 0 1 14 0c0 5.2 2.2 6.5 2.2 6.5H2.8S5 14.2 5 9\"/><path d=\"M9.5 20a2.5 2.5 0 0 0 5 0\"/>",
    mail: "<rect x=\"2\" y=\"4.5\" width=\"20\" height=\"15\" rx=\"2.2\"/><path d=\"M3 6.5l9 6.2 9-6.2\"/>"
};

const SLATE = '#5B6B82', AMBER = '#C6851B', TEAL = '#12909F', BLUE = '#2F6FB0', VIOLET = '#6D5AE6', INDIGO = '#4F5D95', GREEN = '#2E9E6B', INK = '#25324A', MUT = '#7C8A9C';
function sh(h, p) { const n = parseInt(h.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * (100 + p) / 100))); return '#' + ((1 << 24) + (f((n >> 16) & 255) << 16) + (f((n >> 8) & 255) << 8) + f(n & 255)).toString(16).slice(1); }
function tile(cx, cy, gl, c) { const id = 'l' + cx + '_' + cy; return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${sh(c, -15)}"/></linearGradient></defs><rect x="${cx - 30}" y="${cy - 30}" width="60" height="60" rx="14" fill="url(#${id})"/><g transform="translate(${cx - 12},${cy - 12})" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${G[gl]}</g>`; }
function node(cx, cy, gl, c, label, port) { let s = tile(cx, cy, gl, c) + `<text x="${cx}" y="${cy + 48}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">${label}</text>`; if (port) s += `<text x="${cx}" y="${cy + 64}" text-anchor="middle" font-size="11" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">${port}</text>`; return s; }
function grp(x, y, w, h, t, strong) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${strong ? '#F4F8FC' : 'none'}" stroke="${strong ? '#9DB8D2' : '#CBD5E1'}" stroke-width="${strong ? 1.5 : 1.25}" stroke-dasharray="${strong ? '7 5' : '5 4'}"/><text x="${x + 14}" y="${y + 20}" font-size="${strong ? 11 : 10.5}" font-weight="${strong ? 600 : 400}" letter-spacing="0.06em" fill="${strong ? '#5E7A99' : '#9AA8BA'}">${t}</text>`; }
function lbl(t, lx, ly, color) { color = color || '#33445A'; const w = t.length * 6.7 + 14; return `<rect x="${lx - w / 2}" y="${ly - 10}" width="${w}" height="20" rx="10" fill="#ffffff" stroke="#D3DDEA" stroke-width="1"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${color}">${t}</text>`; }
function pl(pts, color, dash) { color = color || MUT; const d = 'M' + pts.map((p) => p.join(',')).join(' L'); return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${dash ? ' stroke-dasharray="5 4"' : ''}/>`; }
function line(pts, color, dash) { color = color || MUT; const d = 'M' + pts.map((p) => p.join(',')).join(' L'); return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#ah)"/>`; }

let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 770" width="1120" height="770" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" role="img" aria-label="Fleet Manager system architecture">
<title>Fleet Manager system architecture</title>
<desc>Clients (browser, mobile app, Shelly devices, and the Wall Display) reach Fleet Manager through the Traefik TLS edge; internal traffic is plaintext behind it. A person signs in through Zitadel's Login UI, which the edge routes at /ui/v2/login; the Login UI calls the Zitadel API, which persists to its own database. Fleet Manager verifies tokens against the Zitadel API over internal HTTP, stores data in TimescaleDB, uses Redis for cache and coordination, and delivers notifications through FCM push and other channels. Ports sit on the listening service; the wire carries the protocol.</desc>
<rect width="1120" height="770" fill="#ffffff"/>
<defs><marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUT}"/></marker></defs>
<text x="40" y="40" font-size="17" font-weight="700" fill="#122A4F">Fleet Manager architecture at a glance</text>
<text x="40" y="61" font-size="12" fill="#6B7A90">Ports on the service that listens; protocols on the wire. Internal traffic is plaintext behind the TLS edge.</text>`;
// containers
g += grp(530, 115, 535, 495, 'INTERNAL NETWORK behind the TLS edge', true);
g += grp(40, 100, 190, 500, 'CLIENTS public');
g += grp(665, 150, 385, 140, 'ZITADEL identity');
g += grp(770, 340, 215, 255, 'DATA STORES');
g += grp(385, 620, 320, 130, 'NOTIFICATIONS external');
g += `<text x="350" y="298" text-anchor="middle" font-size="10.5" letter-spacing="0.05em" fill="#9AA8BA">TLS EDGE</text>`;
// clients gather onto one bus, then a single line into Traefik
g += pl([[165, 170], [280, 170]]);
g += pl([[165, 290], [280, 290]]);
g += pl([[165, 410], [280, 410]]);
g += pl([[165, 530], [280, 530]], AMBER, true);
g += pl([[280, 170], [280, 530]]);
g += line([[280, 340], [320, 340]]);
// edge -> core
g += line([[380, 330], [580, 330]]);
// edge -> login UI (the browser sign-in page, routed by Traefik)
g += line([[380, 322], [450, 322], [450, 205], [700, 205]], VIOLET);
// core -> zitadel-api (introspection), and zitadel internal chain
g += line([[640, 314], [830, 314], [830, 235]], VIOLET);
g += line([[760, 205], [825, 205]], VIOLET);
g += line([[885, 205], [950, 205]], VIOLET);
// core -> data stores
g += line([[640, 336], [750, 336], [750, 400], [840, 400]], INDIGO);
g += line([[640, 356], [730, 356], [730, 520], [840, 520]], INDIGO);
// core -> notifications (exits bottom-left, clears the FM label)
g += line([[585, 360], [545, 360], [545, 620]], GREEN);
// labels (protocol on the wire)
g += lbl('wss · /', 205, 150);
g += lbl('wss · /', 205, 270);
g += lbl('wss · /shelly', 222, 390);
g += lbl('ws · /shelly', 238, 510, AMBER);
g += lbl('http', 480, 314);
g += lbl('http', 735, 314, VIOLET);
g += lbl('/ui/v2/login', 600, 205, VIOLET);
g += lbl('PostgreSQL', 750, 385, INDIGO);
g += lbl('RESP', 730, 455, INDIGO);
g += lbl('HTTPS · SMTP', 545, 490, GREEN);
// nodes
g += node(135, 170, 'monitor', SLATE, 'Browser app');
g += node(135, 290, 'phone', SLATE, 'Mobile app');
g += node(135, 410, 'cpu', SLATE, 'Shelly devices');
g += node(135, 530, 'wall', AMBER, 'Wall Display');
g += node(350, 340, 'shield', TEAL, 'Traefik', ':80 · :443');
g += node(610, 330, 'activity', BLUE, 'Fleet Manager', ':7011');
g += node(730, 205, 'windw', VIOLET, 'Login UI', ':3000');
g += node(855, 205, 'key', VIOLET, 'API', ':8080');
g += node(980, 205, 'database', VIOLET, 'Database', ':5432');
g += node(870, 400, 'database', INDIGO, 'TimescaleDB', ':5432');
g += node(870, 520, 'bolt', INDIGO, 'Redis', ':6379');
g += node(480, 678, 'bell', GREEN, 'FCM push');
g += node(610, 678, 'mail', GREEN, 'Notify channels');
g += '</svg>';
fs.writeFileSync(path.join(__dirname, '..', 'system-architecture.svg'), g);
console.log('wrote ../system-architecture.svg', Math.round(g.length / 1024) + 'KB');

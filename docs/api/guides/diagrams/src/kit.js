// Shared diagram toolkit. One source of truth for the docs diagram family:
// palette, icon tiles, boxes, connectors, and the sequence / state-machine
// helpers. Every diagram script requires this so they all read as one set.
// Pure module (no I/O). Run generators under plain `node` (not tsx).

// ---- palette: role-based, matches the architecture overview ----
const ROLE = {
    client: '#5B6B82', // neutral slate, browsers, apps, devices
    edge: '#12909F', // teal, the TLS edge
    core: '#2F6FB0', // blue, Fleet Manager and its own surfaces
    identity: '#6D5AE6', // violet, Zitadel
    data: '#4F5D95', // indigo, data stores
    delivery: '#2E9E6B', // green, outbound notifications
    warn: '#C6851B', // amber, the odd-one-out / attention
    danger: '#C24A3D' // muted red, denied / blocked / failed states
};
const INK = '#25324A'; // primary text
const MUT = '#7C8A9C'; // muted text + default line
const BORDER = '#D3DDEA'; // pill / hairline border
const TITLE = '#122A4F'; // diagram heading
const C = {...ROLE, ink: INK, mut: MUT, border: BORDER, title: TITLE};

// lighten/darken by percent; tint mixes toward white for soft fills
function shade(hex, p) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round((v * (100 + p)) / 100)));
    return '#' + ((1 << 24) + (f((n >> 16) & 255) << 16) + (f((n >> 8) & 255) << 8) + f(n & 255)).toString(16).slice(1);
}
function tint(hex, p) {
    const n = parseInt(hex.slice(1), 16);
    const m = (v) => Math.round(v + (255 - v) * (p / 100));
    return '#' + ((1 << 24) + (m((n >> 16) & 255) << 16) + (m((n >> 8) & 255) << 8) + m(n & 255)).toString(16).slice(1);
}

// ---- glyphs: faithful Lucide (MIT) shapes on the 24x24 grid, rendered as a
// white stroke inside the tile. Keys are our use-case names; the comment on
// each is the Lucide icon it reproduces. One home for the whole icon vocabulary.
const G = {
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>', // monitor: browser / screen
    phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>', // smartphone: mobile app
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>', // cpu: a device
    router: '<rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18H6M10.01 18H10M15 10v4M17.84 7.17a4 4 0 0 0-5.66 0M20.66 4.34a8 8 0 0 0-11.31 0"/>', // router: gateway
    wall: '<rect width="20" height="16" x="2" y="3" rx="2"/><path d="M6 22h12"/><circle cx="12" cy="11" r="2.4"/>', // wall display
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>', // shield: edge
    shieldcheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', // shield-check: authz
    key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>', // key: token
    keyround: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r="1"/>', // key-round: identity
    badge: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>', // badge-check: certificate
    windw: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M10 4v4M2 8h20M6 4v4"/>', // app-window
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>', // database
    bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', // zap: energy
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>', // bell: alert
    siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1M18.5 4.5 18 5M2 12h1M12 2v1M4.929 4.929l.707.707M12 12v6"/>', // siren: alert engine
    belloff: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/><path d="m2 2 20 20"/>', // bell-off: cleared
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>', // mail: delivery
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>', // send
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>', // activity: live stream
    radio: '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>', // radio-tower: event distributor
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', // layout-grid: entities
    blocks: '<path d="M10 22V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z"/><rect width="8" height="8" x="14" y="2" rx="1"/>', // blocks: components
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', // box: virtual device
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', // user
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', // users: persona / group
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>', // building-2: organization
    mappin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', // map-pin: location
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>', // server: Fleet Manager
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>', // cloud
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>', // code
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>', // globe: HTTP
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', // terminal: script client
    list: '<path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>', // list: API list
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', // clock
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>', // hourglass: waiting
    check: '<path d="M20 6 9 17l-5-5"/>', // check
    circlecheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', // circle-check: accepted
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>', // ban: denied
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>', // tag
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>', // plug: socket
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>', // layers
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>', // route: dispatch
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>' // gauge: meter
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ---- SVG scaffold: a11y + white bg + heading ----
function svg({w, h, title, desc, heading, sub}) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" role="img" aria-label="${title}">`;
    s += `<title>${title}</title>`;
    if (desc) s += `<desc>${desc}</desc>`;
    s += `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
    if (heading) {
        s += `<text x="40" y="42" font-size="18" font-weight="700" fill="${TITLE}">${heading}</text>`;
        if (sub) s += `<text x="40" y="64" font-size="12.5" fill="#6B7A90">${sub}</text>`;
    }
    return s;
}
const close = () => '</svg>';

// per-color arrowhead; duplicate ids for a repeated color are harmless
function marker(color) {
    const id = 'a' + color.slice(1);
    return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker></defs>`;
}

// ---- connectors ----
function link(pts, {color = MUT, dash, both} = {}) {
    const id = 'a' + color.slice(1);
    const d = 'M' + pts.map((p) => p.join(',')).join(' L');
    return marker(color) + `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.7"${dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#${id})"${both ? ` marker-start="url(#${id})"` : ''}/>`;
}
function plain(pts, {color = MUT, dash} = {}) {
    const d = 'M' + pts.map((p) => p.join(',')).join(' L');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.7"${dash ? ' stroke-dasharray="5 4"' : ''}/>`;
}

// ---- icon tile + node (topology) ----
function tile(cx, cy, gl, color, r = 30) {
    const id = `t${cx}_${cy}`;
    const gs = (r * 24) / 30 / 24; // scale glyph with tile (native 24px at r=30)
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -15)}"/></linearGradient></defs>` +
        `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.47}" fill="url(#${id})"/>` +
        `<g transform="translate(${cx},${cy}) scale(${gs}) translate(-12,-12)" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${G[gl]}</g>`;
}
function node(cx, cy, gl, color, label, sub, r = 30) {
    let s = tile(cx, cy, gl, color, r);
    s += `<text x="${cx}" y="${cy + r + 18}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">${label}</text>`;
    if (sub) s += `<text x="${cx}" y="${cy + r + 34}" text-anchor="middle" font-size="11" font-family="ui-monospace,Menlo,monospace" fill="${MUT}">${sub}</text>`;
    return s;
}

// ---- concept box: tinted fill, colored border, optional icon tile, title + body
// `icon` draws the filled gradient tile at the top; `gl` draws a lighter
// outline glyph. Use `icon` to keep the whole set on the same icon language.
function chip(x, y, w, h, {title, body = [], color = ROLE.core, gl, icon, iconSvg, mono, align = 'middle', vcenter} = {}) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${tint(color, 90)}" stroke="${color}" stroke-width="1.5"/>`;
    const cx = align === 'start' ? x + 20 : x + w / 2;
    const anc = align === 'start' ? 'start' : 'middle';
    let ty = y + (gl ? 34 : 30);
    if (vcenter && !gl && !icon && !iconSvg) {
        const contentH = 20 + body.length * 18; // title row + body lines
        ty = y + Math.round((h - contentH) / 2) + 14;
    }
    if (iconSvg) {
        // a pre-positioned icon fragment supplied by the caller, at the top
        s += iconSvg;
        ty = y + 66;
    } else if (icon) {
        s += tile(cx, y + 30, icon, color, 18);
        ty = y + 66;
    } else if (gl) {
        s += `<g transform="translate(${cx - 11},${y + 14}) scale(0.92)" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${G[gl]}</g>`;
        ty = y + 52;
    }
    s += `<text x="${cx}" y="${ty}" text-anchor="${anc}" font-size="${mono ? 15 : 14.5}" font-weight="700"${mono ? ' font-family="ui-monospace,Menlo,monospace"' : ''} fill="${INK}">${title}</text>`;
    body.forEach((line, i) => {
        s += `<text x="${cx}" y="${ty + 22 + i * 18}" text-anchor="${anc}" font-size="12.5" fill="${MUT}">${line}</text>`;
    });
    return s;
}

// ---- boundary group ----
function group(x, y, w, h, title, {strong} = {}) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${strong ? '#F4F8FC' : 'none'}" stroke="${strong ? '#9DB8D2' : '#CBD5E1'}" stroke-width="${strong ? 1.5 : 1.25}" stroke-dasharray="${strong ? '7 5' : '5 4'}"/>` +
        `<text x="${x + 14}" y="${y + 20}" font-size="${strong ? 11 : 10.5}" font-weight="${strong ? 600 : 400}" letter-spacing="0.06em" fill="${strong ? '#5E7A99' : '#9AA8BA'}">${title}</text>`;
}

// ---- wire label pill ----
function pill(text, x, y, {color = '#33445A'} = {}) {
    const w = text.length * 6.7 + 16;
    return `<rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="20" rx="10" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>` +
        `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${color}">${text}</text>`;
}

// ---- state-machine bubble ----
function state(cx, cy, {label, color = ROLE.core, w = 130, h = 46} = {}) {
    return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${tint(color, 88)}" stroke="${color}" stroke-width="1.8"/>` +
        `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13.5" font-weight="600" fill="${INK}">${label}</text>`;
}

// ---- sequence: lifeline + actor head + message ----
function lane(x, y0, y1, {color = MUT} = {}) {
    return `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${tint(color, 55)}" stroke-width="1.5" stroke-dasharray="3 5"/>`;
}
function actor(x, y, gl, color, label) {
    return tile(x, y, gl, color, 26) +
        `<text x="${x}" y="${y + 44}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${INK}">${label}</text>`;
}
function msg(x0, x1, y, {label, num, color = MUT, dash} = {}) {
    let s = link([[x0, y], [x1, y]], {color, dash});
    const mid = (x0 + x1) / 2;
    if (num != null) s += `<circle cx="${x0 < x1 ? x0 + 12 : x0 - 12}" cy="${y - 13}" r="9" fill="${color}"/><text x="${x0 < x1 ? x0 + 12 : x0 - 12}" y="${y - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${num}</text>`;
    if (label) s += `<text x="${mid}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${INK}">${label}</text>`;
    return s;
}

module.exports = {ROLE, C, INK, MUT, BORDER, TITLE, shade, tint, G, FONT, svg, close, link, plain, tile, node, chip, group, pill, state, lane, actor, msg};

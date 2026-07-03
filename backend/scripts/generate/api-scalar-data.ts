// Static data for the api-scalar generator: branding, featured tiles, category map, scalar config.

import {SHELLY_CUSTOM_CSS} from './api-scalar-css.js';
import type {Category, FeaturedNamespace} from './api-scalar-types.js';

const FAVICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="11" fill="#4495D1"/>' +
    '<path fill="white" d="M14.5 7 h-5 l0.8 5 h2.4 l-0.7 6 l5-5.7z"/>' +
    '</svg>';
export const FAVICON_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(FAVICON_SVG).toString('base64')}`;

// "Where to start" tiles.
export const FEATURED_NAMESPACES: FeaturedNamespace[] = [
    {
        name: 'device',
        label: 'Devices',
        blurb: 'Discover, configure, and control every Shelly device in your fleet.',
        icon: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm4 9h10M8 7v9'
    },
    {
        name: 'alert',
        label: 'Alerts',
        blurb: 'Rule-based notifications with channels, schedules, and templates.',
        icon: 'M12 3 14.5 8 20 9 16 13 17 19 12 16 7 19 8 13 4 9 9.5 8z'
    },
    {
        name: 'group',
        label: 'Groups',
        blurb: 'Organise devices into named groups for bulk operations and access.',
        icon: 'M9 12a4 4 0 1 1 6 0 4 4 0 0 1-6 0zM3 21a6 6 0 0 1 12 0M15 11a3 3 0 1 0 0-6M21 21a4 4 0 0 0-6-4'
    },
    {
        name: 'schedule',
        label: 'Schedules',
        blurb: 'Time- and event-triggered automations across the fleet.',
        icon: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'
    },
    {
        name: 'dashboard',
        label: 'Dashboards',
        blurb: 'Cards, widgets, and live tiles for the people who watch the fleet.',
        icon: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-12h8V3h-8z'
    },
    {
        name: 'user',
        label: 'Users',
        blurb: 'Identity, sessions, and Zitadel-backed authentication.',
        icon: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM4 22a8 8 0 0 1 16 0'
    },
    {
        name: 'organization',
        label: 'Organizations',
        blurb: 'Multi-tenant boundaries, members, branding, and isolation.',
        icon: 'M4 21h16M6 21V7l6-4 6 4v14M9 21V9m6 12V9M9 9h6'
    },
    {
        name: 'entity',
        label: 'Entities',
        blurb: 'Unified abstraction over heterogeneous device capabilities.',
        icon: 'M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6z'
    }
];

// Categories — derived from entity-registry.ts + docs/architecture/api.md § 2.
// Every namespace belongs to exactly one. Build asserts full coverage.
export const CATEGORIES: readonly Category[] = [
    {
        label: 'Switches & Relays',
        blurb: 'On/off relays and circuit breakers — every Shelly relay generation.',
        icon: 'M12 3v9m0 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        namespaces: ['switch', 'cb']
    },
    {
        label: 'Smart Lighting',
        blurb: 'Dimmable bulbs, RGB/RGBW/CCT, addressable LED strips.',
        icon: 'M9 21h6m-6-4h6M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11z',
        namespaces: ['light', 'cct', 'rgb', 'rgbw', 'rgbcct', 'ledstrip']
    },
    {
        label: 'Covers & Rollers',
        blurb: 'Shutters, blinds, garage doors, position control.',
        icon: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
        namespaces: ['cover']
    },
    {
        label: 'Inputs & Buttons',
        blurb: 'Wired inputs and learned button events.',
        icon: 'M9 9h6a2 2 0 0 1 2 2v8H7v-8a2 2 0 0 1 2-2zM12 4v5',
        namespaces: ['input', 'button']
    },
    {
        label: 'Energy & Power Meters',
        blurb: 'EM/EM1, single-channel meters, voltmeters, battery monitors, energy history.',
        icon: 'M13 2 3 14h7l-1 8 10-12h-7z',
        namespaces: [
            'em',
            'em1',
            'emdata',
            'em1data',
            'pm1',
            'devicepower',
            'voltmeter',
            'energy',
            'bm'
        ]
    },
    {
        label: 'Climate Control',
        blurb: 'Thermostats and TRVs, fans, with paired ambient temp/humidity.',
        icon: 'M12 9V3m0 0a2 2 0 0 0-2 2v10a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z',
        namespaces: ['thermostat', 'trv', 'temperature', 'humidity', 'fan']
    },
    {
        label: 'Environmental Sensors',
        blurb: 'Smoke, flood, illuminance, presence — safety + ambient.',
        icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
        namespaces: [
            'smoke',
            'flood',
            'illuminance',
            'presence',
            'presencezone'
        ]
    },
    {
        label: 'BTHome & BLE',
        blurb: 'BTHome v2 sensor mesh, BLE peripherals, BLU gateways.',
        icon: 'M7 8 17 16 12 21V3l5 5L7 16',
        namespaces: ['bthome', 'ble', 'blugw']
    },
    {
        label: 'Cameras & Media',
        blurb: 'IP cameras, audio/media playback, image storage.',
        icon: 'M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
        namespaces: ['camera', 'media']
    },
    {
        label: 'Wall Display',
        blurb: 'On-device UI surfaces — touch panels and embedded screens.',
        icon: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm6 17h6M12 17v5',
        namespaces: ['ui']
    },
    {
        label: 'Specialty Devices',
        blurb: 'Cury scent diffusers, Pill, DALI lighting networks, XT1 services.',
        icon: 'M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6z',
        namespaces: ['cury', 'pill', 'dali', 'service']
    },
    {
        label: 'Virtual Components & Devices',
        blurb: 'Software-only state, projected devices, and virtual meters.',
        icon: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
        namespaces: [
            'virtual',
            'virtual_meta',
            'virtualdevice',
            'object',
            'entity'
        ]
    },
    {
        label: 'Device Lifecycle',
        blurb: 'Device registry, addons, firmware versions, OTA flow.',
        icon: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
        namespaces: ['device', 'shelly', 'addon', 'firmware', 'ota']
    },
    {
        label: 'Networking',
        blurb: 'Wi-Fi, Ethernet, mDNS, HTTP/WS transport surfaces, local-network messaging.',
        icon: 'M5 12a14 14 0 0 1 14 0M3 9a18 18 0 0 1 18 0M8 15a10 10 0 0 1 8 0M12 18h0',
        namespaces: ['wifi', 'eth', 'http', 'mdns', 'web', 'ws', 'mobile', 'lnm']
    },
    {
        label: 'Industrial Protocols',
        blurb: 'Modbus, KNX, DALI, Zigbee bridging, serial passthrough, X-Mod.',
        icon: 'M4 6h16M4 12h16M4 18h16M8 3v3M16 3v3M8 18v3M16 18v3',
        namespaces: ['modbus', 'mbrtuclient', 'knx', 'serial', 'xmod', 'zigbee']
    },
    {
        label: 'Smart-Home Integrations',
        blurb: 'Alexa, Matter, MQTT broker, Shelly Cloud integrations.',
        icon: 'M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0zM4 12h16M12 4a14 14 0 0 1 0 16M12 4a14 14 0 0 0 0 16',
        namespaces: ['alexa', 'matter', 'mqtt', 'cloud']
    },
    {
        label: 'Alerts & Notifications',
        blurb: 'Rules, channels, templates, webhooks, mail delivery.',
        icon: 'M12 3 14.5 8 20 9 16 13 17 19 12 16 7 19 8 13 4 9 9.5 8z',
        namespaces: [
            'alert',
            'channel',
            'notification',
            'notification_policy',
            'webhook',
            'mail',
            'message_text'
        ]
    },
    {
        label: 'Schedules & Automation',
        blurb: 'Time- and event-driven schedules; embedded device scripts.',
        icon: 'M5 3v18M9 7l5-3 5 3v10l-5 3-5-3z',
        namespaces: ['schedule', 'script']
    },
    {
        label: 'Dashboards & UI',
        blurb: 'Cards, widgets, embedded Grafana, branding, login text, reports.',
        icon: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-12h8V3h-8z',
        namespaces: ['dashboard', 'branding', 'grafana', 'report', 'login_text']
    },
    {
        label: 'Users & Identity',
        blurb: 'Accounts, sessions, personas, identities, credentials.',
        icon: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM4 22a8 8 0 0 1 16 0',
        namespaces: ['user', 'user_group', 'persona', 'identity', 'credential']
    },
    {
        label: 'Organization',
        blurb: 'Organizations, groups, fleets, locations, tags, assignments.',
        icon: 'M4 21h16M6 21V7l6-4 6 4v14M9 21V9m6 12V9M9 9h6',
        namespaces: [
            'organization',
            'group',
            'fleet',
            'assignment',
            'location',
            'tag',
            'waitingroom'
        ]
    },
    {
        label: 'Security, Audit & Privacy',
        blurb: 'Permissions, policy, certificates, audit logs, privacy controls.',
        icon: 'M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6z',
        namespaces: [
            'permission',
            'policy',
            'restrictions',
            'certificate',
            'domain_policy',
            'privacy',
            'security',
            'audit',
            'authz_audit'
        ]
    },
    {
        label: 'Storage & State',
        blurb: 'Per-device KVS, server-side storage, backups, variables.',
        icon: 'M3 6a9 3 0 1 0 18 0 9 3 0 0 0-18 0v12a9 3 0 0 0 18 0V6M3 12a9 3 0 0 0 18 0',
        namespaces: ['kvs', 'storage', 'backup', 'variables']
    },
    {
        label: 'System & Admin',
        blurb: 'System health, admin operations, plugins, background jobs, sys.',
        icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
        namespaces: ['system', 'admin', 'sys', 'plugin', 'client', 'job']
    }
];

export const SCALAR_CONFIGURATION = {
    theme: 'default',
    layout: 'modern',
    showSidebar: true,
    hideDarkModeToggle: true,
    hideDownloadButton: false,
    darkMode: false,
    metaData: {title: 'Fleet Manager API'},
    favicon: FAVICON_DATA_URI,
    customCss: SHELLY_CUSTOM_CSS
};

export const SPEC_INTRO_MARKDOWN =
    '**Fleet Manager** exposes a JSON-RPC surface over WebSocket. ' +
    'Every operation is reachable as a WebSocket RPC call against ' +
    '`wss://{host}/` (the root path). The `/rpc/{Namespace}.{Method}` URLs ' +
    'documented ' +
    'here exist so this reference renders in any OpenAPI tool — the ' +
    'contract (params, response, errors, permissions) is identical on ' +
    'either transport.\n\n' +
    '**Authentication** — all operations require an authenticated WebSocket ' +
    'session except those tagged `public`. Permissions are listed under ' +
    '`x-fm-permission` on every operation.\n\n' +
    '**Errors** — operations may return validation (400) or permission ' +
    '(403) errors. Domain-specific error kinds are listed per namespace.';

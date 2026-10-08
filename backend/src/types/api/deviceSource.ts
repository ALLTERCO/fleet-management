// How a device reaches us. The one place these values are declared.
//
// It was `string` in five files, so tests keyed 'websocket' and the frontend
// keyed 'shelly'. Nothing emits either. Filtering by one returned an empty
// list, not an error.
//
// Lives here so the frontend can reach it through @api/*. No imports: every
// layer depends on this, so it depends on nothing.

export const DEVICE_SOURCE_VALUES = [
    // The two transports supply these as their `name`.
    'ws',
    'local',
    // No transport attached.
    'offline',
    // Records, not connections. They never have a transport.
    'virtual',
    'bluetooth'
] as const;

export type DeviceSource = (typeof DEVICE_SOURCE_VALUES)[number];

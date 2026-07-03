// Bare-key device singletons — kept as-is by the normalizer (no ":0").
// Leaf file so callers consume it without an import cycle.

export const NON_COMPONENT_KEYS: ReadonlySet<string> = new Set([
    'ts',
    'sys',
    'wifi',
    'ble',
    'cloud',
    'mqtt',
    'modbus',
    'ws',
    'eth',
    'dali',
    'knx',
    'bthome'
]);

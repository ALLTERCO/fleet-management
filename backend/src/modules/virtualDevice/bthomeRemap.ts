const BTHOME_OBJ_NAME_REMAP: Record<string, string> = {
    temperature: 'temperature',
    humidity: 'humidity',
    illuminance: 'illuminance',
    motion: 'motion',
    moving: 'motion',
    moisture: 'flood',
    battery: 'battery',
    button: 'button',
    door: 'door',
    opening: 'door',
    window: 'door',
    smoke: 'smoke',
    voltage: 'voltage',
    current: 'current',
    power: 'power',
    energy: 'energy',
    precipitation: 'rain',
    light_level: 'illuminance',
    pressure: 'pressure',
    co2: 'co2',
    tvoc: 'tvoc',
    gas: 'gas',
    carbon_monoxide: 'carbon_monoxide',
    tamper: 'tamper',
    vibration: 'vibration',
    presence: 'presence',
    occupancy: 'presence',
    garage_door: 'garage_door',
    lock: 'lock',
    sound: 'sound'
};

export function canonicalBTHomeComponentType(
    objectName: string
): string | undefined {
    return BTHOME_OBJ_NAME_REMAP[objectName];
}

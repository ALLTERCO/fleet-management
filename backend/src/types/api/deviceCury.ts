// Firmware-defined vial mode enum. null = clear/no mode.
export const CURY_MODES = [
    'hall',
    'bedroom',
    'living_room',
    'lavatory_room',
    'reception',
    'workplace'
] as const;
export type CuryMode = (typeof CURY_MODES)[number];

export const METER_COUNTER_COMPONENTS = [
    'EM',
    'EM1',
    'EMData',
    'EM1Data',
    'PM1',
    'PM1Data'
] as const;

export const METER_CONFIG_COMPONENTS = ['EM', 'EM1', 'PM1'] as const;

export const METER_COUNTER_COMPONENT_SET = new Set<string>(
    METER_COUNTER_COMPONENTS
);

export const METER_CONFIG_COMPONENT_SET = new Set<string>(
    METER_CONFIG_COMPONENTS
);

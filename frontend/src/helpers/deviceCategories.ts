export interface DeviceCategory {
    key: string;
    label: string;
}

export const DEVICE_CATEGORIES: readonly DeviceCategory[] = [
    {key: 'energy', label: 'Energy'},
    {key: 'climate', label: 'Climate'},
    {key: 'safety', label: 'Safety'},
    {key: 'lighting', label: 'Lighting'},
    {key: 'access', label: 'Access'},
    {key: 'custom', label: 'Custom'}
];

export const DEVICE_CATEGORY_KEYS = DEVICE_CATEGORIES.map((c) => c.key);

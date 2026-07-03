// Firmware-defined allowlists for Virtual.* (role + Add type).

export const VIRTUAL_ROLE_COMPONENTS = [
    'Boolean',
    'Number',
    'Enum',
    'Text'
] as const;
export type VirtualRoleComponent = (typeof VIRTUAL_ROLE_COMPONENTS)[number];

export const VIRTUAL_ADD_TYPES = [
    'boolean',
    'text',
    'number',
    'enum',
    'group',
    'button'
] as const;
export type VirtualAddType = (typeof VIRTUAL_ADD_TYPES)[number];

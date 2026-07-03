export interface ComponentEventAttr {
    name: string;
    type: 'boolean' | 'number' | 'string' | 'object' | 'array';
    desc: string;
}

export interface ComponentEventDescriptor {
    /** Event name as the device sends it, e.g. "data", "alarm_overvoltage". */
    event: string;
    attrs?: ReadonlyArray<ComponentEventAttr>;
}

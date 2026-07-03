const COMPONENT_KEY_PATTERN = /^[a-z][a-z0-9_]*:\d+$/;

export function isComponentKey(value: unknown): value is string {
    return typeof value === 'string' && COMPONENT_KEY_PATTERN.test(value);
}

export function componentType(componentKey: string): string {
    return componentKey.split(':')[0] ?? componentKey;
}

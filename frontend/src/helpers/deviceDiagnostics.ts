const READ_ONLY_ACTION = /^(?:Describe|Get|List|Read)/;

export function isReadOnlyDeviceMethod(method: string): boolean {
    const separator = method.lastIndexOf('.');
    if (separator <= 0 || separator === method.length - 1) return false;
    return READ_ONLY_ACTION.test(method.slice(separator + 1));
}

export function diagnosticMethods(methods: readonly string[]): string[] {
    return [...new Set(methods.filter(isReadOnlyDeviceMethod))].sort();
}

export function canRunDiagnosticMethod(
    method: string,
    advertisedMethods: readonly string[]
): boolean {
    return isReadOnlyDeviceMethod(method) && advertisedMethods.includes(method);
}

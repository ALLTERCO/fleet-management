// One framework-neutral trust rule for browser runtime, package validation and
// immutable deploy requests. Keep paths in the result so every caller can
// present useful errors without maintaining its own dangerous-field table.

export const EXECUTABLE_CUSTOMIZATION_FIELDS = [
    'html',
    'css',
    'script',
    'srcdoc',
    'dataSources'
] as const;

export const HOST_CALL_SOURCE_KINDS = ['api', 'rpc'] as const;

const executableFields = new Set<string>(EXECUTABLE_CUSTOMIZATION_FIELDS);
const hostCallKinds = new Set<string>(HOST_CALL_SOURCE_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findUnsafeCustomizationIssues(
    value: unknown,
    location = 'customization'
): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item, index) =>
            findUnsafeCustomizationIssues(item, `${location}[${index}]`)
        );
    }
    if (!isRecord(value)) return [];

    const issues: string[] = [];
    if (typeof value.kind === 'string' && hostCallKinds.has(value.kind)) {
        issues.push(`${location}.kind is a forbidden host-call source`);
    }
    for (const [field, child] of Object.entries(value)) {
        if (executableFields.has(field)) {
            issues.push(`${location}.${field} is not customizable`);
        }
        issues.push(
            ...findUnsafeCustomizationIssues(child, `${location}.${field}`)
        );
    }
    return issues;
}

// Stable context paths from the AlertInstance/notification API contract.
// Per-rule-kind extras belong on the backend descriptor — frontend merges
// them in via getContextVariables(kind, fromDescriptor).

export interface ContextVariable {
    path: string;
    label: string;
}

export type TemplateContextKind = 'alert' | 'delivery';

const STABLE_ALERT: ContextVariable[] = [
    {path: 'alert.title', label: 'Alert title'},
    {path: 'alert.message', label: 'Alert message'},
    {path: 'alert.severity', label: 'Severity'},
    {path: 'alert.activeSince', label: 'Active since (ISO)'},
    {path: 'rule.name', label: 'Rule name'},
    {path: 'rule.kind', label: 'Rule kind'},
    {path: 'rule.runbookUrl', label: 'Runbook URL'},
    {path: 'subject.name', label: 'Subject name'},
    {path: 'subject.type', label: 'Subject type'},
    {path: 'subject.id', label: 'Subject identifier'}
];

export function getContextVariables(
    kind: TemplateContextKind,
    fromDescriptor?: ContextVariable[]
): ContextVariable[] {
    const stable = kind === 'alert' ? STABLE_ALERT : [];
    const extras = fromDescriptor ?? [];
    const seen = new Set(stable.map((v) => v.path));
    return [...stable, ...extras.filter((v) => !seen.has(v.path))];
}

// Editor preview: substitutes action vars. `{path}` tokens pass through
// since backend owns the real render and per-kind values.
export function previewRender(
    template: string,
    actionVars: Record<string, string>
): string {
    return template.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, key) =>
        actionVars[key] != null ? actionVars[key] : `\${${key}}`
    );
}

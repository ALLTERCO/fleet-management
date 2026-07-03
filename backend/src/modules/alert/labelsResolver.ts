// ${path.to.value} token expansion. Unresolved tokens drop the label.

export interface LabelResolutionContext {
    device?: {
        shellyID?: string;
        name?: string;
        info?: {name?: string} | null;
        labels?: Record<string, unknown> | null;
        attributes?: Record<string, unknown> | null;
    };
    rule?: {id: number; name: string; kind: string};
    instance?: {severity: string; subjectId?: string; subjectType?: string};
}

const TOKEN_RE = /\$\{([a-zA-Z0-9_.]+)\}/g;

export function resolveLabels(
    template: Record<string, unknown> | null | undefined,
    context: LabelResolutionContext
): Record<string, string> {
    if (!template) return {};
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(template)) {
        if (typeof raw !== 'string') {
            out[key] =
                typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
            continue;
        }
        const expanded = expandTokens(raw, context);
        if (expanded !== null) out[key] = expanded;
    }
    return out;
}

function expandTokens(
    template: string,
    context: LabelResolutionContext
): string | null {
    let allTokensResolved = true;
    const expanded = template.replace(TOKEN_RE, (_match, path: string) => {
        const value = readPath(context, path);
        if (value === undefined || value === null) {
            allTokensResolved = false;
            return '';
        }
        return String(value);
    });
    return allTokensResolved ? expanded : null;
}

function readPath(root: unknown, path: string): unknown {
    let cur: unknown = root;
    for (const segment of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[segment];
    }
    return cur;
}

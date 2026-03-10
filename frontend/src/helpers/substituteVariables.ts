import {getRegistry} from '@/tools/websocket';

const registry = getRegistry('action-variables');

export async function fetchActionVariables(): Promise<Record<string, string>> {
    try {
        return (await registry.getAll<Record<string, string>>()) ?? {};
    } catch {
        return {};
    }
}

export function substituteVariablesSync(
    obj: any,
    vars: Record<string, string>
): any {
    if (typeof obj === 'string') {
        return obj.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, key) =>
            vars[key] != null ? vars[key] : `\${${key}}`
        );
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => substituteVariablesSync(item, vars));
    }

    if (obj && typeof obj === 'object') {
        const out: Record<string, any> = {};
        for (const k in obj) {
            if (Object.hasOwn(obj, k)) {
                out[k] = substituteVariablesSync(obj[k], vars);
            }
        }
        return out;
    }

    return obj;
}

// Legacy wrapper for backward compatibility
export async function substituteVariables(obj: any): Promise<any> {
    const vars = await fetchActionVariables();
    return substituteVariablesSync(obj, vars);
}

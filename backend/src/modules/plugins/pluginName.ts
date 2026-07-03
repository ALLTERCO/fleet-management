const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function normalisePluginName(raw: string): string | undefined {
    const name = raw.startsWith('@') ? raw.split('/').at(-1) : raw;
    if (typeof name !== 'string' || name.length === 0) return undefined;
    if (!SAFE_PLUGIN_NAME.test(name)) return undefined;
    if (name === '.' || name === '..' || name.includes('..')) return undefined;
    return name;
}

export function assertSafePluginName(raw: string): string {
    const name = normalisePluginName(raw);
    if (!name) {
        throw new Error(`Unsafe plugin name: ${raw}`);
    }
    return name;
}

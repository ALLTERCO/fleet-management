// Express 5 types route params as `string | string[] | undefined` to support
// repeated regex captures. Our routes use simple `:foo` patterns, so coerce.

export function paramStr(v: string | string[] | undefined): string {
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

// Accent tokens that virtual-device + group decoration can choose from.
// Each key maps to `--accent-<key>` in design-tokens.css (RGB triplet).

export interface AccentToken {
    key: string | null;
    label: string;
}

export const ACCENT_TOKENS: readonly AccentToken[] = [
    {key: null, label: 'Default'},
    {key: 'red', label: 'Red'},
    {key: 'darkred', label: 'Dark red'},
    {key: 'orange', label: 'Orange'},
    {key: 'darkorange', label: 'Dark orange'},
    {key: 'amber', label: 'Amber'},
    {key: 'yellow', label: 'Yellow'},
    {key: 'darkyellow', label: 'Dark yellow'},
    {key: 'lime', label: 'Lime'},
    {key: 'green', label: 'Green'},
    {key: 'darkgreen', label: 'Dark green'},
    {key: 'emerald', label: 'Emerald'},
    {key: 'teal', label: 'Teal'},
    {key: 'cyan', label: 'Cyan'},
    {key: 'sky', label: 'Sky'},
    {key: 'blue', label: 'Blue'},
    {key: 'darkblue', label: 'Dark blue'},
    {key: 'indigo', label: 'Indigo'},
    {key: 'violet', label: 'Violet'},
    {key: 'purple', label: 'Purple'},
    {key: 'darkpurple', label: 'Dark purple'},
    {key: 'fuchsia', label: 'Fuchsia'},
    {key: 'pink', label: 'Pink'},
    {key: 'rose', label: 'Rose'},
    {key: 'slate', label: 'Slate'},
    {key: 'white', label: 'White'},
    {key: 'black', label: 'Black'}
] as const;

const VALID_KEYS = new Set(
    ACCENT_TOKENS.map((t) => t.key).filter((k): k is string => k !== null)
);

export function isAccentTokenKey(value: unknown): value is string {
    return typeof value === 'string' && VALID_KEYS.has(value);
}

// A token key resolves via its --accent-<key> var; a raw hex (legacy) is used
// as-is. Lenient on the key so legacy device-type keys still resolve.
export function accentToCss(
    value: string | null | undefined
): string | undefined {
    if (!value) return undefined;
    return value.startsWith('#') ? value : `rgb(var(--accent-${value}))`;
}

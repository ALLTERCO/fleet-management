// Bidirectional value↔label map for enum-style Dropdown options.
export interface EnumLabels<K extends string> {
    labels: string[];
    labelOf: (key: K) => string;
    keyOf: (label: string) => K;
}

export function useEnumLabels<K extends string>(
    map: Record<K, string>,
    fallback: K
): EnumLabels<K> {
    const labels = Object.values(map) as string[];
    const labelOf = (key: K): string => map[key] ?? map[fallback] ?? '';
    const keyOf = (label: string): K => {
        const entry = (Object.entries(map) as [K, string][]).find(
            ([, v]) => v === label
        );
        return entry?.[0] ?? fallback;
    };
    return {labels, labelOf, keyOf};
}

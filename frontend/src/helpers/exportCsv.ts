export function downloadCsv(
    filename: string,
    headers: string[],
    rows: (string | number | null | undefined)[][]
) {
    const escapeCell = (v: any): string => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
    };

    const csv = [
        headers.map(escapeCell).join(','),
        ...rows.map((r) => r.map(escapeCell).join(','))
    ].join('\n');

    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

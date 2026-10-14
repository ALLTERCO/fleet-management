/** Keep the unit tied to the underlying count; groups are not locations. */
export function formatGroupCount(count: number): string {
    return `${count} ${count === 1 ? 'group' : 'groups'}`;
}

export function formatDeviceCount(count: number): string {
    return `${count} ${count === 1 ? 'device' : 'devices'}`;
}

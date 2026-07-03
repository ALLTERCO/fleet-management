export function pushRing<T>(ring: T[], entry: T, cap: number): void {
    ring.push(entry);
    while (ring.length > cap) ring.shift();
}

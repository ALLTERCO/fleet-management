/**
 * Validate that an IP address is a safe device IP (not loopback, link-local, etc.)
 */
export function isValidDeviceIp(ip: string): boolean {
    const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (!ipv4.test(ip)) return false;
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return false;
    // Reject loopback, link-local, multicast, broadcast, unspecified
    if (parts[0] === 127) return false; // loopback
    if (parts[0] === 0) return false; // unspecified
    if (parts[0] === 169 && parts[1] === 254) return false; // link-local
    if (parts[0] >= 224) return false; // multicast + reserved
    return true;
}

export function isPrivateDeviceIp(ip: string): boolean {
    if (!isValidDeviceIp(ip)) return false;
    const [first, second] = ip.split('.').map(Number);
    return (
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
    );
}

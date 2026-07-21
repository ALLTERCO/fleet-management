/** True when the string is a complete dotted-quad IPv4 address. */
export function ipv4Valid(value: string): boolean {
    return /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(
        value
    );
}

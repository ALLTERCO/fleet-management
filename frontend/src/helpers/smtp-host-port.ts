/** Split + join the SMTP host endpoint.
 *  The Zitadel API treats host as a single string ("smtp.example.com:587"),
 *  but every other admin UI presents host and port separately. These helpers
 *  do the conversion at the form boundary so the rest of the code never sees
 *  the combined form. */

const COMMON_SMTP_PORTS: ReadonlySet<number> = new Set([25, 465, 587, 2525]);

export interface HostPort {
    readonly host: string;
    readonly port: number | null;
}

/** Parse "smtp.example.com:587" → {host, port}.
 *  Falls back to {host, port: null} when the trailing segment isn't a
 *  plausible port number. Whitespace-trim and IPv6 brackets are honoured. */
export function splitHostPort(input: string): HostPort {
    const raw = input.trim();
    if (raw.length === 0) return {host: '', port: null};

    // [::1]:587 — IPv6 in brackets, port after the closing bracket.
    if (raw.startsWith('[')) {
        const close = raw.indexOf(']');
        if (close > 0) {
            const host = raw.slice(1, close);
            const tail = raw.slice(close + 1);
            const port = parsePortTail(tail);
            return {host, port};
        }
    }

    // Plain "host:port" — only split on the LAST colon, IPv6 hosts already
    // handled above. Anything else with multiple colons is treated as host-only.
    const lastColon = raw.lastIndexOf(':');
    if (lastColon === -1) return {host: raw, port: null};
    const head = raw.slice(0, lastColon);
    const tail = raw.slice(lastColon);
    if (head.includes(':')) return {host: raw, port: null};
    const port = parsePortTail(tail);
    if (port === null) return {host: raw, port: null};
    return {host: head, port};
}

/** Join {host, port} → "smtp.example.com:587".
 *  Returns the bare host when port is null. IPv6 hosts are bracketed. */
export function joinHostPort(input: HostPort): string {
    const host = input.host.trim();
    if (host.length === 0) return '';
    if (input.port === null) return host;
    const wrapped = host.includes(':') ? `[${host}]` : host;
    return `${wrapped}:${input.port}`;
}

/** Suggested port when the user picks an encryption mode and the port is
 *  blank — purely an autofill convenience. Never overrides a port the
 *  user typed. */
export function defaultPortForEncryption(
    mode: 'none' | 'starttls' | 'ssl'
): number {
    if (mode === 'ssl') return 465;
    if (mode === 'starttls') return 587;
    return 25;
}

/** Reverse mapping: a port → its conventional encryption mode.
 *  Used to seed the encryption select from a loaded {host, port}. */
export function encryptionFromPort(
    port: number | null,
    tls: boolean
): 'none' | 'starttls' | 'ssl' {
    if (port === 465) return 'ssl';
    if (!tls) return 'none';
    return 'starttls';
}

/** Strict port-only parser — accepts ":NNN" prefix from the lastIndexOf
 *  split. Rejects non-numeric, out-of-range, leading-zero noise. */
function parsePortTail(tail: string): number | null {
    if (!tail.startsWith(':')) return null;
    const digits = tail.slice(1);
    if (digits.length === 0) return null;
    if (!/^\d+$/.test(digits)) return null;
    const n = Number.parseInt(digits, 10);
    if (!Number.isInteger(n)) return null;
    if (n < 1 || n > 65535) return null;
    return n;
}

/** True when the port is one of the conventional SMTP ports — a hint for
 *  the UI to suppress the "unusual port" warning. */
export function isCommonSmtpPort(port: number | null): boolean {
    return port !== null && COMMON_SMTP_PORTS.has(port);
}

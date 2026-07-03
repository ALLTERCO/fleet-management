// DKIM alignment enforcer. The signing domain (dkim.domainName) must
// equal the `from` address domain or be a parent of it — otherwise
// recipient DMARC checks reject the mail.

import RpcError from '../../rpc/RpcError';

function domainOf(address: string): string | undefined {
    const at = address.lastIndexOf('@');
    if (at < 0 || at === address.length - 1) return undefined;
    return address.slice(at + 1).toLowerCase();
}

export function enforceDkimAlignment(config: unknown): void {
    if (!config || typeof config !== 'object') return;
    const rec = config as Record<string, unknown>;
    const dkim = rec.dkim;
    if (!dkim || typeof dkim !== 'object') return;
    const domainName = (dkim as Record<string, unknown>).domainName;
    const from = rec.from;
    if (typeof domainName !== 'string' || typeof from !== 'string') return;
    const fromDomain = domainOf(from);
    if (!fromDomain) return;
    const signDomain = domainName.toLowerCase();
    const aligned =
        fromDomain === signDomain || fromDomain.endsWith(`.${signDomain}`);
    if (!aligned) {
        throw RpcError.InvalidParams(
            `DKIM domain "${domainName}" must match the "from" address domain "${fromDomain}" or be a parent of it (e.g. set dkim.domainName to "${fromDomain}" for strict alignment).`
        );
    }
}

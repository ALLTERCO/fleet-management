// Chokepoint for redacting + length-capping error strings before they
// hit audit_log / delivery_attempts. Single home, applied at every write.

const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const AUTH_SCHEME =
    /(authorization|x-auth-token)\s*:\s*(?:bearer|basic|token)\s+\S+/gi;
const AUTH_FALLBACK = /(authorization|x-auth-token)\s*:\s*[^\s,]+/gi;
const COOKIE_HEADER = /((?:^|\s)(?:set-)?cookie)\s*:\s*[^\r\n]+/gi;
const QUERY_SECRET =
    /([?&](?:token|secret|key|api[_-]?key|password|pass|sig|signature)=)[^&\s"']+/gi;
const SMTP_PASSWORD = /(["']?password["']?\s*[:=]\s*["']?)[^"',\s)}]+/gi;

export function redactSecretsFromErrorMessage(input: string): string {
    if (!input) return input;
    return input
        .replace(URL_USERINFO, '$1<redacted>@')
        .replace(AUTH_SCHEME, '$1: <redacted>')
        .replace(AUTH_FALLBACK, '$1: <redacted>')
        .replace(COOKIE_HEADER, '$1: <redacted>')
        .replace(QUERY_SECRET, '$1<redacted>')
        .replace(SMTP_PASSWORD, '$1<redacted>');
}

// Strips query+fragment from every URL. Catches S3 / SAS signed URLs.
export function redactUrlSecretsInErrorMessage(message: string): string {
    if (!message) return message;
    return message.replace(/https?:\/\/[^\s'"<>]+/g, (match) => {
        try {
            const parsed = new URL(match);
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        } catch {
            return match;
        }
    });
}

// URL strip → regex redact → length cap. maxChars <= 0 disables the cap.
export function sanitizeErrorMessageForPersistence(
    raw: string | null | undefined,
    maxChars: number
): string | null {
    if (!raw) return null;
    const redacted = redactSecretsFromErrorMessage(
        redactUrlSecretsInErrorMessage(raw)
    );
    if (maxChars <= 0 || redacted.length <= maxChars) return redacted;
    const marker = `…[truncated ${redacted.length - maxChars} chars]`;
    const keep = Math.max(0, maxChars - marker.length);
    return redacted.slice(0, keep) + marker;
}

// Recipient locale + per-locale template fallback.

export interface LocalizedTemplate {
    /** Default template, used when no locale-specific variant is set. */
    default: string;
    /** Per-IETF-tag overrides; e.g. {"de-DE": "...", "es": "..."}. */
    variants?: Record<string, string>;
}

// Pick the best template variant for the recipient locale. Falls back
// from "de-DE" → "de" → "default" so callers can ship only what's
// translated without breaking the chain.
export function selectTemplate(
    template: LocalizedTemplate | string,
    recipientLocale: string | null | undefined
): string {
    if (typeof template === 'string') return template;
    if (!recipientLocale) return template.default;
    const variants = template.variants ?? {};
    const exact = variants[recipientLocale];
    if (typeof exact === 'string' && exact.length > 0) return exact;
    const dashIndex = recipientLocale.indexOf('-');
    if (dashIndex > 0) {
        const language = recipientLocale.slice(0, dashIndex);
        const fallback = variants[language];
        if (typeof fallback === 'string' && fallback.length > 0) {
            return fallback;
        }
    }
    return template.default;
}

// SMS character set + segment counter. Operators bill per segment; we
// surface (used, segments) so renderers warn early. GSM-7 vs UCS-2 is
// chosen by whether every char is in the 128-character GSM-7 alphabet.

const GSM7_BASIC = new Set(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);
const GSM7_EXT = new Set('|^€{}[]~\\');

function isGsm7(message: string): boolean {
    for (const ch of message) {
        if (!GSM7_BASIC.has(ch) && !GSM7_EXT.has(ch)) return false;
    }
    return true;
}

function gsm7Length(message: string): number {
    let n = 0;
    for (const ch of message) n += GSM7_EXT.has(ch) ? 2 : 1;
    return n;
}

export interface SmsSegmentInfo {
    encoding: 'gsm7' | 'ucs2';
    /** Encoded character count (GSM-7 ext chars count as 2). */
    units: number;
    /** Number of network segments operator will bill for. */
    segments: number;
    /** Hard limit at which the renderer should truncate. */
    maxUnits: number;
}

export function smsSegmentInfo(message: string): SmsSegmentInfo {
    if (isGsm7(message)) {
        const units = gsm7Length(message);
        // 160 single, 153 per concatenated segment (UDH overhead).
        if (units <= 160) {
            return {encoding: 'gsm7', units, segments: 1, maxUnits: 160};
        }
        const segments = Math.ceil(units / 153);
        return {encoding: 'gsm7', units, segments, maxUnits: 153 * segments};
    }
    // UCS-2: 70 single, 67 per concatenated segment.
    const units = [...message].length;
    if (units <= 70) {
        return {encoding: 'ucs2', units, segments: 1, maxUnits: 70};
    }
    const segments = Math.ceil(units / 67);
    return {encoding: 'ucs2', units, segments, maxUnits: 67 * segments};
}

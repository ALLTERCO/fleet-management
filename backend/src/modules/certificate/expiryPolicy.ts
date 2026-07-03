import {envStr} from '../../config/envReader';

const MS_PER_DAY = 86_400_000;

export function certificateExpiryWarnDays(): number[] {
    const raw = envStr('FM_CERT_EXPIRY_WARN_DAYS', '30,14,7');
    return raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => right - left);
}

export function daysUntilCertificateExpiry(
    notAfter: Date | string | null
): number | null {
    if (!notAfter) return null;
    const timestamp = new Date(notAfter).getTime();
    if (Number.isNaN(timestamp)) return null;
    return Math.ceil((timestamp - Date.now()) / MS_PER_DAY);
}

export function certificateExpiryThresholdCrossed(
    daysLeft: number,
    thresholds: readonly number[]
): number | null {
    for (const threshold of thresholds) {
        if (daysLeft <= threshold) return threshold;
    }
    return null;
}

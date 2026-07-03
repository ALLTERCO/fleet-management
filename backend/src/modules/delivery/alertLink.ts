// Shared "Open alert" link helper. One env, every adapter.

import {envStr} from '../../config/envReader';

export function alertLinkBase(): string {
    return envStr('FM_ALERT_LINK_BASE', '');
}

export function alertHref(alertId: number | null | undefined): string {
    const base = alertLinkBase();
    if (!base || alertId == null) return '';
    return `${base.replace(/\/+$/, '')}/${alertId}`;
}

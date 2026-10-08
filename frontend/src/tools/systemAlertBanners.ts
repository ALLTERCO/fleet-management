// Turns system health alerts into top banners. Wired once at app boot from
// main.ts. Active alerts are shown after login; new ones arrive over the
// socket; a resolved alert takes its banner away.

import type {Router} from 'vue-router';
import {ALERTS_PATH} from '@/constants';
import {clearSystemBanner, showSystemBanner} from '@/helpers/systemBanner';
import {type AlertInstance, useAlertsStore} from '@/stores/alerts';
import {useAuthStore} from '@/stores/auth';
import type {BannerSeverity} from '@/stores/banner';
import {onAlertEvent} from '@/tools/websocket';
import {ALERT_EVENT} from '@/tools/wsEvents';

/** Alert kinds the product raises about itself; each open one gets a banner. */
export const BANNER_RULE_KINDS: ReadonlySet<string> = new Set([
    'system_health'
]);

interface AlertWsParams {
    readonly alertId?: number;
    readonly ruleKind?: string;
    readonly state?: string;
}

function bannerId(alertId: number): string {
    return `alert:${alertId}`;
}

function severityOf(value: string | undefined): BannerSeverity {
    if (value === 'critical') return 'critical';
    if (value === 'info') return 'info';
    return 'warning';
}

export function showAlertBanner(
    instance: AlertInstance,
    open: (id: number) => void
): void {
    showSystemBanner({
        id: bannerId(Number(instance.id)),
        severity: severityOf(instance.severity),
        title: instance.title,
        message: instance.message,
        actionLabel: 'Open',
        onAction: () => open(Number(instance.id)),
        since: new Date(instance.activeSince).getTime()
    });
}

async function showActiveBanners(open: (id: number) => void): Promise<void> {
    const alerts = useAlertsStore();
    await alerts.fetchInstances({state: 'active'}, {failureMode: 'throw'});
    for (const instance of Object.values(alerts.instances)) {
        if (instance.state !== 'active') continue;
        if (!BANNER_RULE_KINDS.has(instance.ruleKind)) continue;
        showAlertBanner(instance, open);
    }
}

export function initSystemAlertBanners(router: Router): void {
    const auth = useAuthStore();
    const alerts = useAlertsStore();
    const open = (id: number) => {
        void router.push({path: ALERTS_PATH, query: {instance: String(id)}});
    };

    let shownForSession = false;
    auth.$subscribe(() => {
        if (!auth.permissionsLoaded || shownForSession) return;
        shownForSession = true;
        showActiveBanners(open).catch(() => {
            // The socket event path still delivers new alerts.
            shownForSession = false;
        });
    });

    onAlertEvent((event) => {
        const params = event.params as AlertWsParams;
        if (!params.alertId || !BANNER_RULE_KINDS.has(params.ruleKind ?? '')) {
            return;
        }
        if (
            event.method === ALERT_EVENT.RESOLVED ||
            params.state === 'resolved'
        ) {
            clearSystemBanner(bannerId(params.alertId));
            return;
        }
        if (event.method !== ALERT_EVENT.CREATED) return;
        void alerts.fetchInstance(params.alertId).then((instance) => {
            if (instance && instance.state === 'active') {
                showAlertBanner(instance, open);
            }
        });
    });
}

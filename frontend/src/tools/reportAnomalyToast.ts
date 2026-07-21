// Subscribes to Report.Anomaly server-push events and surfaces them as
// toasts. Wired once at app boot from main.ts.

import {useToastStore} from '@/stores/toast';
import {onReportEvent} from '@/tools/websocket';
import {REPORT_EVENT} from '@/tools/wsEvents';

interface AnomalyParams {
    readonly kind?: string;
    readonly severity?: 'info' | 'warning' | 'critical';
    readonly title?: string;
    readonly detail?: string;
}

export function initReportAnomalyToasts(): void {
    const toast = useToastStore();
    onReportEvent((event) => {
        if (event.method !== REPORT_EVENT.ANOMALY) return;
        showAnomalyToast(toast, event.params as AnomalyParams);
    });
}

function showAnomalyToast(
    toast: ReturnType<typeof useToastStore>,
    params: AnomalyParams
): void {
    const title = params.title?.trim();
    if (!title) return;
    const message = params.detail ? `${title} — ${params.detail}` : title;
    const type = severityToToastType(params.severity);
    toast.addToast({type, message});
}

function severityToToastType(
    severity?: 'info' | 'warning' | 'critical'
): 'info' | 'warning' | 'error' {
    if (severity === 'critical') return 'error';
    if (severity === 'warning') return 'warning';
    return 'info';
}

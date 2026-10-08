export type AccessLogLevel = 'info' | 'warn' | 'error';

export const HTTP_ACCESS_LOG_STATUS_RULES = [
    {from: 400, to: 499, level: 'warn'},
    {from: 500, to: 599, level: 'error'}
];

export function accessLogLevelForStatus(statusCode: number): AccessLogLevel {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 300) return 'warn';
    return 'info';
}

// A webhook may carry its secret as ?token=, so its query never reaches a log.
function withoutHookQuery(url: string): string {
    return url.startsWith('/automation-hooks/') ? url.split('?')[0]! : url;
}

export function sanitizeAccessLogUrl(url: string): string {
    return withoutHookQuery(url).replace(
        /^\/api\/tariff\/live\/[^/?#]+(?=$|[/?#])/,
        '/api/tariff/live/[redacted]'
    );
}

export function accessLogOptions() {
    return {
        level: 'auto',
        format: (req: any, res: any) => {
            const status = res.__statusCode || res.statusCode;
            const url = sanitizeAccessLogUrl(req.originalUrl || req.url || '');
            return `${status} ${req.method} ${url}`;
        },
        nolog: ['/health', '/metrics'],
        statusRules: HTTP_ACCESS_LOG_STATUS_RULES
    };
}

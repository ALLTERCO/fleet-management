import {requirePublicWsBaseUrl} from './publicWsBaseUrl';

export function plainServerUrl(reportedExternalId: string): string {
    return `${requirePublicWsBaseUrl()}?id=${encodeURIComponent(reportedExternalId)}`;
}

// The token rides in the address because Shelly outbound WS has no auth header.
export function tokenServerUrl(
    reportedExternalId: string,
    token: string
): string {
    return `${plainServerUrl(reportedExternalId)}&token=${encodeURIComponent(token)}`;
}

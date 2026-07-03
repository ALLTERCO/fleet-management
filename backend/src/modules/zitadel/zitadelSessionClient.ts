// Zitadel session + auth-method-type queries. Free functions over the facade's
// http context so a swapped `request` on the singleton stays visible.

import {zitadelListPageSize} from '../../config/zitadel';
import {
    validateId,
    type ZitadelHttpContext,
    zitadelLogger
} from './zitadelHttp';

const logger = zitadelLogger;

export interface ZitadelSession {
    id: string;
    creationDate?: string;
    changeDate?: string;
    expirationDate?: string;
    user?: {
        id: string;
        loginName?: string;
        displayName?: string;
        organizationId?: string;
    };
    factors: {
        password: boolean;
        webAuthN: boolean;
        totp: boolean;
        otpSms: boolean;
        otpEmail: boolean;
        intent: boolean;
        recoveryCode: boolean;
    };
    userAgent?: {
        fingerprintId?: string;
        ip?: string;
        description?: string;
    };
}

export async function listSessions(
    svc: ZitadelHttpContext,
    userId?: string
): Promise<ZitadelSession[]> {
    if (!svc.isConfigured()) return [];
    const body: Record<string, unknown> = {
        query: {limit: zitadelListPageSize()}
    };
    if (userId) {
        body.queries = [{userIdQuery: {id: userId}}];
    }
    const response = await svc.request<{
        sessions?: Array<{
            id: string;
            creationDate?: string;
            changeDate?: string;
            expirationDate?: string;
            factors?: {
                user?: {
                    id: string;
                    loginName?: string;
                    displayName?: string;
                    organizationId?: string;
                };
                password?: {verifiedAt?: string};
                webAuthN?: {verifiedAt?: string};
                totp?: {verifiedAt?: string};
                otpSms?: {verifiedAt?: string};
                otpEmail?: {verifiedAt?: string};
                intent?: {verifiedAt?: string};
                recoveryCode?: {verifiedAt?: string};
            };
            userAgent?: {
                fingerprintId?: string;
                ip?: string;
                description?: string;
            };
        }>;
    }>('POST', '/v2/sessions/search', body);
    return (response.sessions ?? []).map((s) => ({
        id: s.id,
        creationDate: s.creationDate,
        changeDate: s.changeDate,
        expirationDate: s.expirationDate,
        user: s.factors?.user,
        factors: {
            password: !!s.factors?.password?.verifiedAt,
            webAuthN: !!s.factors?.webAuthN?.verifiedAt,
            totp: !!s.factors?.totp?.verifiedAt,
            otpSms: !!s.factors?.otpSms?.verifiedAt,
            otpEmail: !!s.factors?.otpEmail?.verifiedAt,
            intent: !!s.factors?.intent?.verifiedAt,
            recoveryCode: !!s.factors?.recoveryCode?.verifiedAt
        },
        userAgent: s.userAgent
    }));
}

export async function deleteSession(
    svc: ZitadelHttpContext,
    sessionId: string
): Promise<void> {
    validateId(sessionId, 'sessionId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');
    await svc.request('DELETE', `/v2/sessions/${sessionId}`);
    logger.info('Deleted session %s', sessionId);
}

export async function listAuthenticationMethodTypes(
    svc: ZitadelHttpContext,
    userId: string
): Promise<{authMethodTypes: string[]}> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) return {authMethodTypes: []};
    const response = await svc.request<{authMethodTypes?: string[]}>(
        'GET',
        `/v2/users/${userId}/authentication_methods`
    );
    return {authMethodTypes: response.authMethodTypes ?? []};
}

export async function listPasskeys(
    svc: ZitadelHttpContext,
    userId: string
): Promise<Array<{id: string; name?: string; state?: string}>> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) return [];
    const response = await svc.request<{
        result?: Array<{id: string; name?: string; state?: string}>;
    }>('POST', `/v2/users/${userId}/passkeys/_search`, {});
    return response.result ?? [];
}

export async function listIDPLinks(
    svc: ZitadelHttpContext,
    userId: string
): Promise<Array<{idpId: string; userId: string; userName?: string}>> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) return [];
    const response = await svc.request<{
        result?: Array<{idpId: string; userId: string; userName?: string}>;
    }>('POST', `/v2/users/${userId}/links/_search`, {});
    return response.result ?? [];
}

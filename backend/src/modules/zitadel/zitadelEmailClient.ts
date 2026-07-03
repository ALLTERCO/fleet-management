// Zitadel SMTP settings + email-provider administration. Free functions over
// the facade's http context. `findSmtpEmailProvider` stays a facade method so
// callers can swap it; the public ops route through `svc.findSmtpEmailProvider`.

import RpcError from '../../rpc/RpcError';
import type {
    IdentitySetSmtpSettingsParams,
    IdentitySmtpSettings,
    IdentityTestSmtpSettingsParams
} from '../../types/api/identity';
import {
    assertSmtpPasswordAvailableForCreate,
    buildSmtpProviderPayload,
    emptyIdentitySmtpSettings,
    isActiveEmailProviderState,
    isSavedProviderOnlyTestRequest,
    mapZitadelSmtpProvider,
    type ZitadelEmailProvider,
    type ZitadelEmailProviderCreateResponse,
    type ZitadelEmailProviderListResponse
} from './identitySmtpProvider';
import type {ZitadelHttpContext} from './zitadelHttp';

// `findSmtpEmailProvider` is a swappable facade method, not a plain client fn.
type EmailFacade = ZitadelHttpContext & {
    findSmtpEmailProvider(): Promise<ZitadelEmailProvider | null>;
};

export async function getIdentitySmtpSettings(
    svc: EmailFacade
): Promise<IdentitySmtpSettings> {
    if (!svc.isConfigured()) return emptyIdentitySmtpSettings();

    const provider = await svc.findSmtpEmailProvider();
    if (!provider?.smtp) return emptyIdentitySmtpSettings();

    return mapZitadelSmtpProvider(provider);
}

export async function setIdentitySmtpSettings(
    svc: EmailFacade,
    params: IdentitySetSmtpSettingsParams
): Promise<void> {
    if (!svc.isConfigured()) return;

    const existing = await svc.findSmtpEmailProvider();
    if (!params.enabled) {
        if (existing?.id) {
            await svc.request(
                'POST',
                `/admin/v1/email/${encodeURIComponent(existing.id)}/_deactivate`
            );
        }
        return;
    }

    const existingSmtpId = existing?.smtp ? existing.id : undefined;
    assertSmtpPasswordAvailableForCreate(!!existingSmtpId, params);
    const payload = buildSmtpProviderPayload(params);
    const shouldActivate =
        !existingSmtpId || !isActiveEmailProviderState(existing?.state);
    const providerId =
        typeof existingSmtpId === 'string'
            ? await updateIdentitySmtpProvider(svc, existingSmtpId, payload)
            : await createIdentitySmtpProvider(svc, payload);

    if (!shouldActivate) return;
    await svc.request(
        'POST',
        `/admin/v1/email/${encodeURIComponent(providerId)}/_activate`
    );
}

export async function testIdentitySmtpSettings(
    svc: ZitadelHttpContext,
    params: IdentityTestSmtpSettingsParams
): Promise<void> {
    if (!svc.isConfigured()) return;
    if (isSavedProviderOnlyTestRequest(params)) {
        throw RpcError.InvalidParams(
            'Identity SMTP test requires SMTP password. Re-enter the password and test the draft provider settings.'
        );
    }
    const payload = buildSmtpProviderPayload(params);
    await svc.request('POST', '/admin/v1/email/smtp/_test', payload);
}

export async function findSmtpEmailProvider(
    svc: ZitadelHttpContext
): Promise<ZitadelEmailProvider | null> {
    const providers = await listEmailProviders(svc);
    return (
        providers.find(
            (provider) =>
                !!provider.smtp && isActiveEmailProviderState(provider.state)
        ) ??
        providers.find((provider) => provider.smtp) ??
        null
    );
}

async function listEmailProviders(
    svc: ZitadelHttpContext
): Promise<ZitadelEmailProvider[]> {
    const response = await svc.request<ZitadelEmailProviderListResponse>(
        'POST',
        '/admin/v1/email/_search',
        {}
    );
    return response.result ?? response.configs ?? [];
}

async function createIdentitySmtpProvider(
    svc: ZitadelHttpContext,
    payload: Record<string, unknown>
): Promise<string> {
    const result = await svc.request<ZitadelEmailProviderCreateResponse>(
        'POST',
        '/admin/v1/email/smtp',
        payload
    );
    if (!result.id) {
        throw RpcError.Unavailable(
            'zitadel',
            'SMTP provider creation returned no provider id'
        );
    }
    return result.id;
}

async function updateIdentitySmtpProvider(
    svc: ZitadelHttpContext,
    id: string,
    payload: Record<string, unknown>
): Promise<string> {
    await svc.request(
        'PUT',
        `/admin/v1/email/smtp/${encodeURIComponent(id)}`,
        payload
    );
    return id;
}

// Zitadel Action V2 targets/event-executions + external identity providers
// (instance scope). Free functions over the facade's http context.

import {validateId, type ZitadelHttpContext} from './zitadelHttp';

// Sibling calls route back through the facade so swapped methods stay visible.
type IdpFacade = ZitadelHttpContext & {
    searchAllActionTargets(
        name: string
    ): Promise<Array<{id: string; name: string}>>;
};

export async function searchActionTarget(
    svc: IdpFacade,
    name: string
): Promise<{id: string; name: string} | null> {
    const all = await svc.searchAllActionTargets(name);
    return all[0] ?? null;
}

export async function searchAllActionTargets(
    svc: ZitadelHttpContext,
    name: string
): Promise<Array<{id: string; name: string}>> {
    if (!svc.isConfigured()) return [];
    const res = await svc.request<{
        targets?: Array<{id: string; name: string}>;
    }>('POST', '/v2beta/actions/targets/search', {
        filters: [
            {
                targetNameFilter: {
                    targetName: name,
                    method: 'TEXT_FILTER_METHOD_EQUALS'
                }
            }
        ]
    });
    return res.targets ?? [];
}

export async function createActionTarget(
    svc: ZitadelHttpContext,
    spec: {
        name: string;
        endpoint: string;
        timeout: string;
        interruptOnError?: boolean;
    }
): Promise<{id: string; signingKey: string}> {
    if (!svc.isConfigured()) throw new Error('Zitadel service not configured');
    const res = await svc.request<{id: string; signingKey: string}>(
        'POST',
        '/v2beta/actions/targets',
        {
            name: spec.name,
            endpoint: spec.endpoint,
            timeout: spec.timeout,
            restCall: {interruptOnError: spec.interruptOnError ?? false}
        }
    );
    if (!res.id || !res.signingKey)
        throw new Error('Zitadel target create returned no id/signingKey');
    return res;
}

export async function deleteActionTarget(
    svc: ZitadelHttpContext,
    id: string
): Promise<void> {
    if (!svc.isConfigured()) return;
    await svc.request('DELETE', `/v2beta/actions/targets/${id}`);
}

export async function bindEventExecution(
    svc: ZitadelHttpContext,
    event: string,
    targetId: string
): Promise<void> {
    if (!svc.isConfigured()) return;
    await svc.request('PUT', '/v2beta/actions/executions', {
        condition: {event: {event}},
        targets: [targetId]
    });
}

export async function listIdentityProviders(
    svc: ZitadelHttpContext
): Promise<Array<{id: string; name: string; type: string; state: string}>> {
    if (!svc.isConfigured()) return [];
    const res = await svc.request<{
        result?: Array<{
            id: string;
            name?: string;
            type?: string;
            state?: string;
        }>;
    }>('POST', '/admin/v1/idps/_search', {});
    return (res.result ?? []).map((idp) => ({
        id: idp.id,
        name: idp.name ?? '',
        type: idp.type ?? '',
        state: idp.state ?? ''
    }));
}

export async function addOidcIdentityProvider(
    svc: ZitadelHttpContext,
    spec: {
        name: string;
        issuer: string;
        clientId: string;
        clientSecret: string;
        scopes?: string[];
        autoCreation?: boolean;
    }
): Promise<{id: string}> {
    if (!svc.isConfigured()) throw new Error('Zitadel service not configured');
    // Field names match Zitadel admin v1 AddOIDCIDPRequest proto
    // (zitadel/admin.proto v4.14): styling_type, client_id/secret,
    // display_name_mapping, username_mapping (snake → JSON camelCase),
    // auto_register controls whether unknown users are created on
    // first sign-in.
    const res = await svc.request<{idpId?: string; id?: string}>(
        'POST',
        '/admin/v1/idps/oidc',
        {
            name: spec.name,
            issuer: spec.issuer,
            clientId: spec.clientId,
            clientSecret: spec.clientSecret,
            scopes: spec.scopes ?? ['openid', 'profile', 'email'],
            stylingType: 'STYLING_TYPE_UNSPECIFIED',
            displayNameMapping: 'OIDC_MAPPING_FIELD_PREFERRED_USERNAME',
            usernameMapping: 'OIDC_MAPPING_FIELD_PREFERRED_USERNAME',
            autoRegister: spec.autoCreation ?? true
        }
    );
    const id = res.idpId ?? res.id;
    if (!id) throw new Error('Zitadel addOIDCIdp returned no id');
    return {id};
}

export async function deleteIdentityProvider(
    svc: ZitadelHttpContext,
    id: string
): Promise<void> {
    validateId(id, 'idpId');
    if (!svc.isConfigured()) return;
    await svc.request('DELETE', `/admin/v1/idps/${id}`);
}

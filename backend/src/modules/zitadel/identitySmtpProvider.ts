import RpcError from '../../rpc/RpcError';
import type {
    IdentitySetSmtpSettingsParams,
    IdentitySmtpSettings,
    IdentityTestSmtpSettingsParams
} from '../../types/api/identity';

export interface ZitadelEmailProvider {
    id?: string;
    state?: string;
    description?: string;
    smtp?: {
        host?: string;
        senderAddress?: string;
        senderName?: string;
        tls?: boolean;
        user?: string;
        replyToAddress?: string;
    };
    http?: unknown;
}

export interface ZitadelEmailProviderListResponse {
    result?: ZitadelEmailProvider[];
    configs?: ZitadelEmailProvider[];
}

export interface ZitadelEmailProviderCreateResponse {
    id?: string;
}

export function emptyIdentitySmtpSettings(): IdentitySmtpSettings {
    return {
        enabled: false,
        configured: false,
        authMode: 'none',
        host: '',
        senderAddress: '',
        senderName: '',
        tls: false,
        passwordSet: false
    };
}

export function mapZitadelSmtpProvider(
    provider: ZitadelEmailProvider
): IdentitySmtpSettings {
    const smtp = provider.smtp;
    if (!smtp) return emptyIdentitySmtpSettings();
    return {
        enabled: isActiveEmailProviderState(provider.state),
        configured: true,
        id: provider.id,
        state: provider.state,
        authMode: smtp.user ? 'plain' : 'none',
        host: smtp.host ?? '',
        senderAddress: smtp.senderAddress ?? '',
        senderName: smtp.senderName ?? '',
        tls: !!smtp.tls,
        user: smtp.user,
        replyToAddress: smtp.replyToAddress,
        description: provider.description,
        passwordSet: !!smtp.user
    };
}

export function isActiveEmailProviderState(state: unknown): boolean {
    if (typeof state === 'number') return state === 1;
    if (typeof state !== 'string') return false;

    return (
        state === '1' ||
        state === 'EMAIL_PROVIDER_STATE_ACTIVE' ||
        state === 'EMAIL_PROVIDER_ACTIVE' ||
        state === 'ACTIVE'
    );
}

export function buildSmtpProviderPayload(
    params: IdentitySetSmtpSettingsParams | IdentityTestSmtpSettingsParams
): Record<string, unknown> {
    const base = smtpProviderBase(params);
    return params.authMode === 'plain'
        ? {...base, plain: {}}
        : {...base, none: {}};
}

export function assertSmtpPasswordAvailableForCreate(
    hasExistingSmtpProvider: boolean,
    params: IdentitySetSmtpSettingsParams
): void {
    if (hasExistingSmtpProvider || params.authMode !== 'plain') return;

    assertSmtpField(params.password, 'password');
}

export function isSavedProviderOnlyTestRequest(
    params: IdentityTestSmtpSettingsParams
): params is IdentityTestSmtpSettingsParams & {id: string} {
    return (
        typeof params.id === 'string' &&
        params.id.length > 0 &&
        params.host === undefined &&
        params.senderAddress === undefined &&
        params.senderName === undefined
    );
}

function smtpProviderBase(
    params: IdentitySetSmtpSettingsParams | IdentityTestSmtpSettingsParams
): Record<string, unknown> {
    assertSmtpField(params.host, 'host');
    assertSmtpField(params.senderAddress, 'senderAddress');
    assertSmtpField(params.senderName, 'senderName');
    assertSmtpAuth(params);

    return compactObject({
        id: 'id' in params ? params.id : undefined,
        host: params.host,
        senderAddress: params.senderAddress,
        senderName: params.senderName,
        tls: params.tls ?? false,
        user: params.authMode === 'plain' ? params.user : undefined,
        password: params.authMode === 'plain' ? params.password : undefined,
        replyToAddress:
            'replyToAddress' in params ? params.replyToAddress : undefined,
        description: 'description' in params ? params.description : undefined,
        receiverAddress:
            'receiverAddress' in params ? params.receiverAddress : undefined
    });
}

function assertSmtpField(
    value: unknown,
    field: string
): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw RpcError.InvalidParams(`Identity SMTP ${field} is required`);
    }
}

function assertSmtpAuth(
    params: IdentitySetSmtpSettingsParams | IdentityTestSmtpSettingsParams
): void {
    if (params.authMode === 'plain') {
        assertSmtpField(params.user, 'user');
    }
}

function compactObject(
    value: Record<string, unknown>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    );
}

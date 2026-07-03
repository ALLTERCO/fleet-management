// Zitadel org-branding + policy administration: label/privacy/mail-template/
// notification/domain/login-text/message-text policies, restrictions, instance
// info, and identity-policy reads. Free functions over the facade's http context.

import {zitadelHttpTimeoutMs, zitadelListPageSize} from '../../config/zitadel';
import RpcError from '../../rpc/RpcError';
import {DOMAIN_ERRORS} from '../../types/api/errors';
import {sanitizeErrorMessageForPersistence} from '../util/sanitizeErrorMessage';
import {
    validateId,
    type ZitadelHttpContext,
    zitadelLogger
} from './zitadelHttp';

const logger = zitadelLogger;

// Friendly enum -> Zitadel URL fragment for /text/message/<fragment>/<lang>.
// The fragments come from proto/zitadel/management.proto in v4.14.0; the
// inconsistency between concatenated (`verifyemail`) and underscored
// (`password_change`) names is Zitadel's, not ours.
const MESSAGE_TYPE_PATH: Record<string, string> = {
    init: 'init',
    password_reset: 'passwordreset',
    verify_email: 'verifyemail',
    verify_phone: 'verifyphone',
    verify_sms_otp: 'verifysmsotp',
    verify_email_otp: 'verifyemailotp',
    domain_claimed: 'domainclaimed',
    passwordless_registration: 'passwordless_registration',
    password_change: 'password_change',
    invite_user: 'invite_user'
};

// BCP-47-ish guard: 2-10 letters/hyphens. Callers decide how to react.
function isValidLanguageCode(language: string): boolean {
    return /^[a-zA-Z-]{2,10}$/.test(language);
}

export async function getInstanceInfo(svc: ZitadelHttpContext): Promise<{
    customDomains: Array<{domain: string; instanceId?: string}>;
    trustedDomains: Array<{domain: string; instanceId?: string}>;
}> {
    if (!svc.isConfigured()) {
        return {customDomains: [], trustedDomains: []};
    }
    const customs = await svc.request<{
        domains?: Array<{domain: string; instanceId?: string}>;
    }>('POST', '/zitadel.instance.v2.InstanceService/ListCustomDomains', {
        pagination: {limit: zitadelListPageSize()}
    });
    const trusted = await svc.request<{
        trustedDomains?: Array<{domain: string; instanceId?: string}>;
    }>('POST', '/zitadel.instance.v2.InstanceService/ListTrustedDomains', {
        pagination: {limit: zitadelListPageSize()}
    });
    return {
        customDomains: customs.domains ?? [],
        trustedDomains: trusted.trustedDomains ?? []
    };
}

export async function getIdentityPolicies(svc: ZitadelHttpContext): Promise<{
    login: Record<string, unknown> | null;
    passwordComplexity: Record<string, unknown> | null;
    passwordExpiry: Record<string, unknown> | null;
    lockout: Record<string, unknown> | null;
    security: Record<string, unknown> | null;
    branding: Record<string, unknown> | null;
    identityProviders: Array<Record<string, unknown>> | null;
}> {
    if (!svc.isConfigured()) {
        return {
            login: null,
            passwordComplexity: null,
            passwordExpiry: null,
            lockout: null,
            security: null,
            branding: null,
            identityProviders: null
        };
    }
    // Return null on failure so the UI distinguishes a fetch error
    // (permission/network/regression) from an explicitly empty config.
    const safe = async <T>(path: string): Promise<T | null> => {
        try {
            return await svc.request<T>('GET', path);
        } catch (err) {
            logger.warn('settings %s failed: %s', path, err);
            return null;
        }
    };
    const [
        login,
        passwordComplexity,
        passwordExpiry,
        lockout,
        security,
        branding,
        idps
    ] = await Promise.all([
        safe<Record<string, unknown>>('/v2/settings/login'),
        safe<Record<string, unknown>>('/v2/settings/password/complexity'),
        safe<Record<string, unknown>>('/v2/settings/password/expiry'),
        safe<Record<string, unknown>>('/v2/settings/lockout'),
        safe<Record<string, unknown>>('/v2/settings/security'),
        safe<Record<string, unknown>>('/v2/settings/branding'),
        safe<{identityProviders?: Array<Record<string, unknown>>}>(
            '/v2/settings/login/idps'
        )
    ]);
    return {
        login,
        passwordComplexity,
        passwordExpiry,
        lockout,
        security,
        branding,
        identityProviders: idps === null ? null : (idps.identityProviders ?? [])
    };
}

/** Org-scoped label policy. Falls back to instance default if no override. */
export async function getLabelPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/management/v1/policies/label', undefined, {orgId});
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getLabelPolicy(%s) failed: %s', orgId, err);
        return null;
    }
}

/** Create-or-update the org's draft label policy. Caller must activate.
 *  Zitadel's GET returns the *effective* policy (org override OR inherited
 *  instance default). The `isDefault: true` flag means "no org override
 *  exists yet" — so we POST to create. Otherwise PUT to update. */
export async function setLabelPolicy(
    svc: ZitadelHttpContext,
    orgId: string,
    policy: {
        primaryColor?: string;
        warnColor?: string;
        backgroundColor?: string;
        fontColor?: string;
        primaryColorDark?: string;
        warnColorDark?: string;
        backgroundColorDark?: string;
        fontColorDark?: string;
        hideLoginNameSuffix?: boolean;
        disableWatermark?: boolean;
        themeMode?: 'THEME_MODE_AUTO' | 'THEME_MODE_LIGHT' | 'THEME_MODE_DARK';
    }
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const existing = await getLabelPolicy(svc, orgId);
    const hasCustom = existing !== null && existing.isDefault !== true;
    const verb = hasCustom ? 'PUT' : 'POST';
    await svc.request(verb, '/management/v1/policies/label', policy, {
        orgId
    });
}

/** Promote the draft label policy to live. */
export async function activateLabelPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request(
        'POST',
        '/management/v1/policies/label/_activate',
        {},
        {orgId}
    );
}

/** Drop org override → instance default takes over. */
export async function resetLabelPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request('DELETE', '/management/v1/policies/label', undefined, {
        orgId
    });
}

/** Read-only view of the unsaved draft policy (vs the live one). */
export async function getLabelPolicyPreview(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/management/v1/policies/label/_preview', undefined, {
            orgId
        });
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getLabelPolicyPreview(%s) failed: %s', orgId, err);
        return null;
    }
}

/** Read the platform's factory-default label policy. */
export async function getLabelPolicyDefault(
    svc: ZitadelHttpContext
): Promise<Record<string, unknown> | null> {
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/admin/v1/policies/label');
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getLabelPolicyDefault failed: %s', err);
        return null;
    }
}

/** Multipart logo upload (light or dark) for an org. */
export async function setLabelLogo(
    svc: ZitadelHttpContext,
    orgId: string,
    file: Buffer,
    contentType: string,
    theme: 'light' | 'dark'
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const path =
        theme === 'dark'
            ? '/assets/v1/org/policy/label/logo/dark'
            : '/assets/v1/org/policy/label/logo';
    await multipartUpload(
        svc,
        orgId,
        path,
        file,
        contentType,
        theme === 'dark' ? 'logo-dark' : 'logo'
    );
}

/** Drop the uploaded logo. */
export async function deleteLabelLogo(
    svc: ZitadelHttpContext,
    orgId: string,
    theme: 'light' | 'dark'
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const path =
        theme === 'dark'
            ? '/management/v1/policies/label/logo_dark'
            : '/management/v1/policies/label/logo';
    await svc.request('DELETE', path, undefined, {orgId});
}

async function multipartUpload(
    svc: ZitadelHttpContext,
    orgId: string,
    path: string,
    file: Buffer,
    contentType: string,
    filename: string
): Promise<void> {
    const ab = new ArrayBuffer(file.byteLength);
    new Uint8Array(ab).set(file);
    const form = new FormData();
    form.append('file', new Blob([ab], {type: contentType}), filename);
    const token = await svc.getServiceToken();
    const resp = await fetch(`${svc.baseUrl}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'x-zitadel-orgid': orgId
        },
        body: form,
        signal: AbortSignal.timeout(zitadelHttpTimeoutMs())
    });
    if (!resp.ok) {
        const text = await resp.text();
        const safeText = sanitizeErrorMessageForPersistence(text, 4_000) ?? '';
        throw RpcError.InvalidParams(
            `Zitadel asset upload failed: ${resp.status} ${safeText}`
        );
    }
}

/** Favicon-class image (light or dark). */
export async function setLabelIcon(
    svc: ZitadelHttpContext,
    orgId: string,
    file: Buffer,
    contentType: string,
    theme: 'light' | 'dark'
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const path =
        theme === 'dark'
            ? '/assets/v1/org/policy/label/icon/dark'
            : '/assets/v1/org/policy/label/icon';
    await multipartUpload(
        svc,
        orgId,
        path,
        file,
        contentType,
        theme === 'dark' ? 'icon-dark' : 'icon'
    );
}

export async function deleteLabelIcon(
    svc: ZitadelHttpContext,
    orgId: string,
    theme: 'light' | 'dark'
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const path =
        theme === 'dark'
            ? '/management/v1/policies/label/icon_dark'
            : '/management/v1/policies/label/icon';
    await svc.request('DELETE', path, undefined, {orgId});
}

/** Custom font (TTF). */
export async function setLabelFont(
    svc: ZitadelHttpContext,
    orgId: string,
    file: Buffer,
    contentType: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await multipartUpload(
        svc,
        orgId,
        '/assets/v1/org/policy/label/font',
        file,
        contentType,
        'font.ttf'
    );
}

export async function deleteLabelFont(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request(
        'DELETE',
        '/management/v1/policies/label/font',
        undefined,
        {orgId}
    );
}

/** Privacy / legal links policy (ToS, privacy, support, help, etc). */
export async function getPrivacyPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/management/v1/policies/privacy', undefined, {orgId});
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getPrivacyPolicy(%s) failed: %s', orgId, err);
        return null;
    }
}

export async function setPrivacyPolicy(
    svc: ZitadelHttpContext,
    orgId: string,
    policy: {
        tosLink?: string;
        privacyLink?: string;
        helpLink?: string;
        supportEmail?: string;
        docsLink?: string;
        customLink?: string;
        customLinkText?: string;
    }
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const existing = await getPrivacyPolicy(svc, orgId);
    const hasCustom = existing !== null && existing.isDefault !== true;
    const verb = hasCustom ? 'PUT' : 'POST';
    await svc.request(verb, '/management/v1/policies/privacy', policy, {
        orgId
    });
}

export async function resetPrivacyPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request('DELETE', '/management/v1/policies/privacy', undefined, {
        orgId
    });
}

/** Platform-default message text (read-only — what Zitadel ships with). */
export async function getMessageTextDefault(
    svc: ZitadelHttpContext,
    type: string,
    language: string
): Promise<Record<string, unknown> | null> {
    if (!svc.isConfigured()) return null;
    const fragment = MESSAGE_TYPE_PATH[type];
    if (!fragment) return null;
    if (!isValidLanguageCode(language)) return null;
    try {
        const resp = await svc.request<{
            customText?: Record<string, unknown>;
        }>(
            'GET',
            `/management/v1/text/default/message/${fragment}/${language}`
        );
        return resp.customText ?? null;
    } catch (err) {
        logger.warn(
            'getMessageTextDefault(%s,%s) failed: %s',
            type,
            language,
            err
        );
        return null;
    }
}

export async function getLoginTextDefault(
    svc: ZitadelHttpContext,
    language: string
): Promise<Record<string, unknown> | null> {
    if (!svc.isConfigured()) return null;
    if (!isValidLanguageCode(language)) return null;
    try {
        const resp = await svc.request<{
            customText?: Record<string, unknown>;
        }>('GET', `/management/v1/text/default/login/${language}`);
        return resp.customText ?? null;
    } catch (err) {
        logger.warn('getLoginTextDefault(%s) failed: %s', language, err);
        return null;
    }
}

/** Per-language email/SMS message text. type ∈ init|password_reset|verify_email|... */
export async function getMessageText(
    svc: ZitadelHttpContext,
    orgId: string,
    type: string,
    language: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    const fragment = MESSAGE_TYPE_PATH[type];
    if (!fragment) {
        throw RpcError.InvalidParams(`unknown message type: ${type}`);
    }
    if (!isValidLanguageCode(language)) {
        throw RpcError.InvalidParams('bad language code');
    }
    try {
        const resp = await svc.request<{
            customText?: Record<string, unknown>;
        }>(
            'GET',
            `/management/v1/text/message/${fragment}/${language}`,
            undefined,
            {orgId}
        );
        return resp.customText ?? null;
    } catch (err) {
        logger.warn(
            'getMessageText(%s,%s,%s) failed: %s',
            orgId,
            type,
            language,
            err
        );
        return null;
    }
}

export async function setMessageText(
    svc: ZitadelHttpContext,
    orgId: string,
    type: string,
    language: string,
    body: Record<string, unknown>
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const fragment = MESSAGE_TYPE_PATH[type];
    if (!fragment) {
        throw RpcError.InvalidParams(`unknown message type: ${type}`);
    }
    if (!isValidLanguageCode(language)) {
        throw RpcError.InvalidParams('bad language code');
    }
    await svc.request(
        'PUT',
        `/management/v1/text/message/${fragment}/${language}`,
        body,
        {orgId}
    );
}

export async function resetMessageText(
    svc: ZitadelHttpContext,
    orgId: string,
    type: string,
    language: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const fragment = MESSAGE_TYPE_PATH[type];
    if (!fragment) return;
    if (!isValidLanguageCode(language)) return;
    await svc.request(
        'DELETE',
        `/management/v1/text/message/${fragment}/${language}`,
        undefined,
        {orgId}
    );
}

/** Custom HTML email scaffold per org. Replaces Zitadel's default
 *  email template wholesale. Body is HTML with Go-template
 *  placeholders ({{.Title}}, {{.Greeting}}, {{.Text}}, {{.URL}},
 *  {{.ButtonText}}, {{.PrimaryColor}}, {{.LogoURL}}, etc.). Set
 *  empty / reset to fall back to Zitadel's built-in template. */
export async function getCustomMailTemplate(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<{template: string; isDefault: boolean} | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            template?: {template?: string; isDefault?: boolean};
        }>('GET', '/management/v1/mail_template', undefined, {orgId});
        const t = resp.template;
        if (!t) return null;
        const decoded = Buffer.from(t.template ?? '', 'base64').toString(
            'utf8'
        );
        return {template: decoded, isDefault: t.isDefault ?? false};
    } catch (err) {
        // 404 = no custom template; other errors must propagate so the
        // UI doesn't show "using default" during an outage.
        if (
            err instanceof RpcError &&
            err.code === DOMAIN_ERRORS.ResourceNotFound.code
        )
            return null;
        throw err;
    }
}

export async function setCustomMailTemplate(
    svc: ZitadelHttpContext,
    orgId: string,
    html: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) {
        throw RpcError.Unavailable('zitadel', 'not configured');
    }
    const encoded = Buffer.from(html, 'utf8').toString('base64');
    await svc.request(
        'PUT',
        '/management/v1/mail_template',
        {template: encoded},
        {orgId}
    );
}

export async function resetCustomMailTemplate(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) {
        throw RpcError.Unavailable('zitadel', 'not configured');
    }
    await svc.request(
        'POST',
        '/management/v1/mail_template/_reset',
        {},
        {
            orgId
        }
    );
}

/** Per-language UI strings on every login screen.
 *  Read + write use the v2 Hosted Login Translation API (the V2 login
 *  app's i18n catalog, free-form translations object). Reset still uses
 *  the v1 management endpoint because v2 has no reset/delete operation.
 */
export async function getLoginText(
    svc: ZitadelHttpContext,
    orgId: string,
    language: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    if (!isValidLanguageCode(language)) {
        throw RpcError.InvalidParams('bad language code');
    }
    try {
        const qs = new URLSearchParams({
            organizationId: orgId,
            locale: language
        });
        const resp = await svc.request<{
            translations?: Record<string, unknown>;
            etag?: string;
        }>('GET', `/v2/settings/hosted_login_translation?${qs.toString()}`);
        return resp.translations ?? null;
    } catch (err) {
        logger.warn('getLoginText(%s,%s) failed: %s', orgId, language, err);
        return null;
    }
}

export async function setLoginText(
    svc: ZitadelHttpContext,
    orgId: string,
    language: string,
    body: Record<string, unknown>
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    if (!isValidLanguageCode(language)) {
        throw RpcError.InvalidParams('bad language code');
    }
    await svc.request('PUT', '/v2/settings/hosted_login_translation', {
        organizationId: orgId,
        locale: language,
        translations: body
    });
}

/** Notify user when their password is changed. */
export async function getNotificationPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/management/v1/policies/notification', undefined, {
            orgId
        });
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getNotificationPolicy(%s) failed: %s', orgId, err);
        return null;
    }
}

export async function setNotificationPolicy(
    svc: ZitadelHttpContext,
    orgId: string,
    policy: {passwordChange?: boolean}
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    const existing = await getNotificationPolicy(svc, orgId);
    const hasCustom = existing !== null && existing.isDefault !== true;
    const verb = hasCustom ? 'PUT' : 'POST';
    await svc.request(verb, '/management/v1/policies/notification', policy, {
        orgId
    });
}

export async function resetNotificationPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request(
        'DELETE',
        '/management/v1/policies/notification',
        undefined,
        {orgId}
    );
}

/** Instance-wide restrictions: disallow public org registration + cap allowed UI languages. */
export async function getRestrictions(
    svc: ZitadelHttpContext
): Promise<Record<string, unknown> | null> {
    if (!svc.isConfigured()) return null;
    try {
        return await svc.request<Record<string, unknown>>(
            'GET',
            '/admin/v1/restrictions'
        );
    } catch (err) {
        logger.warn('getRestrictions failed: %s', err);
        return null;
    }
}

export async function setRestrictions(
    svc: ZitadelHttpContext,
    body: {
        disallowPublicOrgRegistration?: boolean;
        allowedLanguages?: {list?: string[]};
    }
): Promise<void> {
    if (!svc.isConfigured()) return;
    await svc.request('PUT', '/admin/v1/restrictions', body);
}

/** Per-org domain policy override (custom). */
export async function getDomainPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<Record<string, unknown> | null> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/management/v1/policies/domain', undefined, {orgId});
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getDomainPolicy(%s) failed: %s', orgId, err);
        return null;
    }
}

export async function setDomainPolicy(
    svc: ZitadelHttpContext,
    orgId: string,
    policy: {
        userLoginMustBeDomain?: boolean;
        validateOrgDomains?: boolean;
        smtpSenderAddressMatchesInstanceDomain?: boolean;
    }
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    // Per-org custom domain policy is admin-API scoped via /admin/v1/orgs/{id}/policies/domain.
    await svc.request('PUT', `/admin/v1/orgs/${orgId}/policies/domain`, policy);
}

export async function resetDomainPolicy(
    svc: ZitadelHttpContext,
    orgId: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    await svc.request(
        'DELETE',
        `/admin/v1/orgs/${orgId}/policies/domain`,
        undefined
    );
}

/** Instance-wide default domain policy. */
export async function getInstanceDomainPolicy(
    svc: ZitadelHttpContext
): Promise<Record<string, unknown> | null> {
    if (!svc.isConfigured()) return null;
    try {
        const resp = await svc.request<{
            policy?: Record<string, unknown>;
        }>('GET', '/admin/v1/policies/domain');
        return resp.policy ?? null;
    } catch (err) {
        logger.warn('getInstanceDomainPolicy failed: %s', err);
        return null;
    }
}

export async function setInstanceDomainPolicy(
    svc: ZitadelHttpContext,
    policy: {
        userLoginMustBeDomain?: boolean;
        validateOrgDomains?: boolean;
        smtpSenderAddressMatchesInstanceDomain?: boolean;
    }
): Promise<void> {
    if (!svc.isConfigured()) return;
    await svc.request('PUT', '/admin/v1/policies/domain', policy);
}

export async function resetLoginText(
    svc: ZitadelHttpContext,
    orgId: string,
    language: string
): Promise<void> {
    validateId(orgId, 'orgId');
    if (!svc.isConfigured()) return;
    if (!isValidLanguageCode(language)) return;
    await svc.request(
        'DELETE',
        `/management/v1/text/login/${language}`,
        undefined,
        {orgId}
    );
}

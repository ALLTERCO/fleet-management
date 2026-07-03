import {getLogger} from 'log4js';
import {configRc} from '../../config';
import {envStr} from '../../config/envReader';
import {oidcApiBaseUrl} from '../../config/oidcEndpoints';
import {
    fmClientOrgId,
    fmPlatformAdminRole,
    zitadelClientProjectId,
    zitadelHttpTimeoutMs,
    zitadelProjectName
} from '../../config/zitadel';
import RpcError from '../../rpc/RpcError';
import type {FleetRole} from '../../types/api/authzCatalog';
import type {
    IdentitySetSmtpSettingsParams,
    IdentitySmtpSettings,
    IdentityTestSmtpSettingsParams
} from '../../types/api/identity';
import {
    extractRolesFromClaims,
    FLEET_ROLES,
    mapRolesToPermissions as mapFleetRolesToPermissions,
    ROLE_PERMISSIONS
} from '../authz/coarse';
import {sanitizeErrorMessageForPersistence} from '../util/sanitizeErrorMessage';
import type {ZitadelEmailProvider} from './identitySmtpProvider';
import {makeJwtServiceTokenSource} from './serviceAuth';
import * as brandingClient from './zitadelBrandingClient';
import * as emailClient from './zitadelEmailClient';
import {
    type FleetProjectRef,
    type FleetUserMetadata,
    METADATA_KEYS,
    normalizeUser,
    type ZitadelHttpContext,
    type ZitadelUser,
    type ZitadelV2User
} from './zitadelHttp';
import * as idpClient from './zitadelIdpClient';
import * as sessionClient from './zitadelSessionClient';
import type {
    CreateMachineUserParams,
    CreateMachineUserResult,
    FleetUserRoles,
    PersonalAccessToken,
    ZitadelV2Authorization
} from './zitadelUserClient';
import * as userClient from './zitadelUserClient';

const logger = getLogger('zitadel');

// Re-exported so existing `import {FleetRole} from 'modules/zitadel'` paths keep working.
export type {
    CreateMachineUserParams,
    CreateMachineUserResult,
    FleetRole,
    FleetUserMetadata,
    FleetUserRoles,
    PersonalAccessToken,
    ZitadelUser
};
export {extractRolesFromClaims, FLEET_ROLES, METADATA_KEYS, ROLE_PERMISSIONS};

class ZitadelService implements ZitadelHttpContext {
    baseUrl: string;
    private serviceToken: string | null = null;
    private jwtTokenSource: (() => Promise<string>) | null = null;
    // Fleet project id + org are bootstrap-set and never change at runtime —
    // cache for the lifetime of this service instance (one Zitadel call per
    // process start instead of one per grant/role op).
    private fleetProject: FleetProjectRef | null = null;

    constructor() {
        const oidcConfig = configRc.oidc?.backend;
        if (!oidcConfig) {
            logger.warn(
                'Zitadel OIDC config not found - service will be disabled'
            );
            this.baseUrl = '';
            return;
        }

        if (oidcConfig.authority) {
            this.baseUrl = oidcApiBaseUrl(oidcConfig);
        } else {
            logger.error(
                'Cannot determine Zitadel base URL - authority not set'
            );
            this.baseUrl = '';
        }

        // Service auth selection. Default 'pat' = legacy long-lived bearer token.
        // 'jwt-profile' = sign assertion → exchange at /oauth/v2/token per request,
        // cached in-process until ~30s before expiry.
        const serviceAuthMethod = envStr(
            'FM_ZITADEL_SERVICE_AUTH',
            'pat'
        ).trim();
        if (serviceAuthMethod === 'jwt-profile') {
            const keyPath = envStr('ZITADEL_SERVICE_KEY_PATH', '').trim();
            if (!keyPath) {
                throw new Error(
                    'FM_ZITADEL_SERVICE_AUTH=jwt-profile requires ZITADEL_SERVICE_KEY_PATH to point at a Zitadel machine-user key JSON file'
                );
            }
            // JWT-bearer audience must match the Zitadel host receiving the
            // token request; split deployments can override it explicitly.
            const audience =
                envStr('FM_ZITADEL_SERVICE_AUDIENCE_URL', '').trim() ||
                envStr('FM_ZITADEL_ISSUER_URL', '').trim() ||
                oidcConfig.authority ||
                this.baseUrl;
            this.jwtTokenSource = makeJwtServiceTokenSource({
                keyPath,
                audience,
                scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
                fetchAccessToken: (assertion, scope) =>
                    this.exchangeAssertion(assertion, scope)
            });
            logger.info(
                'ZitadelService initialized with base URL: %s (service auth: jwt-profile)',
                this.baseUrl
            );
        } else if (oidcConfig.serviceToken) {
            this.serviceToken = oidcConfig.serviceToken;
            logger.info(
                'ZitadelService initialized with base URL: %s (service auth: pat)',
                this.baseUrl
            );
        } else {
            logger.info(
                'ZitadelService initialized with base URL: %s (no service token — metadata API disabled)',
                this.baseUrl
            );
        }
    }

    private async exchangeAssertion(
        assertion: string,
        scope: string
    ): Promise<{accessToken: string; expiresInSeconds: number}> {
        const body = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            scope,
            assertion
        });
        const response = await fetch(`${this.baseUrl}/oauth/v2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            body: body.toString(),
            signal: AbortSignal.timeout(zitadelHttpTimeoutMs())
        });
        if (!response.ok) {
            const text = await response.text();
            const safeText =
                sanitizeErrorMessageForPersistence(text, 4_000) ?? '';
            throw new Error(
                `Zitadel JWT-bearer token exchange failed: ${response.status} ${safeText}`
            );
        }
        const data = (await response.json()) as {
            access_token?: string;
            expires_in?: number;
        };
        if (
            !data.access_token ||
            typeof data.expires_in !== 'number' ||
            data.expires_in <= 0
        ) {
            throw new Error(
                'Zitadel JWT-bearer response missing access_token or has non-positive expires_in'
            );
        }
        return {
            accessToken: data.access_token,
            expiresInSeconds: data.expires_in
        };
    }

    isConfigured(): boolean {
        return this.baseUrl.length > 0;
    }

    /**
     * Resolve a Bearer token for Management API calls.
     *
     * Two paths, controlled by FM_ZITADEL_SERVICE_AUTH at construction:
     *   - 'pat'         (default): long-lived Personal Access Token from bootstrap.
     *   - 'jwt-profile': machine-user private-key JWT exchanged for short-lived
     *                    access tokens at /oauth/v2/token, cached in-process.
     */
    async getServiceToken(): Promise<string> {
        if (this.jwtTokenSource) {
            return this.jwtTokenSource();
        }
        if (!this.serviceToken) {
            throw new Error(
                'No service token configured. Run bootstrap-zitadel.sh to create a service user with a PAT.'
            );
        }
        return this.serviceToken;
    }

    // Authenticated call; aborts after ZITADEL_HTTP_TIMEOUT_MS.
    async request<T>(
        method: string,
        path: string,
        body?: unknown,
        opts: {orgId?: string} = {}
    ): Promise<T> {
        const token = await this.getServiceToken();
        const timeoutMs = zitadelHttpTimeoutMs();

        let response: Response;
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            };

            if (path.startsWith('/zitadel.')) {
                headers['Connect-Protocol-Version'] = '1';
            }
            if (opts.orgId) {
                headers['x-zitadel-orgid'] = opts.orgId;
            }

            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (err) {
            if ((err as Error)?.name === 'TimeoutError') {
                logger.error(
                    'Zitadel API timeout [%s %s] after %dms',
                    method,
                    path,
                    timeoutMs
                );
                throw RpcError.Unavailable(
                    'zitadel',
                    `request timeout after ${timeoutMs}ms`
                );
            }
            throw err;
        }

        if (!response.ok) {
            const text = await response.text();
            const safeText =
                sanitizeErrorMessageForPersistence(text, 4_000) ?? '';
            logger.error(
                'Zitadel API error [%s %s]: %s',
                method,
                path,
                safeText
            );
            if (response.status === 401 || response.status === 403) {
                throw RpcError.Unauthorized();
            }
            if (response.status === 404) {
                throw RpcError.NotFound('zitadel', path);
            }
            if (response.status >= 400 && response.status < 500) {
                throw RpcError.InvalidParams(
                    `Zitadel rejected request: ${safeText}`
                );
            }
            throw RpcError.Unavailable(
                'zitadel',
                `${response.status} ${safeText}`
            );
        }

        // Handle empty responses
        const contentLength = response.headers.get('content-length');
        if (contentLength === '0' || response.status === 204) {
            return {} as T;
        }

        return response.json() as Promise<T>;
    }

    normalizeUser(user: ZitadelV2User): ZitadelUser {
        return normalizeUser(user);
    }

    async getFleetProject(): Promise<FleetProjectRef> {
        if (this.fleetProject) return this.fleetProject;

        const configuredProjectId = zitadelClientProjectId();
        const configuredOrganizationId = fmClientOrgId();
        if (configuredProjectId && configuredOrganizationId) {
            this.fleetProject = {
                projectId: configuredProjectId,
                organizationId: configuredOrganizationId
            };
            return this.fleetProject;
        }

        const projectName = zitadelProjectName();
        const projectRes = await this.request<{
            projects?: Array<{
                projectId: string;
                organizationId: string;
                name: string;
            }>;
        }>('POST', '/zitadel.project.v2.ProjectService/ListProjects', {
            pagination: {limit: 1},
            filters: [
                {
                    projectNameFilter: {
                        projectName,
                        method: 'TEXT_FILTER_METHOD_EQUALS'
                    }
                }
            ]
        });

        const project = projectRes.projects?.[0];
        if (!project) {
            throw new Error(`Project "${projectName}" not found in Zitadel`);
        }
        // Validate before caching — never poison the cache with partial data.
        if (!project.projectId || !project.organizationId) {
            throw new Error(
                `Project "${projectName}" missing projectId/organizationId in Zitadel response`
            );
        }

        this.fleetProject = {
            projectId: project.projectId,
            organizationId: project.organizationId
        };
        return this.fleetProject;
    }

    async getFleetProjectId(): Promise<string> {
        return userClient.getFleetProjectId(this);
    }

    async listAuthorizationsForUser(
        userId: string
    ): Promise<ZitadelV2Authorization[]> {
        return userClient.listAuthorizationsForUser(this, userId);
    }

    async getUserMetadata(userId: string): Promise<FleetUserMetadata> {
        return userClient.getUserMetadata(this, userId);
    }

    async getUserRoles(
        userId: string,
        restrictToOrgId?: string
    ): Promise<FleetUserRoles> {
        return userClient.getUserRoles(this, userId, restrictToOrgId);
    }

    // group = roles[0] (priority pick); permissions = union of every role's
    // coarse tag (legacy callers).
    mapRolesToPermissions(roles: readonly FleetRole[]): {
        permissions: string[];
        group: string;
    } {
        return mapFleetRolesToPermissions(roles);
    }

    async setUserMetadata(
        userId: string,
        metadata: Partial<FleetUserMetadata>
    ): Promise<void> {
        return userClient.setUserMetadata(this, userId, metadata);
    }

    async listUsers(tenantId?: string): Promise<ZitadelUser[]> {
        return userClient.listUsers(this, tenantId);
    }

    async listMachineUsers(organizationId?: string): Promise<
        Array<{
            userId: string;
            userName: string;
            name: string;
            description?: string;
            organizationId?: string;
        }>
    > {
        return userClient.listMachineUsers(this, organizationId);
    }

    async findUserByEmail(email: string): Promise<ZitadelUser | null> {
        return userClient.findUserByEmail(this, email);
    }

    async findUserByUsername(username: string): Promise<ZitadelUser | null> {
        return userClient.findUserByUsername(this, username);
    }

    async getUserResourceOwner(userId: string): Promise<string | null> {
        return userClient.getUserResourceOwner(this, userId);
    }

    async userBelongsToTenant(
        userId: string,
        tenantId: string
    ): Promise<boolean> {
        return userClient.userBelongsToTenant(this, userId, tenantId);
    }

    async createHumanUser(params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
        tenantId: string;
    }): Promise<{userId: string}> {
        return userClient.createHumanUser(this, params);
    }

    async createMachineUser(
        params: CreateMachineUserParams
    ): Promise<CreateMachineUserResult> {
        return userClient.createMachineUser(this, params);
    }

    async createPersonalAccessToken(
        userId: string,
        expirationDate?: Date
    ): Promise<PersonalAccessToken> {
        return userClient.createPersonalAccessToken(
            this,
            userId,
            expirationDate
        );
    }

    async listPersonalAccessTokens(
        userId: string
    ): Promise<
        Array<{tokenId: string; expirationDate?: string; creationDate?: string}>
    > {
        return userClient.listPersonalAccessTokens(this, userId);
    }

    async revokePersonalAccessToken(
        userId: string,
        tokenId: string
    ): Promise<void> {
        return userClient.revokePersonalAccessToken(this, userId, tokenId);
    }

    async grantProjectRole(
        userId: string,
        roleKeys: string[],
        organizationId?: string
    ): Promise<void> {
        return userClient.grantProjectRole(
            this,
            userId,
            roleKeys,
            organizationId
        );
    }

    async ensureProjectRoles(
        userId: string,
        roleKeys: string[],
        organizationId?: string
    ): Promise<void> {
        return userClient.ensureProjectRoles(
            this,
            userId,
            roleKeys,
            organizationId
        );
    }

    async removeProjectRoles(
        userId: string,
        roleKeys: string[],
        organizationId?: string
    ): Promise<void> {
        return userClient.removeProjectRoles(
            this,
            userId,
            roleKeys,
            organizationId
        );
    }

    async sendPasswordResetEmail(userId: string): Promise<void> {
        return userClient.sendPasswordResetEmail(this, userId);
    }

    async updateHumanProfile(
        userId: string,
        profile: {firstName: string; lastName: string; displayName?: string}
    ): Promise<void> {
        return userClient.updateHumanProfile(this, userId, profile);
    }

    async updateHumanEmail(
        userId: string,
        email: string,
        isVerified = false
    ): Promise<void> {
        return userClient.updateHumanEmail(this, userId, email, isVerified);
    }

    async removeUserMetadata(userId: string, key: string): Promise<void> {
        return userClient.removeUserMetadata(this, userId, key);
    }

    async deactivateUser(userId: string): Promise<void> {
        return userClient.deactivateUser(this, userId);
    }

    async reactivateUser(userId: string): Promise<void> {
        return userClient.reactivateUser(this, userId);
    }

    async deleteUser(userId: string): Promise<void> {
        return userClient.deleteUser(this, userId);
    }

    /**
     * Check if Zitadel is configured and available
     */
    isAvailable(): boolean {
        return this.isConfigured();
    }

    /**
     * Check if the Management API is available — requires either a configured
     * PAT or a JWT-profile machine-user key. Without one, role grants and
     * metadata lookups (listAdministrators, mail-template management, etc.)
     * will fail.
     */
    isManagementApiAvailable(): boolean {
        return (
            this.isConfigured() &&
            (this.serviceToken !== null || this.jwtTokenSource !== null)
        );
    }

    async listOrganizationAdministrators(
        organizationId: string
    ): Promise<userClient.AdministratorRecord[]> {
        return userClient.listOrganizationAdministrators(this, organizationId);
    }

    async hasInstanceAdministratorRole(
        userId: string,
        roleKey = fmPlatformAdminRole()
    ): Promise<boolean> {
        return userClient.hasInstanceAdministratorRole(this, userId, roleKey);
    }

    // GetInstance needs system-level auth; runtime PAT only has iam.read.
    async getInstanceInfo(): Promise<{
        customDomains: Array<{domain: string; instanceId?: string}>;
        trustedDomains: Array<{domain: string; instanceId?: string}>;
    }> {
        return brandingClient.getInstanceInfo(this);
    }

    async getIdentitySmtpSettings(): Promise<IdentitySmtpSettings> {
        return emailClient.getIdentitySmtpSettings(this);
    }

    async setIdentitySmtpSettings(
        params: IdentitySetSmtpSettingsParams
    ): Promise<void> {
        return emailClient.setIdentitySmtpSettings(this, params);
    }

    async testIdentitySmtpSettings(
        params: IdentityTestSmtpSettingsParams
    ): Promise<void> {
        return emailClient.testIdentitySmtpSettings(this, params);
    }

    async findSmtpEmailProvider(): Promise<ZitadelEmailProvider | null> {
        return emailClient.findSmtpEmailProvider(this);
    }

    async listSessions(
        userId?: string
    ): Promise<sessionClient.ZitadelSession[]> {
        return sessionClient.listSessions(this, userId);
    }

    async deleteSession(sessionId: string): Promise<void> {
        return sessionClient.deleteSession(this, sessionId);
    }

    async listAuthenticationMethodTypes(userId: string): Promise<{
        authMethodTypes: string[];
    }> {
        return sessionClient.listAuthenticationMethodTypes(this, userId);
    }

    async listPasskeys(
        userId: string
    ): Promise<Array<{id: string; name?: string; state?: string}>> {
        return sessionClient.listPasskeys(this, userId);
    }

    async listIDPLinks(
        userId: string
    ): Promise<Array<{idpId: string; userId: string; userName?: string}>> {
        return sessionClient.listIDPLinks(this, userId);
    }

    async getIdentityPolicies(): Promise<{
        login: Record<string, unknown> | null;
        passwordComplexity: Record<string, unknown> | null;
        passwordExpiry: Record<string, unknown> | null;
        lockout: Record<string, unknown> | null;
        security: Record<string, unknown> | null;
        branding: Record<string, unknown> | null;
        identityProviders: Array<Record<string, unknown>> | null;
    }> {
        return brandingClient.getIdentityPolicies(this);
    }

    async getLabelPolicy(
        orgId: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getLabelPolicy(this, orgId);
    }

    async setLabelPolicy(
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
            themeMode?:
                | 'THEME_MODE_AUTO'
                | 'THEME_MODE_LIGHT'
                | 'THEME_MODE_DARK';
        }
    ): Promise<void> {
        return brandingClient.setLabelPolicy(this, orgId, policy);
    }

    async activateLabelPolicy(orgId: string): Promise<void> {
        return brandingClient.activateLabelPolicy(this, orgId);
    }

    async resetLabelPolicy(orgId: string): Promise<void> {
        return brandingClient.resetLabelPolicy(this, orgId);
    }

    async getLabelPolicyPreview(
        orgId: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getLabelPolicyPreview(this, orgId);
    }

    async getLabelPolicyDefault(): Promise<Record<string, unknown> | null> {
        return brandingClient.getLabelPolicyDefault(this);
    }

    async setLabelLogo(
        orgId: string,
        file: Buffer,
        contentType: string,
        theme: 'light' | 'dark'
    ): Promise<void> {
        return brandingClient.setLabelLogo(
            this,
            orgId,
            file,
            contentType,
            theme
        );
    }

    async deleteLabelLogo(
        orgId: string,
        theme: 'light' | 'dark'
    ): Promise<void> {
        return brandingClient.deleteLabelLogo(this, orgId, theme);
    }

    async setLabelIcon(
        orgId: string,
        file: Buffer,
        contentType: string,
        theme: 'light' | 'dark'
    ): Promise<void> {
        return brandingClient.setLabelIcon(
            this,
            orgId,
            file,
            contentType,
            theme
        );
    }

    async deleteLabelIcon(
        orgId: string,
        theme: 'light' | 'dark'
    ): Promise<void> {
        return brandingClient.deleteLabelIcon(this, orgId, theme);
    }

    async setLabelFont(
        orgId: string,
        file: Buffer,
        contentType: string
    ): Promise<void> {
        return brandingClient.setLabelFont(this, orgId, file, contentType);
    }

    async deleteLabelFont(orgId: string): Promise<void> {
        return brandingClient.deleteLabelFont(this, orgId);
    }

    async getPrivacyPolicy(
        orgId: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getPrivacyPolicy(this, orgId);
    }

    async setPrivacyPolicy(
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
        return brandingClient.setPrivacyPolicy(this, orgId, policy);
    }

    async resetPrivacyPolicy(orgId: string): Promise<void> {
        return brandingClient.resetPrivacyPolicy(this, orgId);
    }

    async getMessageTextDefault(
        type: string,
        language: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getMessageTextDefault(this, type, language);
    }

    async getLoginTextDefault(
        language: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getLoginTextDefault(this, language);
    }

    async getMessageText(
        orgId: string,
        type: string,
        language: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getMessageText(this, orgId, type, language);
    }

    async setMessageText(
        orgId: string,
        type: string,
        language: string,
        body: Record<string, unknown>
    ): Promise<void> {
        return brandingClient.setMessageText(this, orgId, type, language, body);
    }

    async resetMessageText(
        orgId: string,
        type: string,
        language: string
    ): Promise<void> {
        return brandingClient.resetMessageText(this, orgId, type, language);
    }

    async getCustomMailTemplate(
        orgId: string
    ): Promise<{template: string; isDefault: boolean} | null> {
        return brandingClient.getCustomMailTemplate(this, orgId);
    }

    async setCustomMailTemplate(orgId: string, html: string): Promise<void> {
        return brandingClient.setCustomMailTemplate(this, orgId, html);
    }

    async resetCustomMailTemplate(orgId: string): Promise<void> {
        return brandingClient.resetCustomMailTemplate(this, orgId);
    }

    async getLoginText(
        orgId: string,
        language: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getLoginText(this, orgId, language);
    }

    async setLoginText(
        orgId: string,
        language: string,
        body: Record<string, unknown>
    ): Promise<void> {
        return brandingClient.setLoginText(this, orgId, language, body);
    }

    async getNotificationPolicy(
        orgId: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getNotificationPolicy(this, orgId);
    }

    async setNotificationPolicy(
        orgId: string,
        policy: {passwordChange?: boolean}
    ): Promise<void> {
        return brandingClient.setNotificationPolicy(this, orgId, policy);
    }

    async resetNotificationPolicy(orgId: string): Promise<void> {
        return brandingClient.resetNotificationPolicy(this, orgId);
    }

    async getRestrictions(): Promise<Record<string, unknown> | null> {
        return brandingClient.getRestrictions(this);
    }

    async setRestrictions(body: {
        disallowPublicOrgRegistration?: boolean;
        allowedLanguages?: {list?: string[]};
    }): Promise<void> {
        return brandingClient.setRestrictions(this, body);
    }

    async getDomainPolicy(
        orgId: string
    ): Promise<Record<string, unknown> | null> {
        return brandingClient.getDomainPolicy(this, orgId);
    }

    async setDomainPolicy(
        orgId: string,
        policy: {
            userLoginMustBeDomain?: boolean;
            validateOrgDomains?: boolean;
            smtpSenderAddressMatchesInstanceDomain?: boolean;
        }
    ): Promise<void> {
        return brandingClient.setDomainPolicy(this, orgId, policy);
    }

    async resetDomainPolicy(orgId: string): Promise<void> {
        return brandingClient.resetDomainPolicy(this, orgId);
    }

    async getInstanceDomainPolicy(): Promise<Record<string, unknown> | null> {
        return brandingClient.getInstanceDomainPolicy(this);
    }

    async setInstanceDomainPolicy(policy: {
        userLoginMustBeDomain?: boolean;
        validateOrgDomains?: boolean;
        smtpSenderAddressMatchesInstanceDomain?: boolean;
    }): Promise<void> {
        return brandingClient.setInstanceDomainPolicy(this, policy);
    }

    async resetLoginText(orgId: string, language: string): Promise<void> {
        return brandingClient.resetLoginText(this, orgId, language);
    }

    // Action V2 target administration — used by Identity.RotateActionSigningKeys.
    async searchActionTarget(
        name: string
    ): Promise<{id: string; name: string} | null> {
        return idpClient.searchActionTarget(this, name);
    }

    // Returns every target matching the canonical name. Multiple results
    // mean prior rotations left orphans; rotation logic deletes them all.
    async searchAllActionTargets(
        name: string
    ): Promise<Array<{id: string; name: string}>> {
        return idpClient.searchAllActionTargets(this, name);
    }

    async createActionTarget(spec: {
        name: string;
        endpoint: string;
        timeout: string;
        interruptOnError?: boolean;
    }): Promise<{id: string; signingKey: string}> {
        return idpClient.createActionTarget(this, spec);
    }

    async deleteActionTarget(id: string): Promise<void> {
        return idpClient.deleteActionTarget(this, id);
    }

    async bindEventExecution(event: string, targetId: string): Promise<void> {
        return idpClient.bindEventExecution(this, event, targetId);
    }

    // External Identity Provider administration (instance scope).
    async listIdentityProviders(): Promise<
        Array<{id: string; name: string; type: string; state: string}>
    > {
        return idpClient.listIdentityProviders(this);
    }

    async addOidcIdentityProvider(spec: {
        name: string;
        issuer: string;
        clientId: string;
        clientSecret: string;
        scopes?: string[];
        autoCreation?: boolean;
    }): Promise<{id: string}> {
        return idpClient.addOidcIdentityProvider(this, spec);
    }

    async deleteIdentityProvider(id: string): Promise<void> {
        return idpClient.deleteIdentityProvider(this, id);
    }
}

// Singleton instance
export const zitadelService = new ZitadelService();

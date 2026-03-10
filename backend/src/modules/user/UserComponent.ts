import {getLogger} from 'log4js';
import {DEV_MODE} from '../../config';
import type CommandSender from '../../model/CommandSender';
import Component from '../../model/component/Component';
import RpcError from '../../rpc/RpcError';
import type {User} from '../../validations/params';
import * as store from '../PostgresProvider';
import {zitadelService} from '../zitadel';
import {clearUserinfoCache} from './cache';
import {
    AlexaTokenSigner,
    DefaultSigner,
    REFRESH_TOKEN_OPTIONS
} from './signers';

const logger = getLogger('user');

/**
 * Login helper for dev mode - validates credentials against local database
 */
async function login(
    username: string,
    password: string
): Promise<string | undefined> {
    try {
        const result = await store.userList({name: username, password});
        if (result?.rows?.length > 0) {
            const user = result.rows[0];
            if (user.enabled) {
                return DefaultSigner.sign(username);
            }
        }
        return undefined;
    } catch (error) {
        logger.warn('Login failed for user %s: %s', username, error);
        return undefined;
    }
}

export interface UserComponentConfig {
    allowDebugUser: boolean;
    jwtToken: string;
}

export default class UserComponent extends Component<UserComponentConfig> {
    constructor() {
        super('user');

        this.methods.delete('setconfig');
    }

    /**
     * Authenticate for Alexa OAuth2 integration only.
     * Regular web authentication goes through Zitadel.
     */
    @Component.Expose('AuthenticateAlexa')
    @Component.NoPermissions
    async authenticateAlexa({
        username,
        endpoint
    }: {
        username: string;
        endpoint: string;
    }) {
        // Verify user exists in Zitadel
        const user = await zitadelService.findUserByEmail(username);
        if (!user) {
            throw RpcError.InvalidRequest('User not found');
        }

        // Generate Alexa-specific tokens
        const refreshToken = AlexaTokenSigner.sign({
            username,
            endpoint
        });

        return {
            refresh_token: refreshToken,
            access_token: AlexaTokenSigner.refresh(refreshToken)
        };
    }

    /**
     * Refresh Alexa tokens only.
     * Regular token refresh is handled by Zitadel.
     */
    @Component.Expose('RefreshAlexa')
    @Component.NoPermissions
    async refreshAlexa({refresh_token}: User.Refresh) {
        const data = AlexaTokenSigner.verify(refresh_token);

        if (!data || data.aud !== 'alexa') {
            throw RpcError.Unauthrozied();
        }

        const access_token = AlexaTokenSigner.refresh(refresh_token);

        if (!access_token) {
            throw RpcError.Unauthrozied();
        }

        return {
            access_token
        };
    }

    /**
     * Authenticate user with username/password (DEV MODE ONLY).
     * In production, authentication is handled by Zitadel.
     */
    @Component.Expose('Authenticate')
    @Component.NoPermissions
    async authenticate({
        username,
        password,
        purpose,
        endpoint
    }: User.Authenticate) {
        if (!DEV_MODE) {
            throw RpcError.InvalidRequest(
                'Local authentication is disabled. Use Zitadel for authentication.'
            );
        }

        const access_token = await login(username, password);
        if (access_token === undefined) {
            throw RpcError.InvalidRequest('Invalid credentials');
        }

        // Handle Alexa-specific authentication
        if (purpose === 'alexa') {
            if (typeof endpoint !== 'string') {
                throw RpcError.InvalidParams('Endpoint required for Alexa');
            }
            const refreshToken = AlexaTokenSigner.sign({
                username,
                endpoint
            });
            return {
                refresh_token: refreshToken,
                access_token: AlexaTokenSigner.refresh(refreshToken)
            };
        }

        // Standard authentication - return access and refresh tokens
        const refresh_token = DefaultSigner.sign(
            username,
            REFRESH_TOKEN_OPTIONS
        );

        return {
            access_token,
            refresh_token
        };
    }

    /**
     * Refresh access token using refresh token (DEV MODE ONLY).
     * In production, token refresh is handled by Zitadel.
     */
    @Component.Expose('Refresh')
    @Component.NoPermissions
    async refresh({refresh_token}: User.Refresh) {
        if (!DEV_MODE) {
            throw RpcError.InvalidRequest(
                'Local token refresh is disabled. Use Zitadel for authentication.'
            );
        }

        const data = DefaultSigner.verify(refresh_token, REFRESH_TOKEN_OPTIONS);

        if (!data) {
            throw RpcError.Unauthrozied();
        }

        // Check if this is an Alexa token
        if (data.aud === 'alexa') {
            const access_token = AlexaTokenSigner.refresh(refresh_token);
            if (!access_token) {
                throw RpcError.Unauthrozied();
            }
            return {access_token};
        }

        // Standard token refresh
        const access_token = DefaultSigner.refresh(refresh_token);
        if (!access_token) {
            throw RpcError.Unauthrozied();
        }

        return {access_token};
    }

    @Component.Expose('Create')
    async create(params: User.Create) {
        const {name, password, fullName, group, permissions, email} = params;
        const exists = await this.find({name});
        if (exists?.rows.length > 0) {
            throw RpcError.InvalidParams(`User '${name}' already created`);
        }

        // Remove any permission that is undefined, null, empty, or contains '.undefined'
        const safePermissions = (permissions || []).filter(
            (p) => !!p && typeof p === 'string' && !p.includes('undefined')
        );

        const u = await store.userCreate({
            email,
            name,
            password,
            fullName,
            group,
            enabled: true,
            permissions: safePermissions
        });
        return {created: u};
    }

    @Component.Expose('Update')
    async update(params: User.Update) {
        const u = await store.userUpdate(params);
        return {updated: params.id, fields: params};
    }

    @Component.Expose('Delete')
    async delete(params: User.Delete) {
        const u = await store.userDelete({id: params.id});
        return {deleted: params.id};
    }

    @Component.Expose('List')
    async list() {
        const dbResponse = await store.userList({});
        const rows = dbResponse?.rows || [];
        const users = rows.filter((user) => user.deleted === false);
        return users;
    }

    @Component.Expose('Find')
    async find({
        id,
        name,
        password
    }: {
        id?: number;
        name?: string;
        password?: string;
    }): Promise<any> {
        const u = await store.userList({id, name, password});
        return u;
    }

    /**
     * Get current user's information including role and permissions.
     * This is used by the frontend to determine what actions are allowed.
     */
    @Component.Expose('GetMe')
    @Component.ReadOnly
    async getMe(_params: any, sender: CommandSender) {
        return {
            role: sender.getRole(),
            group: sender.getGroup(),
            canWrite: sender.canWrite(),
            isAdmin: sender.isAdmin(),
            isViewer: sender.isViewer(),
            permissionConfig: sender.getPermissionConfig()
        };
    }

    // @Component.Expose('View')
    // async view(params: User.View) {
    //     return await store.userList({ id: params.id });
    // }

    // ========================================================================
    // ZITADEL USER MANAGEMENT
    // ========================================================================

    @Component.Expose('ZitadelAvailable')
    @Component.ReadOnly
    async zitadelAvailable() {
        return {available: zitadelService.isManagementApiAvailable()};
    }

    @Component.Expose('ListZitadelUsers')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async listZitadelUsers() {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        return await zitadelService.listUsers();
    }

    @Component.Expose('GetUserPermissions')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async getUserPermissions({userId}: {userId: string}) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        const config = await zitadelService.getFmPermissions(userId);
        return {userId, permissionConfig: config};
    }

    @Component.Expose('SetUserPermissions')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async setUserPermissions({
        userId,
        permissionConfig
    }: {userId: string; permissionConfig: Record<string, unknown>}) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        await zitadelService.setFmPermissions(userId, permissionConfig);
        clearUserinfoCache();
        return {success: true};
    }

    @Component.Expose('CreateZitadelUser')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async createZitadelUser(params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
    }) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        return await zitadelService.createHumanUser(params);
    }

    @Component.Expose('SendPasswordReset')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async sendPasswordReset({userId}: {userId: string}) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        await zitadelService.sendPasswordResetEmail(userId);
        return {success: true};
    }

    @Component.Expose('DeactivateUser')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async deactivateZitadelUser({userId}: {userId: string}) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        await zitadelService.deactivateUser(userId);
        return {success: true};
    }

    @Component.Expose('ReactivateUser')
    @Component.CheckPermissions((sender) => sender.isAdmin())
    async reactivateZitadelUser({userId}: {userId: string}) {
        if (!zitadelService.isManagementApiAvailable()) {
            throw RpcError.InvalidParams(
                'Zitadel Management API not available'
            );
        }
        await zitadelService.reactivateUser(userId);
        return {success: true};
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'allowDebugUser':
                return typeof value === 'boolean';
            default:
                return false;
        }
    }

    protected override applyConfigKey(key: string, value: any) {
        switch (key) {
            case 'allowDebugUser': {
                const allowed = Boolean(value);
                this.config.allowDebugUser = allowed;
                break;
            }
        }
    }

    protected override getDefaultConfig() {
        return {
            allowDebugUser: false,
            jwtToken: 'shelly-secret-token' // this should go into config
        } satisfies UserComponentConfig;
    }

    override getConfig(params?: any) {
        return Object.assign({}, {allowDebugUser: this.config.allowDebugUser});
    }
}

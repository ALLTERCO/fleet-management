// Auth/token RPCs: Alexa OAuth2, DEV_MODE local auth, WS token rotation.
// Web auth is Zitadel — Authenticate/Refresh return InvalidRequest in prod.

import {getLogger} from 'log4js';
import {DEV_MODE} from '../../config';
import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import * as store from '../PostgresProvider';
import type {ConnectionContext} from '../web/ws/ConnectionContext';
import {zitadelService} from '../zitadel';
import {
    AlexaTokenSigner,
    DefaultSigner,
    REFRESH_TOKEN_OPTIONS
} from './signers';

const logger = getLogger('user');

// DEV MODE only — validates against local DB; production uses Zitadel.
async function localLogin(
    username: string,
    password: string
): Promise<string | undefined> {
    try {
        const result = await store.userList({name: username, password});
        const user = result?.rows?.[0];
        if (user?.enabled) return DefaultSigner.sign(username);
        return undefined;
    } catch (error) {
        logger.warn('Login failed for user %s: %s', username, error);
        return undefined;
    }
}

export async function authenticateAlexa(
    params: {username?: unknown; endpoint?: unknown} | undefined,
    sender: CommandSender
) {
    const username = params?.username;
    const endpoint = params?.endpoint;
    if (typeof username !== 'string' || !username) {
        throw RpcError.InvalidParams('username required');
    }
    if (typeof endpoint !== 'string' || !endpoint) {
        throw RpcError.InvalidParams('endpoint required');
    }
    // Emails are case-insensitive per RFC 5321.
    if (sender.getUser()?.username?.toLowerCase() !== username.toLowerCase()) {
        throw RpcError.InvalidRequest(
            'Cannot generate tokens for a different user'
        );
    }
    const user = await zitadelService.findUserByEmail(username);
    if (!user) throw RpcError.InvalidRequest('User not found');

    const refreshToken = AlexaTokenSigner.signRefresh({username, endpoint});
    return {
        refresh_token: refreshToken,
        access_token: AlexaTokenSigner.refresh(refreshToken)
    };
}

export async function refreshAlexa(
    params: {refresh_token?: unknown} | undefined
) {
    const refresh_token = params?.refresh_token;
    if (typeof refresh_token !== 'string' || !refresh_token) {
        throw RpcError.InvalidParams('refresh_token required');
    }
    const data = AlexaTokenSigner.verify(refresh_token);
    if (!data || data.aud !== 'alexa') throw RpcError.Unauthorized();
    const access_token = AlexaTokenSigner.refresh(refresh_token);
    if (!access_token) throw RpcError.Unauthorized();
    return {access_token};
}

export async function authenticate(
    params:
        | {
              username?: unknown;
              password?: unknown;
              purpose?: unknown;
              endpoint?: unknown;
          }
        | undefined
) {
    if (!DEV_MODE) {
        throw RpcError.InvalidRequest(
            'Local authentication is disabled. Use Zitadel for authentication.'
        );
    }
    const username = params?.username;
    const password = params?.password;
    const purpose = params?.purpose;
    const endpoint = params?.endpoint;
    if (typeof username !== 'string' || !username) {
        throw RpcError.InvalidParams('username required');
    }
    if (typeof password !== 'string' || !password) {
        throw RpcError.InvalidParams('password required');
    }

    const access_token = await localLogin(username, password);
    if (access_token === undefined) {
        throw RpcError.InvalidRequest('Invalid credentials');
    }

    if (purpose === 'alexa') {
        if (typeof endpoint !== 'string') {
            throw RpcError.InvalidParams('Endpoint required for Alexa');
        }
        const refreshToken = AlexaTokenSigner.signRefresh({username, endpoint});
        return {
            refresh_token: refreshToken,
            access_token: AlexaTokenSigner.refresh(refreshToken)
        };
    }

    const refresh_token = DefaultSigner.sign(username, REFRESH_TOKEN_OPTIONS);
    return {access_token, refresh_token};
}

// Swaps the live WS connection's bearer after an OIDC silent renew.
export async function rotateToken(
    params: {access_token?: unknown} | undefined,
    ctx?: ConnectionContext
) {
    if (!ctx) throw RpcError.InvalidRequest('rotateToken requires WS');
    const token = params?.access_token;
    if (typeof token !== 'string' || !token) {
        throw RpcError.InvalidParams('access_token required');
    }
    const ok = await ctx.rotateToken(token);
    if (!ok) throw RpcError.Unauthorized();
    return {ok: true};
}

export async function refresh(params: {refresh_token?: unknown} | undefined) {
    if (!DEV_MODE) {
        throw RpcError.InvalidRequest(
            'Local token refresh is disabled. Use Zitadel for authentication.'
        );
    }
    const refresh_token = params?.refresh_token;
    if (typeof refresh_token !== 'string' || !refresh_token) {
        throw RpcError.InvalidParams('refresh_token required');
    }
    const data = DefaultSigner.verify(refresh_token, REFRESH_TOKEN_OPTIONS);
    if (!data) throw RpcError.Unauthorized();

    if (data.aud === 'alexa') {
        const access_token = AlexaTokenSigner.refresh(refresh_token);
        if (!access_token) throw RpcError.Unauthorized();
        return {access_token};
    }

    const access_token = DefaultSigner.refresh(refresh_token);
    if (!access_token) throw RpcError.Unauthorized();
    return {access_token};
}

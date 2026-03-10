/**
 * JWT Signers for Authentication
 *
 * This module provides JWT signing/verification for:
 * - Dev mode local authentication (DefaultSigner)
 * - Alexa voice assistant integration (AlexaTokenSigner)
 *
 * In production, regular user authentication is handled by Zitadel.
 * In dev mode, DefaultSigner is used for local username/password authentication.
 */

import * as jwt from 'jsonwebtoken';
import {getJwtToken} from '.';
import type {SignContent} from './types';

export const REFRESH_TOKEN_OPTIONS: jwt.SignOptions = {
    expiresIn: '1y',
    issuer: 'fleet-management',
    subject: 'refresh_token'
};

const ACCESS_TOKEN_OPTIONS: jwt.SignOptions = {
    expiresIn: '1d',
    issuer: 'fleet-management',
    subject: 'access_token'
};

/**
 * Default JWT Token Signer for dev mode local authentication.
 * Used when running without Zitadel (DEV_MODE=true).
 */
export class DefaultSigner {
    static sign(username: string, options = ACCESS_TOKEN_OPTIONS): string {
        return jwt.sign({username}, getJwtToken(), options);
    }

    static verify(
        token: string,
        options = ACCESS_TOKEN_OPTIONS
    ): jwt.JwtPayload | undefined {
        try {
            const decoded = jwt.verify(token, getJwtToken(), options);
            if (typeof decoded === 'string') {
                return undefined;
            }
            return decoded;
        } catch {
            return undefined;
        }
    }

    static refresh(token: string): string | undefined {
        try {
            const content = jwt.verify(
                token,
                getJwtToken(),
                REFRESH_TOKEN_OPTIONS
            );

            if (typeof content === 'string') {
                return undefined;
            }

            if (typeof content.username !== 'string') {
                return undefined;
            }

            return DefaultSigner.sign(content.username, ACCESS_TOKEN_OPTIONS);
        } catch {
            return undefined;
        }
    }
}

interface AlexaSignContent extends SignContent {
    username: string;
    endpoint: string;
}

/**
 * JWT Token Signer for Alexa OAuth2 integration.
 * Used to generate tokens for Alexa smart home skill authorization.
 */
export class AlexaTokenSigner {
    static readonly ALEXA_REFRESH_OPTIONS = {
        ...REFRESH_TOKEN_OPTIONS,
        audience: 'alexa'
    } satisfies jwt.SignOptions;

    static readonly ALEXA_ACCESS_OPTIONS = {
        ...ACCESS_TOKEN_OPTIONS,
        audience: 'alexa'
    } satisfies jwt.SignOptions;

    static sign(
        content: AlexaSignContent,
        options = AlexaTokenSigner.ALEXA_ACCESS_OPTIONS
    ) {
        return jwt.sign(content, getJwtToken(), options);
    }

    static verify(token: string): jwt.JwtPayload | undefined {
        try {
            const decoded = jwt.verify(
                token,
                getJwtToken(),
                AlexaTokenSigner.ALEXA_REFRESH_OPTIONS
            );
            if (typeof decoded === 'string') {
                return undefined;
            }
            return decoded;
        } catch {
            return undefined;
        }
    }

    static refresh(token: string): string | undefined {
        try {
            const content = jwt.verify(
                token,
                getJwtToken(),
                AlexaTokenSigner.ALEXA_REFRESH_OPTIONS
            );

            if (typeof content === 'string') {
                return undefined;
            }

            if (
                typeof content.username !== 'string' ||
                typeof content.endpoint !== 'string'
            ) {
                return undefined;
            }

            const signContent: AlexaSignContent = {
                endpoint: content.endpoint,
                username: content.username
            };

            return AlexaTokenSigner.sign(
                signContent,
                AlexaTokenSigner.ALEXA_ACCESS_OPTIONS
            );
        } catch {
            return undefined;
        }
    }
}

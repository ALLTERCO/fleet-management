// JWT signers: DefaultSigner (dev mode), AlexaTokenSigner (Alexa OAuth),
// ScopedTokenSigner (FM-issued PATs with boundary in organization.fm_scoped_pats).
// Production user auth = Zitadel introspection elsewhere.

import * as jwt from 'jsonwebtoken';
import {envBool, envOptionalStr} from '../../config/envReader';
import {getJwtToken} from '../../config/jwtSecret';
import type {SignContent} from './types';

// RFC 8725 §3.1 — sign + verify pinned to one algorithm. Routing every
// jwt.sign / jwt.verify call through these helpers makes algorithm
// confusion attacks (HS512-signed forgery using the leaked HS256 secret)
// impossible without bypassing the helper at the source level.
const JWT_ALGORITHM = 'HS256' as const satisfies jwt.Algorithm;

export function signHs256(
    payload: string | Buffer | object,
    secret: jwt.Secret,
    options: jwt.SignOptions = {}
): string {
    return jwt.sign(payload, secret, {...options, algorithm: JWT_ALGORITHM});
}

export function verifyHs256(
    token: string,
    secret: jwt.Secret,
    options: jwt.VerifyOptions = {}
): jwt.Jwt | jwt.JwtPayload | string {
    return jwt.verify(token, secret, {
        ...options,
        algorithms: [JWT_ALGORITHM]
    });
}

// Issuer is per-instance — multi-region deployments where a shared
// JWT secret leaks across instances would otherwise let a PAT minted
// by instance A verify (and authenticate) on instance B. Pinning the
// instance id at sign + verify time stops that. Default 'fleet-management'
// preserves single-instance back-compat. Set FM_INSTANCE_ID per deploy.
function buildScopedPatIssuer(): string {
    const id = envOptionalStr('FM_INSTANCE_ID');
    return id ? `fleet-management:${id}` : 'fleet-management';
}
export const FM_SCOPED_PAT_ISSUER = buildScopedPatIssuer();
export const FM_SCOPED_PAT_AUDIENCE = 'fm-api';

function currentKid(): string {
    return envOptionalStr('FM_JWT_KID_CURRENT') ?? 'primary';
}

function previousKid(): string {
    return envOptionalStr('FM_JWT_KID_PREVIOUS') ?? 'previous';
}

function previousJwtToken(): string | undefined {
    return envOptionalStr('FM_JWT_SECRET_PREVIOUS');
}

function jwtRequiresKid(): boolean {
    return envBool('FM_JWT_REQUIRE_KID', false);
}

export function getCurrentKid(): string {
    return currentKid();
}

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
        return signHs256({username}, getJwtToken(), options);
    }

    static verify(
        token: string,
        options = ACCESS_TOKEN_OPTIONS
    ): jwt.JwtPayload | undefined {
        try {
            // @types/jsonwebtoken ^9 narrowed VerifyOptions.audience to a non-empty
            // tuple; SignOptions.audience is still a wider array. Cast at the
            // boundary — the runtime accepts both shapes.
            const decoded = verifyHs256(
                token,
                getJwtToken(),
                options as jwt.VerifyOptions
            );
            if (typeof decoded === 'string') {
                return undefined;
            }
            return decoded as jwt.JwtPayload;
        } catch {
            return undefined;
        }
    }

    static refresh(token: string): string | undefined {
        try {
            const content = verifyHs256(
                token,
                getJwtToken(),
                REFRESH_TOKEN_OPTIONS as jwt.VerifyOptions
            );

            if (typeof content === 'string') {
                return undefined;
            }

            // jwt.verify returns JwtPayload | Jwt in @types/jsonwebtoken ^9.
            // The Jwt branch wraps the payload; narrow to JwtPayload.
            const payload =
                'payload' in content && typeof content.payload === 'object'
                    ? (content.payload as jwt.JwtPayload)
                    : (content as jwt.JwtPayload);
            const username = (payload as {username?: unknown}).username;
            if (typeof username !== 'string') {
                return undefined;
            }

            return DefaultSigner.sign(username, ACCESS_TOKEN_OPTIONS);
        } catch {
            return undefined;
        }
    }
}

interface AlexaSignContent extends SignContent {
    username: string;
    endpoint: string;
}

// FM-issued scoped PAT. `tokenId` lets the auth gate look up boundary
// in organization.fm_scoped_pats; boundary can only narrow, never escalate.
//
// kid header lets verify select the right key during a rotation window.
// Tokens minted before kid support also verify (back-compat: no kid → current).
export class ScopedTokenSigner {
    static sign(userId: string, tokenId: string, expiresAt: Date): string {
        const ttlSeconds = Math.max(
            1,
            Math.floor((expiresAt.getTime() - Date.now()) / 1000)
        );
        return signHs256({userId, tokenId}, getJwtToken(), {
            keyid: getCurrentKid(),
            issuer: FM_SCOPED_PAT_ISSUER,
            audience: FM_SCOPED_PAT_AUDIENCE,
            subject: userId,
            jwtid: tokenId,
            expiresIn: ttlSeconds
        });
    }

    static verify(
        token: string
    ): {userId: string; tokenId: string} | undefined {
        const decoded = jwt.decode(token, {complete: true});
        if (!decoded || typeof decoded === 'string') return undefined;
        const candidates = pickJwtSecretByKid(decoded.header?.kid);
        for (const secret of candidates) {
            try {
                const payload = verifyHs256(token, secret, {
                    issuer: FM_SCOPED_PAT_ISSUER,
                    audience: FM_SCOPED_PAT_AUDIENCE
                });
                if (typeof payload === 'string') continue;
                const userId = (payload as jwt.JwtPayload).userId;
                const tokenId = (payload as jwt.JwtPayload).tokenId;
                if (typeof userId !== 'string' || typeof tokenId !== 'string')
                    continue;
                return {userId, tokenId};
            } catch {
                // try next candidate
            }
        }
        return undefined;
    }
}

// Candidate secrets to try at verify time. Returns an array so the
// verifier can attempt each in order; the FIRST successful jwt.verify
// wins. Cases:
//
//   - kid === current      → [current]
//   - kid === previous kid → [previous]
//   - kid undefined        → [current, previous?]   // legacy back-compat
//                            both sides of a rotation window are valid
//                            for tokens signed before kid landed
//   - any unknown kid      → []                     // reject (no silent
//                            fallback — an attacker can't forge a
//                            verifying token by inventing a kid)
//
// FM_JWT_REQUIRE_KID=true drops the kid-less back-compat after rotation.
// Exported for tests.
export function pickJwtSecretByKid(kid: string | undefined): string[] {
    const current = getJwtToken();
    const previous = previousJwtToken();
    if (!kid) {
        if (jwtRequiresKid()) return [];
        // Legacy token (no kid header). Must survive a rotation: it could
        // have been signed under either side. Try current first, fall
        // through to previous when the rotation slot is configured.
        return previous ? [current, previous] : [current];
    }
    if (kid === currentKid()) return [current];
    if (previous && kid === previousKid()) return [previous];
    return [];
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

    // Named methods only — verify()/refresh() require sub=refresh_token.
    private static signWith(
        content: AlexaSignContent,
        options: jwt.SignOptions
    ): string {
        return signHs256(content, getJwtToken(), {
            ...options,
            keyid: getCurrentKid()
        });
    }

    static signRefresh(content: AlexaSignContent): string {
        return AlexaTokenSigner.signWith(
            content,
            AlexaTokenSigner.ALEXA_REFRESH_OPTIONS
        );
    }

    static signAccess(content: AlexaSignContent): string {
        return AlexaTokenSigner.signWith(
            content,
            AlexaTokenSigner.ALEXA_ACCESS_OPTIONS
        );
    }

    static verify(token: string): jwt.JwtPayload | undefined {
        const decoded = jwt.decode(token, {complete: true});
        if (!decoded || typeof decoded === 'string') return undefined;
        const candidates = pickJwtSecretByKid(decoded.header?.kid);
        for (const secret of candidates) {
            try {
                const payload = verifyHs256(
                    token,
                    secret,
                    AlexaTokenSigner.ALEXA_REFRESH_OPTIONS
                );
                if (typeof payload === 'string') continue;
                return payload;
            } catch {
                // try next candidate
            }
        }
        return undefined;
    }

    static refresh(token: string): string | undefined {
        const decoded = jwt.decode(token, {complete: true});
        if (!decoded || typeof decoded === 'string') return undefined;
        const candidates = pickJwtSecretByKid(decoded.header?.kid);
        let content: jwt.JwtPayload | undefined;
        for (const secret of candidates) {
            try {
                const verified = verifyHs256(
                    token,
                    secret,
                    AlexaTokenSigner.ALEXA_REFRESH_OPTIONS
                );
                if (typeof verified === 'string') continue;
                content = verified;
                break;
            } catch {
                // try next candidate
            }
        }
        if (!content) return undefined;
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
        return AlexaTokenSigner.signAccess(signContent);
    }
}

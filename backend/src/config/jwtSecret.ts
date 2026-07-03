import {envStr} from './envReader';

export const PUBLIC_JWT_SECRET_FALLBACK = 'shelly-secret-token';

// Single env-driven source for the FM-signed JWT secret. The fallback
// matches the public dev sentinel — checkJwtSecret() in modules/user/
// refuses to boot non-DEV processes if the secret is unset or still
// matches it.
export function getJwtToken(): string {
    return envStr('JWT_SECRET', PUBLIC_JWT_SECRET_FALLBACK);
}

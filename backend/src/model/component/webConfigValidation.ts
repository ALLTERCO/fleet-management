import RpcError from '../../rpc/RpcError';

export {
    WEB_DEFAULT_HTTPS_CRT,
    WEB_DEFAULT_HTTPS_KEY,
    WEB_DEFAULT_PORT,
    WEB_DEFAULT_PORT_SSL
} from '../../config/webDefaults';

export interface WebComponentConfig {
    host?: string;
    port: number;
    port_ssl: number;
    https_crt: string;
    https_key: string;
    jwt_token: string;
}

export const WEB_FIELD_TYPES: Record<
    keyof WebComponentConfig,
    'string' | 'number'
> = {
    host: 'string',
    port: 'number',
    port_ssl: 'number',
    https_crt: 'string',
    https_key: 'string',
    jwt_token: 'string'
};

/**
 * Cross-field invariants for the merged web listener config:
 *   1. at least one port enabled (port > -1 OR port_ssl > -1)
 *   2. https_crt + https_key non-empty when port_ssl > -1
 *   3. jwt_token non-empty
 *
 * Throws RpcError.InvalidParams when any invariant fails. Pure — no
 * Component dependency, so it can be unit-tested in isolation.
 */
export function assertMergedWebConfigValid(c: WebComponentConfig): void {
    if (typeof c.port !== 'number' || typeof c.port_ssl !== 'number') {
        throw RpcError.InvalidParams('port and port_ssl must be numbers');
    }
    if (c.port <= -1 && c.port_ssl <= -1) {
        throw RpcError.InvalidParams(
            'At least one HTTP/HTTPS port must be enabled (port or port_ssl > -1)'
        );
    }
    if (c.port_ssl > -1) {
        if (typeof c.https_crt !== 'string' || c.https_crt.length === 0) {
            throw RpcError.InvalidParams(
                'https_crt is required when port_ssl is enabled'
            );
        }
        if (typeof c.https_key !== 'string' || c.https_key.length === 0) {
            throw RpcError.InvalidParams(
                'https_key is required when port_ssl is enabled'
            );
        }
    }
    if (typeof c.jwt_token !== 'string' || c.jwt_token.length === 0) {
        throw RpcError.InvalidParams('jwt_token is required');
    }
}

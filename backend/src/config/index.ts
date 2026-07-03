import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import * as log4js from 'log4js';
import type {ZitadelIntrospectionOptions} from 'passport-zitadel';
import rc from 'rc';
import websocketAppender from './../websocketAppender';
import {envBool, envOptionalStr, envStr, takeEnvRejections} from './envReader';
import {getJwtToken} from './jwtSecret';
import {LINKED_SCHEMAS, MIGRATION_DIRS} from './migrationLayout';
import {CFG_FOLDER, PLUGINS_FOLDER, STATIC_FOLDER} from './paths';
import {redactSecretsForLog} from './redact';
import {runtimeMetadata} from './runtimeMetadata';
import {
    describeSecretsMisconfiguration,
    describeSecretsWarnings
} from './secrets';
// Tuning lives in ./tuning so lean modules can read defaults without
// pulling this barrel (which bootstraps configRc + plugin loader + runtime
// metadata and otherwise creates import cycles).
import {tuning} from './tuning';
import {
    WEB_DEFAULT_HTTPS_CRT,
    WEB_DEFAULT_HTTPS_KEY,
    WEB_DEFAULT_PORT_SSL
} from './webDefaults';

export {CFG_FOLDER, PLUGINS_FOLDER, STATIC_FOLDER} from './paths';
export {redactSecretsForLog} from './redact';
export type {
    DeploymentMode,
    RuntimeMetadataConfig
} from './runtimeMetadata';
export {runtimeMetadata} from './runtimeMetadata';
export {type TuningConfig, tuning} from './tuning';

const logger = log4js.getLogger('config');

export interface ServiceAccountConfig {
    userId: string;
    token: string;
}

export interface BackendOidcConfig extends ZitadelIntrospectionOptions {
    apiBaseUrl?: string;
    userinfoEndpoint?: string;
    /** PAT for a service user — enables Management API access (user metadata) */
    serviceToken?: string;
}

export interface config_rc_t {
    oidc?: {
        backend: BackendOidcConfig;
        frontend: any;
    };
    serviceAccounts?: {
        nodered?: ServiceAccountConfig;
        alexa?: ServiceAccountConfig;
        grafana?: ServiceAccountConfig;
    };
    graphs?: {
        grafana: {endpoint: string};
    };
    components: {
        group?: Record<string, object>;
        mail?: Record<string, object>;
        mdns?: Record<string, object>;
        storage?: Record<string, object>;
        user?: Record<string, object>;
        web?: {
            relativeClientPath: string;
            port: number;
            port_ssl: number;
            https_crt: string;
            https_key: string;
            jwt_token: string;
        };
    };
    internalStorage?: {
        connection: {
            host: string;
            port?: number;
            user: string;
            max?: number;
            password?: string;
            database: string;
            connectionTimeoutMillis?: number;
            idleTimeoutMillis?: number;
            allowExitOnIdle?: boolean;
        };
        schema: string;
        cwd: string[];
        link: any;
    };
    observability?: boolean;
    'wipe-components': boolean;
    'dev-mode': boolean;
    'root-user'?: {
        username: string;
        password: string;
    };
    logger: log4js.Configuration;
}

export const configRc: config_rc_t = rc<config_rc_t>('fleet-manager', {
    observability: false,
    'wipe-components': false,
    'dev-mode': false,
    logger: {
        appenders: {
            console: {type: 'console'},
            websocket: {type: websocketAppender}
        },
        categories: {
            default: {
                appenders: ['console', 'websocket'],
                level: envStr('LOG_LEVEL', 'info')
            }
        }
    },
    internalStorage: {
        connection: {
            host: envStr('DB_HOST', 'localhost'),
            user: envStr('DB_USER', 'fleet'),
            max: tuning.db.poolMax,
            // undefined lets pg use peer/trust auth when DB requires no password;
            // empty-string fallback masked misconfiguration.
            password: envOptionalStr('DB_PASSWORD'),
            database: envStr('DB_NAME', 'fleet'),
            connectionTimeoutMillis: tuning.db.connectionTimeoutMs,
            idleTimeoutMillis: tuning.db.idleTimeoutMs,
            allowExitOnIdle: true
        },
        schema: 'migration',
        cwd: [...MIGRATION_DIRS],
        link: {schemas: [...LINKED_SCHEMAS]}
    },
    components: {
        web: {
            port: tuning.http.fmPort,
            port_ssl: WEB_DEFAULT_PORT_SSL,
            https_crt: WEB_DEFAULT_HTTPS_CRT,
            https_key: WEB_DEFAULT_HTTPS_KEY,
            jwt_token: getJwtToken(),
            relativeClientPath: '../../../../frontend/dist'
        }
    }
});

// Make sure all folders are present
const REQUIRED_FOLDERS = ['node-red', 'components', 'registry', 'grafana'];
export async function bootstrapFs() {
    return Promise.all(
        REQUIRED_FOLDERS.map(async (f) => {
            try {
                const folderPath = path.join(__dirname, '../../cfg', f);
                if (!fs.existsSync(folderPath))
                    await fsPromises.mkdir(folderPath);
            } catch (e) {
                logger.error(e);
            }
        })
    );
}

// Explicit only — missing OIDC must NOT silently flip prod into local auth.
export const DEV_MODE = !!configRc['dev-mode'] || envBool('FM_DEV_MODE', false);

// Called from main() so test imports don't trigger boot-time logging.
export function logBootConfig(): void {
    logger.info(
        'RC Config',
        JSON.stringify(redactSecretsForLog(configRc), null, 4)
    );
    logger.info('Tuning Config', JSON.stringify(redactSecretsForLog(tuning)));
    logger.info('Runtime Metadata', JSON.stringify(runtimeMetadata));
    for (const msg of takeEnvRejections()) logger.warn('ENV %s', msg);
}

export function wipeComponentsIfRequested(): void {
    if (!configRc['wipe-components']) return;
    logger.warn('Wipe components flag set to TRUE, resetting everything');

    const componentsDir = path.join(CFG_FOLDER, 'components');
    if (!fs.existsSync(componentsDir)) {
        logger.warn('DELETED 0 configs ');
        return;
    }
    let count = 0;
    for (const file of fs.readdirSync(componentsDir)) {
        if (file.startsWith('.')) continue;
        fs.rmSync(path.join(componentsDir, file));
        count++;
    }
    logger.warn('DELETED %s configs ', count);
}

export function logDevModeBannerIfActive(): void {
    if (!DEV_MODE) return;
    logger.warn('='.repeat(60));
    logger.warn('STARTING IN DEV MODE - LOCAL AUTHENTICATION ENABLED');
    logger.warn('Zitadel authentication is DISABLED');
    logger.warn('Users are authenticated via local database');
    logger.warn('='.repeat(60));
    logger.warn('CFG_FOLDER=%s', CFG_FOLDER);
    logger.warn('STATIC_FOLDER=%s', STATIC_FOLDER);
    logger.warn('PLUGINS_FOLDER=%s', PLUGINS_FOLDER);
}

export function warnIfInsecureProduction(): void {
    if (DEV_MODE) return;
    // Secret checks live in config/secrets.ts — single source for the rules.
    const jwtFromConfig = configRc?.components?.web?.jwt_token;
    const fatal = describeSecretsMisconfiguration(jwtFromConfig);
    if (!configRc?.oidc?.backend) {
        fatal.push(
            'oidc.backend is not configured — Zitadel introspection cannot run. Set OIDC config or FM_DEV_MODE=true for local-only deploys.'
        );
    }
    if (fatal.length > 0) {
        logger.error('='.repeat(60));
        for (const msg of fatal) logger.error(msg);
        logger.error('Set both in deploy/env/<env>.env and redeploy.');
        logger.error('='.repeat(60));
        throw new Error('Insecure non-dev configuration — refusing to start');
    }
    for (const warning of describeSecretsWarnings(jwtFromConfig)) {
        logger.warn(warning);
    }
    if (!envOptionalStr('DB_PASSWORD')) {
        logger.warn(
            'WARNING: DB_PASSWORD is not set — database has no password protection.'
        );
    }
}

/**
 * Check if Zitadel OIDC is properly configured
 */
// Env gate: opt-in for self-hosted / on-prem L2 device discovery.
export function mdnsEnabled(): boolean {
    return envBool('FM_MDNS_ENABLED', false);
}

// Strict mode: any plugin init failure aborts boot.
export function requireAllPlugins(): boolean {
    return envBool('FM_REQUIRE_ALL_PLUGINS', false);
}

// Graceful exit on unhandled rejection / uncaught exception.
// Default OFF: a stray uncaughtException/unhandledRejection (e.g. one report's
// stream 'error') must not take the whole multi-tenant process down — it is
// logged + counted instead (see app.ts handlers). Set FM_EXIT_ON_FATAL_ERRORS
// =true to restore fail-fast (e.g. under an orchestrator that auto-restarts).
export function exitOnFatalErrors(): boolean {
    return envBool('FM_EXIT_ON_FATAL_ERRORS', false);
}

export function isZitadelConfigured(): boolean {
    const backend = configRc?.oidc?.backend;
    if (!backend) return false;

    // Check for authority and authorization config
    return !!(
        backend.authority &&
        backend.authorization &&
        (backend.authorization.type === 'basic' ||
            backend.authorization.type === 'jwt-profile')
    );
}

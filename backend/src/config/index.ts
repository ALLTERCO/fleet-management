import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import * as log4js from 'log4js';
import type {ZitadelIntrospectionOptions} from 'passport-zitadel';
import rc from 'rc';
import websocketAppender from './../websocketAppender';
const logger = log4js.getLogger('config');

export const CFG_FOLDER =
    process.env?.CONFIG_FOLDER || path.join(__dirname, '../../cfg');
export const STATIC_FOLDER =
    process.env?.STATIC_FOLDER || path.join(__dirname, '../../static');
export const PLUGINS_FOLDER =
    process.env?.PLUGINS_FOLDER || path.join(__dirname, '../../plugins');

export interface ServiceAccountConfig {
    userId: string;
    token: string;
}

export interface config_rc_t {
    oidc?: {
        backend: ZitadelIntrospectionOptions & {
            /** PAT for a service user — enables Management API access (user metadata) */
            serviceToken?: string;
        };
        frontend: any;
    };
    serviceAccounts?: {
        nodered?: ServiceAccountConfig;
        alexa?: ServiceAccountConfig;
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
            password: string;
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
    'wipe-node-red': boolean;
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
    'wipe-node-red': false,
    'dev-mode': false,
    logger: {
        appenders: {
            console: {type: 'console'},
            websocket: {type: websocketAppender} as any
        },
        categories: {
            default: {
                appenders: ['console', 'websocket'],
                level: 'all'
            }
        }
    },
    internalStorage: {
        connection: {
            host: 'localhost',
            // port: 5434, // for my dev env
            user: 'fleet',
            max: 60,
            password: 'fleet',
            database: 'fleet',
            connectionTimeoutMillis: 7000,
            idleTimeoutMillis: 15000,
            allowExitOnIdle: true
        },
        schema: 'migration',
        cwd: [
            './db/migration/postgresql/logging',
            './db/migration/postgresql/organization',
            './db/migration/postgresql/user',
            './db/migration/postgresql/ui',
            './db/migration/postgresql/device',
            './db/migration/postgresql/device/groups',
            './db/migration/postgresql/device/em',
            './db/migration/postgresql/notifications'
        ],
        link: {
            schemas: [
                'device',
                'user',
                'ui',
                'organization',
                'device_em',
                'logging',
                'notifications'
            ]
        }
    },
    components: {
        web: {
            port: 7011,
            port_ssl: -1,
            https_crt: '/path/to/cert.crt',
            https_key: '/path/to/cert.key',
            jwt_token: 'shelly-secret-token',
            relativeClientPath: '../../../../frontend/dist'
        }
    }
});

const REDACT_PATTERNS = /secret|password|token|masterkey|key/i;
function redactForLog(obj: unknown): unknown {
    return JSON.parse(
        JSON.stringify(obj, (k, v) =>
            typeof v === 'string' && REDACT_PATTERNS.test(k) ? '[REDACTED]' : v
        )
    );
}
logger.info('RC Config', JSON.stringify(redactForLog(configRc), null, 4));

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

// wipe flag has been set
if (configRc['wipe-components']) {
    logger.warn('Wipe components flag set to TRUE, resetting everything');

    let count = 0;
    for (const file of fs.readdirSync(path.join(CFG_FOLDER, 'components'))) {
        if (file.startsWith('.')) continue;
        fs.rmSync(path.join(CFG_FOLDER, 'components', file));
        count++;
    }

    logger.warn('DELETED %s configs ', count);
}

export const DEV_MODE = !!configRc['dev-mode'];

// Validate Zitadel configuration - required for authentication (unless in dev mode)
if (!configRc?.oidc?.backend && !DEV_MODE) {
    logger.error(
        'OIDC configuration is required but not found in .fleet-managerrc'
    );
    logger.error(
        'Please configure the "oidc.backend" section with Zitadel credentials'
    );
    logger.error('Or set "dev-mode": true to use local authentication');
}

if (DEV_MODE) {
    logger.warn('='.repeat(60));
    logger.warn('STARTING IN DEV MODE - LOCAL AUTHENTICATION ENABLED');
    logger.warn('Zitadel authentication is DISABLED');
    logger.warn('Users are authenticated via local database');
    logger.warn('='.repeat(60));
    console.table({
        CFG_FOLDER,
        STATIC_FOLDER,
        PLUGINS_FOLDER
    });
}

/**
 * Check if Zitadel OIDC is properly configured
 */
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

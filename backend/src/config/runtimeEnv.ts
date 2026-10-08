import {envBool, envInt, envOptionalStr, envStr} from './envReader';

export function storageConnectionFromEnv() {
    return {
        host: envStr('DB_HOST', envStr('POSTGRES_HOST', 'localhost')),
        port: envInt('DB_PORT', envInt('POSTGRES_PORT', 5_432, 1), 1),
        user: envStr('DB_USER', envStr('POSTGRES_USER', 'fleet')),
        password:
            envOptionalStr('DB_PASSWORD') ??
            envOptionalStr('POSTGRES_PASSWORD'),
        database: envStr('DB_NAME', envStr('POSTGRES_DB', 'fleet'))
    };
}

export function httpPortFromEnv(): number {
    return envInt('FM_HTTP_PORT', envInt('FLEET_MANAGER_PORT', 7_011, 1), 1);
}

export function observabilityEnabledFromEnv(): boolean {
    return envBool('FM_OBSERVABILITY', false);
}

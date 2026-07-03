// OIDC introspection auth: pick basic or jwt-profile from FM_OIDC_AUTH_METHOD.
// jwt-profile loads the app key JSON from OIDC_INTROSPECTION_KEY_PATH.

import {readFileSync} from 'node:fs';
import type {ZitadelIntrospectionOptions} from 'passport-zitadel';
import {envStr} from '../../config/envReader';

interface ZitadelJwtProfile {
    type: 'application';
    keyId: string;
    key: string;
    appId: string;
    clientId: string;
}

const JWT_PROFILE_REQUIRED_KEYS: ReadonlyArray<keyof ZitadelJwtProfile> = [
    'type',
    'keyId',
    'key',
    'appId',
    'clientId'
];

function parseJwtProfile(raw: string, sourcePath: string): ZitadelJwtProfile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(
            `OIDC introspection key file ${sourcePath} is not valid JSON: ${
                (err as Error).message
            }`
        );
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(
            `OIDC introspection key file ${sourcePath} did not contain a JSON object`
        );
    }
    const obj = parsed as Record<string, unknown>;
    for (const key of JWT_PROFILE_REQUIRED_KEYS) {
        if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
            throw new Error(
                `OIDC introspection key file ${sourcePath} is missing required field '${key}'`
            );
        }
    }
    if (obj.type !== 'application') {
        throw new Error(
            `OIDC introspection key file ${sourcePath} has type='${String(
                obj.type
            )}' (expected 'application')`
        );
    }
    return parsed as ZitadelJwtProfile;
}

function loadJwtProfile(
    keyPath: string,
    readFile: (p: string) => string
): ZitadelJwtProfile {
    let raw: string;
    try {
        raw = readFile(keyPath);
    } catch (err) {
        throw new Error(
            `OIDC introspection key file ${keyPath} could not be read: ${
                (err as Error).message
            }`
        );
    }
    return parseJwtProfile(raw, keyPath);
}

// Deps injected for tests; default reader is fs.readFileSync.
export interface BuildIntrospectionDeps {
    readFile?: (path: string) => string;
    envOverride?: Partial<{
        FM_OIDC_AUTH_METHOD: string;
        OIDC_INTROSPECTION_KEY_PATH: string;
    }>;
}

// Returns the rc-loaded backend untouched unless FM_OIDC_AUTH_METHOD=jwt-profile.
export function buildIntrospectionOptions(
    backend: ZitadelIntrospectionOptions,
    deps: BuildIntrospectionDeps = {}
): ZitadelIntrospectionOptions {
    const readFile =
        deps.readFile ?? ((p: string) => readFileSync(p, {encoding: 'utf8'}));
    const method =
        deps.envOverride?.FM_OIDC_AUTH_METHOD ??
        envStr('FM_OIDC_AUTH_METHOD', '').trim();

    if (method === '' || method === 'basic') {
        // Guard against rc-config drift: env says basic but the loaded
        // backend says jwt-profile (no inline profile field). Refuse rather
        // than hand passport-zitadel a half-built object.
        if (backend.authorization?.type === 'jwt-profile') {
            throw new Error(
                "FM_OIDC_AUTH_METHOD=basic but rc config has authorization.type='jwt-profile' — regenerate fm-runtime.env"
            );
        }
        return backend;
    }
    if (method !== 'jwt-profile') {
        throw new Error(
            `FM_OIDC_AUTH_METHOD='${method}' is not supported (use 'basic' or 'jwt-profile')`
        );
    }

    const keyPath =
        deps.envOverride?.OIDC_INTROSPECTION_KEY_PATH ??
        envStr('OIDC_INTROSPECTION_KEY_PATH', '').trim();
    if (keyPath === '') {
        throw new Error(
            'FM_OIDC_AUTH_METHOD=jwt-profile requires OIDC_INTROSPECTION_KEY_PATH to point at a Zitadel app-key JSON file'
        );
    }
    const profile = loadJwtProfile(keyPath, readFile);
    return {
        ...backend,
        authorization: {type: 'jwt-profile', profile}
    };
}

// Single home for "which paths must the SPA index.html fallback NOT answer".
// These belong to the API / system / operator surface and must reach their own
// route (or 404). Serving the template for one of them is what hid /version
// behind the SPA — keep this list and its test as the guard against that.

import {isNodeRedPath} from './authToken';

const NON_SPA_PREFIXES = [
    '/rpc',
    '/grafana',
    '/api',
    '/health',
    '/version',
    '/metrics',
    '/media',
    '/uploads',
    '/auth/login_flow',
    '/admin'
];

// A path ending in a file extension is a static asset; a miss must 404, not
// load index.html as JS/CSS.
const STATIC_ASSET = /\.\w+$/;

// True when the SPA fallback must skip this path (route it or let it 404).
// Reserved API/system/operator prefix. No static-asset rule: the dev Vite
// proxy serves assets (with extensions), so it guards on prefixes only.
export function isReservedBackendPath(path: string): boolean {
    if (isNodeRedPath(path)) return true;
    return NON_SPA_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isNonSpaPath(path: string): boolean {
    return isReservedBackendPath(path) || STATIC_ASSET.test(path);
}

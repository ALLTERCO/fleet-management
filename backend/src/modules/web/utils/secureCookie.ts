// True if the request reached us over TLS, including via reverse proxy.

import type express from 'express';

export function isSecureRequest(req: express.Request): boolean {
    const forwardedProto = req
        .get('x-forwarded-proto')
        ?.split(',')
        .map((value) => value.trim().toLowerCase());
    return (
        req.secure ||
        req.protocol === 'https' ||
        forwardedProto?.includes('https') ||
        req.get('x-forwarded-ssl')?.toLowerCase() === 'on'
    );
}

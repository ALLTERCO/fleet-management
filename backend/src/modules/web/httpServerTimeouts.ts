import type http from 'node:http';
import type https from 'node:https';
import {tuning} from '../../config';

// The proxy must close an idle upstream connection first; Node's 5 s default makes it send onto a closing socket (502).
export function applyHttpServerTimeouts(
    server: http.Server | https.Server
): void {
    server.keepAliveTimeout = tuning.http.keepAliveTimeoutMs;
    server.setTimeout(tuning.http.httpSocketTimeoutMs);
}

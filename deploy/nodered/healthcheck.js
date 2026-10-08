// Healthy only when the admin API answers through our proxy guard. The image's
// own check accepts any status below 500, so a 403 would still count as up.
// auth/login needs no editor user, so the check signs no user token.
const http = require('node:http');

const adminRoot = (process.env.NODE_RED_HTTP_ADMIN_ROOT || '/node-red/red').replace(/\/+$/, '');
const secret = process.env.NODE_RED_PROXY_SECRET || process.env.FM_NODE_RED_PROXY_SECRET || '';

const request = http.get(
    {
        host: '127.0.0.1',
        port: process.env.PORT || 1880,
        path: `${adminRoot}/auth/login`,
        headers: {'x-fm-node-red-proxy-secret': secret, accept: 'application/json'},
        timeout: 4000
    },
    (res) => {
        res.resume();
        process.exit(res.statusCode === 200 ? 0 : 1);
    }
);
request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => process.exit(1));

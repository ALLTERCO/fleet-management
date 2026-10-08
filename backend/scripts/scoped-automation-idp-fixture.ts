import {
    createServer,
    type IncomingMessage,
    type ServerResponse
} from 'node:http';

const port = requiredInteger('FM_SCOPED_IDP_PORT');
const serviceToken = required('FM_SCOPED_IDP_SERVICE_TOKEN');
const userId = process.env.FM_SCOPED_IDP_USER_ID?.trim() || 'admin';
const tenantId = process.env.FM_SCOPED_IDP_TENANT_ID?.trim() || 'default';
const projectId =
    process.env.FM_SCOPED_IDP_PROJECT_ID?.trim() || 'fleet-project';
const roleKey = process.env.FM_SCOPED_IDP_ROLE_KEY?.trim() || 'admin';
const issuer = `http://127.0.0.1:${port}`;

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function requiredInteger(name: string): number {
    const parsed = Number(required(name));
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`${name} must be a TCP port`);
    }
    return parsed;
}

function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, {'content-type': 'application/json'});
    response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage): boolean {
    return request.headers.authorization === `Bearer ${serviceToken}`;
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', issuer);
    if (request.method === 'GET' && url.pathname === '/health/ready') {
        json(response, 200, {ready: true, fixture: 'simulated-idp'});
        return;
    }
    if (
        request.method === 'GET' &&
        url.pathname === '/.well-known/openid-configuration'
    ) {
        json(response, 200, {
            issuer,
            introspection_endpoint: `${issuer}/oauth/v2/introspect`,
            jwks_uri: `${issuer}/oauth/v2/keys`
        });
        return;
    }
    if (request.method === 'GET' && url.pathname === '/oauth/v2/keys') {
        json(response, 200, {keys: []});
        return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/v2/introspect') {
        json(response, 200, {active: false});
        return;
    }
    if (!authorized(request)) {
        json(response, 401, {message: 'invalid fixture service token'});
        return;
    }
    if (
        request.method === 'GET' &&
        url.pathname === `/v2/users/${encodeURIComponent(userId)}`
    ) {
        json(response, 200, {
            user: {
                id: userId,
                state: 'USER_STATE_ACTIVE',
                details: {resourceOwner: tenantId}
            }
        });
        return;
    }
    if (
        request.method === 'POST' &&
        url.pathname ===
            '/zitadel.authorization.v2.AuthorizationService/ListAuthorizations'
    ) {
        json(response, 200, {
            authorizations: [
                {
                    id: 'fixture-authorization',
                    project: {id: projectId, organizationId: tenantId},
                    organization: {id: tenantId},
                    user: {id: userId},
                    roles: [{key: roleKey}]
                }
            ]
        });
        return;
    }
    json(response, 404, {message: 'fixture endpoint not implemented'});
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
        `${JSON.stringify({ready: true, fixture: 'simulated-idp', issuer})}\n`
    );
});

function shutdown(): void {
    server.close((error) => {
        if (error) {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        }
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

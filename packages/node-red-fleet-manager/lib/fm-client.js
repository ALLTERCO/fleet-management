const {auditHeaders} = require('./audit');

const DEFAULT_TIMEOUT_MS = 30000;

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function tokenForServer(server) {
    return (
        server.token ||
        server.credentials?.token ||
        process.env.FM_NODE_RED_SERVICE_TOKEN ||
        ''
    );
}

function baseUrlForServer(server) {
    return trimTrailingSlash(
        server.baseUrl || process.env.FM_BASE_URL || 'http://fleet-manager:7011'
    );
}

function wsUrlForServer(server) {
    const configured =
        server.wsUrl || process.env.FM_WS_URL || 'ws://fleet-manager:7011/';
    return trimTrailingSlash(configured);
}

function rpcTimeoutMs() {
    const configured = Number(process.env.FM_NODE_RED_RPC_TIMEOUT_MS);
    return configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function rpcRequest(server, call) {
    return {
        method: 'POST',
        headers: {
            authorization: `Bearer ${tokenForServer(server)}`,
            'content-type': 'application/json',
            ...auditHeaders(call.audit)
        },
        body: JSON.stringify({method: call.method, params: call.params || {}}),
        signal: AbortSignal.timeout(call.timeoutMs || rpcTimeoutMs())
    };
}

async function fetchRpc(url, request) {
    try {
        return await fetch(url, request);
    } catch (error) {
        if (error?.name === 'TimeoutError') {
            throw new Error('Fleet Manager RPC timed out');
        }
        throw error;
    }
}

function rpcFailure(response, body) {
    return new Error(
        body?.error?.message ||
            body?.message ||
            `Fleet Manager RPC failed with HTTP ${response.status}`
    );
}

// FM's /rpc answers the bare result with 2xx and {error} with 4xx/5xx, so a
// result may itself hold `result` or `error` fields.
function rpcResult(response, body) {
    if (!response.ok) throw rpcFailure(response, body);
    return body;
}

/** call: {method, params?, audit?, timeoutMs?} */
async function callRpc(server, call) {
    if (!tokenForServer(server)) {
        throw new Error('Fleet Manager service token is not configured');
    }
    if (!call.method) throw new Error('Fleet Manager method is not configured');
    const response = await fetchRpc(
        `${baseUrlForServer(server)}/rpc`,
        rpcRequest(server, call)
    );
    const body = await response.json().catch(() => ({}));
    return rpcResult(response, body);
}

module.exports = {
    baseUrlForServer,
    callRpc,
    tokenForServer,
    wsUrlForServer
};

const {
    HOOK_ROUTE,
    hookMessage,
    isValidHookId,
    providedSecret,
    requestBody,
    secretMatches
} = require('../webhook');
const {fleetContext} = require('./context');

const FLOW_REPLY_TIMEOUT_MS = 30000;

function rejection(status, error) {
    return {status, error};
}

function accessProblem(hook, req) {
    if (!hook.secret) return rejection(503, 'hook secret is not set');
    if (!secretMatches(hook.secret, providedSecret(req, hook.allowQueryToken))) {
        return rejection(401, 'invalid hook secret');
    }
    return null;
}

async function bodyOrProblem(req) {
    try {
        return {body: await requestBody(req)};
    } catch (error) {
        return {problem: rejection(error?.status || 400, 'unreadable body')};
    }
}

// A flow that never answers must not hold the caller forever.
function replyDeadline(res) {
    const timer = setTimeout(() => {
        if (!res.headersSent)
            res.status(504).json({error: 'flow did not reply'});
    }, FLOW_REPLY_TIMEOUT_MS);
    timer.unref?.();
}

const RESPONDERS = {
    auto: (msg, exchange) => {
        exchange.res.status(202).json({accepted: true});
        return msg;
    },
    flow: (msg, exchange) => {
        replyDeadline(exchange.res);
        return {...msg, req: exchange.req, res: {_res: exchange.res}};
    }
};

/** hook: {node, ctx, secret, respond}; exchange: {req, res} */
async function acceptHook(hook, exchange) {
    const {req, res} = exchange;
    const denied = accessProblem(hook, req);
    if (denied) {
        res.status(denied.status).json({error: denied.error});
        return;
    }
    const read = await bodyOrProblem(req);
    if (read.problem) {
        res.status(read.problem.status).json({error: read.problem.error});
        return;
    }
    const respond = RESPONDERS[hook.respond] || RESPONDERS.auto;
    hook.node.send(respond(hookMessage(req, read.body), exchange));
    hook.ctx.ran();
}

function hookDispatcher(hooks) {
    return (req, res) => {
        const handler = hooks.get(String(req.params.hookId));
        if (!handler) {
            res.status(404).json({error: 'unknown hook'});
            return;
        }
        return handler(req, res).catch(() => failQuietly(res));
    };
}

function failQuietly(res) {
    if (!res.headersSent) res.status(500).json({error: 'hook failed'});
}

function registerHookRoute(runtime) {
    const dispatch = hookDispatcher(runtime.hooks);
    runtime.RED.httpNode.post(HOOK_ROUTE, dispatch);
    runtime.RED.httpNode.put(HOOK_ROUTE, dispatch);
    runtime.RED.httpNode.get(HOOK_ROUTE, dispatch);
}

function claimHookId(hooks, hookId) {
    if (!isValidHookId(hookId)) return 'bad hook id';
    if (hooks.has(hookId)) return 'hook id already used';
    return '';
}

function registerWebhookInNode(runtime) {
    const {RED, hooks} = runtime;
    registerHookRoute(runtime);
    function FleetManagerWebhookInNode(config) {
        RED.nodes.createNode(this, config);
        const hookId = String(config.hookId || '');
        const problem = claimHookId(hooks, hookId);
        if (problem) {
            this.status({fill: 'red', shape: 'ring', text: problem});
            this.error(`fm-webhook-in: ${problem} (${hookId})`);
            return;
        }
        const hook = {
            node: this,
            ctx: fleetContext(runtime, {
                node: this,
                config,
                nodeType: 'fm-webhook-in'
            }),
            secret: this.credentials?.secret || '',
            allowQueryToken: config.allowQueryToken === true,
            respond: config.respond
        };
        const handler = (req, res) => acceptHook(hook, {req, res});
        hooks.set(hookId, handler);
        this.status(
            hook.secret
                ? {
                      fill: 'green',
                      shape: 'dot',
                      text: `/automation-hooks/${hookId}`
                  }
                : {fill: 'yellow', shape: 'ring', text: 'set a secret'}
        );
        this.on('close', (_removed, done) => {
            if (hooks.get(hookId) === handler) hooks.delete(hookId);
            if (typeof done === 'function') done();
        });
    }
    RED.nodes.registerType('fm-webhook-in', FleetManagerWebhookInNode, {
        credentials: {
            secret: {type: 'password'}
        }
    });
}

module.exports = {
    registerWebhookInNode
};

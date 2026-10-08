const {isDeniedMethod, methodByFullName} = require('../catalog');
const {paramsFromConfigOrMessage} = require('../params');
const {paramsWithTarget} = require('../target');
const {fleetContext} = require('./context');

// Must match the editor list in nodes/fm-nodes.html and the catalog nodes.
const OPERATION_NODE_TYPES = [
    'fm-rpc',
    'fm-tag',
    'fm-group',
    'fm-location',
    'fm-device',
    'fm-component-catalog',
    'fm-component-state',
    'fm-component-action',
    'fm-schedule',
    'fm-variable',
    'fm-webhook',
    'fm-script',
    'fm-firmware',
    'fm-backup',
    'fm-certificate',
    'fm-diagnostics',
    'fm-alert',
    'fm-report',
    'fm-energy',
    'fm-notification',
    'fm-audit'
];

// msg.fm.method only records what an earlier node called; never reuse it.
function configuredMethod(config, msg) {
    return config.operation || msg?.method || msg?.topic || '';
}

function checkedMethod(config, msg) {
    const method = configuredMethod(config, msg);
    if (isDeniedMethod(method)) {
        throw new Error(`${method} is not available to Node-RED automations`);
    }
    return method;
}

function callParams(config, msg, method) {
    return paramsWithTarget({
        params: paramsFromConfigOrMessage(config, msg),
        target: msg?.fm?.target,
        targetSchema: methodByFullName(method)?.paramsSchema?.properties?.target
    });
}

// Inputs meant for this node are used up, so the next node cannot reuse them.
// Kept on failure, so a catch node can retry with them.
function resultMessage(msg, outcome) {
    const {target: _usedTarget, ...fm} = msg.fm || {};
    delete msg.params;
    delete msg.method;
    msg.payload = outcome.result;
    msg.fm = {...fm, ...outcome.call};
    return msg;
}

/** operation: {config, ctx, type} */
async function runOperation(operation, msg) {
    const {config, ctx, type} = operation;
    if (!ctx.server) throw new Error('Fleet Manager server is missing');
    const method = checkedMethod(config, msg);
    const params = callParams(config, msg, method);
    const result = await ctx.rpc(method, params);
    return resultMessage(msg, {result, call: {method, nodeType: type, params}});
}

/** delivery: {msg, send, done} */
async function deliverOperation(operation, delivery) {
    try {
        delivery.send(await runOperation(operation, delivery.msg));
        operation.ctx.ran();
        delivery.done();
    } catch (error) {
        operation.ctx.failed(error);
        delivery.done(error);
    }
}

function registerOperationNode(runtime, type) {
    const {RED} = runtime;
    function FleetManagerOperationNode(config) {
        RED.nodes.createNode(this, config);
        const ctx = fleetContext(runtime, {node: this, config, nodeType: type});
        const operation = {config, ctx, type};
        this.on('input', (msg, send, done) => {
            void deliverOperation(operation, {
                msg,
                send: send || this.send.bind(this),
                done: done || ((error) => error && this.error(error, msg))
            });
        });
    }
    RED.nodes.registerType(type, FleetManagerOperationNode);
}

function registerOperationNodes(runtime) {
    for (const type of OPERATION_NODE_TYPES)
        registerOperationNode(runtime, type);
}

module.exports = {
    OPERATION_NODE_TYPES,
    registerOperationNodes
};

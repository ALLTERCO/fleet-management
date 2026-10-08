// What every FM node needs: its server, who it is (audit), and a way to
// report runs and errors back to FM.

const {auditContext} = require('../audit');
const {callRpc} = require('../fm-client');

function errorMessage(error) {
    return error?.message || String(error);
}

/** spec: {node, config, nodeType} */
function fleetContext(runtime, spec) {
    const {RED, reportActivity} = runtime;
    const server = RED.nodes.getNode(spec.config.server) || null;
    const audit = auditContext(RED, spec.node);
    const activity = {
        ...audit,
        nodeType: spec.nodeType,
        warn: (text) => spec.node.warn(text)
    };
    return {
        server,
        audit,
        rpc: (method, params) => callRpc(server || {}, {method, params, audit}),
        ran: () => reportActivity(server || {}, {...activity, kind: 'run'}),
        failed: (error) =>
            reportActivity(server || {}, {
                ...activity,
                kind: 'error',
                message: errorMessage(error)
            })
    };
}

module.exports = {
    errorMessage,
    fleetContext
};

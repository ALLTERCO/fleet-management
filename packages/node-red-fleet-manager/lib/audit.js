// Which flow and node made a call. FM records it next to the shared service user.

function envSetting(RED, node, name) {
    try {
        const value = RED.util.evaluateNodeProperty(name, 'env', node);
        return typeof value === 'string' ? value : '';
    } catch {
        // Older runtimes and test fakes have no NR_* env settings.
        return '';
    }
}

function auditContext(RED, node) {
    return {
        flowId: envSetting(RED, node, 'NR_FLOW_ID') || node.z || '',
        nodeId: envSetting(RED, node, 'NR_NODE_ID') || node.id || '',
        flowName: envSetting(RED, node, 'NR_FLOW_NAME')
    };
}

function auditHeaders(audit) {
    if (!audit) return {};
    return {
        'x-fm-automation-flow-id': String(audit.flowId || ''),
        'x-fm-automation-node-id': String(audit.nodeId || ''),
        'x-fm-automation-flow-name': encodeURIComponent(audit.flowName || '')
    };
}

module.exports = {
    auditContext,
    auditHeaders
};

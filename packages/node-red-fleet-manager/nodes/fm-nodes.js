const {createActivityReporter} = require('../lib/activity');
const {registerAdminRoutes} = require('../lib/admin-routes');
const {createScopeLookups} = require('../lib/device-scope');
const {callRpc} = require('../lib/fm-client');
const {
    registerServerNode,
    registerTargetNode
} = require('../lib/nodes/config-nodes');
const {registerEventNodes} = require('../lib/nodes/event-nodes');
const {registerOperationNodes} = require('../lib/nodes/operation-node');
const {registerWebhookInNode} = require('../lib/nodes/webhook-in-node');

module.exports = function registerFleetManagerNodes(RED) {
    const runtime = {
        RED,
        reportActivity: createActivityReporter({send: callRpc}),
        scopeLookups: createScopeLookups(),
        hooks: new Map()
    };
    registerServerNode(runtime);
    registerTargetNode(runtime);
    registerOperationNodes(runtime);
    registerEventNodes(runtime);
    registerWebhookInNode(runtime);
    registerAdminRoutes(RED);
};

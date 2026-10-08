const {targetFromConfig} = require('../target');

function registerServerNode(runtime) {
    const {RED} = runtime;
    function FleetManagerServerNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.baseUrl = config.baseUrl;
        this.wsUrl = config.wsUrl;
        this.token = this.credentials?.token;
    }
    RED.nodes.registerType('fm-server', FleetManagerServerNode, {
        credentials: {
            token: {type: 'password'}
        }
    });
}

function registerTargetNode(runtime) {
    const {RED} = runtime;
    function FleetManagerTargetNode(config) {
        RED.nodes.createNode(this, config);
        this.on('input', (msg, send, done) => {
            try {
                msg.fm = {...(msg.fm || {}), target: targetFromConfig(config)};
                (send || this.send.bind(this))(msg);
                if (done) done();
            } catch (error) {
                if (done) done(error);
                else this.error(error, msg);
            }
        });
    }
    RED.nodes.registerType('fm-target', FleetManagerTargetNode);
}

module.exports = {
    registerServerNode,
    registerTargetNode
};

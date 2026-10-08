// Editor endpoints: method catalog, device/group/place pickers and the
// installed node definitions Fleet Manager validates graphs against.
// The browser never sees the token; the runtime calls FM with it.

const {methodsForNode} = require('./catalog');
const {callRpc} = require('./fm-client');
const {FM_METHODS} = require('./fm-methods');
const {nodeDefinitionsHandler} = require('./node-definitions');

const ROOT = '/fleet-manager-node-red';
const READ_PERMISSION = 'fm-server.read';
// Node-RED's own permission for reading the installed node registry.
const NODES_READ_PERMISSION = 'nodes.read';
const PICKER_LIMIT = 1000;
const MAX_ERROR_TEXT = 200;

function deviceLabel(item) {
    const name = item.info?.name || item.name;
    return name ? `${name} (${item.shellyID})` : String(item.shellyID);
}

const PICKERS = {
    devices: {
        call: {method: FM_METHODS.listDevices, params: {limit: 0}},
        option: (item) => ({
            value: String(item.shellyID),
            label: deviceLabel(item)
        })
    },
    groups: {
        call: {method: FM_METHODS.listGroups, params: {limit: PICKER_LIMIT}},
        option: (item) => ({value: String(item.id), label: String(item.name)})
    },
    locations: {
        call: {method: FM_METHODS.listPlaces, params: {limit: PICKER_LIMIT}},
        option: (item) => ({
            value: String(item.id),
            label: `${item.name} (${item.kind})`
        })
    }
};

// An unsaved config node is unknown to the runtime; fall back to the
// sidecar's env connection (FM_BASE_URL + FM_NODE_RED_SERVICE_TOKEN).
function serverFor(RED, id) {
    const node = RED.nodes.getNode(id);
    return node?.type === 'fm-server' ? node : {};
}

async function pickerOptions(server, picker) {
    const result = await callRpc(server, picker.call);
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.map(picker.option);
}

function isControlCharacter(char) {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
}

function singleLine(text) {
    return [...text]
        .map((char) => (isControlCharacter(char) ? ' ' : char))
        .join('');
}

// One short line for the editor; never echoes a bearer token.
function editorErrorText(error) {
    const text = String(error?.message || error).replace(
        /bearer\s+\S+/gi,
        'Bearer ***'
    );
    return singleLine(text).trim().slice(0, MAX_ERROR_TEXT);
}

function pickerHandler(RED) {
    return async (req, res) => {
        const picker = Object.hasOwn(PICKERS, req.params.kind)
            ? PICKERS[req.params.kind]
            : undefined;
        if (!picker) {
            res.status(404).json({error: 'unknown picker'});
            return;
        }
        try {
            res.json(
                await pickerOptions(serverFor(RED, req.params.id), picker)
            );
        } catch (error) {
            res.status(502).json({error: editorErrorText(error)});
        }
    };
}

function catalogHandler(req, res) {
    res.json(methodsForNode(req.params.nodeKey));
}

function registerAdminRoutes(RED) {
    const canRead = RED.auth.needsPermission(READ_PERMISSION);
    RED.httpAdmin.get(`${ROOT}/catalog/:nodeKey`, canRead, catalogHandler);
    RED.httpAdmin.get(`${ROOT}/server/:id/:kind`, canRead, pickerHandler(RED));
    RED.httpAdmin.get(
        `${ROOT}/node-definitions`,
        RED.auth.needsPermission(NODES_READ_PERMISSION),
        nodeDefinitionsHandler(RED)
    );
}

module.exports = {
    READ_PERMISSION,
    registerAdminRoutes
};

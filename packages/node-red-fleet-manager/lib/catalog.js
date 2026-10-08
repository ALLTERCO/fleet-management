const catalog = require('../generated/catalog.json');

// Built once at load: a message must not scan 1000+ entries.
const methodsByName = new Map(
    catalog.methods.map((method) => [method.fullMethod.toLowerCase(), method])
);
const nodesByKey = new Map(catalog.nodes.map((node) => [node.key, node]));
const deniedNames = new Set(
    (catalog.deniedMethods || []).map((name) => name.toLowerCase())
);

function nodeByKey(key) {
    return nodesByKey.get(key);
}

function methodsForNode(key) {
    const node = nodesByKey.get(key);
    if (!node) return [];
    return node.methods
        .map((name) => methodsByName.get(name.toLowerCase()))
        .filter(Boolean);
}

function methodByFullName(fullMethod) {
    return methodsByName.get(String(fullMethod).toLowerCase());
}

function isDeniedMethod(fullMethod) {
    return deniedNames.has(String(fullMethod).toLowerCase());
}

module.exports = {
    catalog,
    isDeniedMethod,
    methodByFullName,
    methodsForNode,
    nodeByKey
};

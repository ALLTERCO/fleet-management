function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value, label) {
    if (value === undefined || value === null || value === '') return {};
    if (isPlainObject(value)) return value;
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a JSON object`);
    }
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
}

// Auto mode guesses; a timestamp or text payload just means "no params".
function lenientJsonObject(value) {
    try {
        return parseJsonObject(value, 'value');
    } catch {
        return {};
    }
}

function messagePath(msg, path) {
    return String(path)
        .replace(/^msg\./, '')
        .split('.')
        .filter(Boolean)
        .reduce((value, part) => {
            if (value === undefined || value === null) return undefined;
            return value[part];
        }, msg);
}

function autoParams(msg) {
    const msgParams = lenientJsonObject(msg.params);
    if (Object.keys(msgParams).length > 0) return msgParams;
    return lenientJsonObject(msg.payload);
}

const PARAM_SOURCES = {
    auto: (_config, msg) => autoParams(msg),
    config: (config) => parseJsonObject(config.paramsJson, 'configured params'),
    'msg.payload': (_config, msg) =>
        parseJsonObject(msg.payload, 'msg.payload'),
    'msg.params': (_config, msg) => parseJsonObject(msg.params, 'msg.params'),
    merge: (config, msg) => ({
        ...parseJsonObject(config.paramsJson, 'configured params'),
        ...parseJsonObject(msg.params || {}, 'msg.params')
    })
};

function paramsFromConfigOrMessage(config, msg) {
    const source = config.paramsSource || 'auto';
    const strategy = PARAM_SOURCES[source];
    if (strategy) return strategy(config, msg);
    return parseJsonObject(messagePath(msg, source) || {}, source);
}

module.exports = {
    isPlainObject,
    messagePath,
    parseJsonObject,
    paramsFromConfigOrMessage
};

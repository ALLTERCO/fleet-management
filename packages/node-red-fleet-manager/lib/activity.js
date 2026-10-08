// Tells FM a node ran or failed, so its screens show last run and recent errors.
// Throttled and fire-and-forget: reporting must never slow or break a flow,
// but a refused report warns the node so a broken permission setup shows.

const {FM_METHODS} = require('./fm-methods');

const MIN_INTERVAL_MS = {run: 30000, error: 5000};
const MAX_MESSAGE_LENGTH = 500;
const REFUSAL_WARNING_INTERVAL_MS = 10 * 60000;

function throttleKey(entry) {
    return `${entry.nodeId}:${entry.kind}`;
}

function isDue(lastSentAt, entry, now) {
    const last = lastSentAt.get(throttleKey(entry));
    return last === undefined || now - last >= MIN_INTERVAL_MS[entry.kind];
}

function activityParams(entry) {
    return {
        flowId: entry.flowId,
        nodeId: entry.nodeId,
        nodeType: entry.nodeType,
        kind: entry.kind,
        ...(entry.message
            ? {message: String(entry.message).slice(0, MAX_MESSAGE_LENGTH)}
            : {})
    };
}

function refusalWarning(error) {
    return `Fleet Manager refused the activity report (${error?.message || error}); check the Node-RED service account`;
}

/** Warns at most once per interval per node; returns nothing. */
function createRefusalWarner(now) {
    const lastWarnedAt = new Map();
    return function warnRefused(entry, error) {
        const at = now();
        const last = lastWarnedAt.get(entry.nodeId);
        if (last !== undefined && at - last < REFUSAL_WARNING_INTERVAL_MS)
            return;
        lastWarnedAt.set(entry.nodeId, at);
        entry.warn?.(refusalWarning(error));
    };
}

/** request: {server, call, onRefused(error)} */
async function sendQuietly(send, request) {
    try {
        await send(request.server, request.call);
    } catch (error) {
        request.onRefused(error);
    }
}

function withoutWarn(entry) {
    const {warn: _warn, ...data} = entry;
    return data;
}

/** options: {send(server, call), now?()}; entry.warn?(text) tells the node. */
function createActivityReporter(options) {
    const lastSentAt = new Map();
    const now = options.now || Date.now;
    const warnRefused = createRefusalWarner(now);
    return function reportActivity(server, entry) {
        const at = now();
        if (!server || !isDue(lastSentAt, entry, at)) return;
        lastSentAt.set(throttleKey(entry), at);
        const data = withoutWarn(entry);
        void sendQuietly(options.send, {
            server,
            call: {
                method: FM_METHODS.reportActivity,
                params: activityParams(data),
                audit: data
            },
            onRefused: (error) => warnRefused(entry, error)
        });
    };
}

module.exports = {
    createActivityReporter
};

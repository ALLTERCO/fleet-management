// Shared plumbing for every node that listens to FM events: scope lookup,
// one subscription, local scope check, cleanup on redeploy.

const {
    ScopeTracker,
    isEventInScope,
    scopeFromConfig,
    scopeKey,
    scopeProblem,
    scopedSubscribeOptions
} = require('../device-scope');
const {EventStream} = require('../event-stream');
const {errorMessage, fleetContext} = require('./context');

function redStatus(text) {
    return {fill: 'red', shape: 'ring', text};
}

// Two server nodes may point at one FM with different tokens: key by node.
function lookupKey(server, scope) {
    return `${server.id || server.baseUrl || ''}|${scopeKey(scope)}`;
}

function startWhenScopeKnown(stream) {
    return () => {
        if (stream.started) stream.refreshSubscription();
        else stream.start();
    };
}

/**
 * spec: {node, config, nodeType, events, baseOptions?, needRows?,
 *   onEvent(frame, watch), onSubscribed?(watch), onStop?()}
 * Returns the watch, or null when the config cannot work.
 */
function watchFleetEvents(runtime, spec) {
    const {node, config} = spec;
    const scope = scopeFromConfig(config);
    const problem = scopeProblem(scope);
    if (problem) {
        node.status(redStatus(problem));
        return null;
    }
    const ctx = fleetContext(runtime, spec);
    if (!ctx.server) {
        node.status(redStatus('missing server'));
        return null;
    }
    const watch = {ctx, node};
    watch.tracker = new ScopeTracker({
        scope,
        rpc: ctx.rpc,
        needRows: spec.needRows,
        refreshMinutes: config.refreshMinutes,
        lookups: runtime.scopeLookups,
        lookupKey: lookupKey(ctx.server, scope),
        onChange: () => watch.onScopeChange(),
        onError: (error) => {
            if (!watch.tracker.isReady())
                node.status(redStatus('device lookup failed'));
            node.warn(`device scope lookup failed: ${errorMessage(error)}`);
            ctx.failed(error);
        }
    });
    watch.stream = new EventStream(node, {
        server: ctx.server,
        events: spec.events,
        subscribeOptions: () =>
            scopedSubscribeOptions(watch.tracker, spec.baseOptions || {}),
        onEvent: (frame) => {
            if (isEventInScope(watch.tracker, frame))
                spec.onEvent(frame, watch);
        },
        onSubscribed: () => spec.onSubscribed?.(watch)
    });
    watch.onScopeChange = startWhenScopeKnown(watch.stream);
    node.on('close', (_removed, done) => {
        watch.tracker.stop();
        watch.stream.stop();
        spec.onStop?.();
        if (typeof done === 'function') done();
    });
    watch.tracker.start();
    return watch;
}

module.exports = {
    redStatus,
    watchFleetEvents
};

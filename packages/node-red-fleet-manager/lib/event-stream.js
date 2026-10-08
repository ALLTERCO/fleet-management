// One Fleet Manager WebSocket subscription per node: connect, subscribe,
// wait for the server ack, resume after a drop, back off on failure.

const {reconnectDelay} = require('./backoff');
const {tokenForServer, wsUrlForServer} = require('./fm-client');
const {FM_METHODS} = require('./fm-methods');

const SUBSCRIBE_TIMEOUT_MS = 15000;
const CLIENT_SOURCE = 'FLEET_MANAGER_NODE_RED';

const STATUS = {
    connecting: {fill: 'yellow', shape: 'ring', text: 'connecting'},
    subscribed: {fill: 'green', shape: 'dot', text: 'subscribed'},
    noDevices: {fill: 'yellow', shape: 'ring', text: 'no devices in scope'}
};

function redStatus(text) {
    return {fill: 'red', shape: 'ring', text};
}

function websocketConstructor() {
    if (typeof globalThis.WebSocket !== 'undefined')
        return globalThis.WebSocket;
    try {
        return require('ws');
    } catch {
        return undefined;
    }
}

function onSocket(socket, event, handler) {
    if (typeof socket.addEventListener === 'function') {
        socket.addEventListener(event, handler);
        return;
    }
    socket.on(event, handler);
}

function frameText(event) {
    const data = event?.data ?? event;
    return typeof data === 'string' ? data : String(data);
}

function parseFrame(event) {
    try {
        const frame = JSON.parse(frameText(event));
        return frame && typeof frame === 'object' ? frame : null;
    } catch {
        return null;
    }
}

function isReply(frame) {
    return (
        Object.hasOwn(frame, 'id') &&
        (Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error'))
    );
}

function errorText(error) {
    return error?.message || String(error?.error?.message || error || '');
}

class EventStream {
    /**
     * options: {server, events, subscribeOptions() -> object | null,
     *   onEvent(frame), onSubscribed?(result), WebSocket?, random?}
     */
    constructor(node, options) {
        this.node = node;
        this.options = options;
        this.socket = null;
        this.closing = false;
        this.started = false;
        this.attempt = 0;
        this.requestId = 0;
        this.pending = new Map();
        this.subscriptionIds = [];
        this.connectionId = undefined;
        this.lastSeenStreamId = undefined;
        this.reconnectTimer = null;
        this.lastFailure = '';
    }

    start() {
        this.started = true;
        this.closing = false;
        this.connect();
    }

    stop() {
        this.closing = true;
        clearTimeout(this.reconnectTimer);
        this.clearPending();
        const socket = this.socket;
        this.socket = null;
        if (socket) socket.close();
    }

    /** Re-send the subscription, e.g. after the device scope changed. */
    refreshSubscription() {
        if (this.socket && this.socketOpen) this.subscribe();
    }

    connect() {
        const problem = this.connectProblem();
        if (problem) {
            this.node.status(redStatus(problem));
            return;
        }
        this.node.status(STATUS.connecting);
        const WebSocketImpl = this.options.WebSocket || websocketConstructor();
        const server = this.options.server;
        const socket = new WebSocketImpl(
            wsUrlForServer(server),
            tokenForServer(server)
        );
        this.socket = socket;
        this.socketOpen = false;
        this.attachHandlers(socket);
    }

    connectProblem() {
        if (!this.options.server) return 'missing server';
        if (!this.options.WebSocket && !websocketConstructor()) {
            return 'WebSocket unavailable';
        }
        if (!tokenForServer(this.options.server)) return 'missing token';
        return '';
    }

    attachHandlers(socket) {
        const current = (handler) => (event) => {
            if (socket === this.socket) handler.call(this, event);
        };
        onSocket(socket, 'open', current(this.onOpen));
        onSocket(socket, 'message', current(this.onMessage));
        onSocket(socket, 'close', current(this.onClose));
        onSocket(socket, 'error', current(this.onError));
    }

    onOpen() {
        this.socketOpen = true;
        this.subscribe();
    }

    subscribe() {
        const options = this.options.subscribeOptions();
        if (options === null) {
            this.node.status(STATUS.noDevices);
            this.dropSubscription();
            return;
        }
        this.request(
            FM_METHODS.subscribe,
            this.subscribeParams(options),
            (reply) => this.onSubscribeReply(reply)
        );
    }

    subscribeParams(options) {
        return {
            events: this.options.events,
            options,
            ...(this.connectionId ? {connectionId: this.connectionId} : {}),
            ...(this.lastSeenStreamId
                ? {lastSeenStreamId: this.lastSeenStreamId}
                : {})
        };
    }

    request(method, params, onReply) {
        this.requestId += 1;
        const id = this.requestId;
        const timer = setTimeout(
            () => this.onRequestTimeout(id),
            SUBSCRIBE_TIMEOUT_MS
        );
        this.pending.set(id, {onReply, timer});
        this.socket.send(
            JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                src: CLIENT_SOURCE,
                dst: 'FLEET_MANAGER',
                params
            })
        );
    }

    onRequestTimeout(id) {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        entry.onReply({id, error: {message: 'no reply from Fleet Manager'}});
    }

    clearPending() {
        for (const entry of this.pending.values()) clearTimeout(entry.timer);
        this.pending.clear();
    }

    onMessage(event) {
        const frame = parseFrame(event);
        if (!frame) {
            this.node.warn('Fleet Manager sent a frame that is not JSON');
            return;
        }
        if (isReply(frame)) {
            this.onReply(frame);
            return;
        }
        if (!frame.method) return;
        if (typeof frame.streamId === 'string') {
            this.lastSeenStreamId = frame.streamId;
        }
        this.dispatch(frame);
    }

    dispatch(frame) {
        try {
            this.options.onEvent(frame);
        } catch (error) {
            this.node.error(error);
        }
    }

    onReply(frame) {
        const entry = this.pending.get(frame.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(frame.id);
        entry.onReply(frame);
    }

    onSubscribeReply(reply) {
        if (reply.error) {
            this.onSubscribeFailed(errorText(reply.error));
            return;
        }
        this.onSubscribed(reply.result || {});
    }

    onSubscribeFailed(message) {
        this.node.status(redStatus('subscribe failed'));
        if (message !== this.lastFailure) {
            this.node.error(`Fleet Manager subscribe failed: ${message}`);
        }
        this.lastFailure = message;
        if (this.socket) this.socket.close();
    }

    onSubscribed(result) {
        const replaced = this.subscriptionIds;
        this.subscriptionIds = Array.isArray(result.ids) ? result.ids : [];
        if (result.connectionId) this.connectionId = result.connectionId;
        if (result.resyncRequired) this.onResyncRequired(result.resyncRequired);
        this.attempt = 0;
        this.lastFailure = '';
        this.node.status(STATUS.subscribed);
        if (replaced.length > 0) this.unsubscribe(replaced);
        if (this.options.onSubscribed) this.options.onSubscribed(result);
    }

    onResyncRequired(reason) {
        this.lastSeenStreamId = undefined;
        this.node.warn(
            `Fleet Manager could not replay missed events (${reason}); some events may be lost`
        );
    }

    // Scope became empty: stop the server sending the old devices' events.
    dropSubscription() {
        if (this.subscriptionIds.length === 0) return;
        this.unsubscribe(this.subscriptionIds);
        this.subscriptionIds = [];
    }

    unsubscribe(ids) {
        this.request(FM_METHODS.unsubscribe, {ids}, () => {});
    }

    onClose() {
        this.socket = null;
        this.socketOpen = false;
        this.subscriptionIds = [];
        this.clearPending();
        if (this.closing) return;
        this.scheduleReconnect();
    }

    onError(error) {
        if (this.attempt === 0) {
            this.node.warn(`Fleet Manager socket error: ${errorText(error)}`);
        }
    }

    scheduleReconnect() {
        const delay = reconnectDelay(this.attempt, this.options.random);
        this.attempt += 1;
        this.node.status(
            redStatus(`disconnected, retry in ${Math.ceil(delay / 1000)}s`)
        );
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
}

module.exports = {
    EventStream,
    SUBSCRIBE_TIMEOUT_MS
};

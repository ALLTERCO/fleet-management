const {eventDevice, scopeFromConfig} = require('../device-scope');
const {HoldTimers, secondsToMs} = require('../hold-timers');
const {parseJsonObject} = require('../params');
const {csv} = require('../target');
const {
    ThresholdWatch,
    buttonEventMatches,
    buttonFilter,
    componentOfEntity,
    presenceOf,
    readStatusPath,
    watchesPresence
} = require('../triggers');
const {redStatus, watchFleetEvents} = require('./watch');

const DEFAULT_EVENTS =
    'Shelly.Connect,Shelly.Disconnect,Shelly.Status,Entity.Event';

function emit(watch, msg) {
    watch.node.send(msg);
    watch.ctx.ran();
}

// --- fm-device-event: any FM events, optionally scoped -------------------

function filterOrNull(node, config) {
    try {
        return parseJsonObject(config.filterJson, 'event filter');
    } catch (error) {
        node.status(redStatus('bad filter JSON'));
        node.error(error);
        return null;
    }
}

function deviceEventMessage(frame, watch) {
    return {
        topic: frame.method,
        payload: frame.params || frame,
        fm: {
            event: frame.method,
            shellyID: eventDevice(watch.tracker, frame) ?? null
        }
    };
}

function registerDeviceEventNode(runtime) {
    const {RED} = runtime;
    function FleetManagerDeviceEventNode(config) {
        RED.nodes.createNode(this, config);
        const filter = filterOrNull(this, config);
        // A broken filter must not quietly widen to every event.
        if (!filter) return;
        const events = csv(config.events || DEFAULT_EVENTS);
        watchFleetEvents(runtime, {
            node: this,
            config,
            nodeType: 'fm-device-event',
            events,
            baseOptions: filter,
            // Entity events name no device; a narrowed scope needs the map.
            needRows:
                scopeFromConfig(config).type !== 'all' &&
                events.some((event) => event.startsWith('Entity.')),
            onEvent: (frame, watch) =>
                emit(watch, deviceEventMessage(frame, watch))
        });
    }
    RED.nodes.registerType('fm-device-event', FleetManagerDeviceEventNode);
}

// --- fm-trigger-threshold: value above/below a limit ---------------------

function thresholdProblem(config) {
    if (!String(config.path || '').trim()) return 'pick a value path';
    if (!Number.isFinite(Number.parseFloat(config.limit))) return 'set a limit';
    return '';
}

function thresholdMessage(rule, reading) {
    return {
        topic: rule.path,
        payload: {
            shellyID: reading.shellyID,
            path: rule.path,
            value: reading.value,
            limit: rule.limit,
            operator: rule.operator,
            state: reading.state
        },
        fm: {event: 'Shelly.Status', trigger: 'threshold'}
    };
}

function thresholdRule(config) {
    return {
        path: String(config.path).trim(),
        operator: config.operator === 'below' ? 'below' : 'above',
        limit: Number.parseFloat(config.limit),
        fireOnStart: config.fireOnStart === true,
        holdMs: secondsToMs(config.forSeconds)
    };
}

class ThresholdTrigger {
    constructor(rule) {
        this.rule = rule;
        this.edges = new ThresholdWatch(rule);
        this.holds = new HoldTimers();
        this.latest = new Map();
        this.fired = new Set();
    }

    observe(watch, frame) {
        const value = readStatusPath(frame.params?.status, this.rule.path);
        const shellyID = frame.params?.shellyID;
        if (typeof value !== 'number' || !shellyID) return;
        this.latest.set(shellyID, value);
        const edge = this.edges.edge({shellyID, value});
        if (edge === 'enter') this.enter(watch, shellyID);
        if (edge === 'leave') this.leave(watch, shellyID);
    }

    enter(watch, shellyID) {
        this.holds.start(shellyID, {
            delayMs: this.rule.holdMs,
            action: () => {
                this.fired.add(shellyID);
                this.send(watch, {shellyID, state: this.rule.operator}, 0);
            }
        });
    }

    leave(watch, shellyID) {
        if (this.holds.isPending(shellyID)) {
            this.holds.cancel(shellyID);
            return;
        }
        if (!this.fired.delete(shellyID)) return;
        this.send(watch, {shellyID, state: 'normal'}, 1);
    }

    send(watch, reading, output) {
        const msg = thresholdMessage(this.rule, {
            ...reading,
            value: this.latest.get(reading.shellyID)
        });
        emit(watch, output === 0 ? [msg, null] : [null, msg]);
    }
}

function registerThresholdNode(runtime) {
    const {RED} = runtime;
    function FleetManagerThresholdNode(config) {
        RED.nodes.createNode(this, config);
        const problem = thresholdProblem(config);
        if (problem) {
            this.status(redStatus(problem));
            return;
        }
        const trigger = new ThresholdTrigger(thresholdRule(config));
        watchFleetEvents(runtime, {
            node: this,
            config,
            nodeType: 'fm-trigger-threshold',
            events: ['Shelly.Status'],
            baseOptions: {
                events: {'Shelly.Status': {paths: [trigger.rule.path]}}
            },
            onEvent: (frame, watch) => trigger.observe(watch, frame),
            onStop: () => trigger.holds.clear()
        });
    }
    RED.nodes.registerType('fm-trigger-threshold', FleetManagerThresholdNode);
}

// --- fm-trigger-status: device online / offline ---------------------------

class PresenceTrigger {
    /** rule: {watch, holdMs, outputCurrent} */
    constructor(rule) {
        this.rule = rule;
        this.holds = new HoldTimers();
        this.reported = new Map();
    }

    observe(watch, frame) {
        const presence = presenceOf(frame);
        const shellyID = frame.params?.shellyID;
        if (!presence || !shellyID) return;
        this.holds.start(shellyID, {
            delayMs: this.rule.holdMs,
            action: () => this.report(watch, {shellyID, presence})
        });
    }

    // Same state twice (a short flap, a reconnect) is not news.
    report(watch, change) {
        if (this.reported.get(change.shellyID) === change.presence) return;
        this.reported.set(change.shellyID, change.presence);
        if (!watchesPresence(this.rule.watch, change.presence)) return;
        emit(watch, {
            topic: change.presence,
            payload: {
                shellyID: change.shellyID,
                online: change.presence === 'online',
                initial: Boolean(change.initial)
            },
            fm: {trigger: 'presence'}
        });
    }

    async reportCurrent(watch) {
        await watch.tracker.refresh();
        for (const row of watch.tracker.deviceRows()) {
            if (row.presence !== 'online' && row.presence !== 'offline')
                continue;
            this.report(watch, {
                shellyID: row.shellyID,
                presence: row.presence,
                initial: true
            });
        }
    }
}

function registerStatusNode(runtime) {
    const {RED} = runtime;
    function FleetManagerStatusNode(config) {
        RED.nodes.createNode(this, config);
        const trigger = new PresenceTrigger({
            watch: config.watch || 'both',
            holdMs: secondsToMs(config.forSeconds),
            outputCurrent: config.outputCurrent === true
        });
        watchFleetEvents(runtime, {
            node: this,
            config,
            nodeType: 'fm-trigger-status',
            events: ['Shelly.Connect', 'Shelly.Disconnect'],
            needRows: trigger.rule.outputCurrent,
            onEvent: (frame, watch) => trigger.observe(watch, frame),
            onSubscribed: (watch) => {
                if (trigger.rule.outputCurrent) {
                    trigger
                        .reportCurrent(watch)
                        .catch((error) => this.error(error));
                }
            },
            onStop: () => trigger.holds.clear()
        });
    }
    RED.nodes.registerType('fm-trigger-status', FleetManagerStatusNode);
}

// --- fm-trigger-button: input / button events -----------------------------

function buttonMessage(watch, frame) {
    const entityId = String(frame.params?.entityId || '');
    return {
        topic: String(frame.params?.event || ''),
        payload: {
            shellyID: watch.tracker.ownerOfEntity(entityId) ?? null,
            entityId,
            component: componentOfEntity(entityId),
            event: frame.params?.event
        },
        fm: {event: 'Entity.Event', trigger: 'button'}
    };
}

function registerButtonNode(runtime) {
    const {RED} = runtime;
    function FleetManagerButtonNode(config) {
        RED.nodes.createNode(this, config);
        const filter = buttonFilter(config);
        watchFleetEvents(runtime, {
            node: this,
            config,
            nodeType: 'fm-trigger-button',
            events: ['Entity.Event'],
            // Entity ids carry no shellyID; device rows map them back.
            needRows: true,
            onEvent: (frame, watch) => {
                const msg = buttonMessage(watch, frame);
                if (buttonEventMatches(filter, msg.payload)) emit(watch, msg);
            }
        });
    }
    RED.nodes.registerType('fm-trigger-button', FleetManagerButtonNode);
}

function registerEventNodes(runtime) {
    registerDeviceEventNode(runtime);
    registerThresholdNode(runtime);
    registerStatusNode(runtime);
    registerButtonNode(runtime);
}

module.exports = {
    registerEventNodes
};

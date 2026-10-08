// Pure rules behind the easy trigger nodes. No sockets, no timers.

const {csv} = require('./target');

// Component keys like "switch:0" never contain a dot, so a dot split is safe.
function readStatusPath(status, path) {
    return String(path)
        .split('.')
        .reduce((value, part) => {
            if (value === undefined || value === null) return undefined;
            return typeof value === 'object' ? value[part] : undefined;
        }, status);
}

const THRESHOLD_TESTS = {
    above: (value, limit) => value > limit,
    below: (value, limit) => value < limit
};

/** Tracks per device whether a value is past its limit; reports the edges. */
class ThresholdWatch {
    /** rule: {operator: 'above' | 'below', limit, fireOnStart?} */
    constructor(rule) {
        this.test = THRESHOLD_TESTS[rule.operator] || THRESHOLD_TESTS.above;
        this.limit = Number(rule.limit);
        this.fireOnStart = Boolean(rule.fireOnStart);
        this.matched = new Map();
    }

    /** 'enter' when the value crosses the limit, 'leave' when it returns. */
    edge(reading) {
        const matched = this.test(reading.value, this.limit);
        const before = this.matched.get(reading.shellyID);
        this.matched.set(reading.shellyID, matched);
        if (before === undefined)
            return matched && this.fireOnStart ? 'enter' : null;
        if (matched === before) return null;
        return matched ? 'enter' : 'leave';
    }

    forget() {
        this.matched.clear();
    }
}

const PRESENCE_BY_EVENT = {
    'Shelly.Connect': 'online',
    'Shelly.Disconnect': 'offline'
};

function presenceOf(frame) {
    return PRESENCE_BY_EVENT[frame.method];
}

const WATCHED_PRESENCE = {
    both: new Set(['online', 'offline']),
    online: new Set(['online']),
    offline: new Set(['offline'])
};

function watchesPresence(watch, presence) {
    return (WATCHED_PRESENCE[watch] || WATCHED_PRESENCE.both).has(presence);
}

// Entity ids end in "_<n>:<type>", e.g. "12_0:input" is component input:0.
function componentOfEntity(entityId) {
    const match = /_([^_:]+):([^:_]+)$/.exec(String(entityId || ''));
    return match ? `${match[2]}:${match[1]}` : '';
}

/** filter: {component, events} from the node config. */
function buttonFilter(config) {
    return {
        component: String(config.component || '').trim(),
        events: new Set(csv(config.eventTypes))
    };
}

function buttonEventMatches(filter, press) {
    if (filter.component && filter.component !== press.component) return false;
    return filter.events.size === 0 || filter.events.has(press.event);
}

module.exports = {
    ThresholdWatch,
    buttonEventMatches,
    buttonFilter,
    componentOfEntity,
    presenceOf,
    readStatusPath,
    watchesPresence
};

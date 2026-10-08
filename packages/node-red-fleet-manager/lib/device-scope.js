// Which devices a node listens to: all, a list, a group or a place.
// Groups and places are turned into device ids through FM and kept fresh.
// device.List filters by one place at a time, so a place with children costs
// one call per child: those run a few at a time and are shared between nodes.

const {csv} = require('./target');
const {FM_METHODS} = require('./fm-methods');

const DEFAULT_REFRESH_MINUTES = 5;
const RETRY_AFTER_FAILURE_MS = 30000;
const LIST_CONCURRENCY = 4;
const SHARE_WINDOW_MS = 30000;

function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function scopeType(config) {
    if (['all', 'devices', 'group', 'location'].includes(config.scopeType)) {
        return config.scopeType;
    }
    return csv(config.deviceIds).length > 0 ? 'devices' : 'all';
}

function scopeFromConfig(config) {
    return {
        type: scopeType(config),
        deviceIds: csv(config.deviceIds),
        groupId: positiveIntegerOrNull(config.groupId),
        locationId: positiveIntegerOrNull(config.locationId)
    };
}

const SCOPE_PROBLEMS = {
    all: () => '',
    devices: (scope) => (scope.deviceIds.length > 0 ? '' : 'pick a device'),
    group: (scope) => (scope.groupId ? '' : 'pick a group'),
    location: (scope) => (scope.locationId ? '' : 'pick a place')
};

function scopeProblem(scope) {
    return SCOPE_PROBLEMS[scope.type](scope);
}

function deviceRow(item) {
    return {
        shellyID: String(item.shellyID),
        entities: Array.isArray(item.entities) ? item.entities.map(String) : [],
        presence: item.presence
    };
}

async function listDevices(rpc, filters) {
    const result = await rpc(FM_METHODS.listDevices, {filters, limit: 0});
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.filter((item) => item?.shellyID).map(deviceRow);
}

/** work: {limit, load(item)}; at most `limit` loads at once, order kept. */
async function mapLimited(items, work) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await work.load(items[index]);
        }
    }
    const workers = Math.min(work.limit, items.length);
    await Promise.all(Array.from({length: workers}, worker));
    return results;
}

async function listDevicesPerFilter(rpc, filtersList) {
    const pages = await mapLimited(filtersList, {
        limit: LIST_CONCURRENCY,
        load: (filters) => listDevices(rpc, filters)
    });
    return pages.flat();
}

async function placeAndChildren(rpc, locationId) {
    const result = await rpc(FM_METHODS.placeAndChildren, {
        id: locationId,
        includeSelf: true
    });
    const ids = Array.isArray(result?.items) ? result.items : [];
    return ids.length > 0 ? ids : [locationId];
}

const SCOPE_RESOLVERS = {
    all: (rpc) => listDevices(rpc, {}),
    devices: (rpc, scope) =>
        listDevicesPerFilter(
            rpc,
            scope.deviceIds.map((shellyID) => ({shellyID}))
        ),
    group: (rpc, scope) => listDevices(rpc, {groupId: scope.groupId}),
    location: async (rpc, scope) => {
        const ids = await placeAndChildren(rpc, scope.locationId);
        return listDevicesPerFilter(
            rpc,
            ids.map((locationId) => ({locationId}))
        );
    }
};

/** Same scope, same name: device order does not matter. */
function scopeKey(scope) {
    const ids = {
        all: () => '',
        devices: () => [...scope.deviceIds].sort().join(','),
        group: () => String(scope.groupId),
        location: () => String(scope.locationId)
    };
    return `${scope.type}:${ids[scope.type]()}`;
}

/**
 * Nodes asking about the same scope on the same server within the window
 * get one answer. A failed lookup is forgotten at once.
 */
function createScopeLookups(options = {}) {
    const now = options.now || Date.now;
    const entries = new Map();
    function forgetExpired(at) {
        for (const [key, entry] of entries) {
            if (entry.doneAt !== null && at - entry.doneAt >= SHARE_WINDOW_MS)
                entries.delete(key);
        }
    }
    function lookUp(key, load) {
        forgetExpired(now());
        if (entries.has(key)) return entries.get(key).promise;
        const entry = {doneAt: null, promise: null};
        entry.promise = load().then(
            (rows) => {
                entry.doneAt = now();
                return rows;
            },
            (error) => {
                entries.delete(key);
                throw error;
            }
        );
        entries.set(key, entry);
        return entry.promise;
    }
    return {lookUp};
}

function staticRows(scope) {
    return scope.deviceIds.map((shellyID) =>
        deviceRow({shellyID, entities: []})
    );
}

class ScopeTracker {
    /**
     * options: {scope, rpc(method, params), needRows?, refreshMinutes?,
     *   lookups?, lookupKey?, onChange(), onError(error)}
     * lookups + lookupKey share one FM lookup between nodes.
     */
    constructor(options) {
        this.options = options;
        this.scope = options.scope;
        this.rows = null;
        this.entityOwners = new Map();
        this.key = '';
        this.timer = null;
    }

    /** Group and place scopes, and nodes that need entity data, ask FM. */
    isLookedUp() {
        return (
            this.options.needRows ||
            this.scope.type === 'group' ||
            this.scope.type === 'location'
        );
    }

    start() {
        void this.refresh();
        if (!this.isLookedUp()) return;
        this.timer = setInterval(() => void this.refresh(), this.refreshMs());
        // Background refresh alone must not keep a process alive.
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        clearTimeout(this.retryTimer);
    }

    refreshMs() {
        const minutes = Number(this.options.refreshMinutes);
        return (minutes > 0 ? minutes : DEFAULT_REFRESH_MINUTES) * 60000;
    }

    async refresh() {
        if (!this.isLookedUp()) {
            this.apply(staticRows(this.scope));
            return;
        }
        const rows = await this.lookUpSafely();
        if (rows) this.apply(rows);
    }

    lookUp() {
        const load = () =>
            SCOPE_RESOLVERS[this.scope.type](this.options.rpc, this.scope);
        const {lookups, lookupKey} = this.options;
        return lookups && lookupKey ? lookups.lookUp(lookupKey, load) : load();
    }

    async lookUpSafely() {
        try {
            return await this.lookUp();
        } catch (error) {
            this.options.onError(error);
            this.retryIfNeverLoaded();
            return null;
        }
    }

    retryIfNeverLoaded() {
        if (this.rows !== null) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(
            () => void this.refresh(),
            RETRY_AFTER_FAILURE_MS
        );
        this.retryTimer.unref?.();
    }

    apply(rows) {
        const key = rows
            .map((row) => `${row.shellyID}=${row.entities.join(',')}`)
            .sort()
            .join('|');
        const first = this.rows === null;
        this.rows = new Map(rows.map((row) => [row.shellyID, row]));
        this.entityOwners = entityOwnerIndex(rows);
        if (first || key !== this.key) {
            this.key = key;
            this.options.onChange();
        }
    }

    isReady() {
        return this.rows !== null;
    }

    restricts() {
        return this.scope.type !== 'all';
    }

    /** null = every device the service account can see. */
    shellyIDs() {
        if (!this.restricts()) return null;
        return [...(this.rows || new Map()).keys()];
    }

    includes(shellyID) {
        return !this.restricts() || Boolean(this.rows?.has(shellyID));
    }

    ownerOfEntity(entityId) {
        return this.entityOwners.get(entityId);
    }

    deviceRows() {
        return [...(this.rows || new Map()).values()];
    }
}

function entityOwnerIndex(rows) {
    const index = new Map();
    for (const row of rows) {
        for (const entityId of row.entities) index.set(entityId, row.shellyID);
    }
    return index;
}

/** Subscribe options for the scope, or null while there is nothing to watch. */
function scopedSubscribeOptions(tracker, baseOptions) {
    if (!tracker.isReady()) return null;
    const ids = tracker.shellyIDs();
    if (ids === null) return baseOptions;
    if (ids.length === 0) return null;
    return {...baseOptions, shellyIDs: ids};
}

/** The device an event is about, or undefined when it names none. */
function eventDevice(tracker, frame) {
    const params = frame.params || {};
    if (params.shellyID) return String(params.shellyID);
    if (params.entityId) return tracker.ownerOfEntity(String(params.entityId));
    return undefined;
}

// Server filters by device where it can; entity events need the local check.
function isEventInScope(tracker, frame) {
    if (!tracker.restricts()) return true;
    const params = frame.params || {};
    const named = Boolean(params.shellyID || params.entityId);
    if (!named) return true;
    const shellyID = eventDevice(tracker, frame);
    return Boolean(shellyID) && tracker.includes(shellyID);
}

module.exports = {
    ScopeTracker,
    createScopeLookups,
    eventDevice,
    isEventInScope,
    scopeFromConfig,
    scopeKey,
    scopeProblem,
    scopedSubscribeOptions
};

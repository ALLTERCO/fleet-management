// Cytoscape {nodes, edges} from device runtime. Two edge sources:
//   - BT mesh: bthomedevice:N parent → BLE peer
//   - Cross-device actuator: thermostat:N.actuator pointing at another shellyID
//
// Intra-device actuator URLs (shelly://self/...) are omitted — that's
// internal wiring of a single device, not fleet topology.

export type TopologyNodeType = 'hub' | 'device' | 'group';
export type TopologyStatus = 'on' | 'off' | 'warn';

export interface TopologyNode {
    id: string;
    label: string;
    type: TopologyNodeType;
    status?: TopologyStatus;
}

export interface TopologyEdge {
    source: string;
    target: string;
    weight?: number;
}

export interface DeviceSnapshot {
    shellyID: string;
    name?: string | null;
    presence?: string;
    /** keyed by component key, e.g. "bthomedevice:200" -> {addr, name?}. */
    bthomeDevices?: Record<string, {addr?: string; name?: string | null}>;
    /** keyed by component key, e.g. "thermostat:0" -> {actuator}. */
    thermostats?: Record<string, {actuator?: string}>;
}

export interface Topology {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
}

function statusFromPresence(presence?: string): TopologyStatus {
    if (presence === 'online') return 'on';
    if (presence === 'offline') return 'off';
    return 'warn';
}

// Shelly actuator URL: `shelly://<host>/c/<component>:<id>`.
// Returns null on intra-device (`self`) or unparseable input.
function parseActuatorTargetShellyID(url: string): string | null {
    const m = url.match(/^shelly:\/\/([^/]+)\/c\//);
    if (!m) return null;
    const host = m[1];
    if (host === 'self' || host === '') return null;
    return host;
}

export function buildDeviceTopology(
    devices: readonly DeviceSnapshot[]
): Topology {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];
    const bleSeen = new Set<string>(); // BLE peers may pair to multiple hosts
    const knownShellyIDs = new Set(devices.map((d) => d.shellyID));

    for (const d of devices) {
        const hostPaired = Object.values(d.bthomeDevices ?? {}).some(
            (c) => typeof c.addr === 'string' && c.addr.length > 0
        );
        nodes.push({
            id: d.shellyID,
            label: d.name || d.shellyID,
            type: hostPaired ? 'hub' : 'device',
            status: statusFromPresence(d.presence)
        });

        for (const cfg of Object.values(d.bthomeDevices ?? {})) {
            if (!cfg.addr) continue;
            const bleId = `ble:${cfg.addr}`;
            if (!bleSeen.has(bleId)) {
                bleSeen.add(bleId);
                // BLE peer liveness isn't known from the host's config alone.
                nodes.push({
                    id: bleId,
                    label: cfg.name || cfg.addr,
                    type: 'device',
                    status: 'warn'
                });
            }
            edges.push({source: d.shellyID, target: bleId});
        }

        for (const cfg of Object.values(d.thermostats ?? {})) {
            if (typeof cfg.actuator !== 'string') continue;
            const target = parseActuatorTargetShellyID(cfg.actuator);
            if (!target) continue;
            // Only emit edges where both endpoints are known to the
            // caller — keeps Cytoscape's "edge references a missing
            // node" rule intact and respects the access-filtered set.
            if (!knownShellyIDs.has(target)) continue;
            edges.push({source: d.shellyID, target});
        }
    }
    return {nodes, edges};
}

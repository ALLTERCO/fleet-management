// FM-side tracking of active GATTC connections per BLU Assistant.
// Source of truth is the device firmware (5-slot pool); this map is a hint
// for the UI. Synced via Connect/Disconnect handler calls and reconciled on
// Connection.List queries.

const MAX_PER_DEVICE = 5;

export interface BluAssistConnection {
    conn_id: number;
    addr: string;
    openedAt: number;
    discoveredAt?: number;
    mtu?: number;
}

// shellyID → conn_id → connection
const connections = new Map<string, Map<number, BluAssistConnection>>();

function bucket(shellyID: string): Map<number, BluAssistConnection> {
    let b = connections.get(shellyID);
    if (!b) {
        b = new Map();
        connections.set(shellyID, b);
    }
    return b;
}

export function recordConnect(
    shellyID: string,
    entry: Omit<BluAssistConnection, 'openedAt'> & {openedAt?: number}
): void {
    const b = bucket(shellyID);
    if (b.size >= MAX_PER_DEVICE && !b.has(entry.conn_id)) {
        // Defensive: device should reject before us, but if FM and firmware
        // disagree we drop the oldest to stay consistent with the device.
        const oldest = [...b.values()].sort(
            (x, y) => x.openedAt - y.openedAt
        )[0];
        if (oldest) b.delete(oldest.conn_id);
    }
    b.set(entry.conn_id, {
        conn_id: entry.conn_id,
        addr: entry.addr,
        openedAt: entry.openedAt ?? Date.now(),
        discoveredAt: entry.discoveredAt,
        mtu: entry.mtu
    });
}

export function recordDisconnect(
    shellyID: string,
    selector: {conn_id?: number; addr?: string}
): void {
    const b = bucket(shellyID);
    if (selector.conn_id !== undefined) {
        b.delete(selector.conn_id);
        return;
    }
    if (selector.addr !== undefined) {
        for (const [id, entry] of b) {
            if (entry.addr === selector.addr) b.delete(id);
        }
    }
}

export function markDiscovered(shellyID: string, conn_id: number): void {
    const b = bucket(shellyID);
    const entry = b.get(conn_id);
    if (entry) entry.discoveredAt = Date.now();
}

export function listConnections(shellyID: string): BluAssistConnection[] {
    const b = connections.get(shellyID);
    if (!b) return [];
    return [...b.values()].sort((a, b2) => a.openedAt - b2.openedAt);
}

export function clearDevice(shellyID: string): void {
    connections.delete(shellyID);
}

export {MAX_PER_DEVICE};

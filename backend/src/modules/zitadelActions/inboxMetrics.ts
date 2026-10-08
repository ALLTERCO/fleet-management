export interface ZitadelActionInboxSnapshot {
    queued: number;
    inProgress: number;
    oldestQueuedAgeSeconds: number;
    lastSuccessTimestampSeconds: number;
}

let snapshot: ZitadelActionInboxSnapshot = {
    queued: 0,
    inProgress: 0,
    oldestQueuedAgeSeconds: 0,
    lastSuccessTimestampSeconds: 0
};

export function getZitadelActionInboxSnapshot(): ZitadelActionInboxSnapshot {
    return {...snapshot};
}

export function updateZitadelActionInboxSnapshot(
    update: Partial<ZitadelActionInboxSnapshot>
): void {
    snapshot = {...snapshot, ...update};
}

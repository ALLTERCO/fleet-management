export type RefreshTask = () => Promise<void>;

export interface RefreshCoordinator {
    request(): Promise<void>;
}

export interface LatestRefreshCoordinator<Request> {
    request(input: Request): Promise<void>;
}

export function createRefreshCoordinator(
    refreshTask: RefreshTask
): RefreshCoordinator {
    let activeRefresh: Promise<void> | null = null;
    let followUpRequested = false;

    async function runQueuedRefreshes(): Promise<void> {
        do {
            followUpRequested = false;
            await refreshTask();
        } while (followUpRequested);
    }

    function request(): Promise<void> {
        if (activeRefresh) {
            followUpRequested = true;
            return activeRefresh;
        }

        activeRefresh = runQueuedRefreshes().finally(() => {
            activeRefresh = null;
            followUpRequested = false;
        });
        return activeRefresh;
    }

    return {request};
}

export function createLatestRefreshCoordinator<Request>(
    refreshTask: (input: Request) => Promise<void>
): LatestRefreshCoordinator<Request> {
    let activeRefresh: Promise<void> | null = null;
    let pendingRequest: Request | null = null;

    async function runLatestRefreshes(): Promise<void> {
        while (pendingRequest !== null) {
            const request = pendingRequest;
            pendingRequest = null;
            await refreshTask(request);
        }
    }

    function request(input: Request): Promise<void> {
        pendingRequest = input;
        if (activeRefresh) return activeRefresh;

        activeRefresh = runLatestRefreshes().finally(() => {
            activeRefresh = null;
            pendingRequest = null;
        });
        return activeRefresh;
    }

    return {request};
}

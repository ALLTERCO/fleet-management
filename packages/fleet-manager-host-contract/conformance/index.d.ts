export type HostConformanceError = {
    code: string;
    numericCode?: number;
    message: string;
    retryable: boolean;
    permissionDenied: boolean;
};

export type HostConformanceResourceSnapshot<T> = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: T;
    error: HostConformanceError | null;
};

export type HostConformanceResource<T> = {
    getSnapshot(): HostConformanceResourceSnapshot<T>;
    refresh(): Promise<void>;
    dispose?(): void;
};

export type HostConformanceResourceOptions<T> = {
    initial: T;
    load(): Promise<T>;
};

export type HostConformancePageRequest = {
    offset: number;
    limit: number;
};

export type HostConformancePage<T> = {
    items: readonly T[];
    has_more: boolean;
};

export type HostConformanceListOptions<T> = {
    pageSize?: number;
    loadPage(
        request: HostConformancePageRequest
    ): Promise<HostConformancePage<T>>;
};

export interface HostConformanceAdapter {
    readonly version: string;
    readonly versionNumber: number;
    has(name: string): boolean;
    createResource<T>(
        options: HostConformanceResourceOptions<T>
    ): HostConformanceResource<T>;
    listAll<T>(options: HostConformanceListOptions<T>): Promise<readonly T[]>;
}

export type HostConformanceFailure = {
    readonly case: string;
    readonly message: string;
};

export type HostConformanceResult = {
    readonly failures: readonly HostConformanceFailure[];
};

export function checkHostConformance(
    adapter: HostConformanceAdapter
): Promise<HostConformanceResult>;

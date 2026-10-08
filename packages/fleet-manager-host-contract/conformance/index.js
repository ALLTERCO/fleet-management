const UNKNOWN_CAPABILITY = 'fleet.__host_contract_conformance_unknown__';

function messageOf(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}

function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
}

async function runCase(failures, caseName, check) {
    try {
        await check();
    } catch (cause) {
        failures.push({case: caseName, message: messageOf(cause)});
    }
}

function requireNormalizedError(snapshot, permissionDenied) {
    requireCondition(
        snapshot.status === 'error',
        'resource did not reach error'
    );
    const error = snapshot.error;
    requireCondition(
        error && typeof error === 'object',
        'resource exposed no normalized error'
    );
    requireCondition(
        typeof error.code === 'string' && error.code.length > 0,
        'normalized error code is missing'
    );
    requireCondition(
        typeof error.message === 'string' && error.message.length > 0,
        'normalized error message is missing'
    );
    requireCondition(
        typeof error.retryable === 'boolean',
        'normalized error retryable flag is missing'
    );
    requireCondition(
        error.permissionDenied === permissionDenied,
        permissionDenied
            ? 'permission error did not set permissionDenied'
            : 'non-permission error set permissionDenied'
    );
}

async function checkSuccessfulResource(adapter) {
    const initial = {state: 'initial'};
    const loaded = {state: 'loaded'};
    const resource = adapter.createResource({
        initial,
        load: async () => loaded
    });
    try {
        requireCondition(
            resource.getSnapshot().data === initial,
            'resource did not expose its initial value'
        );
        await resource.refresh();
        const snapshot = resource.getSnapshot();
        requireCondition(
            snapshot.status === 'ready',
            'successful resource did not reach ready'
        );
        requireCondition(
            snapshot.data === loaded,
            'successful resource did not expose the loaded value'
        );
        requireCondition(
            snapshot.error === null,
            'successful resource retained an error'
        );
    } finally {
        resource.dispose?.();
    }
}

async function checkFailedResource(adapter, cause, permissionDenied) {
    const initial = {state: 'initial'};
    const resource = adapter.createResource({
        initial,
        load: async () => {
            throw cause;
        }
    });
    try {
        await resource.refresh();
        requireNormalizedError(resource.getSnapshot(), permissionDenied);
    } finally {
        resource.dispose?.();
    }
}

async function checkPagination(adapter) {
    const calls = [];
    const items = await adapter.listAll({
        pageSize: 2,
        loadPage: async ({offset, limit}) => {
            calls.push({offset, limit});
            if (offset === 0) return {items: ['one', 'two'], has_more: true};
            if (offset === 2) return {items: ['three'], has_more: false};
            return {items: [], has_more: false};
        }
    });
    requireCondition(
        JSON.stringify(items) === JSON.stringify(['one', 'two', 'three']),
        'pagination did not return every item exactly once'
    );
    requireCondition(
        calls.length === 2,
        `pagination loaded ${calls.length} pages instead of 2`
    );
    requireCondition(
        calls[0]?.offset === 0 &&
            calls[0]?.limit === 2 &&
            calls[1]?.offset === 2 &&
            calls[1]?.limit === 2,
        'pagination did not advance by the requested page size'
    );
}

/** Run the portable behaviour checks shared by every Host implementation. */
export async function checkHostConformance(adapter) {
    const failures = [];
    await runCase(failures, 'host.version', async () => {
        requireCondition(
            typeof adapter.version === 'string' && adapter.version.length > 0,
            'version is missing'
        );
        requireCondition(
            Number.isSafeInteger(adapter.versionNumber) &&
                adapter.versionNumber >= 0,
            'versionNumber must be a non-negative safe integer'
        );
    });
    await runCase(failures, 'host.unknown-capability', async () => {
        requireCondition(
            adapter.has(UNKNOWN_CAPABILITY) === false,
            'unknown capability returned true'
        );
    });
    await runCase(failures, 'resource.success', () =>
        checkSuccessfulResource(adapter)
    );
    await runCase(failures, 'resource.normalized-error', () =>
        checkFailedResource(
            adapter,
            {code: 503, message: 'Conformance service unavailable'},
            false
        )
    );
    await runCase(failures, 'resource.permission-error', () =>
        checkFailedResource(
            adapter,
            {code: 403, message: 'Conformance permission denied'},
            true
        )
    );
    await runCase(failures, 'pagination', () => checkPagination(adapter));
    return {failures};
}

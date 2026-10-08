// Coalesces reads by id: ids asked for in the same tick, or while a read is
// running, share one call per batch instead of one call each.

/** device.list and entity.list read at most this many named devices per call. */
export const ID_READ_BATCH_MAX = 100;

export interface IdBatchReads {
    /** Resolves once every id asked for so far has been read. */
    request(ids: readonly string[]): Promise<void>;
}

export function createIdBatchReads(input: {
    read: (ids: string[]) => Promise<void>;
    /** Reports a failed read that no caller is waiting on. */
    onError: (reason: unknown) => void;
}): IdBatchReads {
    const {read, onError} = input;
    const pending = new Set<string>();
    let running: Promise<void> | null = null;

    async function drain(): Promise<void> {
        try {
            while (pending.size > 0) {
                const batch = [...pending].slice(0, ID_READ_BATCH_MAX);
                for (const id of batch) pending.delete(id);
                await read(batch);
            }
        } catch (reason) {
            // A failed read drops what is queued; the next event asks again.
            pending.clear();
            throw reason;
        }
    }

    function request(ids: readonly string[]): Promise<void> {
        for (const id of ids) pending.add(id);
        if (running) return running;
        // One microtask late, so a same-tick burst lands in the first batch.
        running = Promise.resolve()
            .then(drain)
            .finally(() => {
                running = null;
                // Ids that arrived after the last batch was taken.
                if (pending.size > 0) void request([]).catch(onError);
            });
        return running;
    }

    return {request};
}

import {AsyncLocalStorage} from 'node:async_hooks';

// Counts the database calls one piece of work issues, including the calls of
// the async work it starts, so a periodic job can report its cost per run.

interface DbCallTally {
    calls: number;
}

const tallies = new AsyncLocalStorage<DbCallTally>();

export interface CountedDbCalls<T> {
    result: T;
    calls: number;
}

export async function countDbCalls<T>(
    body: () => Promise<T>
): Promise<CountedDbCalls<T>> {
    const tally: DbCallTally = {calls: 0};
    const result = await tallies.run(tally, body);
    return {result, calls: tally.calls};
}

export function noteDbCall(): void {
    const tally = tallies.getStore();
    if (tally) tally.calls++;
}

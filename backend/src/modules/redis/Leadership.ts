// Back-compat shim. Callers should migrate to `import {leadership}
// from './services'` and call leadership.create(opts).

import type {LeadershipOptions, LeadershipPort} from './ports';
import {leadership} from './services';

export type {LeadershipOptions} from './ports';

export class Leadership {
    readonly #port: LeadershipPort;
    constructor(opts: LeadershipOptions) {
        this.#port = leadership.create(opts);
    }
    isLeader(): boolean {
        return this.#port.isLeader();
    }
    start(): Promise<void> {
        return this.#port.start();
    }
    stop(): Promise<void> {
        return this.#port.stop();
    }
}

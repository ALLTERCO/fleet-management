// LIFO drain on dispose. Idempotent. A throwing disposable is collected,
// not propagated, so siblings still run.

import {fireAndForget} from './util/fireAndForget';

export type Disposable = () => void | Promise<void>;

export class DisposableBag {
    readonly #fns: Disposable[] = [];
    #disposed = false;

    add(fn: Disposable): void {
        if (this.#disposed) {
            fireAndForget(
                'disposableBag.post-dispose',
                Promise.resolve().then(fn)
            );
            return;
        }
        this.#fns.push(fn);
    }

    async dispose(): Promise<void> {
        if (this.#disposed) return;
        this.#disposed = true;
        const errors: unknown[] = [];
        while (this.#fns.length > 0) {
            const fn = this.#fns.pop();
            if (!fn) break;
            try {
                await fn();
            } catch (err) {
                errors.push(err);
            }
        }
        if (errors.length > 0) this.#onDisposeErrors?.(errors);
    }

    get size(): number {
        return this.#fns.length;
    }

    get disposed(): boolean {
        return this.#disposed;
    }

    #onDisposeErrors?: (errors: unknown[]) => void;

    setErrorSink(sink: (errors: unknown[]) => void): void {
        this.#onDisposeErrors = sink;
    }
}

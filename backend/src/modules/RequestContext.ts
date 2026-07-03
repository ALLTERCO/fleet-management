import type CommandSender from '../model/CommandSender';
import {DisposableBag} from './disposableBag';
import type {ConnectionContext} from './web/ws/ConnectionContext';

// Per-RPC scope: bag drains and signal aborts when Commander.exec returns.
// Signal is a child of connection.signal so socket close cascades down.

export interface RequestContextOptions {
    method: string;
    requestId: string;
    sender: CommandSender;
    connection?: ConnectionContext;
}

export class RequestContext {
    readonly method: string;
    readonly requestId: string;
    readonly sender: CommandSender;
    readonly connection: ConnectionContext | undefined;
    readonly bag: DisposableBag = new DisposableBag();
    readonly #abortController = new AbortController();
    #parentSignal: AbortSignal | undefined;
    #parentAbortListener: (() => void) | undefined;
    #disposed = false;

    constructor(opts: RequestContextOptions) {
        this.method = opts.method;
        this.requestId = opts.requestId;
        this.sender = opts.sender;
        this.connection = opts.connection;

        const parent = opts.connection?.signal;
        if (parent) {
            if (parent.aborted) {
                this.#abortController.abort();
            } else {
                this.#parentSignal = parent;
                this.#parentAbortListener = () => this.#abortController.abort();
                parent.addEventListener('abort', this.#parentAbortListener, {
                    once: true
                });
            }
        }
    }

    get signal(): AbortSignal {
        return this.#abortController.signal;
    }

    get disposed(): boolean {
        return this.#disposed;
    }

    async dispose(): Promise<void> {
        if (this.#disposed) return;
        this.#disposed = true;

        if (this.#parentSignal && this.#parentAbortListener) {
            this.#parentSignal.removeEventListener(
                'abort',
                this.#parentAbortListener
            );
            this.#parentSignal = undefined;
            this.#parentAbortListener = undefined;
        }

        if (!this.#abortController.signal.aborted) {
            this.#abortController.abort();
        }

        await this.bag.dispose();
    }
}

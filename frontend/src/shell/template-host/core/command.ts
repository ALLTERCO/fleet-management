// Physical-command state machine. A relay is not idempotent, so nothing here
// retries, overlaps, or trusts a confirmation it cannot tie to the command.

import {
    createFleetSdkError,
    type FleetSdkError,
    toFleetSdkError
} from './errors';
import {createExternalStore, type ExternalStore} from './external-store';
import type {FleetCommandState, HostLifecycle} from './types';

export const FLEET_COMMAND_TIMED_OUT = 'FleetCommandTimedOut';
export const FLEET_COMMAND_NOT_PERMITTED = 'FleetCommandNotPermitted';
export const FLEET_COMMAND_IN_FLIGHT = 'FleetCommandInFlight';
export const FLEET_COMMAND_DISPOSED = 'FleetCommandDisposed';

/** Long enough for a relay round trip, short enough to not look hung. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

/** Identifies one issued command so a late confirmation cannot be misapplied. */
export type FleetCommandToken = number;

export const NO_COMMAND_TOKEN: FleetCommandToken = 0;

export type FleetCommandOptions<T> = {
    /** The state the backend last confirmed. Rollback target. */
    confirmed: T;
    /** Sends the command. Must reject on a backend refusal. */
    submit: (next: T) => Promise<void>;
    /** True when the caller is allowed to perform this command. */
    permitted: boolean;
    timeoutMs?: number;
};

export type FleetCommand<T> = ExternalStore<FleetCommandState<T>> &
    HostLifecycle & {
        /** Resolves with the token identifying this command. */
        run(next: T): Promise<FleetCommandToken>;
        /** Accepted only for the command still awaiting confirmation. */
        confirm(token: FleetCommandToken, observed: T): boolean;
        /** Releases the timeout. The control stays usable on a remount. */
        detach(): void;
        /** Ends the command: nothing may be sent through it again. */
        dispose(): void;
    };

const AWAITING_CONFIRMATION = new Set(['pending', 'submitted']);

/** One issued command, tied to the attachment that issued it. */
type IssuedCommand = {token: FleetCommandToken; attachment: number};

function idle<T>(confirmed: T): FleetCommandState<T> {
    return {
        status: 'idle',
        confirmed,
        optimistic: null,
        error: null,
        token: NO_COMMAND_TOKEN
    };
}

export function createCommand<T>(
    options: FleetCommandOptions<T>
): FleetCommand<T> {
    const store = createExternalStore<FleetCommandState<T>>(
        idle(options.confirmed)
    );
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeToken: FleetCommandToken = NO_COMMAND_TOKEN;
    let issuedTokens: FleetCommandToken = NO_COMMAND_TOKEN;
    let disposed = false;
    // A command belongs to the attachment that issued it, so a reply landing
    // after a detach has no mounted control left to write to.
    let attachment = 0;

    function clearTimer(): void {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
    }

    function isActive(token: FleetCommandToken): boolean {
        return (
            !disposed &&
            token === activeToken &&
            AWAITING_CONFIRMATION.has(store.getSnapshot().status)
        );
    }

    function isAwaited(issued: IssuedCommand): boolean {
        return issued.attachment === attachment && isActive(issued.token);
    }

    /** Releases the timeout. A reply still in flight can no longer write. */
    function detach(): void {
        attachment += 1;
        clearTimer();
    }

    function fail(
        status: 'failed' | 'timed_out',
        token: FleetCommandToken,
        error: FleetSdkError
    ): void {
        clearTimer();
        activeToken = NO_COMMAND_TOKEN;
        store.setSnapshot({
            status,
            confirmed: store.getSnapshot().confirmed,
            optimistic: null,
            error,
            token
        });
    }

    function timeoutFor(token: FleetCommandToken): Promise<never> {
        return new Promise((_, reject) => {
            timer = setTimeout(() => {
                if (!isActive(token)) return;
                const error = createFleetSdkError(
                    FLEET_COMMAND_TIMED_OUT,
                    `Device did not confirm within ${timeoutMs}ms`
                );
                fail('timed_out', token, error);
                reject(error);
            }, timeoutMs);
        });
    }

    function refuse(code: string, message: string): never {
        const error = createFleetSdkError(code, message);
        // A refusal must never disturb a command that is still in flight; its
        // optimistic value and timer belong to the run that is still running.
        if (!AWAITING_CONFIRMATION.has(store.getSnapshot().status)) {
            store.setSnapshot({
                ...store.getSnapshot(),
                status: 'failed',
                optimistic: null,
                error
            });
        }
        throw error;
    }

    async function run(next: T): Promise<FleetCommandToken> {
        if (disposed) {
            refuse(FLEET_COMMAND_DISPOSED, 'This control is no longer mounted');
        }
        if (!options.permitted) {
            refuse(
                FLEET_COMMAND_NOT_PERMITTED,
                'You do not have permission to perform this command'
            );
        }
        // Overlapping commands to one device race in the field as well as in
        // the UI, so a second one is refused rather than allowed to clobber.
        if (AWAITING_CONFIRMATION.has(store.getSnapshot().status)) {
            refuse(
                FLEET_COMMAND_IN_FLIGHT,
                'A command for this control is still in progress'
            );
        }

        const issued: IssuedCommand = {token: ++issuedTokens, attachment};
        activeToken = issued.token;
        clearTimer();
        store.setSnapshot({
            status: 'pending',
            confirmed: store.getSnapshot().confirmed,
            optimistic: next,
            error: null,
            token: issued.token
        });

        try {
            // The deadline covers the transport submission as well as the
            // device confirmation. A transport promise that never settles
            // must not leave the control permanently pending.
            await Promise.race([
                options.submit(next),
                timeoutFor(issued.token)
            ]);
        } catch (cause) {
            const error = toFleetSdkError(cause);
            if (isAwaited(issued)) fail('failed', issued.token, error);
            throw error;
        }

        if (!isAwaited(issued)) return issued.token;
        store.setSnapshot({
            status: 'submitted',
            confirmed: store.getSnapshot().confirmed,
            optimistic: next,
            error: null,
            token: issued.token
        });
        return issued.token;
    }

    function confirm(token: FleetCommandToken, observed: T): boolean {
        if (!isActive(token)) return false;
        clearTimer();
        activeToken = NO_COMMAND_TOKEN;
        store.setSnapshot({
            status: 'confirmed',
            confirmed: observed,
            optimistic: null,
            error: null,
            token
        });
        return true;
    }

    return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        run,
        confirm,
        detach,
        dispose() {
            disposed = true;
            activeToken = NO_COMMAND_TOKEN;
            clearTimer();
        }
    };
}

import log4js from 'log4js';
import {publishSession, type SessionSignal} from '../redis/SessionSignals';
import {formatError} from '../util/formatError';

const logger = log4js.getLogger('user-session');

type UserSessionSignal = Omit<SessionSignal, 'instanceId'>;
type UserSessionListener = (signal: UserSessionSignal) => void;

// Peers never receive their own publish, so this instance's reactions hook here.
const localListeners = new Set<UserSessionListener>();

/** Hears every user session signal published on this instance. */
export function onLocalUserSessionSignal(
    listener: UserSessionListener
): () => void {
    localListeners.add(listener);
    return () => {
        localListeners.delete(listener);
    };
}

// One failing listener must not stop the others or the peer broadcast.
function callListener(
    listener: UserSessionListener,
    event: {context: string; signal: UserSessionSignal}
): void {
    try {
        listener(event.signal);
    } catch (error) {
        logger.error(
            '%s: local session listener failed: %s',
            event.context,
            formatError(error)
        );
    }
}

export function publishUserSessionSignal(
    context: string,
    signal: UserSessionSignal
): void {
    for (const listener of localListeners) {
        callListener(listener, {context, signal});
    }
    void publishSession(signal).catch((error) => {
        logger.warn(
            '%s: session signal publish failed: %s',
            context,
            formatError(error)
        );
    });
}

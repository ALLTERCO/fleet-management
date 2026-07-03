import log4js from 'log4js';
import {publishSession, type SessionSignal} from '../redis/SessionSignals';
import {formatError} from '../util/formatError';

const logger = log4js.getLogger('user-session');

export function publishUserSessionSignal(
    context: string,
    signal: Omit<SessionSignal, 'instanceId'>
): void {
    void publishSession(signal).catch((error) => {
        logger.warn(
            '%s: session signal publish failed: %s',
            context,
            formatError(error)
        );
    });
}

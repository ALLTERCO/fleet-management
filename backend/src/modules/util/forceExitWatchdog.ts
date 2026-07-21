import {getLogger} from 'log4js';

const logger = getLogger('shutdown');

// Arm a force-exit so a hung shutdown step cannot strand the process with an
// already-released port (which no orchestrator would restart). Unref'd so it
// never keeps an otherwise-idle process alive; clearTimeout it on clean exit.
export function armForceExit(ms: number, exitCode: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
        logger.fatal('Shutdown watchdog fired — forcing exit');
        process.exit(exitCode);
    }, ms);
    timer.unref();
    return timer;
}

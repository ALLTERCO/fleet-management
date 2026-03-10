import * as log4js from 'log4js';
import type FirmwareComponent from '../model/component/FirmwareComponent';
import * as Commander from './Commander';
import * as Observability from './Observability';

const logger = log4js.getLogger('FirmwareScheduler');

// Weekly interval in milliseconds (7 days)
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// For development/testing: 1 hour interval
// const WEEKLY_INTERVAL_MS = 60 * 60 * 1000;

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Get the FirmwareComponent from Commander
 */
function getFirmwareComponent(): FirmwareComponent | null {
    const component = Commander.getComponent('firmware');
    if (!component) {
        logger.warn('FirmwareComponent not found');
        return null;
    }
    return component as FirmwareComponent;
}

/**
 * Run the auto-update check
 */
async function runAutoUpdate(): Promise<void> {
    logger.info('Running scheduled firmware auto-update check...');

    const firmwareComponent = getFirmwareComponent();
    if (!firmwareComponent) {
        return;
    }

    try {
        const result = await firmwareComponent.runAutoUpdate();
        logger.info(
            'Scheduled auto-update completed: checked=%d, updated=%d, failed=%d',
            result.checked,
            result.updated,
            result.failed
        );
    } catch (error: any) {
        logger.error('Scheduled auto-update failed:', error?.message || error);
    }
}

/**
 * Calculate milliseconds until next Sunday at 3 AM
 */
function msUntilNextSunday3AM(): number {
    const now = new Date();
    const nextSunday = new Date(now);

    // Find next Sunday
    const daysUntilSunday = (7 - now.getDay()) % 7;
    nextSunday.setDate(
        now.getDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday)
    );

    // Set to 3 AM
    nextSunday.setHours(3, 0, 0, 0);

    // If we're already past Sunday 3 AM this week, go to next week
    if (nextSunday.getTime() <= now.getTime()) {
        nextSunday.setDate(nextSunday.getDate() + 7);
    }

    return nextSunday.getTime() - now.getTime();
}

/**
 * Start the firmware auto-update scheduler.
 * Runs every Sunday at 3 AM.
 */
export function startScheduler(): void {
    if (schedulerInterval) {
        logger.warn('Scheduler already running');
        return;
    }

    // Calculate time until first run (next Sunday at 3 AM)
    const msUntilFirstRun = msUntilNextSunday3AM();
    const nextRunDate = new Date(Date.now() + msUntilFirstRun);

    logger.info(
        'Firmware auto-update scheduler started. Next run: %s',
        nextRunDate.toISOString()
    );

    // Schedule first run
    setTimeout(() => {
        runAutoUpdate();

        // Then run weekly
        schedulerInterval = setInterval(runAutoUpdate, WEEKLY_INTERVAL_MS);
    }, msUntilFirstRun);
}

/**
 * Stop the firmware auto-update scheduler.
 */
export function stopScheduler(): void {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        logger.info('Firmware auto-update scheduler stopped');
    }
}

/**
 * Check if scheduler is running
 */
export function isRunning(): boolean {
    return schedulerInterval !== null;
}

Observability.registerModule('firmwareScheduler', () => ({
    running: schedulerInterval !== null ? 1 : 0
}));

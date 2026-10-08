import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as DeviceCollector from '../DeviceCollector';
import {getDeviceOrg} from '../EventDistributor';
import {listAccessRevoked, type RevokedAccessRow} from '../PostgresProvider';
import {
    enforceStoredAccess,
    holdsDeviceSocket,
    pendingDeviceOrganizations
} from './index';

// A peer's access-change signal can be lost. Each interval every process
// re-reads only the devices whose access left ALLOWED or whose row was deleted
// and closes such a device it holds, the same way a signal would. Nothing
// changed costs one indexed read per owner group held here.

const logger = getLogger('access-recheck');

// Rows read per owner group per tick; the rest follow on the next tick.
const PAGE_LIMIT = 500;

// The owner group of rows with no organization. A deny leaves an unowned row
// unowned, so every pending socket may be decided there.
export const UNOWNED_ORGANIZATION_KEY = '';

export interface AccessRecheckDeps {
    now(): number;
    heldOrganizations(): Set<string>;
    listRevoked: typeof listAccessRevoked;
    holdsDevice(externalId: string): boolean;
    // access is null for a deleted device.
    enforce(externalId: string, access: number | null): void;
}

export interface AccessRecheckOptions {
    intervalMs: number;
    pageLimit?: number;
    deps?: Partial<AccessRecheckDeps>;
}

interface Cursor {
    afterAt: Date;
    afterId: number;
}

const defaultDeps: AccessRecheckDeps = {
    now: () => Date.now(),
    heldOrganizations: heldOrganizationKeys,
    listRevoked: listAccessRevoked,
    holdsDevice: holdsDeviceSocket,
    enforce: (externalId, access) =>
        enforceStoredAccess(externalId, access ?? undefined)
};

export class AccessRecheck {
    readonly #intervalMs: number;
    readonly #pageLimit: number;
    readonly #deps: AccessRecheckDeps;
    readonly #cursors = new Map<string, Cursor>();
    #lastTickAt: number;
    #timer: NodeJS.Timeout | undefined;
    #ticking = false;

    constructor(options: AccessRecheckOptions) {
        this.#intervalMs = options.intervalMs;
        this.#pageLimit = options.pageLimit ?? PAGE_LIMIT;
        this.#deps = {...defaultDeps, ...options.deps};
        // A restart looks back one interval, so a deny made just before it counts.
        this.#lastTickAt = this.#deps.now();
    }

    start(): void {
        if (this.#timer) return;
        this.#timer = setInterval(
            () => void this.#tickUnlessBusy(),
            this.#intervalMs
        );
        this.#timer.unref();
    }

    stop(): void {
        clearInterval(this.#timer);
        this.#timer = undefined;
    }

    async tick(): Promise<void> {
        const tickAt = this.#deps.now();
        const organizations = this.#deps.heldOrganizations();
        this.#forgetOrganizationsNotHeld(organizations);
        // One organization at a time: a recheck never takes more than one
        // database connection.
        for (const organizationId of organizations) {
            await this.#recheckOrganizationSafely(organizationId, tickAt);
        }
        this.#lastTickAt = tickAt;
    }

    async #tickUnlessBusy(): Promise<void> {
        if (this.#ticking) return;
        this.#ticking = true;
        try {
            await this.tick();
        } catch (err) {
            logger.error('device access recheck failed: %s', err);
        } finally {
            this.#ticking = false;
        }
    }

    // A failed read keeps the organization's position for the next tick.
    async #recheckOrganizationSafely(
        organizationId: string,
        tickAt: number
    ): Promise<void> {
        try {
            await this.#recheckOrganization(organizationId, tickAt);
        } catch (err) {
            logger.error(
                'device access recheck for org=%s failed: %s',
                organizationId,
                err
            );
        }
    }

    async #recheckOrganization(
        organizationId: string,
        tickAt: number
    ): Promise<void> {
        const cursor =
            this.#cursors.get(organizationId) ??
            this.#lookBackFrom(this.#lastTickAt);
        // Kept as is when the read fails, so a retry misses nothing.
        this.#cursors.set(organizationId, cursor);
        const rows = await this.#deps.listRevoked({
            organizationId,
            afterAt: cursor.afterAt,
            afterId: cursor.afterId,
            limit: this.#pageLimit
        });
        this.#closeHeldDevices(rows);
        this.#cursors.set(organizationId, this.#nextCursor(rows, tickAt));
    }

    #closeHeldDevices(rows: RevokedAccessRow[]): void {
        for (const row of rows) {
            if (!this.#deps.holdsDevice(row.external_id)) continue;
            logger.warn(
                'device %s held here after its access changed to %s; closing it now',
                row.external_id,
                row.control_access ?? 'deleted'
            );
            this.#deps.enforce(row.external_id, row.control_access);
        }
    }

    // A full page continues after its last row. Otherwise the next read looks
    // back one interval: a change committed late can carry an earlier stamp.
    #nextCursor(rows: RevokedAccessRow[], tickAt: number): Cursor {
        const last = rows.at(-1);
        if (last && rows.length >= this.#pageLimit) {
            return {afterAt: last.access_changed_at, afterId: last.id};
        }
        return this.#lookBackFrom(tickAt);
    }

    #lookBackFrom(atMs: number): Cursor {
        return {afterAt: new Date(atMs - this.#intervalMs), afterId: 0};
    }

    #forgetOrganizationsNotHeld(organizations: Set<string>): void {
        for (const organizationId of this.#cursors.keys()) {
            if (!organizations.has(organizationId)) {
                this.#cursors.delete(organizationId);
            }
        }
    }
}

// Owner groups whose rows can decide a socket held here, live or pending.
function heldOrganizationKeys(): Set<string> {
    const keys = new Set<string>();
    for (const shellyID of DeviceCollector.getAllShellyIDs()) {
        keys.add(getDeviceOrg(shellyID) ?? UNOWNED_ORGANIZATION_KEY);
    }
    for (const organizationId of pendingDeviceOrganizations()) {
        keys.add(organizationId ?? UNOWNED_ORGANIZATION_KEY);
        keys.add(UNOWNED_ORGANIZATION_KEY);
    }
    return keys;
}

let running: AccessRecheck | null = null;

export function startAccessRecheck(): void {
    running ??= new AccessRecheck({
        intervalMs: tuning.waitingRoom.accessRecheckMs
    });
    running.start();
}

export function stopAccessRecheck(): void {
    running?.stop();
    running = null;
}

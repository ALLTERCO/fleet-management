import {randomUUID} from 'node:crypto';
import {getLogger} from 'log4js';
import type {WebSocket} from 'ws';
import {envInt} from '../../../config/envReader';
import type CommandSender from '../../../model/CommandSender';
import type {user_t} from '../../../types';
import {type Disposable, DisposableBag} from '../../disposableBag';
import * as EventDistributor from '../../EventDistributor';
import {publishSession} from '../../redis/SessionSignals';
import {getUserFromToken} from '../../user';
import {buildSender} from '../utils/senderFromRequest';
import {CLOSE_REPLACED_BY_NEW_CONNECTION} from './closeCodes';
import {safeSocketSend} from './safeSocketSend';

const logger = getLogger('connection-context');

// One per accepted client WebSocket. Sole owner of socket close: drains
// registered disposables (LIFO) and aborts the signal on disconnect.

export interface ConnectionContextOptions {
    socket: WebSocket;
    sender: CommandSender;
    token?: string;
    sourceIp?: string;
}

// How long the captured WS sender identity is trusted before re-resolving
// against the (cached) userinfo store. Bounds blast radius of stale role.
const REFRESH_INTERVAL_MS = envInt(
    'FM_WS_USER_REFRESH_INTERVAL_MS',
    30_000,
    1000
);

function userIdentityChanged(prev: user_t, next: user_t): boolean {
    if (prev.username !== next.username) return true;
    if (prev.userId !== next.userId) return true;
    if (prev.group !== next.group) return true;
    if (prev.organizationId !== next.organizationId) return true;
    if (prev.mfaPresent !== next.mfaPresent) return true;
    if (prev.enabled !== next.enabled) return true;
    if (prev.permissions.length !== next.permissions.length) return true;
    for (let i = 0; i < prev.permissions.length; i++) {
        if (prev.permissions[i] !== next.permissions[i]) return true;
    }
    // Set-equality semantics: same roles, order-insensitive.
    const prevSet = new Set(prev.roles ?? []);
    const nextSet = new Set(next.roles ?? []);
    if (prevSet.size !== nextSet.size) return true;
    for (const r of nextSet) if (!prevSet.has(r)) return true;
    return false;
}

export interface ConnectionEvent {
    kind: 'rpc' | 'event' | 'patch';
    method: string;
    ts: number;
    ms?: number;
}

const RECENT_EVENTS_CAP = 100;

export class ConnectionContext {
    static readonly #registry = new WeakMap<WebSocket, ConnectionContext>();
    static readonly #byTenant = new Map<string, Set<ConnectionContext>>();
    static readonly #byConnectionId = new Map<string, ConnectionContext>();

    readonly socket: WebSocket;
    readonly connectionId: string;
    readonly connectedAt: number;
    #sender: CommandSender;
    readonly #abortController = new AbortController();
    readonly #bag = new DisposableBag();
    #token: string | undefined;
    readonly #sourceIp: string | undefined;
    #lastUser: user_t | undefined;
    #lastRefreshedAt = Date.now();
    #refreshInFlight: Promise<CommandSender | null> | null = null;
    #tokenInvalidated = false;
    readonly #recentEvents: ConnectionEvent[] = [];

    constructor(opts: ConnectionContextOptions) {
        this.socket = opts.socket;
        this.connectionId = randomUUID();
        this.connectedAt = Date.now();
        this.#sender = opts.sender;
        this.#token = opts.token;
        this.#sourceIp = opts.sourceIp;
        ConnectionContext.#registry.set(opts.socket, this);
        ConnectionContext.#byConnectionId.set(this.connectionId, this);
        this.#indexTenant(this.#sender.getOrganizationId());
        this.socket.once(
            'close',
            () =>
                void this.dispose().catch((err) =>
                    logger.error('connection dispose failed: %s', err)
                )
        );
    }

    recordEvent(event: ConnectionEvent): void {
        this.#recentEvents.push(event);
        while (this.#recentEvents.length > RECENT_EVENTS_CAP) {
            this.#recentEvents.shift();
        }
    }

    recentEvents(limit = RECENT_EVENTS_CAP): readonly ConnectionEvent[] {
        const start = Math.max(0, this.#recentEvents.length - limit);
        return this.#recentEvents.slice(start);
    }

    static byConnectionId(id: string): ConnectionContext | undefined {
        return ConnectionContext.#byConnectionId.get(id);
    }

    static listAll(): ConnectionContext[] {
        return Array.from(ConnectionContext.#byConnectionId.values());
    }

    get sender(): CommandSender {
        return this.#sender;
    }

    get user(): user_t | undefined {
        return this.#lastUser;
    }

    static forSocket(socket: WebSocket): ConnectionContext | undefined {
        return ConnectionContext.#registry.get(socket);
    }

    static async fromAuthenticatedSocket(
        socket: WebSocket,
        user: user_t,
        sourceIp?: string,
        token?: string
    ): Promise<ConnectionContext> {
        const sender = ConnectionContext.#senderFromUser(
            socket,
            user,
            sourceIp
        );
        // Build V2 effective shape once at login. Subsequent sync
        // Permission checks evaluate against this cached shape.
        await sender.loadV2EffectiveShape();
        const ctx = new ConnectionContext({socket, sender, sourceIp, token});
        ctx.#lastUser = user;
        return ctx;
    }

    static #senderFromUser(
        socket: WebSocket,
        user: user_t,
        sourceIp: string | undefined
    ): CommandSender {
        // Sync construction so callers control when loadV2EffectiveShape
        // runs (the lifecycle here interleaves with sender wiring +
        // ensureFreshSender's atomic swap).
        return buildSender(user, {socket, sourceIp});
    }

    // Tenant-wide authz mutation (persona / assignment / user-group
    // change). Drops decision caches, marks senders stale, and pings the
    // browser so it re-fetches its permission shape immediately. Without
    // the push, the frontend UI gates stay stale until reconnect.
    static invalidateTenant(tenantId: string): number {
        const set = ConnectionContext.#byTenant.get(tenantId);
        if (!set) return 0;
        // Same payload for every connection in the tenant — build once.
        const notify = JSON.stringify({
            method: 'NotifyAuthChanged',
            params: {tenantId}
        });
        for (const ctx of set) {
            ctx.#lastRefreshedAt = 0;
            ctx.sender.clearAuthzDecisionCaches();
            safeSocketSend(ctx.socket, notify);
        }
        return set.size;
    }

    static lookupUserIdBySocket(socket: object): user_t['userId'] | undefined {
        const ctx = ConnectionContext.#registry.get(socket as WebSocket);
        return ctx?.sender.getUserId();
    }

    // Run `action` on every live context for `userId`; returns how many matched.
    static #forEachContextOfUser(
        userId: string,
        action: (ctx: ConnectionContext) => void
    ): number {
        let count = 0;
        for (const set of ConnectionContext.#byTenant.values()) {
            for (const ctx of set) {
                if (ctx.sender.getUserId() === userId) {
                    action(ctx);
                    count++;
                }
            }
        }
        return count;
    }

    // Invalidate one user's V2 shape across all live tenants.
    static invalidateUser(userId: string): number {
        return ConnectionContext.#forEachContextOfUser(userId, (ctx) =>
            ctx.sender.clearAuthzDecisionCaches()
        );
    }

    // Force a sender rebuild for matching live sessions on the NEXT request
    // — bypasses REFRESH_INTERVAL_MS. Used by role-grant/revoke/deactivate
    // so the new roles take effect immediately, not after the refresh
    // window. Also pushes a NotifyAuthChanged event so the frontend can
    // re-fetch its permissions (otherwise UI gates that depend on
    // authStore.isPlatformAdmin etc. stay stale until reconnect).
    static forceSenderRefresh(userId: string): number {
        // Identical payload across every matched connection — build once.
        const notify = JSON.stringify({
            method: 'NotifyAuthChanged',
            params: {userId}
        });
        return ConnectionContext.#forEachContextOfUser(userId, (ctx) => {
            ctx.#lastRefreshedAt = 0;
            ctx.sender.clearAuthzDecisionCaches();
            safeSocketSend(ctx.socket, notify);
        });
    }

    // Hard variant for delete: drop the connections matching userId after
    // sending NotifyAuthChanged. forceSenderRefresh alone leaves idle
    // sockets open until the next inbound RPC triggers ensureFreshSender,
    // which is unacceptable for a deleted/disabled user.
    static forceSenderDisconnect(userId: string, reason: string): number {
        const notify = JSON.stringify({
            method: 'NotifyAuthChanged',
            params: {userId, reason}
        });
        return ConnectionContext.#forEachContextOfUser(userId, (ctx) => {
            ctx.#tokenInvalidated = true;
            safeSocketSend(ctx.socket, notify);
            try {
                ctx.socket.close(CLOSE_REPLACED_BY_NEW_CONNECTION, reason);
            } catch {
                // socket already closing — fine
            }
        });
    }

    // Precautionary — Redis recovery. Keeps existing shape until swap.
    static rebuildAllShapes(): number {
        let count = 0;
        for (const set of ConnectionContext.#byTenant.values()) {
            for (const ctx of set) {
                ctx.sender.refreshShapeInBackground();
                count++;
            }
        }
        return count;
    }

    /**
     * Re-resolve the captured WS user against the userinfo cache when the
     * trust window has elapsed. Rebuilds the sender only on actual change;
     * returns the (possibly new) sender. Resolves to null if the token has
     * been invalidated and the caller should drop the connection.
     */
    async ensureFreshSender(): Promise<CommandSender | null> {
        if (!this.#token) return this.#sender;
        if (this.#tokenInvalidated) return null;
        if (Date.now() - this.#lastRefreshedAt < REFRESH_INTERVAL_MS) {
            return this.#sender;
        }
        if (this.#refreshInFlight) {
            return await this.#refreshInFlight;
        }
        this.#refreshInFlight = (async () => {
            const fresh = await getUserFromToken(this.#token);
            this.#lastRefreshedAt = Date.now();
            if (!fresh) {
                this.#lastUser = undefined;
                this.#tokenInvalidated = true;
                return null;
            }
            if (this.#lastUser && !userIdentityChanged(this.#lastUser, fresh)) {
                return this.#sender;
            }
            return this.#swapSender(fresh);
        })().finally(() => {
            this.#refreshInFlight = null;
        });
        return await this.#refreshInFlight;
    }

    // Build a fresh sender for `fresh`, swap it in, re-index on tenant change.
    async #swapSender(fresh: user_t): Promise<CommandSender> {
        const prevTenant = this.#sender.getOrganizationId();
        const nextTenant = fresh.organizationId;
        const next = ConnectionContext.#senderFromUser(
            this.socket,
            fresh,
            this.#sourceIp
        );
        await next.loadV2EffectiveShape();
        this.#sender = next;
        this.#lastUser = fresh;
        if (prevTenant !== nextTenant) {
            this.#unindexTenant(prevTenant);
            this.#indexTenant(nextTenant);
        }
        return next;
    }

    // Pins to same userId + tenant; shares #refreshInFlight with ensureFreshSender.
    async rotateToken(
        newToken: string,
        resolveUser: (
            token: string | undefined
        ) => Promise<user_t | undefined> = getUserFromToken
    ): Promise<boolean> {
        if (!newToken) return false;
        // Refuse rotation on an already-invalidated context. ensureFreshSender
        // sets #tokenInvalidated when Zitadel introspection returns null —
        // without this check, a concurrent rotateToken could attach a
        // foreign user's token to a socket whose original auth just lapsed.
        if (this.#tokenInvalidated) return false;
        while (this.#refreshInFlight) {
            await this.waitForRefreshInFlight();
        }
        if (this.#tokenInvalidated) return false;
        const work = (async (): Promise<CommandSender | null> => {
            const fresh = await resolveUser(newToken);
            if (!fresh) return null;
            // Re-check after the resolver await — forceSenderDisconnect on
            // a peer signal could have flipped #tokenInvalidated while we
            // were resolving the new token. Don't clear it silently.
            if (this.#tokenInvalidated) return null;
            if (this.#lastUser) {
                const sameUser = fresh.userId === this.#lastUser.userId;
                const sameTenant =
                    fresh.organizationId === this.#lastUser.organizationId;
                if (!sameUser || !sameTenant) return null;
            }
            this.#token = newToken;
            this.#lastRefreshedAt = Date.now();
            return this.#swapSender(fresh);
        })();
        this.#refreshInFlight = work.finally(() => {
            this.#refreshInFlight = null;
        });
        return (await work) !== null;
    }

    get signal(): AbortSignal {
        return this.#abortController.signal;
    }

    onClose(fn: Disposable): void {
        this.#bag.add(fn);
    }

    async dispose(): Promise<void> {
        if (this.#abortController.signal.aborted) return;
        this.#abortController.abort();
        ConnectionContext.#registry.delete(this.socket);
        ConnectionContext.#byConnectionId.delete(this.connectionId);
        this.#unindexTenant(this.#sender.getOrganizationId());
        // Defense in depth: drop any EventDistributor listener that a
        // component forgot to detach. Without this, a missed removeEventListener
        // pair leaks the sender ref via sender_callbacks indefinitely.
        EventDistributor.removeAllForSender(this.#sender);
        // Broadcast disconnect to peer instances (multi-instance session sync).
        // Adapter handles disabled case.
        const userId = this.#sender.getUserId();
        if (userId) {
            this.publishDisconnectBestEffort(userId);
        }
        await this.#bag.dispose();
    }

    private async waitForRefreshInFlight(): Promise<void> {
        try {
            await this.#refreshInFlight;
        } catch (error) {
            logger.debug(
                'sender refresh completed with error before token rotation: %s',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private publishDisconnectBestEffort(userId: string): void {
        void publishSession({kind: 'disconnect', userId}).catch((error) => {
            logger.debug(
                'disconnect session signal failed for %s: %s',
                userId,
                error instanceof Error ? error.message : String(error)
            );
        });
    }

    get pendingDisposables(): number {
        return this.#bag.size;
    }

    #indexTenant(tenantId: string | undefined): void {
        if (!tenantId) return;
        let set = ConnectionContext.#byTenant.get(tenantId);
        if (!set) {
            set = new Set();
            ConnectionContext.#byTenant.set(tenantId, set);
        }
        set.add(this);
    }

    #unindexTenant(tenantId: string | undefined): void {
        if (!tenantId) return;
        const set = ConnectionContext.#byTenant.get(tenantId);
        set?.delete(this);
        if (set?.size === 0) ConnectionContext.#byTenant.delete(tenantId);
    }
}

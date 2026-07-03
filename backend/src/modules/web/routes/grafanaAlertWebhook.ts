// Grafana alert webhook bridge. Bearer-authed, rate-limited, validated.

import {timingSafeEqual} from 'node:crypto';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config/tuning';
import {type GrafanaAlertEvent, reportGrafanaAlert} from '../../AlertEngine';
import * as Observability from '../../Observability';

const logger = log4js.getLogger('grafana-alert-webhook');

export interface GrafanaAlert {
    status?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    startsAt?: string;
    endsAt?: string;
    fingerprint?: string;
    valueString?: string;
}

export interface GrafanaAlertPayload {
    receiver?: string;
    status?: string;
    alerts?: GrafanaAlert[];
}

export interface WebhookRouterDeps {
    secret(): string;
    rateLimiter: RateLimiter;
    onAlert(orgId: string, alert: GrafanaAlert): void | Promise<void>;
    maxBodyBytes: number;
}

export interface RateLimiter {
    consume(now: number): boolean;
}

export function createTokenBucket(
    capacity: number,
    refillPerSec: number
): RateLimiter {
    const state = {tokens: capacity, lastRefill: Date.now()};
    return {
        consume(now: number) {
            // Clamp backward clock skew to zero elapsed.
            const elapsedSec = Math.max(0, (now - state.lastRefill) / 1000);
            state.tokens = Math.min(
                capacity,
                state.tokens + elapsedSec * refillPerSec
            );
            if (now > state.lastRefill) state.lastRefill = now;
            if (state.tokens < 1) return false;
            state.tokens -= 1;
            return true;
        }
    };
}

export function isStringMap(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every((v) => typeof v === 'string');
}

export function isAlert(value: unknown): value is GrafanaAlert {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const v = value as Record<string, unknown>;
    if (v.status !== undefined && typeof v.status !== 'string') return false;
    if (v.fingerprint !== undefined && typeof v.fingerprint !== 'string') {
        return false;
    }
    if (v.labels !== undefined && !isStringMap(v.labels)) return false;
    if (v.annotations !== undefined && !isStringMap(v.annotations)) {
        return false;
    }
    return true;
}

export function parsePayload(value: unknown): GrafanaAlert[] {
    if (!value || typeof value !== 'object') return [];
    const alerts = (value as GrafanaAlertPayload).alerts;
    if (!Array.isArray(alerts)) return [];
    return alerts.filter(isAlert);
}

export function constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
}

export function extractBearerSecret(req: express.Request): string {
    const auth = req.get('authorization');
    if (!auth) return '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    return match?.[1] ?? '';
}

export function secretMatches(req: express.Request, secret: string): boolean {
    const presented = extractBearerSecret(req);
    if (!presented) return false;
    return constantTimeEqual(presented, secret);
}

function alertLabel(alert: GrafanaAlert): string {
    return alert.labels?.alertname ?? alert.fingerprint ?? 'unnamed';
}

// Map a Grafana webhook alert to the engine's normalized event shape.
export function toGrafanaAlertEvent(alert: GrafanaAlert): GrafanaAlertEvent {
    const labels = alert.labels ?? {};
    const annotations = alert.annotations ?? {};
    return {
        status: alert.status === 'resolved' ? 'resolved' : 'firing',
        fingerprint: alert.fingerprint || alertLabel(alert),
        alertName: alertLabel(alert),
        summary:
            annotations.summary ??
            annotations.description ??
            alert.valueString ??
            '',
        labels,
        annotations
    };
}

function makeHandler(deps: WebhookRouterDeps) {
    return async function handleAlertPost(
        req: express.Request,
        res: express.Response
    ): Promise<void> {
        const secret = deps.secret();
        if (!secret) {
            Observability.incrementCounter(
                'grafana_alert_webhook_unconfigured'
            );
            res.status(503).json({error: 'Grafana webhook not configured'});
            return;
        }
        if (!secretMatches(req, secret)) {
            Observability.incrementCounter('grafana_alert_webhook_rejected');
            res.status(403).json({error: 'Invalid webhook secret'});
            return;
        }
        if (!deps.rateLimiter.consume(Date.now())) {
            Observability.incrementCounter(
                'grafana_alert_webhook_rate_limited'
            );
            res.status(429).json({error: 'Too many alert webhooks'});
            return;
        }
        const orgId = req.params.orgId;
        if (typeof orgId !== 'string' || !orgId) {
            res.status(400).json({error: 'Missing orgId'});
            return;
        }
        const alerts = parsePayload(req.body);
        Observability.incrementCounter(
            'grafana_alert_webhook_received',
            alerts.length
        );
        const results = await Promise.allSettled(
            alerts.map((alert) => deps.onAlert(orgId, alert))
        );
        for (const r of results) {
            if (r.status === 'rejected') {
                Observability.incrementCounter('grafana_alert_webhook_errors');
                logger.error('grafana alert ingest failed: %s', r.reason);
            }
        }
        res.status(204).end();
    };
}

export function buildGrafanaAlertWebhookRouter(
    deps: WebhookRouterDeps
): express.Router {
    const router = express.Router();
    router.post(
        '/alert-webhook/:orgId',
        express.json({limit: deps.maxBodyBytes}),
        makeHandler(deps)
    );
    return router;
}

export function buildDefaultRouter(): express.Router {
    return buildGrafanaAlertWebhookRouter({
        secret: () => tuning.grafana.proxySecret,
        rateLimiter: createTokenBucket(
            tuning.grafana.webhookRateCapacity,
            tuning.grafana.webhookRateRefillPerSec
        ),
        onAlert: (orgId, alert) =>
            reportGrafanaAlert(orgId, toGrafanaAlertEvent(alert)),
        maxBodyBytes: tuning.grafana.webhookMaxBytes
    });
}

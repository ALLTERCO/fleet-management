import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import express from 'express';
import {
    buildGrafanaAlertWebhookRouter,
    type GrafanaAlert
} from '../../src/modules/web/routes/grafanaAlertWebhook';

test('Grafana webhook enforces auth and org validation before delivering alerts', async () => {
    const delivered: Array<{orgId: string; alert: GrafanaAlert}> = [];
    const rateLimitKeys: string[] = [];
    const app = express();

    app.use(
        '/api/grafana',
        buildGrafanaAlertWebhookRouter({
            secret: () => 'test-secret',
            rateLimiter: {
                consume(_now, key) {
                    rateLimitKeys.push(key ?? 'global');
                    return true;
                }
            },
            onAlert(orgId, alert) {
                delivered.push({orgId, alert});
            },
            maxBodyBytes: 16 * 1024,
            orgExists: async (orgId) => orgId === 'org-1'
        })
    );

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/grafana/alert-webhook`;

    try {
        const unauthorized = await fetch(`${endpoint}/org-1`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({alerts: []})
        });
        assert.equal(unauthorized.status, 403);
        assert.deepEqual(await unauthorized.json(), {
            error: 'Invalid webhook secret'
        });

        const unknownOrg = await fetch(`${endpoint}/missing-org`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer test-secret',
                'content-type': 'application/json'
            },
            body: JSON.stringify({alerts: []})
        });
        assert.equal(unknownOrg.status, 404);
        assert.deepEqual(await unknownOrg.json(), {
            error: 'Unknown organization'
        });

        const alert: GrafanaAlert = {
            status: 'firing',
            fingerprint: 'alert-1',
            labels: {alertname: 'DeviceOffline'}
        };
        const accepted = await fetch(`${endpoint}/org-1`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer test-secret',
                'content-type': 'application/json'
            },
            body: JSON.stringify({alerts: [alert]})
        });
        assert.equal(accepted.status, 204);
        assert.deepEqual(rateLimitKeys, ['org-1']);
        assert.deepEqual(delivered, [{orgId: 'org-1', alert}]);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});

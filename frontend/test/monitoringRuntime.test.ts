import {describe, expect, it} from 'vitest';
import {buildRuntimeContractView} from '@/helpers/monitoringRuntime';

function runtimeView(manifest: Record<string, unknown>) {
    return buildRuntimeContractView({
        versionInfo: {},
        manifestPayload: {status: 'ok', manifest},
        manifestError: null,
        deviceUsagePayload: null
    });
}

describe('buildRuntimeContractView container status', () => {
    it('leaves static manifest inventory unverified when live status fields are absent', () => {
        const view = runtimeView({
            schema_version: 2,
            identity: {
                client_id: 'shared',
                environment_id: 'production'
            },
            shared_services: {
                fleet_manager: {
                    service: 'fleet-manager',
                    image: 'fleet-manager:v1.92.0'
                },
                fleet_db: {
                    service: 'fleet-db',
                    image: 'postgres:17'
                }
            },
            clients: {
                tenant_a: {
                    containers: [
                        {
                            service: 'fleet-manager',
                            image: 'fleet-manager:v1.92.0',
                            client_id: 'tenant-a',
                            environment_id: 'production'
                        }
                    ]
                }
            }
        });

        expect(view.containerSummary).toMatchObject({
            expected: 3,
            running: null,
            statusVerified: false
        });
        expect(view.runtimeStatus).toBe('unknown');
    });

    it('reports healthy only when container runtime status is explicitly verified', () => {
        const view = runtimeView({
            schema_version: 2,
            identity: {
                client_id: 'shared',
                environment_id: 'production'
            },
            containers: [
                {name: 'fleet-manager', status: 'running'},
                {name: 'fleet-db', health: 'healthy'}
            ]
        });

        expect(view.containerSummary).toMatchObject({
            expected: 2,
            running: 2,
            statusVerified: true
        });
        expect(view.runtimeStatus).toBe('healthy');
    });

    it('warns when an explicit runtime count does not match the expected inventory', () => {
        const view = runtimeView({
            schema_version: 2,
            identity: {
                client_id: 'shared',
                environment_id: 'production'
            },
            container_summary: {
                expected: 7,
                running: 6
            }
        });

        expect(view.containerSummary).toMatchObject({
            expected: 7,
            running: 6,
            statusVerified: true
        });
        expect(view.runtimeStatus).toBe('warning');
    });
});

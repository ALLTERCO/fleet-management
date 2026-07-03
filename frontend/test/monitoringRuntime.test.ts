import {describe, expect, it} from 'vitest';
import manifestFixture from '../../docs/architecture/contracts/fixtures/manifest-v2.example.json';
import {
    buildRuntimeContractView,
    deployCheckStatus,
    deviceUsageStatusClass,
    deviceUsageStatusLabel,
    redactRuntimePayload,
    runtimeStatusClass,
    shortSha
} from '@/helpers/monitoringRuntime';

describe('monitoringRuntime — runtime contract view', () => {
    it('normalizes runtime identity, deploy checks, and containers', () => {
        const view = buildRuntimeContractView({
            versionInfo: {version: '2.1.2', commit: 'version-commit'},
            manifestPayload: {
                status: 'ok',
                checksum: {value: 'sha256:abc'},
                manifest: {
                    schema_version: 2,
                    revision: 'rev-7',
                    generated_at: '2026-06-13T00:00:00Z',
                    runtime: {
                        commit: 'abcdef1234567890',
                        environment_id: 'prod-eu',
                        deployment_mode: 'shared_saas',
                        client_id: 'client-a',
                        compose_project_name: 'fm-prod'
                    },
                    checks: {
                        migration: {status: 'passed'},
                        smoke: 'passed'
                    },
                    containers: [
                        {
                            name: 'fm-api',
                            image: 'fleet:abcdef',
                            status: 'running',
                            labels: {
                                'fleet.client': 'client-a',
                                'fleet.environment': 'prod-eu'
                            }
                        }
                    ]
                }
            },
            manifestError: null,
            deviceUsagePayload: null
        });

        expect(view.runtimeIdentity).toEqual({
            commit: 'abcdef1234567890',
            environment: 'prod-eu',
            mode: 'shared_saas',
            client: 'client-a',
            composeProject: 'fm-prod'
        });
        expect(view.manifestStatus).toBe('ok');
        expect(view.manifestChecksumLabel).toBe('present');
        expect(view.manifestSchema).toBe('2');
        expect(view.manifestRevision).toBe('rev-7');
        expect(view.containerSummary).toEqual({
            expected: 1,
            running: 1,
            missing: 0,
            unexpected: 0,
            unknownOwner: 0
        });
        expect(view.containerRows[0]).toMatchObject({
            name: 'fm-api',
            client: 'client-a',
            environment: 'prod-eu',
            ownerKnown: true
        });
        expect(deployCheckStatus(view.manifest, 'migration')).toBe('passed');
        expect(deployCheckStatus(view.manifest, 'smoke')).toBe('passed');
    });

    it('normalizes the full deploy manifest fixture used by the control plane', () => {
        const view = buildRuntimeContractView({
            versionInfo: {},
            manifestPayload: {
                status: 'ok',
                checksum: {value: 'sha256:fixture'},
                manifest: manifestFixture
            },
            manifestError: null,
            deviceUsagePayload: null
        });

        expect(view.runtimeIdentity).toEqual({
            commit: '0000000000000000000000000000000000000000',
            environment: 'example',
            mode: 'shared',
            client: 'shared',
            composeProject: 'fm'
        });
        expect(view.manifestRevision).toBe('example');
        expect(view.rollbackLabel).toBe('ready');
        expect(view.containerSummary).toEqual({
            expected: 7,
            running: 7,
            missing: 0,
            unexpected: 0,
            unknownOwner: 0
        });
        expect(view.containerRows).toHaveLength(7);
        expect(view.containerRows.map((row) => row.name)).toEqual(
            expect.arrayContaining([
                'fm-fleet-manager',
                'fm-postgres',
                'fm-client-example',
                'fm-client-dedicated-app'
            ])
        );
        expect(view.deviceUsageRows).toHaveLength(2);
        expect(view.deviceUsageRows[0]).toMatchObject({
            client_id: 'client-example',
            unique_active_devices: 342,
            paid_device_limit: 500,
            warning: false,
            over_limit: false
        });
        expect(view.deviceUsageRows[1]).toMatchObject({
            client_id: 'client-dedicated',
            unique_active_devices: 2480,
            paid_device_limit: 2500,
            warning: true,
            over_limit: false,
            usage_percent: 99
        });
    });

    it('marks the runtime warning when containers are missing, unexpected, or unknown-owner', () => {
        const view = buildRuntimeContractView({
            versionInfo: {},
            manifestPayload: {
                status: 'ok',
                manifest: {
                    missing_containers: ['fm-worker'],
                    unexpected_containers: ['debug-shell'],
                    unknown_owner_containers: ['orphan-container']
                }
            },
            manifestError: null,
            deviceUsagePayload: null
        });

        expect(view.containerSummary.missing).toBe(1);
        expect(view.containerSummary.unexpected).toBe(1);
        expect(view.containerSummary.unknownOwner).toBe(1);
        expect(view.runtimeStatus).toBe('warning');
    });

    it('derives unknown-owner containers from missing ownership identity', () => {
        const view = buildRuntimeContractView({
            versionInfo: {},
            manifestPayload: {
                status: 'ok',
                manifest: {
                    runtime: {
                        commit: 'abcdef',
                        environment_id: 'unknown',
                        client_id: 'unknown'
                    },
                    containers: [
                        {
                            name: 'orphan-debug',
                            image: 'debug:latest',
                            status: 'running'
                        }
                    ]
                }
            },
            manifestError: null,
            deviceUsagePayload: null
        });

        expect(view.containerRows[0]).toMatchObject({
            name: 'orphan-debug',
            ownerKnown: false
        });
        expect(view.containerSummary.unknownOwner).toBe(1);
        expect(view.runtimeStatus).toBe('warning');
    });

    it('normalizes device usage rows from supported payload shapes', () => {
        const view = buildRuntimeContractView({
            versionInfo: {},
            manifestPayload: null,
            manifestError: 'not_available',
            deviceUsagePayload: {
                data: [
                    {
                        client_id: 'client-a',
                        environment_id: 'prod-eu',
                        unique_active_devices: 51,
                        paid_device_limit: 50,
                        over_limit: true
                    }
                ]
            }
        });

        expect(view.deviceUsageRows).toHaveLength(1);
        expect(deviceUsageStatusLabel(view.deviceUsageRows[0])).toBe(
            'over_limit'
        );
        expect(deviceUsageStatusClass(view.deviceUsageRows[0])).toBe(
            'runtime-danger'
        );
    });

    it('treats deploy manifest API errors as critical runtime state', () => {
        const view = buildRuntimeContractView({
            versionInfo: {},
            manifestPayload: null,
            manifestError: 'error',
            deviceUsagePayload: null
        });

        expect(view.manifestStatus).toBe('error');
        expect(view.manifestStatusLabel).toBe('error');
        expect(view.runtimeStatus).toBe('critical');
    });

    it('keeps small UI helpers deterministic', () => {
        expect(runtimeStatusClass('ok')).toBe('runtime-success');
        expect(runtimeStatusClass('failed')).toBe('runtime-danger');
        expect(runtimeStatusClass('unknown')).toBe('runtime-warning');
        expect(shortSha('abcdef1234567890')).toBe('abcdef123456');
    });

    it('redacts secret-looking runtime payload fields before JSON preview', () => {
        const redacted = redactRuntimePayload({
            status: 'ok',
            token: 'plain-token',
            nested: {
                password: 'pass',
                private_key: 'key',
                database_url: 'postgres://user:pass@db/fm',
                safe: 'visible'
            },
            rows: [{authorization: 'Bearer abc', commit: 'abcdef'}]
        });

        expect(redacted).toEqual({
            status: 'ok',
            token: '[redacted]',
            nested: {
                password: '[redacted]',
                private_key: '[redacted]',
                database_url: '[redacted]',
                safe: 'visible'
            },
            rows: [{authorization: '[redacted]', commit: 'abcdef'}]
        });
    });
});

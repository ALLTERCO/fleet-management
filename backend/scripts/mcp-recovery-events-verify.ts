import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
    copyFileSync,
    createWriteStream,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    writeFileSync
} from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../..');
const backend = path.join(root, 'backend');
const args = process.argv.slice(2);
const requested = args[0] ?? 'full,system';
const checks = requested.split(',');
const output = path.resolve(
    args[1] ??
        path.join(
            root,
            'report/mcp-recovery-events',
            new Date().toISOString().replaceAll(':', '-')
        )
);
const unitFiles = [
    'test/patActionScoping.test.ts',
    'test/scopedAutomationCompilerInvocation.test.ts',
    'test/devSimulationSocket.test.ts',
    'test/apiDescribeGoldenCoverage.test.ts',
    'test/credentialPushWorkerSystem.test.ts',
    'test/crudEventEmissions.test.ts',
    'test/jobClaimIdentitySql.test.ts',
    'test/rpcOutcomeCounter.test.ts',
    'test/scopedAutomation.test.ts',
    'test/readEnvelope.test.ts',
    'test/auditBatchRow.test.ts',
    'test/mcpGovernanceRegression.test.ts',
    'test/nodeRedNodeConfigurationValidation.test.ts',
    'test/nodeRedAutomationComponent.test.ts',
    'test/nodeRedFlowGraph.test.ts',
    'test/nodeRedFlowRecipe.test.ts',
    'test/eventJournalCoverage.test.ts',
    'test/mcpEventResources.test.ts',
    'test/mcpRecoveryTransport.test.ts',
    'test/jobRepository.test.ts',
    'test/jobComponent.test.ts',
    'test/jobWorkersControl.test.ts',
    'test/eventJournal.test.ts',
    'test/mcpEventStreams.test.ts',
    'test/mcpEventTransport.test.ts',
    'test/mcpSessions.test.ts',
    'test/mcpHttpEndpoint.test.ts',
    'test/mcpProtocolConformance.test.ts',
    'test/v2HandlerRatchet.test.ts',
    'test/mcpSystemEvalHarness.test.ts'
];
const integrationFiles = [
    'test/integration/scopedAutomationInvocation.integration.ts',
    'test/integration/scopedAutomation.integration.ts',
    'test/integration/jobExtendedControl.integration.ts',
    'test/integration/jobControl.integration.ts',
    'test/integration/eventJournal.integration.ts',
    'test/integration/mcpEventStreams.integration.ts',
    'test/integration/mcpOperationReconciliation.integration.ts'
];
const gates: Record<string, {cwd: string; command: string; args: string[]}> = {
    full: {cwd: root, command: 'npm', args: ['run', 'check:ci:full']},
    fast: {cwd: root, command: 'npm', args: ['run', 'check:ci']},
    typecheck: {cwd: backend, command: 'npx', args: ['tsc', '--noEmit']},
    'system-lint': {
        cwd: root,
        command: 'shellcheck',
        args: ['backend/scripts/mcp-system-smoke.sh']
    },
    'integration-all': {
        cwd: backend,
        command: 'npm',
        args: ['run', 'test:integration']
    },
    frontend: {
        cwd: path.join(root, 'frontend'),
        command: 'npm',
        args: ['test', '--', 'test/hostSdkGapGuard.test.ts']
    },
    unit: {
        cwd: backend,
        command: process.execPath,
        args: [
            '--import',
            'tsx',
            '--import',
            './test/_runtimeMetadataEnv.ts',
            '--test',
            '--test-reporter=tap',
            ...unitFiles
        ]
    },
    integration: {
        cwd: backend,
        command: process.execPath,
        args: [
            '--import',
            'tsx',
            '--import',
            './test/_runtimeMetadataEnv.ts',
            '--test',
            '--test-reporter=tap',
            '--test-global-setup=./test/integration/_setup.ts',
            '--test-concurrency=1',
            ...integrationFiles
        ]
    },
    system: {
        cwd: root,
        command: 'bash',
        args: ['backend/scripts/mcp-system-smoke.sh']
    }
};
gates.transport = {
    ...gates.unit,
    args: [
        ...gates.unit.args.slice(0, -unitFiles.length),
        'test/mcpEventStreams.test.ts',
        'test/mcpEventTransport.test.ts',
        'test/mcpHttpEndpoint.test.ts',
        'test/mcpProtocolConformance.test.ts',
        'test/mcpSystemEvalHarness.test.ts',
        'test/redisPortSelection.test.ts'
    ]
};
gates['event-integration'] = {
    ...gates.integration,
    args: [
        ...gates.integration.args.slice(0, -integrationFiles.length),
        'test/integration/eventJournal.integration.ts',
        'test/integration/mcpEventStreams.integration.ts'
    ]
};

gates['transport-http'] = {
    ...gates.unit,
    args: [
        ...gates.unit.args.slice(0, -unitFiles.length),
        '--test-timeout=30000',
        'test/mcpEventTransport.test.ts'
    ]
};

function git(args: string[]): string {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
    if (result.status !== 0)
        throw new Error(`Cannot capture source: git ${args.join(' ')}`);
    return result.stdout;
}

function fingerprint() {
    const files = git([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'backend/src',
        'backend/test',
        'backend/scripts',
        'backend/db',
        'backend/package.json',
        'package.json',
        'package-lock.json',
        'scripts/ci'
    ])
        .trim()
        .split('\n')
        .filter(Boolean)
        .sort();
    const digest = createHash('sha256');
    for (const file of files) {
        digest.update(file).update('\0');
        digest.update(
            existsSync(path.join(root, file))
                ? readFileSync(path.join(root, file))
                : '<deleted>'
        );
    }
    return {
        commit: git(['rev-parse', 'HEAD']).trim(),
        sourceSha256: digest.digest('hex'),
        files: files.length,
        scope: 'backend source, tests, migrations, scripts, root dependency lock and CI scripts; system artifact identity is recorded separately'
    };
}

function testCounts(log: string) {
    const value = (name: string) => {
        const matches = [
            ...log.matchAll(new RegExp(`(?:#|ℹ) ${name} (\\d+)`, 'g'))
        ];
        return matches.length ? Number(matches.at(-1)?.[1]) : undefined;
    };
    return {
        tests: value('tests'),
        passed: value('pass'),
        failed: value('fail'),
        skipped: value('skipped'),
        cancelled: value('cancelled')
    };
}

async function main() {
    if (
        args.length > 2 ||
        checks.length === 0 ||
        new Set(checks).size !== checks.length ||
        checks.some((check) => !gates[check])
    ) {
        throw new Error(
            'Usage: mcp-recovery-events-verify.ts [full,system|unit,integration|selected-groups] [new-output-directory]'
        );
    }
    if (existsSync(output))
        throw new Error(
            'Output directory already exists; preserve previous evidence and select a new directory'
        );
    mkdirSync(output, {recursive: true});
    const source = fingerprint();
    const report: {
        source: ReturnType<typeof fingerprint>;
        startedAt: string;
        finishedAt?: string;
        status: string;
        sourceUnchanged?: boolean;
        comparison: string;
        systemEvidence?: unknown;
        testCounts: Record<string, ReturnType<typeof testCounts>>;
        checks: {
            name: string;
            command: string[];
            cwd: string;
            status: string;
            exitCode: number | null;
            signal: string | null;
            durationMs: number;
            log: string;
        }[];
    } = {
        source,
        startedAt: new Date().toISOString(),
        status: 'running',
        comparison: 'deterministic checks; system defaults to same-build A/A',
        checks: [],
        testCounts: {}
    };
    function save() {
        const temporary = path.join(output, 'verification.json.tmp');
        writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
        renameSync(temporary, path.join(output, 'verification.json'));
    }
    save();
    for (const name of checks) {
        const gate = gates[name];
        const started = Date.now();
        const log = path.join(output, `${name}.log`);
        process.stdout.write(`Starting ${name}; log: ${log}\n`);
        const stream = createWriteStream(log, {flags: 'wx'});
        const result = await new Promise<{
            exitCode: number | null;
            signal: string | null;
        }>((resolve) => {
            const child = spawn(gate.command, gate.args, {
                cwd: gate.cwd,
                env: {
                    ...process.env,
                    NODE_BIN: process.execPath,
                    MCP_SYSTEM_REPORT_DIR: path.join(output, 'system')
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout.pipe(stream, {end: false});
            child.stderr.pipe(stream, {end: false});
            child.on('error', (error) => {
                stream.write(`${error.name}: ${error.message}\n`);
            });
            child.on('close', (exitCode, signal) =>
                stream.end(() => resolve({exitCode, signal}))
            );
        });
        let passed = result.exitCode === 0;
        if (
            [
                'unit',
                'integration',
                'transport',
                'event-integration',
                'transport-http'
            ].includes(name)
        ) {
            const counts = testCounts(readFileSync(log, 'utf8'));
            report.testCounts[name] = counts;
            passed =
                passed &&
                (counts.tests ?? 0) > 0 &&
                counts.failed === 0 &&
                counts.skipped === 0 &&
                counts.cancelled === 0;
        }
        if (name === 'system') {
            const evidencePath = path.join(
                output,
                'system/docker-mcp-system-results.json'
            );
            if (existsSync(evidencePath)) {
                const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
                report.systemEvidence = evidence;
                passed = passed && evidence.status === 'passed';
            } else passed = false;
        }
        report.checks.push({
            name,
            command: [gate.command, ...gate.args],
            cwd: gate.cwd,
            status: passed ? 'passed' : 'failed',
            ...result,
            durationMs: Date.now() - started,
            log
        });
        if (name === 'full') {
            const ci = path.join(root, 'report/local-ci');
            const archive = path.join(output, 'ci');
            mkdirSync(archive, {recursive: true});
            if (existsSync(ci))
                for (const file of readdirSync(ci).filter((name) =>
                    name.endsWith('.log')
                )) {
                    copyFileSync(path.join(ci, file), path.join(archive, file));
                    if (
                        file === 'backend-unit.log' ||
                        file === 'backend-integration.log'
                    ) {
                        report.testCounts[file] = testCounts(
                            readFileSync(path.join(archive, file), 'utf8')
                        );
                    }
                }
        }
        save();
        process.stdout.write(`${name}: ${report.checks.at(-1)?.status}\n`);
    }
    report.sourceUnchanged = fingerprint().sourceSha256 === source.sourceSha256;
    report.status =
        report.sourceUnchanged &&
        report.checks.every((check) => check.status === 'passed')
            ? 'passed'
            : 'failed';
    report.finishedAt = new Date().toISOString();
    save();
    process.stdout.write(
        `Result: ${report.status}; ${path.join(output, 'verification.json')}\n`
    );
    if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error: unknown) => {
    process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
});

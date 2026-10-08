#!/usr/bin/env -S npx tsx

import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import * as path from 'node:path';
import {
    readEvalConfig,
    runEvaluation,
    unavailableReport
} from './mcp-system-eval-lib';

function writeReport(report: unknown, outputPath?: string): void {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    if (!outputPath) return;
    const resolved = path.resolve(outputPath);
    mkdirSync(path.dirname(resolved), {recursive: true});
    const temporary = `${resolved}.tmp-${process.pid}`;
    writeFileSync(temporary, json, {encoding: 'utf8', mode: 0o600});
    renameSync(temporary, resolved);
}

async function main(): Promise<void> {
    const configured = readEvalConfig(process.env);
    if (!configured.ok || !configured.config) {
        writeReport(
            unavailableReport(configured.issues),
            process.env.MCP_AB_OUTPUT
        );
        process.exitCode = 2;
        return;
    }
    try {
        const report = await runEvaluation(configured.config);
        writeReport(report, configured.config.outputPath);
        process.exitCode =
            report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
    } catch (error) {
        writeReport(
            {
                schemaVersion: 1,
                reportKind: 'deterministic-real-http-mcp-ab',
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                modelEvaluation: {
                    status: 'not_run',
                    reason: 'The deterministic runner failed before a complete report was produced.'
                }
            },
            configured.config.outputPath
        );
        process.exitCode = 1;
    }
}

void main();

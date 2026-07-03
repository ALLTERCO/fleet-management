import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {tuning} from '../config/tuning';

export type ContractStatus = 'ok' | 'not_available' | 'invalid';

export interface SanitizedManifestResponse {
    schema_version: 1;
    status: ContractStatus;
    exported_at: string;
    checksum: {algorithm: 'sha256'; value: string} | null;
    manifest: unknown | null;
    error?: string;
}

export interface ContractFreshnessMetrics {
    manifestAvailable: number;
    manifestAgeSeconds: number;
    manifestSchemaVersion: number;
    manifestChecksumPresent: number;
    lastDeployTimestampSeconds: number;
    lastMigrationStatus: number;
    lastSmokeStatus: number;
    lastApiStatus: number;
    lastBrowserStatus: number;
    secretScanStatus: number;
}

const SENSITIVE_KEY_RE =
    /(secret|token|password|credential|private|api[_-]?key|service[_-]?key|signing[_-]?key|machinekey|authorization)/i;
const SENSITIVE_VALUE_RE =
    /(glrt-[A-Za-z0-9_.-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]+|Bearer [A-Za-z0-9._~+/=-]{20,})/i;

let contractPathsOverrideForTests: {
    deployManifestPath?: string;
    contractSummaryPath?: string;
} | null = null;

export function isSanitizedManifestExportEnabled(): boolean {
    return tuning.controlPlaneContract.exportSanitizedManifest;
}

function resolveContractPath(configuredPath: string): string {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath);
}

export function deployManifestPath(): string {
    return resolveContractPath(
        contractPathsOverrideForTests?.deployManifestPath ??
            tuning.controlPlaneContract.deployManifestPath
    );
}

export function contractSummaryPath(): string {
    return resolveContractPath(
        contractPathsOverrideForTests?.contractSummaryPath ??
            tuning.controlPlaneContract.contractSummaryPath
    );
}

export function __setContractPathsForTests(
    paths: {deployManifestPath?: string; contractSummaryPath?: string} | null
): void {
    contractPathsOverrideForTests = paths;
}

export function sanitizeContractValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeContractValue);
    if (typeof value === 'string' && SENSITIVE_VALUE_RE.test(value)) {
        return '<redacted>';
    }
    if (!value || typeof value !== 'object') return value;

    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(key)) {
            sanitized[key] = '<redacted>';
        } else {
            sanitized[key] = sanitizeContractValue(child);
        }
    }
    return sanitized;
}

export function readSanitizedDeployManifest(
    manifestPath = deployManifestPath()
): SanitizedManifestResponse {
    const exportedAt = new Date().toISOString();
    if (!fs.existsSync(manifestPath)) {
        return {
            schema_version: 1,
            status: 'not_available',
            exported_at: exportedAt,
            checksum: null,
            manifest: null
        };
    }

    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        return {
            schema_version: 1,
            status: 'ok',
            exported_at: exportedAt,
            checksum: {
                algorithm: 'sha256',
                value: crypto.createHash('sha256').update(raw).digest('hex')
            },
            manifest: sanitizeContractValue(manifest)
        };
    } catch {
        return {
            schema_version: 1,
            status: 'invalid',
            exported_at: exportedAt,
            checksum: null,
            manifest: null,
            error: 'manifest_json_invalid'
        };
    }
}

export function readContractFreshnessMetrics(
    manifestPath = deployManifestPath(),
    summaryPath = contractSummaryPath(),
    now = Date.now()
): ContractFreshnessMetrics {
    const metrics: ContractFreshnessMetrics = {
        manifestAvailable: 0,
        manifestAgeSeconds: -1,
        manifestSchemaVersion: 0,
        manifestChecksumPresent: 0,
        lastDeployTimestampSeconds: -1,
        lastMigrationStatus: -1,
        lastSmokeStatus: -1,
        lastApiStatus: -1,
        lastBrowserStatus: -1,
        secretScanStatus: -1
    };

    try {
        const stat = fs.statSync(manifestPath);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        metrics.manifestAvailable = 1;
        metrics.manifestAgeSeconds = Math.max(
            0,
            Math.floor((now - stat.mtimeMs) / 1000)
        );
        metrics.manifestSchemaVersion = Number(
            manifest.schema_version ?? manifest.manifest_version ?? 0
        );
        metrics.manifestChecksumPresent = 1;
        metrics.lastDeployTimestampSeconds = extractTimestampSeconds(manifest);
        metrics.lastMigrationStatus = numericCheckStatus(
            manifest.checks?.migration?.status
        );
        metrics.lastSmokeStatus = numericCheckStatus(
            manifest.checks?.smoke?.status
        );
        metrics.lastApiStatus = numericCheckStatus(
            manifest.checks?.api?.status
        );
        metrics.lastBrowserStatus = numericCheckStatus(
            manifest.checks?.browser?.status
        );
    } catch {
        // Missing/corrupt manifests stay explicit via -1/0 metrics.
    }

    try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        metrics.secretScanStatus = numericCheckStatus(
            summary.secret_scan?.status
        );
    } catch {
        // CI summaries are usually not present at runtime; -1 means unknown.
    }

    return metrics;
}

function extractTimestampSeconds(manifest: Record<string, any>): number {
    const history = Array.isArray(manifest.history) ? manifest.history : [];
    const lastHistory = history.length > 0 ? history[history.length - 1] : {};
    const candidate =
        manifest.generated_at ??
        manifest.deployed_at ??
        lastHistory.at ??
        lastHistory.timestamp ??
        undefined;
    if (typeof candidate !== 'string') return -1;
    const parsed = Date.parse(candidate);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : -1;
}

function numericCheckStatus(status: unknown): number {
    switch (status) {
        case 'not_run':
            return 0;
        case 'pass':
        case 'ok':
        case 'passed':
            return 1;
        case 'fail':
        case 'failed':
            return 2;
        case 'skip':
        case 'skipped':
            return 3;
        case 'unknown':
            return 4;
        case 'not_available':
            return 5;
        case 'degraded':
            return 6;
        case 'running':
            return 7;
        default:
            return -1;
    }
}

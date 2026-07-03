import {tuning} from '../../config/tuning';

const SEC_PER_DAY = 24 * 60 * 60;
const MS_PER_SEC = 1000;

export function reportArtifactTtlSec(): number {
    return tuning.report.artifactTtlDays * SEC_PER_DAY;
}

export function reportArtifactTtlMs(): number {
    return reportArtifactTtlSec() * MS_PER_SEC;
}

export function reportArtifactExpiresAt(nowMs = Date.now()): string {
    return new Date(nowMs + reportArtifactTtlMs()).toISOString();
}

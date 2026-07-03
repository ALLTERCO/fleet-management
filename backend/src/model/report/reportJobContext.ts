import {emitReportProgress} from '../../modules/EventDistributor';
import {
    type ExportProgress,
    isExportCancelled,
    updateExportProgress
} from '../energy/exportJobStore';

export class ReportCancelledError extends Error {
    constructor() {
        super('report cancelled');
        this.name = 'ReportCancelledError';
    }
}

export interface ReportJobContext {
    jobId: string;
    userId: string;
    kind: string;
    orgId: string | null;
    estimatedRows?: number;
    update(progress: ExportProgress): Promise<void>;
    throwIfCancelled(): Promise<void>;
}

export function createReportJobContext(input: {
    jobId: string;
    userId: string;
    kind: string;
    orgId: string | null;
    estimatedRows?: number;
}): ReportJobContext {
    return {
        ...input,
        update: async (progress) => {
            await updateExportProgress(
                {jobId: input.jobId, userId: input.userId},
                progress
            );
            emitReportProgress(input.orgId, {
                kind: input.kind,
                jobId: input.jobId,
                phase: progress.currentPhase ?? 'progress',
                ...progress
            });
        },
        throwIfCancelled: async () => {
            if (await isExportCancelled(input.jobId)) {
                throw new ReportCancelledError();
            }
        }
    };
}

export function isReportCancelledError(error: unknown): boolean {
    return error instanceof ReportCancelledError;
}

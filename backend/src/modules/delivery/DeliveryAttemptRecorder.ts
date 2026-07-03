import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {sanitizeErrorMessageForPersistence} from '../util/sanitizeErrorMessage';

export interface RecordedAttempt {
    job_id: number;
    attempt_id: number;
    job_state: string;
    attempt_count: number;
    endpoint_id: number;
    auto_disabled: boolean;
}

export interface DeliveryAttemptResult {
    state: 'succeeded' | 'failed';
    httpStatus?: number | null;
    providerCode?: string | null;
    errorMessage?: string | null;
}

export async function recordDeliveryAttempt(input: {
    jobId: number;
    result: DeliveryAttemptResult;
    final: boolean;
}): Promise<RecordedAttempt | undefined> {
    let lastErr: unknown;
    const total = tuning.delivery.outboxRecordAttemptRetries + 1;
    for (let attempt = 0; attempt < total; attempt++) {
        try {
            const res = await PostgresProvider.callMethod(
                'notifications.fn_delivery_job_record_attempt',
                {
                    p_job_id: input.jobId,
                    p_state: input.result.state,
                    p_http_status: input.result.httpStatus ?? null,
                    p_provider_code: input.result.providerCode ?? null,
                    p_error_message: safeErrorMessageForPersistence(
                        input.result.errorMessage
                    ),
                    p_final_failure: input.final,
                    p_autooff_threshold:
                        tuning.delivery.endpointAutoOffThreshold
                }
            );
            if (attempt > 0) {
                Observability.incrementCounter(
                    'outbox_record_attempt_retries_recovered'
                );
            }
            return res?.rows?.[0] as RecordedAttempt | undefined;
        } catch (err) {
            lastErr = err;
            const remaining = total - 1 - attempt;
            if (remaining === 0) break;
            // Marc Brooker / AWS Full Jitter: random(0, min(cap, base*2^attempt)).
            // Spreads thundering-herd retries across the window.
            const exponential =
                tuning.delivery.outboxRecordAttemptBackoffMs * 2 ** attempt;
            const capped = Math.min(
                exponential,
                tuning.delivery.outboxRecordAttemptBackoffCapMs
            );
            const backoff = Math.floor(Math.random() * capped);
            Observability.incrementCounter('outbox_record_attempt_retries');
            await new Promise((resolve) => setTimeout(resolve, backoff));
        }
    }
    throw lastErr;
}

function safeErrorMessageForPersistence(
    raw: string | null | undefined
): string | null {
    return sanitizeErrorMessageForPersistence(
        raw,
        tuning.audit.persistedErrorMessageMaxChars
    );
}

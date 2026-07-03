import {tuning} from '../../config/tuning';
import type {ChannelProvider} from '../../types/api/channel';
import {withTimeout} from '../util/withTimeout';
import {getAdapter} from './adapters';
import type {DeliveryPayload} from './types';

export interface TestDeliveryPayloadInput {
    title?: string;
    message?: string;
}

export interface ProviderTestInput {
    provider: ChannelProvider;
    organizationId: string;
    endpointId: number;
    endpointName?: string;
    config: Record<string, unknown>;
    payload?: TestDeliveryPayloadInput;
    send?: boolean;
}

export async function performProviderTest(
    input: ProviderTestInput
): Promise<void> {
    const adapter = getAdapter(input.provider);
    if (!adapter) {
        throw new Error(`No delivery adapter registered for ${input.provider}`);
    }

    const context = {
        jobId: 0,
        organizationId: input.organizationId,
        endpointId: input.endpointId,
        endpointName: input.endpointName ?? '',
        config: input.config
    };

    const timeoutMs = tuning.delivery.integrationTestTimeoutMs;

    if (typeof adapter.verify === 'function') {
        await withTimeout(
            () => adapter.verify!(context),
            timeoutMs,
            `${input.provider}.verify`
        );
    }

    if (input.send === false) return;

    const result = await withTimeout(
        () => adapter.send(makeTestDeliveryPayload(input), context),
        timeoutMs,
        `${input.provider}.send`
    );
    if (result.state === 'failed') {
        throw new Error(result.errorMessage ?? 'provider test failed');
    }
}

function makeTestDeliveryPayload(input: ProviderTestInput): DeliveryPayload {
    const message = makeTestMessage(input.payload);
    const now = new Date().toISOString();

    return {
        title: message.title,
        message: message.message,
        severity: 'info',
        organizationId: input.organizationId,
        alertId: null,
        ruleId: null,
        ruleName: 'Delivery test',
        ruleKind: 'test',
        state: 'active',
        firedAt: now,
        activeSince: now,
        source: null
    };
}

function makeTestMessage(payload?: TestDeliveryPayloadInput): {
    title: string;
    message: string;
} {
    return {
        title: payload?.title?.trim() || 'Fleet Management test',
        message:
            payload?.message?.trim() ||
            'This is a test notification from Fleet Management.'
    };
}

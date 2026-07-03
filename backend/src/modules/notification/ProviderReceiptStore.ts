import * as PostgresProvider from '../PostgresProvider';
import type {NormalizedProviderReceipt} from './ProviderReceiptHandler';

export interface StoreProviderReceiptInput {
    organizationId: string;
    endpointId: number | null;
    receipt: NormalizedProviderReceipt;
    payload: Record<string, unknown>;
}

export interface StoredProviderReceipt {
    receiptId: number;
    suppressionId: number | null;
}

export async function storeProviderReceipt(
    input: StoreProviderReceiptInput
): Promise<StoredProviderReceipt> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_provider_receipt_record',
        {
            p_organization_id: input.organizationId,
            p_endpoint_id: input.endpointId,
            p_provider: input.receipt.provider,
            p_kind: input.receipt.kind,
            p_provider_message_id: input.receipt.providerMessageId,
            p_recipient: input.receipt.recipient,
            p_occurred_at: input.receipt.occurredAt,
            p_raw_event_type: input.receipt.rawEventType,
            p_payload: input.payload
        }
    );
    const row = result?.rows?.[0] as
        | {
              receipt_id?: number | string;
              suppression_id?: number | string | null;
          }
        | undefined;
    if (!row?.receipt_id) {
        throw new Error('provider receipt record did not return receipt_id');
    }
    return {
        receiptId: Number(row.receipt_id),
        suppressionId:
            row.suppression_id == null ? null : Number(row.suppression_id)
    };
}

import RpcError from './RpcError';

/**
 * Normalize a caught error for an RPC handler: an RpcError already carries
 * its own code and message, so pass it through; anything else becomes an
 * OperationFailed for the named operation. Keeps the pass-through-or-wrap
 * decision in one place instead of repeated in every handler's catch.
 */
export function asOperationFailed(operation: string, cause: unknown): RpcError {
    return cause instanceof RpcError
        ? cause
        : RpcError.OperationFailed(operation, cause);
}

/**
 * Transport-boundary adapter for schema validation.
 *
 * The validation library (`rpc/validation.ts`) stays transport-agnostic and
 * throws its own `ValidationError` type. At the RPC boundary we need to
 * surface that as `RpcError.InvalidParams` with the field-level details in
 * the JSON-RPC `data` field. This helper is the one place that bridge
 * happens — every component that validates params via schema uses it.
 */

import RpcError from './RpcError';
import {type JsonSchema, ValidationError, validateParams} from './validation';

export function validateOrThrow<T>(params: unknown, schema: JsonSchema): T {
    try {
        return validateParams<T>(params, schema);
    } catch (err) {
        if (err instanceof ValidationError) {
            throw RpcError.InvalidParams(err.message, [...err.failures]);
        }
        throw err;
    }
}

// Checks a tool call's arguments against the inputSchema the tool advertises.
// MCP makes input validation a server duty and reports a failure as a tool
// execution error, so the model can read it and correct its own call.

import {
    type JsonSchema,
    ValidationError,
    validateParams
} from '../../rpc/validation';
import {McpError} from './mcpErrors.js';

export function assertToolInput(
    tool: {name: string; inputSchema: JsonSchema},
    args: Record<string, unknown>
): void {
    try {
        // A copy, because validation fills in schema defaults.
        validateParams(structuredClone(args), tool.inputSchema);
    } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        throw new McpError(
            'invalid_params',
            `${tool.name} arguments: ${error.message}`,
            {tool: tool.name, details: {fieldErrors: error.failures}}
        );
    }
}

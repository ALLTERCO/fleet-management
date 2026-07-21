// Thin stdio transport for the read-only docs MCP. The logic lives once
// in backend/src/modules/ai/fleetDocsMcp.ts (shared with the /mcp HTTP
// route); tsx is registered here so plain `node` can load that source.
import * as readline from 'node:readline';
import {register as registerCjsLoader} from 'tsx/cjs/api';
import {register as registerEsmLoader} from 'tsx/esm/api';

// The imported module is CJS (backend has no "type":"module"), so its sibling
// `import './x.js'` runs as require() — which needs tsx's CJS hook too, or Node
// 24 throws MODULE_NOT_FOUND. ESM-only registration is not enough.
registerEsmLoader();
registerCjsLoader();
const core = await import('../src/modules/ai/fleetDocsMcp.ts');

function writeMessage(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function runServer() {
    const input = readline.createInterface({
        input: process.stdin,
        crlfDelay: Number.POSITIVE_INFINITY
    });
    for await (const line of input) {
        if (!line.trim()) continue;
        let message;
        try {
            message = JSON.parse(line);
            const result = await core.handleRequest(message);
            if (result) writeMessage(result);
        } catch (error) {
            writeMessage(core.errorResponse(message?.id ?? null, error));
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await runServer();
}

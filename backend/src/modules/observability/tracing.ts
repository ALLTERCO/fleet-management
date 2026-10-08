// One span per MCP request, exported over OTLP when a collector is configured.
// Without one the API's no-op tracer makes every call free.

import {
    context,
    createTraceState,
    type Span,
    SpanKind,
    SpanStatusCode,
    trace
} from '@opentelemetry/api';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {
    BatchSpanProcessor,
    NodeTracerProvider
} from '@opentelemetry/sdk-trace-node';
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions';
import {readAppVersion} from '../../config/appVersion';
import {otelServiceName, otelTracesEnabled} from '../../config/otel';

const TRACER_NAME = 'fleet-manager/mcp';

let provider: NodeTracerProvider | undefined;

/** Starts the exporter when OTEL_* names a collector; true when it started. */
export function startTracing(): boolean {
    if (provider || !otelTracesEnabled()) return false;
    provider = new NodeTracerProvider({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: otelServiceName(),
            [ATTR_SERVICE_VERSION]: readAppVersion()
        }),
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())]
    });
    provider.register();
    return true;
}

/** Flushes buffered spans; safe to call when tracing never started. */
export async function stopTracing(): Promise<void> {
    const running = provider;
    provider = undefined;
    await running?.shutdown();
}

export interface McpSpanParent {
    traceId: string;
    parentId: string;
    flags: string;
    tracestate?: string;
}

export interface McpSpanRequest {
    method: string;
    toolName?: string;
    protocolVersion?: string;
    parent?: McpSpanParent;
}

export interface McpSpan {
    end(outcome: {failed: boolean; errorType?: string}): void;
}

// The client's validated W3C context, so Fleet's span joins its trace.
function parentContext(parent: McpSpanParent | undefined) {
    if (!parent) return context.active();
    return trace.setSpanContext(context.active(), {
        traceId: parent.traceId,
        spanId: parent.parentId,
        traceFlags: Number.parseInt(parent.flags, 16),
        isRemote: true,
        traceState: parent.tracestate
            ? createTraceState(parent.tracestate)
            : undefined
    });
}

/** Names follow the OpenTelemetry MCP conventions: "<method> <tool>". */
export function startMcpSpan(request: McpSpanRequest): McpSpan {
    const name = request.toolName
        ? `${request.method} ${request.toolName}`
        : request.method;
    const span: Span = trace.getTracer(TRACER_NAME).startSpan(
        name,
        {
            kind: SpanKind.SERVER,
            attributes: {
                'mcp.method.name': request.method,
                ...(request.toolName
                    ? {'gen_ai.tool.name': request.toolName}
                    : {}),
                ...(request.protocolVersion
                    ? {'mcp.protocol.version': request.protocolVersion}
                    : {})
            }
        },
        parentContext(request.parent)
    );
    let ended = false;
    return {
        end({failed, errorType}) {
            if (ended) return;
            ended = true;
            if (failed) {
                span.setStatus({code: SpanStatusCode.ERROR});
                if (errorType) span.setAttribute('error.type', errorType);
            }
            span.end();
        }
    };
}

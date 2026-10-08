// RFC 7692 per-message-deflate config (IOTN production tuning).

export interface DeflateConfigInput {
    compressionEnabled: boolean;
    compressionLevel: number;
    compressionMemLevel: number;
    compressionThreshold: number;
    compressionConcurrencyLimit: number;
    /** Server window size; omitted means the negotiated default (15). */
    compressionWindowBits?: number;
}

export interface PerMessageDeflateConfig {
    zlibDeflateOptions: {level: number; memLevel: number};
    zlibInflateOptions: {chunkSize: number};
    clientNoContextTakeover: true;
    serverNoContextTakeover: true;
    serverMaxWindowBits?: number;
    threshold: number;
    concurrencyLimit: number;
}

/** The `tuning.ws` fields both socket cohorts read. */
export interface WsCompressionTuning {
    compressionEnabled: boolean;
    compressionLevel: number;
    compressionMemLevel: number;
    compressionThreshold: number;
    compressionConcurrencyLimit: number;
    clientCompressionEnabled: boolean;
    clientCompressionThreshold: number;
    clientCompressionWindowBits: number;
}

const INFLATE_CHUNK_BYTES = 10 * 1024;

export function buildPerMessageDeflate(
    cfg: DeflateConfigInput
): PerMessageDeflateConfig | false {
    if (!cfg.compressionEnabled) return false;
    return {
        zlibDeflateOptions: {
            level: cfg.compressionLevel,
            memLevel: cfg.compressionMemLevel
        },
        zlibInflateOptions: {chunkSize: INFLATE_CHUNK_BYTES},
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        ...(cfg.compressionWindowBits === undefined
            ? {}
            : {serverMaxWindowBits: cfg.compressionWindowBits}),
        threshold: cfg.compressionThreshold,
        concurrencyLimit: cfg.compressionConcurrencyLimit
    };
}

/** Device `/shelly` socket: off unless FM_WS_COMPRESSION_ENABLED. */
export function deviceSocketDeflate(
    ws: WsCompressionTuning
): PerMessageDeflateConfig | false {
    return buildPerMessageDeflate(ws);
}

/** Browser and API client socket. No client window is requested: ws rejects
 *  an offer that lacks client_max_window_bits when one is configured. */
export function clientSocketDeflate(
    ws: WsCompressionTuning
): PerMessageDeflateConfig | false {
    return buildPerMessageDeflate({
        compressionEnabled: ws.clientCompressionEnabled,
        compressionLevel: ws.compressionLevel,
        compressionMemLevel: ws.compressionMemLevel,
        compressionThreshold: ws.clientCompressionThreshold,
        compressionConcurrencyLimit: ws.compressionConcurrencyLimit,
        compressionWindowBits: ws.clientCompressionWindowBits
    });
}

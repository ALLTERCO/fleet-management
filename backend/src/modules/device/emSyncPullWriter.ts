// History pull pages go straight to PostgreSQL, never through Redis: the
// meter keeps its history, so a page that fails to write is pulled again.
// Pieces of whole records are written in order; each commits before the next,
// and the caller asks the meter for its next page only after the last one.
// Nothing is set aside: unlike a buffered push, a failed page is not lost.
// A page waits for its connection in the pull admission queue, never in the
// pool, so many pulls at once cannot run out the pool checkout timeout.

import log4js from 'log4js';
import {runAsDbWorkload} from '../dbWorkPriority';
import {appendEmStatsSyncedBatch, type CallDb} from '../energyRollup';
import * as Observability from '../Observability';
import {isPermanentDataError} from '../util/postgresErrorClass';
import {type EmSyncBlock, splitEmSyncBlock} from './emSyncCoalescer';
import {
    type EmSyncPullAdmission,
    getEmSyncPullAdmission
} from './emSyncPullAdmission';

const logger = log4js.getLogger('em-sync-pull');
// Meter history writes share the em-sync cap (FM_DB_EMSYNC_MAX_CONNECTIONS).
const WORKLOAD = 'em-sync';

export interface EmSyncPullWriterDeps {
    callDb: CallDb;
    maxRows: number;
    admission?: EmSyncPullAdmission;
}

// true when every piece is committed; false stops the pull pass so the
// bookmark never moves past a page that is not in the database.
export function writeEmSyncPullPage(
    page: EmSyncBlock,
    deps: EmSyncPullWriterDeps
): Promise<boolean> {
    const admission = deps.admission ?? getEmSyncPullAdmission();
    return admission.write(async () => {
        for (const piece of splitEmSyncBlock(page, deps.maxRows)) {
            if (!(await writePiece(piece, deps.callDb))) return false;
        }
        return true;
    });
}

async function writePiece(
    piece: EmSyncBlock,
    callDb: CallDb
): Promise<boolean> {
    try {
        await runAsDbWorkload(WORKLOAD, () =>
            appendEmStatsSyncedBatch(piece.rows, [piece.cursor], {callDb})
        );
    } catch (err) {
        reportWriteFailure(piece, err);
        return false;
    }
    Observability.incrementCounter(
        'em_sync_pull_rows_written',
        piece.rows.p_ts.length
    );
    return true;
}

// A value PostgreSQL rejects outright fails every retry of this page, so it
// is an error; anything else (outage, timeout) heals on a later pass.
function reportWriteFailure(piece: EmSyncBlock, error: unknown): void {
    Observability.incrementCounter('em_sync_pull_write_failures');
    const log = isPermanentDataError(error) ? logger.error : logger.warn;
    log.call(
        logger,
        'em-sync pull page not stored device=%d channel=%d rows=%d first_ts=%d: %s',
        piece.cursor.device,
        piece.cursor.channel,
        piece.rows.p_ts.length,
        piece.rows.p_ts[0] ?? piece.cursor.created,
        error
    );
}

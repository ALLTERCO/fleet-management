import {AsyncLocalStorage} from 'node:async_hooks';
import * as log4js from 'log4js';
import * as Observability from './Observability';

const logger = log4js.getLogger('postgresTransactionScope');

export type TransactionPool = 'main' | 'query';

interface OpenTransaction {
    readonly pool: TransactionPool;
    open: boolean;
}

export class TransactionScopeError extends Error {
    readonly code = 'DB_TRANSACTION_SECOND_CONNECTION';
    readonly details: Readonly<{pool: TransactionPool; operation: string}>;

    constructor(details: {pool: TransactionPool; operation: string}) {
        super('DB_TRANSACTION_SECOND_CONNECTION');
        this.name = 'TransactionScopeError';
        this.details = details;
    }
}

const openTransaction = new AsyncLocalStorage<OpenTransaction>();

// Marks the body as holding a transaction on `pool`. The mark ends with the
// body, so work the body started that finishes later is not refused.
export async function runInTransactionScope<T>(
    pool: TransactionPool,
    body: () => Promise<T>
): Promise<T> {
    const transaction: OpenTransaction = {pool, open: true};
    try {
        return await openTransaction.run(transaction, body);
    } finally {
        transaction.open = false;
    }
}

// A second connection from the pool whose transaction is open can wait on
// connections held by transactions that wait for it, so the pool locks itself.
export function assertNoOpenTransaction(
    pool: TransactionPool,
    operation: string
): void {
    const transaction = openTransaction.getStore();
    if (!transaction?.open || transaction.pool !== pool) return;
    const error = new TransactionScopeError({pool, operation});
    Observability.incrementCounter('db_transaction_second_connection');
    // The stack names the caller that skipped the transaction.
    logger.error(
        'second %s-pool connection requested inside an open transaction: %s',
        pool,
        operation,
        error
    );
    throw error;
}

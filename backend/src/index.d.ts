declare module 'migration-collection/lib/postgres' {
    export default function (cfg: any): Promise<void>;
}
declare module 'expose-sql-methods/lib/postgres' {
    export default function <T>(
        cfg2: any,
        o: {log: (...a: any) => void}
    ): Promise<{
        methods: T;
        txBegin: () => number;
        txEnd: (id: number, query: string) => number;
    }>;
}
declare module 'pg-copy-streams' {
    import type {Duplex} from 'node:stream';
    import type {Submittable} from 'pg';
    export function to(sql: string): Duplex & Submittable;
    export function from(sql: string): Duplex & Submittable;
}

declare module 'migration-collection/lib/postgres' {
    export default function (cfg: any): Promise<void>;
}
declare module 'pg-copy-streams' {
    import type {Duplex} from 'node:stream';
    import type {Submittable} from 'pg';
    export function to(sql: string): Duplex & Submittable;
    export function from(sql: string): Duplex & Submittable;
}

declare module 'bidi-js' {
    interface EmbeddingLevels {
        levels: Uint8Array;
        paragraphs: Array<{start: number; end: number; level: number}>;
    }

    interface Bidi {
        getEmbeddingLevels(
            text: string,
            direction?: 'ltr' | 'rtl'
        ): EmbeddingLevels;
        getReorderedString(text: string, levels: EmbeddingLevels): string;
    }

    export default function bidiFactory(): Bidi;
}

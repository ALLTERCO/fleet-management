import {once} from 'node:events';
import {createReadStream, createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';

export class ReportRowSpool<T extends Record<string, unknown>> {
    private readonly filePath: string;
    private readonly output: ReturnType<typeof createWriteStream>;
    private closed = false;
    private count = 0;

    private constructor(filePath: string) {
        this.filePath = filePath;
        this.output = createWriteStream(filePath, {encoding: 'utf8'});
    }

    static async create<T extends Record<string, unknown>>(
        label: string
    ): Promise<ReportRowSpool<T>> {
        const dir = await fs.mkdtemp(path.join(tmpdir(), 'fm-report-'));
        return new ReportRowSpool<T>(path.join(dir, `${label}.jsonl`));
    }

    get length(): number {
        return this.count;
    }

    async write(row: T): Promise<void> {
        if (this.closed) throw new Error('report spool is closed');
        if (!this.output.write(`${JSON.stringify(row)}\n`)) {
            await once(this.output, 'drain');
        }
        this.count++;
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.output.end();
        await once(this.output, 'close');
    }

    async *rows(): AsyncGenerator<T> {
        await this.close();
        const lines = createInterface({
            input: createReadStream(this.filePath, {encoding: 'utf8'}),
            crlfDelay: Infinity
        });
        for await (const line of lines) {
            if (line.length > 0) yield JSON.parse(line) as T;
        }
    }

    async remove(): Promise<void> {
        if (!this.closed) {
            this.output.destroy();
            this.closed = true;
        }
        await fs.rm(path.dirname(this.filePath), {
            recursive: true,
            force: true
        });
    }
}

import fs from 'node:fs';
import path from 'node:path';

export function readAppVersion(): string {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
        ).version;
    } catch {
        return 'unknown';
    }
}

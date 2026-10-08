import * as path from 'node:path';
import type express from 'express';

// Express refuses an absolute path when any parent folder starts with a dot; `root` limits that check to the file name.
export function sendFileByName(
    res: express.Response,
    filePath: string,
    callback?: (err?: Error) => void
): void {
    res.sendFile(
        path.basename(filePath),
        {root: path.dirname(filePath)},
        callback
    );
}

export function downloadByName(
    res: express.Response,
    dir: string,
    fileName: string
): void {
    res.download(fileName, fileName, {root: dir});
}

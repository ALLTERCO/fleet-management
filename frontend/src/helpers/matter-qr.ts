/**
 * Minimal QR code generator for Matter pairing codes.
 * Alphanumeric mode, ECC Level L — sufficient for the short MT: payloads (~30 chars).
 * No external dependencies.
 */

const ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

class QREncoder {
    modules: boolean[][] = [];
    private size = 0;

    constructor(text: string) {
        const version = this.getVersion(text.length);
        this.size = version * 4 + 17;
        this.modules = Array.from({length: this.size}, () =>
            Array(this.size).fill(false)
        );

        const reserved = Array.from({length: this.size}, () =>
            Array(this.size).fill(false)
        );

        this.addFinderPatterns(reserved);
        this.addAlignmentPatterns(version, reserved);
        this.addTimingPatterns(reserved);
        this.addDarkModule(version, reserved);
        this.addFormatBits(reserved);
        if (version >= 7) this.addVersionBits(version, reserved);

        const encoded = this.encodeData(text, version);
        this.placeData(encoded, reserved);
        this.applyMask(0, reserved);
        this.addFormatInfo(0);
        if (version >= 7) this.addVersionInfo(version);
    }

    private getVersion(len: number): number {
        const caps = [0, 25, 47, 77, 114, 154, 195, 224, 279, 335, 395];
        for (let v = 1; v < caps.length; v++) {
            if (caps[v] >= len) return v;
        }
        return 10;
    }

    private addFinderPatterns(reserved: boolean[][]) {
        const positions = [
            [0, 0],
            [this.size - 7, 0],
            [0, this.size - 7]
        ];
        for (const [row, col] of positions) {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const rr = row + r;
                    const cc = col + c;
                    if (rr < 0 || rr >= this.size || cc < 0 || cc >= this.size)
                        continue;
                    reserved[rr][cc] = true;
                    const inOuter = r === 0 || r === 6 || c === 0 || c === 6;
                    const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                    this.modules[rr][cc] =
                        r >= 0 &&
                        r <= 6 &&
                        c >= 0 &&
                        c <= 6 &&
                        (inOuter || inInner);
                }
            }
        }
    }

    private addAlignmentPatterns(version: number, reserved: boolean[][]) {
        if (version < 2) return;
        const positions = this.getAlignmentPositions(version);
        for (const row of positions) {
            for (const col of positions) {
                if (reserved[row]?.[col]) continue;
                for (let r = -2; r <= 2; r++) {
                    for (let c = -2; c <= 2; c++) {
                        const rr = row + r;
                        const cc = col + c;
                        if (
                            rr >= 0 &&
                            rr < this.size &&
                            cc >= 0 &&
                            cc < this.size
                        ) {
                            reserved[rr][cc] = true;
                            this.modules[rr][cc] =
                                Math.abs(r) === 2 ||
                                Math.abs(c) === 2 ||
                                (r === 0 && c === 0);
                        }
                    }
                }
            }
        }
    }

    private getAlignmentPositions(version: number): number[] {
        if (version === 1) return [];
        const intervals: number[][] = [
            [],
            [],
            [6, 18],
            [6, 22],
            [6, 26],
            [6, 30],
            [6, 34],
            [6, 22, 38],
            [6, 24, 42],
            [6, 26, 46],
            [6, 28, 50]
        ];
        return intervals[version] || [6, 18];
    }

    private addTimingPatterns(reserved: boolean[][]) {
        for (let i = 8; i < this.size - 8; i++) {
            if (!reserved[6][i]) {
                reserved[6][i] = true;
                this.modules[6][i] = i % 2 === 0;
            }
            if (!reserved[i][6]) {
                reserved[i][6] = true;
                this.modules[i][6] = i % 2 === 0;
            }
        }
    }

    private addDarkModule(version: number, reserved: boolean[][]) {
        const row = 4 * version + 9;
        reserved[row][8] = true;
        this.modules[row][8] = true;
    }

    private addFormatBits(reserved: boolean[][]) {
        for (let i = 0; i < 8; i++) {
            if (!reserved[8][i]) reserved[8][i] = true;
            if (i < 7 && !reserved[8][this.size - 1 - i])
                reserved[8][this.size - 1 - i] = true;
            if (!reserved[i][8]) reserved[i][8] = true;
            if (i < 7 && !reserved[this.size - 1 - i][8])
                reserved[this.size - 1 - i][8] = true;
        }
        reserved[8][8] = true;
    }

    private addVersionBits(version: number, reserved: boolean[][]) {
        if (version < 7) return;
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                reserved[i][this.size - 11 + j] = true;
                reserved[this.size - 11 + j][i] = true;
            }
        }
    }

    private encodeData(text: string, version: number): number[] {
        const bits: number[] = [];
        // Mode indicator: alphanumeric = 0010
        bits.push(0, 0, 1, 0);
        // Character count
        const countBits = version <= 9 ? 9 : 11;
        for (let i = countBits - 1; i >= 0; i--) {
            bits.push((text.length >> i) & 1);
        }
        // Encode pairs
        for (let i = 0; i < text.length; i += 2) {
            const a = ALPHANUM.indexOf(text[i].toUpperCase());
            if (i + 1 < text.length) {
                const b = ALPHANUM.indexOf(text[i + 1].toUpperCase());
                const val = a * 45 + b;
                for (let j = 10; j >= 0; j--) bits.push((val >> j) & 1);
            } else {
                for (let j = 5; j >= 0; j--) bits.push((a >> j) & 1);
            }
        }
        // Terminator
        for (
            let i = 0;
            i < 4 && bits.length < this.getDataCapacity(version);
            i++
        ) {
            bits.push(0);
        }
        // Pad to byte boundary
        while (bits.length % 8 !== 0) bits.push(0);
        // Pad bytes
        const cap = this.getDataCapacity(version);
        let padByte = 0;
        while (bits.length < cap) {
            const val = padByte % 2 === 0 ? 0xec : 0x11;
            for (let i = 7; i >= 0; i--) bits.push((val >> i) & 1);
            padByte++;
        }
        return this.addErrorCorrection(bits, version);
    }

    private getDataCapacity(version: number): number {
        const caps = [0, 152, 272, 440, 640, 864, 1088, 1248, 1552, 1856, 2192];
        return caps[version] || 152;
    }

    private addErrorCorrection(bits: number[], version: number): number[] {
        const bytes: number[] = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8 && i + j < bits.length; j++) {
                byte = (byte << 1) | bits[i + j];
            }
            bytes.push(byte);
        }

        const eccParams: {
            totalBytes: number;
            eccPerBlock: number;
            blocks: number;
        }[] = [
            {totalBytes: 0, eccPerBlock: 0, blocks: 0},
            {totalBytes: 26, eccPerBlock: 7, blocks: 1},
            {totalBytes: 44, eccPerBlock: 10, blocks: 1},
            {totalBytes: 70, eccPerBlock: 15, blocks: 1},
            {totalBytes: 100, eccPerBlock: 20, blocks: 1},
            {totalBytes: 134, eccPerBlock: 26, blocks: 1},
            {totalBytes: 172, eccPerBlock: 18, blocks: 2},
            {totalBytes: 196, eccPerBlock: 20, blocks: 2},
            {totalBytes: 242, eccPerBlock: 24, blocks: 2},
            {totalBytes: 292, eccPerBlock: 30, blocks: 2},
            {totalBytes: 346, eccPerBlock: 18, blocks: 4}
        ];

        const p = eccParams[version] || eccParams[1];
        const dataBytes = bytes.slice(
            0,
            p.totalBytes - p.eccPerBlock * p.blocks
        );
        const eccBytes = this.reedSolomon(dataBytes, p.eccPerBlock);

        const result: number[] = [];
        for (const b of [...dataBytes, ...eccBytes]) {
            for (let i = 7; i >= 0; i--) result.push((b >> i) & 1);
        }
        return result;
    }

    private reedSolomon(data: number[], eccCount: number): number[] {
        const exp = new Uint8Array(512);
        const log = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) {
            exp[i] = x;
            log[x] = i;
            x = x << 1;
            if (x >= 256) x ^= 0x11d;
        }
        for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];

        const gen = new Uint8Array(eccCount + 1);
        gen[0] = 1;
        for (let i = 0; i < eccCount; i++) {
            for (let j = i + 1; j >= 1; j--) {
                gen[j] = gen[j] ? exp[log[gen[j]] + i] : 0;
                gen[j] ^= gen[j - 1];
            }
            gen[0] = exp[log[gen[0]] + i];
        }

        const remainder = new Uint8Array(eccCount);
        for (const byte of data) {
            const factor = byte ^ remainder[0];
            remainder.copyWithin(0, 1);
            remainder[eccCount - 1] = 0;
            if (factor !== 0) {
                const logFactor = log[factor];
                for (let i = 0; i < eccCount; i++) {
                    remainder[i] ^= exp[log[gen[eccCount - 1 - i]] + logFactor];
                }
            }
        }
        return Array.from(remainder);
    }

    private placeData(bits: number[], reserved: boolean[][]) {
        let idx = 0;
        let upward = true;
        for (let col = this.size - 1; col >= 0; col -= 2) {
            if (col === 6) col = 5;
            const rows = upward
                ? Array.from({length: this.size}, (_, i) => this.size - 1 - i)
                : Array.from({length: this.size}, (_, i) => i);
            for (const row of rows) {
                for (const c of [col, col - 1]) {
                    if (c < 0 || reserved[row][c]) continue;
                    if (idx < bits.length) {
                        this.modules[row][c] = bits[idx] === 1;
                        idx++;
                    }
                }
            }
            upward = !upward;
        }
    }

    private applyMask(mask: number, reserved: boolean[][]) {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (reserved[r][c]) continue;
                let flip = false;
                switch (mask) {
                    case 0:
                        flip = (r + c) % 2 === 0;
                        break;
                    case 1:
                        flip = r % 2 === 0;
                        break;
                    case 2:
                        flip = c % 3 === 0;
                        break;
                }
                if (flip) this.modules[r][c] = !this.modules[r][c];
            }
        }
    }

    private addFormatInfo(mask: number) {
        const format = (0b01 << 3) | mask;
        const bits = this.bchEncode(format, 0x537, 15);
        const xorMask = 0b101010000010010;
        const masked = bits ^ xorMask;

        const positions = [
            [0, 8],
            [1, 8],
            [2, 8],
            [3, 8],
            [4, 8],
            [5, 8],
            [7, 8],
            [8, 8],
            [8, 7],
            [8, 5],
            [8, 4],
            [8, 3],
            [8, 2],
            [8, 1],
            [8, 0]
        ];
        const positions2 = [
            [8, this.size - 1],
            [8, this.size - 2],
            [8, this.size - 3],
            [8, this.size - 4],
            [8, this.size - 5],
            [8, this.size - 6],
            [8, this.size - 7],
            [this.size - 7, 8],
            [this.size - 6, 8],
            [this.size - 5, 8],
            [this.size - 4, 8],
            [this.size - 3, 8],
            [this.size - 2, 8],
            [this.size - 1, 8]
        ];

        for (let i = 0; i < 15; i++) {
            const bit = (masked >> (14 - i)) & 1;
            if (positions[i]) {
                this.modules[positions[i][0]][positions[i][1]] = bit === 1;
            }
            if (positions2[i]) {
                this.modules[positions2[i][0]][positions2[i][1]] = bit === 1;
            }
        }
    }

    private addVersionInfo(version: number) {
        if (version < 7) return;
        const bits = this.bchEncode(version, 0x1f25, 18);
        for (let i = 0; i < 18; i++) {
            const bit = (bits >> i) & 1;
            const row = Math.floor(i / 3);
            const col = this.size - 11 + (i % 3);
            this.modules[row][col] = bit === 1;
            this.modules[col][row] = bit === 1;
        }
    }

    private bchEncode(data: number, poly: number, totalBits: number): number {
        const dataBits = totalBits - Math.floor(Math.log2(poly));
        let value = data << (totalBits - dataBits);
        while (Math.floor(Math.log2(value)) >= Math.floor(Math.log2(poly))) {
            value ^=
                poly <<
                (Math.floor(Math.log2(value)) - Math.floor(Math.log2(poly)));
        }
        return (data << (totalBits - dataBits)) | value;
    }
}

/**
 * Generate a Matter QR code as a PNG data URL.
 * Returns null if encoding fails.
 */
export function generateMatterQR(text: string): string | null {
    try {
        const encoder = new QREncoder(text);
        const modules = encoder.modules;
        const size = modules.length;
        const scale = 6;
        const padding = 1 * scale; // Minimal quiet zone — CSS handles outer spacing
        const canvasSize = size * scale + padding * 2;

        const canvas = document.createElement('canvas');
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasSize, canvasSize);
        ctx.fillStyle = '#000000';

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (modules[y][x]) {
                    ctx.fillRect(
                        padding + x * scale,
                        padding + y * scale,
                        scale,
                        scale
                    );
                }
            }
        }

        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
}

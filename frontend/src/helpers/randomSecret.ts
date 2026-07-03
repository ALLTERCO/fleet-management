/** 256-bit (32-byte) HMAC-SHA256 secrets, base64-encoded for transport. */

const HMAC_SECRET_BYTE_LENGTH = 32;

export function generateHmacSecret(): string {
    return bytesToBase64(randomBytes(HMAC_SECRET_BYTE_LENGTH));
}

function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

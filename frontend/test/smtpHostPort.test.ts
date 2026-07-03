/** One test per behaviour rule of the host/port split/join helpers. */

import {describe, expect, it} from 'vitest';
import {
    defaultPortForEncryption,
    encryptionFromPort,
    isCommonSmtpPort,
    joinHostPort,
    splitHostPort
} from '@/helpers/smtp-host-port';

describe('splitHostPort — combined string into {host, port}', () => {
    it('extracts host and port from the canonical "host:port" form', () => {
        expect(splitHostPort('smtp.example.com:587')).toEqual({
            host: 'smtp.example.com',
            port: 587
        });
    });

    it('returns host with null port when no colon is present', () => {
        expect(splitHostPort('smtp.example.com')).toEqual({
            host: 'smtp.example.com',
            port: null
        });
    });

    it('returns empty host and null port for an empty input', () => {
        expect(splitHostPort('')).toEqual({host: '', port: null});
    });

    it('trims surrounding whitespace before parsing', () => {
        expect(splitHostPort('  smtp.example.com:25  ')).toEqual({
            host: 'smtp.example.com',
            port: 25
        });
    });

    it('rejects a non-numeric tail and treats the whole thing as the host', () => {
        expect(splitHostPort('smtp:example')).toEqual({
            host: 'smtp:example',
            port: null
        });
    });

    it('rejects an out-of-range port and treats the whole thing as the host', () => {
        expect(splitHostPort('smtp.example.com:99999')).toEqual({
            host: 'smtp.example.com:99999',
            port: null
        });
    });

    it('parses a bracketed IPv6 host with a port', () => {
        expect(splitHostPort('[::1]:465')).toEqual({
            host: '::1',
            port: 465
        });
    });

    it('treats a bare unbracketed IPv6 as host-only because the last colon is ambiguous', () => {
        expect(splitHostPort('::1')).toEqual({
            host: '::1',
            port: null
        });
    });
});

describe('joinHostPort — {host, port} into combined string', () => {
    it('joins host and port with a single colon', () => {
        expect(joinHostPort({host: 'smtp.example.com', port: 587})).toBe(
            'smtp.example.com:587'
        );
    });

    it('omits the port when port is null', () => {
        expect(joinHostPort({host: 'smtp.example.com', port: null})).toBe(
            'smtp.example.com'
        );
    });

    it('returns the empty string when host is empty regardless of port', () => {
        expect(joinHostPort({host: '', port: 587})).toBe('');
    });

    it('wraps an IPv6 host in brackets so the colon disambiguates with port', () => {
        expect(joinHostPort({host: '::1', port: 465})).toBe('[::1]:465');
    });

    it('trims whitespace from host before joining', () => {
        expect(joinHostPort({host: '  smtp.example.com  ', port: 25})).toBe(
            'smtp.example.com:25'
        );
    });
});

describe('defaultPortForEncryption — sensible autofill per mode', () => {
    it('returns 465 for SSL/SMTPS', () => {
        expect(defaultPortForEncryption('ssl')).toBe(465);
    });

    it('returns 587 for STARTTLS — the modern default', () => {
        expect(defaultPortForEncryption('starttls')).toBe(587);
    });

    it('returns 25 for the unauthenticated/plain mode', () => {
        expect(defaultPortForEncryption('none')).toBe(25);
    });
});

describe('encryptionFromPort — port + tls flag back into mode', () => {
    it('maps port 465 to SSL even when tls is false (port is the strongest signal)', () => {
        expect(encryptionFromPort(465, false)).toBe('ssl');
    });

    it('maps tls=true on a non-SSL port to STARTTLS (the typical 587 case)', () => {
        expect(encryptionFromPort(587, true)).toBe('starttls');
    });

    it('maps tls=false on a non-SSL port to none — plain SMTP relay', () => {
        expect(encryptionFromPort(25, false)).toBe('none');
    });

    it('maps a null port + tls=true to STARTTLS so a brand new form lands on the safe default', () => {
        expect(encryptionFromPort(null, true)).toBe('starttls');
    });
});

describe('isCommonSmtpPort — hint for the "unusual port" warning', () => {
    it('recognises the standard ports 25, 465, 587, 2525', () => {
        for (const p of [25, 465, 587, 2525]) {
            expect(isCommonSmtpPort(p)).toBe(true);
        }
    });

    it('flags an arbitrary high port as uncommon', () => {
        expect(isCommonSmtpPort(8025)).toBe(false);
    });

    it('flags a null port as uncommon — nothing to warn about yet', () => {
        expect(isCommonSmtpPort(null)).toBe(false);
    });
});

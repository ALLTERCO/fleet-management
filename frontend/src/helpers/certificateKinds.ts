import type {CertificateKind} from '@api/certificate';

// The three mTLS roles offered when manually importing a certificate. 'device'
// (an FM-issued leaf) and 'other' stay in the enum for existing certs but are
// not manual import types. Order is the display order in the picker.
export const IMPORT_CERT_KINDS: CertificateKind[] = [
    'root_ca',
    'client_pair',
    'server_bundle'
];

// One-line, plain-English explanation shown under the import kind picker.
export const IMPORT_CERT_KIND_INFO: Partial<Record<CertificateKind, string>> = {
    root_ca: 'A CA the device will trust.',
    client_pair: "The device's certificate for connecting out, like MQTT.",
    server_bundle: "The device's own web server certificate."
};

// Identity certificates (client / server / device) carry a private key; a CA
// certificate is public-only. Drives whether the key field is shown.
export function certKindNeedsPrivateKey(kind: CertificateKind): boolean {
    return (
        kind === 'client_pair' || kind === 'server_bundle' || kind === 'device'
    );
}

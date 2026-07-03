export interface CertificateInstallMaterial {
    certificateId: string;
    clientCertPem: string;
    clientKeyPem?: string;
    userCaPem: string;
    requiresClientKey: boolean;
}

export function attachCertificateInstallMaterial(
    bundle: Record<string, unknown>,
    material: CertificateInstallMaterial
): Record<string, unknown> {
    const certificates = certificateRecord(bundle);
    if (
        !certificates ||
        certificates.certificateId !== material.certificateId
    ) {
        return bundle;
    }
    return {
        ...bundle,
        certificates: {
            ...certificates,
            install: installMaterial(material)
        }
    };
}

export function redactCertificateInstallMaterial(
    bundle: Record<string, unknown>
): Record<string, unknown> {
    const certificates = certificateRecord(bundle);
    if (!certificates) return bundle;
    const {install: _install, ...safeCertificates} = certificates;
    return {...bundle, certificates: safeCertificates};
}

function certificateRecord(
    bundle: Record<string, unknown>
): (Record<string, unknown> & {certificateId?: unknown}) | null {
    const value = bundle.certificates;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown> & {certificateId?: unknown};
}

function installMaterial(
    material: CertificateInstallMaterial
): Record<string, string> {
    return {
        userCaPem: material.userCaPem,
        clientCertPem: material.clientCertPem,
        ...(material.clientKeyPem ? {clientKeyPem: material.clientKeyPem} : {})
    };
}

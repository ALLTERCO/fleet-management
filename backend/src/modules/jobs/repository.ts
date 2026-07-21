import * as store from '../PostgresProvider';
import {
    type BackupDeviceOwnership,
    type BackupDeviceOwnershipProbe,
    type BackupQueuedUnit,
    type BackupUnitCounts,
    type CreatedBackupJob,
    type CreatedFirmwareJob,
    type CredentialPushRow,
    createJobRepository,
    type FirmwareQueuedUnit,
    type FirmwareUnitCounts
} from './repositoryFactory';

export type {
    BackupDeviceOwnership,
    BackupDeviceOwnershipProbe,
    BackupQueuedUnit,
    BackupUnitCounts,
    CreatedBackupJob,
    CreatedFirmwareJob,
    CredentialPushRow,
    FirmwareQueuedUnit,
    FirmwareUnitCounts
};

const defaultRepository = createJobRepository(
    store.queryRows,
    store.callMethod
);

export const listActiveJobs = defaultRepository.listActiveJobs;
export const getJob = defaultRepository.getJob;
export const markJobRunning = defaultRepository.markJobRunning;
export const markCertificateUnit = defaultRepository.markCertificateUnit;
export const markCredentialUnit = defaultRepository.markCredentialUnit;
export const listQueuedBackupUnits = defaultRepository.listQueuedBackupUnits;
export const markBackupUnitDone = defaultRepository.markBackupUnitDone;
export const markBackupUnitFailed = defaultRepository.markBackupUnitFailed;
export const getBackupUnitCounts = defaultRepository.getBackupUnitCounts;
export const backupCaptureOrgs = defaultRepository.backupCaptureOrgs;
export const backupCaptureOwners = defaultRepository.backupCaptureOwners;
export const resolveBackupDeviceOwners =
    defaultRepository.resolveBackupDeviceOwners;
export const reclaimStaleBackupUnits =
    defaultRepository.reclaimStaleBackupUnits;
export const listQueuedFirmwareUnits =
    defaultRepository.listQueuedFirmwareUnits;
export const markFirmwareUnitProgress =
    defaultRepository.markFirmwareUnitProgress;
export const markFirmwareUnitDone = defaultRepository.markFirmwareUnitDone;
export const markFirmwareUnitFailed = defaultRepository.markFirmwareUnitFailed;
export const getFirmwareUnitCounts = defaultRepository.getFirmwareUnitCounts;
export const reclaimStaleFirmwareUnits =
    defaultRepository.reclaimStaleFirmwareUnits;
export const finishJob = defaultRepository.finishJob;
export const createCertificateJob = defaultRepository.createCertificateJob;
export const enqueueCertificateTargets =
    defaultRepository.enqueueCertificateTargets;
export const createCredentialJob = defaultRepository.createCredentialJob;
export const createBackupJob = defaultRepository.createBackupJob;
export const enqueueBackupTargets = defaultRepository.enqueueBackupTargets;
export const createFirmwareJob = defaultRepository.createFirmwareJob;
export const enqueueFirmwareTargets = defaultRepository.enqueueFirmwareTargets;

// Fleet firmware administration. Methods are typed from the generated
// contract; Fleet's permission checks remain the source of authorization.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type FirmwareMethod = Extract<HostMethod, `firmware.${string}`>;

export type FleetFirmwareDomain = ReturnType<typeof createFirmwareDomain>;

export function createFirmwareDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<FirmwareMethod>(access);

    return {
        registerManualUpdate: (
            params: HostParams<'firmware.registermanualupdate'>
        ) => call('firmware.registermanualupdate', params),
        unregisterManualUpdate: (
            params: HostParams<'firmware.unregistermanualupdate'>
        ) => call('firmware.unregistermanualupdate', params),
        startUpdateJob: (params: HostParams<'firmware.startupdatejob'>) =>
            call('firmware.startupdatejob', params),
        checkForUpdateBulk: (
            params: HostParams<'firmware.checkforupdatebulk'>
        ) => call('firmware.checkforupdatebulk', params),
        getAutoUpdateDevices: () => call('firmware.getautoupdatedevices', {}),
        getAutoUpdateModes: () => call('firmware.getautoupdatemodes', {}),
        setAutoUpdate: (params: HostParams<'firmware.setautoupdate'>) =>
            call('firmware.setautoupdate', params),
        setAutoUpdateBulk: (params: HostParams<'firmware.setautoupdatebulk'>) =>
            call('firmware.setautoupdatebulk', params),
        getAutoUpdateStatus: (
            params: HostParams<'firmware.getautoupdatestatus'>
        ) => call('firmware.getautoupdatestatus', params),
        getAutoUpdateMode: (params: HostParams<'firmware.getautoupdatemode'>) =>
            call('firmware.getautoupdatemode', params),
        setAutoUpdateMode: (params: HostParams<'firmware.setautoupdatemode'>) =>
            call('firmware.setautoupdatemode', params),
        setAutoUpdateModeBulk: (
            params: HostParams<'firmware.setautoupdatemodebulk'>
        ) => call('firmware.setautoupdatemodebulk', params),
        getAutoUpdateChannel: () => call('firmware.getautoupdatechannel', {}),
        setAutoUpdateChannel: (
            params: HostParams<'firmware.setautoupdatechannel'>
        ) => call('firmware.setautoupdatechannel', params),
        getLastAutoUpdateRun: () => call('firmware.getlastautoupdaterun', {}),
        triggerAutoUpdate: () => call('firmware.triggerautoupdate', {}),
        listLibrary: () => call('firmware.listlibrary', {}),
        createUploadTicket: () => call('firmware.createuploadticket', {}),
        createLibraryDownloadUrl: (
            params: HostParams<'firmware.createlibrarydownloadurl'>
        ) => call('firmware.createlibrarydownloadurl', params),
        updateLibraryEntry: (
            params: HostParams<'firmware.updatelibraryentry'>
        ) => call('firmware.updatelibraryentry', params),
        deleteLibraryEntry: (
            params: HostParams<'firmware.deletelibraryentry'>
        ) => call('firmware.deletelibraryentry', params)
    };
}

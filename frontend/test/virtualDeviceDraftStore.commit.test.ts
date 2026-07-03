import {setActivePinia, createPinia} from 'pinia';
import {beforeEach, describe, it, expect, vi} from 'vitest';

vi.mock('@host/virtualDevices', () => ({
  virtualDevices: {
    create: vi.fn(async () => ({externalId: 'vd1', revision: 3})),
    bindings: {create: vi.fn(async () => ({id: 'b'}))},
    createImageUploadTicket: vi.fn(),
    update: vi.fn(),
    draft: {preview: vi.fn(async () => ({validation: {valid: true, errors: []}}))},
  },
}));

vi.mock('@/tools/logicalMeters', () => ({
  listMeasurementPoints: vi.fn(async () => []),
  saveLogicalMeter: vi.fn(async () => ({id: 1})),
}));

import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';
import {listMeasurementPoints, saveLogicalMeter} from '@/tools/logicalMeters';
import {virtualDevices} from '@host/virtualDevices';

const energyPoint = (o: Record<string, unknown> = {}) => ({
  deviceId: 1, componentKey: 'em:0', channel: 0, phase: 'z',
  tag: 'total_act_energy', electricalDomain: 'ac', ...o} as any);

const cand = (o: Record<string, unknown> = {}) => ({deviceExternalId:'d1', deviceName:'EM', componentKey:'em1:0',
  componentType:'power', dynamicCategory:null, writable:false, ...o} as any);

function readyDraft() {
  const s = useVirtualDeviceDraftStore();
  s.setKind('composed');
  s.details.name = 'Garage';
  s.addPart(cand());
  return s;
}

describe('commit creates device + bindings', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });
  it('creates the device and initial bindings in one atomic request', async () => {
    const s = readyDraft();
    s.addPart(cand({componentKey:'em1:1'}));
    s.roles[0].visual = {displayName: 'Grid power'} as any;
    await s.commit();
    expect(virtualDevices.create).toHaveBeenCalledOnce();
    expect(virtualDevices.bindings.create).not.toHaveBeenCalled();
    expect((virtualDevices.create as any).mock.calls[0][0]).toMatchObject({
      name: 'Garage',
      bindings: [
        {
          roleKey: 'power_1',
          source: {deviceExternalId: 'd1', componentKey: 'em1:0'},
          visual: {displayName: 'Grid power'},
        },
        {
          roleKey: 'power_2',
          source: {deviceExternalId: 'd1', componentKey: 'em1:1'},
        },
      ],
    });
  });

  it('persists the energy role as a logical meter when one is set', async () => {
    (listMeasurementPoints as any).mockResolvedValueOnce([energyPoint()]);
    const s = readyDraft();
    s.energyRole = 'load';
    await s.commit();
    expect(listMeasurementPoints).toHaveBeenCalledWith({
      shellyID: 'vd1',
      includeAssigned: false,
    });
    expect(saveLogicalMeter).toHaveBeenCalledOnce();
    const params = (saveLogicalMeter as any).mock.calls[0][0];
    expect(params).toMatchObject({
      role: 'load',
      aggregationMode: 'sum_points',
      name: 'Garage',
    });
    expect(params.points).toHaveLength(1);
  });

  it('does not persist a logical meter when no energy role is set', async () => {
    const s = readyDraft();
    await s.commit();
    expect(saveLogicalMeter).not.toHaveBeenCalled();
  });
});

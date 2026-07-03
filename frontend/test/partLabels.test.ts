import {describe, it, expect} from 'vitest';
import {humaniseLabel, partVisual} from '@/helpers/partLabels';

describe('humaniseLabel', () => {
  it('maps known component types to friendly names', () => {
    expect(humaniseLabel({componentType: 'power'})).toBe('Power');
    expect(humaniseLabel({componentType: 'total_act_energy'})).toBe('Energy');
    expect(humaniseLabel({componentType: 'switch'})).toBe('Switch');
  });
  it('prefers an explicit label when present', () => {
    expect(humaniseLabel({componentType: 'power', label: 'Boiler power'})).toBe('Boiler power');
  });
  it('falls back to a humanised type for unknowns', () => {
    expect(humaniseLabel({componentType: 'foo_bar'})).toBe('Foo bar');
  });
});

describe('partVisual', () => {
  it('returns an icon + accent for a known type', () => {
    expect(partVisual('power').icon).toBe('fa-bolt');
  });
});

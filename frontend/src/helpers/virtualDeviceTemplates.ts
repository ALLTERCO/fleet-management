import type {
    SourceComponentCandidate,
    VirtualDeviceProfile,
    VirtualDeviceVisual
} from '@host/virtualDevices';

type CardProfile = NonNullable<VirtualDeviceVisual['cardProfile']>;
type ProfileRole = VirtualDeviceProfile['roles'][number];

export interface VirtualTemplateMeta {
    label: string;
    hint: string;
    icon: string;
    accent: string;
    categoryKey: string;
    cardProfile: CardProfile;
    sort: number;
}

export const MANUAL_TEMPLATE_KEY = '__manual_custom__';

const TEMPLATE_META: Record<string, VirtualTemplateMeta> = {
    door_window: {
        label: 'Door or window',
        hint: 'Open/closed state, optional battery',
        icon: 'fas fa-door-open',
        accent: 'switch',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 10
    },
    lighting_zone: {
        label: 'Lighting zone',
        hint: 'One light or a group of outputs',
        icon: 'fas fa-lightbulb',
        accent: 'switch',
        categoryKey: 'lighting',
        cardProfile: 'actuator',
        sort: 20
    },
    room_climate: {
        label: 'Room climate',
        hint: 'Temperature, humidity, air quality',
        icon: 'fas fa-temperature-half',
        accent: 'temp',
        categoryKey: 'climate',
        cardProfile: 'climate',
        sort: 30
    },
    energy_meter: {
        label: 'Energy meter',
        hint: 'Power, energy, voltage',
        icon: 'fas fa-gauge-high',
        accent: 'energy',
        categoryKey: 'energy',
        cardProfile: 'meter',
        sort: 40
    },
    security_sensor: {
        label: 'Security sensor',
        hint: 'Alarm, tamper, battery',
        icon: 'fas fa-shield-halved',
        accent: 'generic',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 50
    },
    machine_state: {
        label: 'Machine state',
        hint: 'Running state and optional power',
        icon: 'fas fa-industry',
        accent: 'generic',
        categoryKey: 'custom',
        cardProfile: 'custom',
        sort: 60
    },
    occupancy_area: {
        label: 'Occupancy area',
        hint: 'Presence, motion, illuminance',
        icon: 'fas fa-person-walking',
        accent: 'generic',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 70
    },
    air_quality: {
        label: 'Air quality',
        hint: 'CO2, TVOC, temperature, humidity',
        icon: 'fas fa-wind',
        accent: 'temp',
        categoryKey: 'climate',
        cardProfile: 'climate',
        sort: 80
    },
    weather_station: {
        label: 'Weather station',
        hint: 'Temperature, humidity, pressure, rain',
        icon: 'fas fa-cloud-sun',
        accent: 'temp',
        categoryKey: 'climate',
        cardProfile: 'climate',
        sort: 90
    },
    leak_protection: {
        label: 'Leak protection',
        hint: 'Leak sensor, shutoff valve, battery',
        icon: 'fas fa-droplet',
        accent: 'humidity',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 100
    },
    gas_safety: {
        label: 'Gas and CO safety',
        hint: 'Gas and carbon monoxide alarms',
        icon: 'fas fa-triangle-exclamation',
        accent: 'generic',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 110
    },
    garage_door: {
        label: 'Garage door',
        hint: 'Door state and optional opener',
        icon: 'fas fa-warehouse',
        accent: 'switch',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 120
    },
    smart_lock: {
        label: 'Smart lock',
        hint: 'Lock state and battery',
        icon: 'fas fa-lock',
        accent: 'generic',
        categoryKey: 'safety',
        cardProfile: 'safety',
        sort: 130
    },
    button_scene: {
        label: 'Button scene',
        hint: 'Button or remote plus battery',
        icon: 'fas fa-hand-pointer',
        accent: 'generic',
        categoryKey: 'custom',
        cardProfile: 'custom',
        sort: 140
    },
    pump_or_valve: {
        label: 'Pump or valve',
        hint: 'Actuator, pressure, power',
        icon: 'fas fa-faucet-drip',
        accent: 'switch',
        categoryKey: 'energy',
        cardProfile: 'actuator',
        sort: 150
    },
    ev_charger: {
        label: 'EV charger',
        hint: 'Charging state, power, energy',
        icon: 'fas fa-charging-station',
        accent: 'energy',
        categoryKey: 'energy',
        cardProfile: 'meter',
        sort: 160
    },
    custom_blank: {
        label: 'Custom',
        hint: 'Pick any parts manually',
        icon: 'fas fa-layer-group',
        accent: 'generic',
        categoryKey: 'custom',
        cardProfile: 'custom',
        sort: 1000
    }
};

export const MANUAL_TEMPLATE: VirtualTemplateMeta = {
    label: 'Custom',
    hint: 'Pick any parts manually',
    icon: 'fas fa-layer-group',
    accent: 'generic',
    categoryKey: 'custom',
    cardProfile: 'custom',
    sort: 1000
};

export function templateMeta(
    profile: Pick<VirtualDeviceProfile, 'key' | 'name' | 'metadata'>
): VirtualTemplateMeta {
    const known = TEMPLATE_META[profile.key];
    if (known) return known;
    const fallbackCategory = profile.metadata.categoryKey ?? 'custom';
    return {
        label: profile.name,
        hint: roleSummary(profile as VirtualDeviceProfile),
        icon: profile.metadata.defaultVisual?.icon ?? 'fas fa-layer-group',
        accent: profile.metadata.defaultVisual?.accent ?? 'generic',
        categoryKey: fallbackCategory,
        cardProfile: cardProfileForCategory(fallbackCategory),
        sort: 80
    };
}

export function profileVisual(
    profile: Pick<VirtualDeviceProfile, 'key' | 'metadata'>
): VirtualDeviceVisual {
    const meta = templateMeta(profile as VirtualDeviceProfile);
    return {
        icon: profile.metadata.defaultVisual?.icon ?? meta.icon,
        accent: profile.metadata.defaultVisual?.accent ?? meta.accent,
        cardProfile: meta.cardProfile
    };
}

export function manualVisual(): VirtualDeviceVisual {
    return {
        icon: MANUAL_TEMPLATE.icon,
        accent: MANUAL_TEMPLATE.accent,
        cardProfile: MANUAL_TEMPLATE.cardProfile
    };
}

export function sortedProfiles(
    profiles: readonly VirtualDeviceProfile[]
): VirtualDeviceProfile[] {
    return [...profiles].sort((a, b) => {
        const bySort = templateMeta(a).sort - templateMeta(b).sort;
        return bySort || templateMeta(a).label.localeCompare(templateMeta(b).label);
    });
}

export function roleMatchesCandidate(
    role: ProfileRole,
    candidate: SourceComponentCandidate
): boolean {
    const roleText = `${role.roleKey} ${role.label}`.toLowerCase();
    const component = candidate.componentType.toLowerCase();
    const key = candidate.componentKey.toLowerCase();
    const metadata = role.metadata as Record<string, unknown> | undefined;
    const wanted = stringMeta(metadata, 'componentType') ?? stringMeta(metadata, 'objName');
    if (wanted && candidateMatches(component, key, wanted)) return true;
    if (roleText.includes('open') || roleText.includes('door')) {
        return ['window', 'door', 'garage_door'].some((term) =>
            candidateMatches(component, key, term)
        );
    }
    if (roleText.includes('light') || roleText.includes('actuator')) {
        return component.includes('switch') || component.includes('relay');
    }
    if (roleText.includes('temperature')) return component.includes('temperature');
    if (roleText.includes('humidity')) return component.includes('humidity');
    if (roleText.includes('co2')) return component.includes('co2');
    if (roleText.includes('tvoc')) return component.includes('tvoc');
    if (roleText.includes('pressure')) return component.includes('pressure');
    if (roleText.includes('rain')) {
        return component.includes('rain') || component.includes('precipitation');
    }
    if (roleText.includes('occupancy')) return component.includes('occupancy') || component.includes('presence');
    if (roleText.includes('motion')) return component.includes('motion');
    if (roleText.includes('power')) {
        return component.includes('power') || key.includes('apower');
    }
    if (roleText.includes('energy')) {
        return component.includes('energy') || key.includes('energy');
    }
    if (roleText.includes('voltage')) return component.includes('voltage');
    if (roleText.includes('battery')) return component.includes('battery');
    if (roleText.includes('tamper')) return component.includes('tamper');
    if (roleText.includes('lock')) return component.includes('lock');
    if (roleText.includes('button')) return component.includes('button') || component.includes('input');
    if (roleText.includes('gas')) return component.includes('gas');
    if (roleText.includes('carbon monoxide')) return component.includes('carbon_monoxide');
    if (roleText.includes('alarm')) {
        return ['smoke', 'flood', 'gas', 'motion', 'presence'].some((term) =>
            component.includes(term)
        );
    }
    return true;
}

function cardProfileForCategory(categoryKey: string): CardProfile {
    if (categoryKey === 'energy') return 'meter';
    if (categoryKey === 'climate') return 'climate';
    if (categoryKey === 'safety') return 'safety';
    if (categoryKey === 'lighting') return 'actuator';
    return 'custom';
}

function roleSummary(profile: VirtualDeviceProfile): string {
    const labels = profile.roles.slice(0, 3).map((role) => role.label);
    return labels.length ? labels.join(', ') : 'Pick parts manually';
}

function stringMeta(
    metadata: Record<string, unknown> | undefined,
    key: string
): string | null {
    const value = metadata?.[key];
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim().toLowerCase()
        : null;
}

function candidateMatches(component: string, key: string, wanted: string): boolean {
    return component.includes(wanted) || key.includes(wanted);
}

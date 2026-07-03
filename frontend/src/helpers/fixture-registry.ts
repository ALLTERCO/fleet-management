// Fixture registry — maps each FixtureKind to a category + Three.js
// primitive builder. When a glTF file exists at
// `/3d/fixtures/{kind}.glb` it auto-replaces the primitive at runtime
// (see floor-plan-3d.ts) — drop CC0 Quaternius / Kenney / Poly Pizza
// models into frontend/public/3d/fixtures/ to upgrade visuals without
// any code change.

import {
    BoxGeometry,
    BufferGeometry,
    Color,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
    SphereGeometry,
    TorusGeometry
} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import type {FixtureCategory, FixtureKind} from '@/types/floor-plan';

export interface FixtureSpec {
    kind: FixtureKind;
    label: string;
    category: FixtureCategory;
    /** Approximate mounting height in world units (0 = floor). Used to
     *  position the fixture; ceiling fixtures appear at wall height. */
    mountY: number;
    /** Builds the primitive fallback geometry. Replaced by glTF when
     *  /3d/fixtures/{kind}.glb is present. */
    buildPrimitive(color: number): Object3D;
}

// Module-local material defaults — shared across primitives so the
// scene stays under the draw-call budget.
const MAT_DEFAULTS = {
    roughness: 0.6,
    metalness: 0.2,
    emissiveIntensity: 0
};

function paintedMat(
    color: number,
    opts?: {emissive?: boolean}
): MeshStandardMaterial {
    return new MeshStandardMaterial({
        color,
        roughness: MAT_DEFAULTS.roughness,
        metalness: MAT_DEFAULTS.metalness,
        emissive: opts?.emissive ? color : 0x000000,
        emissiveIntensity: opts?.emissive ? MAT_DEFAULTS.emissiveIntensity : 0
    });
}

// ───── PRIMITIVES ──────────────────────────────────────────────────
// Each builder returns a Group at origin. Floor-level fixtures rest on
// y=0; ceiling fixtures use mountY to be positioned later.

function ceilingLight(color: number): Object3D {
    const g = new Group();
    const cone = new Mesh(
        new CylinderGeometry(0.6, 1.0, 0.8, 16),
        paintedMat(0xeeeeee)
    );
    cone.position.y = -0.4;
    const bulb = new Mesh(
        new SphereGeometry(0.45, 16, 12),
        paintedMat(color, {emissive: true})
    );
    bulb.position.y = -0.9;
    g.add(cone, bulb);
    return g;
}

function pendant(color: number): Object3D {
    const g = new Group();
    const cable = new Mesh(
        new CylinderGeometry(0.03, 0.03, 1.6, 6),
        paintedMat(0x1a1a1a)
    );
    cable.position.y = 0.8;
    const shade = new Mesh(
        new CylinderGeometry(0.5, 0.7, 0.6, 16),
        paintedMat(0x222222)
    );
    shade.position.y = -0.3;
    const bulb = new Mesh(
        new SphereGeometry(0.3, 12, 8),
        paintedMat(color, {emissive: true})
    );
    bulb.position.y = -0.55;
    g.add(cable, shade, bulb);
    return g;
}

function spotlight(color: number): Object3D {
    const g = new Group();
    const can = new Mesh(
        new CylinderGeometry(0.35, 0.35, 0.35, 16),
        paintedMat(0x333333)
    );
    const lens = new Mesh(
        new CylinderGeometry(0.28, 0.28, 0.05, 16),
        paintedMat(color, {emissive: true})
    );
    lens.position.y = -0.2;
    g.add(can, lens);
    return g;
}

function floorLamp(color: number): Object3D {
    const g = new Group();
    const base = new Mesh(
        new CylinderGeometry(0.4, 0.4, 0.08, 16),
        paintedMat(0x222222)
    );
    const pole = new Mesh(
        new CylinderGeometry(0.05, 0.05, 2.4, 8),
        paintedMat(0x444444)
    );
    pole.position.y = 1.2;
    const shade = new Mesh(
        new CylinderGeometry(0.5, 0.7, 0.5, 16),
        paintedMat(0xeeeeee)
    );
    shade.position.y = 2.5;
    const bulb = new Mesh(
        new SphereGeometry(0.25, 12, 8),
        paintedMat(color, {emissive: true})
    );
    bulb.position.y = 2.4;
    g.add(base, pole, shade, bulb);
    return g;
}

function tableLamp(color: number): Object3D {
    const g = new Group();
    const base = new Mesh(
        new CylinderGeometry(0.25, 0.3, 0.1, 12),
        paintedMat(0x222222)
    );
    const stem = new Mesh(
        new CylinderGeometry(0.05, 0.05, 0.6, 8),
        paintedMat(0x666666)
    );
    stem.position.y = 0.35;
    const shade = new Mesh(
        new CylinderGeometry(0.3, 0.4, 0.35, 12),
        paintedMat(0xdddddd)
    );
    shade.position.y = 0.85;
    const bulb = new Mesh(
        new SphereGeometry(0.18, 10, 8),
        paintedMat(color, {emissive: true})
    );
    bulb.position.y = 0.75;
    g.add(base, stem, shade, bulb);
    return g;
}

function wallSconce(color: number): Object3D {
    const g = new Group();
    const back = new Mesh(
        new BoxGeometry(0.4, 0.6, 0.08),
        paintedMat(0x222222)
    );
    const bulb = new Mesh(
        new SphereGeometry(0.2, 12, 8),
        paintedMat(color, {emissive: true})
    );
    bulb.position.z = 0.2;
    g.add(back, bulb);
    return g;
}

function ledStrip(color: number): Object3D {
    const g = new Group();
    const strip = new Mesh(
        new BoxGeometry(2.0, 0.05, 0.1),
        paintedMat(color, {emissive: true})
    );
    g.add(strip);
    return g;
}

function acWall(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(1.6, 0.5, 0.3), paintedMat(0xeeeeee));
    const slot = new Mesh(
        new BoxGeometry(1.4, 0.06, 0.05),
        paintedMat(0x111111)
    );
    slot.position.y = -0.18;
    slot.position.z = 0.15;
    const led = new Mesh(
        new BoxGeometry(0.08, 0.06, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.6, 0.1, 0.15);
    g.add(body, slot, led);
    return g;
}

function acCeiling(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(1.4, 0.3, 1.4), paintedMat(0xeeeeee));
    const led = new Mesh(
        new BoxGeometry(0.06, 0.04, 0.06),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.5, -0.18, 0.5);
    g.add(body, led);
    return g;
}

function radiator(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(1.4, 0.7, 0.18),
        paintedMat(0xdddddd)
    );
    for (let i = 0; i < 6; i++) {
        const fin = new Mesh(
            new BoxGeometry(0.04, 0.62, 0.18),
            paintedMat(0xcccccc)
        );
        fin.position.x = -0.6 + i * 0.24;
        g.add(fin);
    }
    const valve = new Mesh(
        new SphereGeometry(0.1, 8, 6),
        paintedMat(color, {emissive: true})
    );
    valve.position.set(-0.75, -0.2, 0.1);
    g.add(body, valve);
    return g;
}

function ceilingFan(color: number): Object3D {
    const g = new Group();
    const motor = new Mesh(
        new CylinderGeometry(0.18, 0.18, 0.15, 12),
        paintedMat(0x444444)
    );
    for (let i = 0; i < 4; i++) {
        const blade = new Mesh(
            new BoxGeometry(1.4, 0.04, 0.18),
            paintedMat(0xaa8855)
        );
        blade.rotation.y = (Math.PI / 2) * i;
        blade.position.y = -0.08;
        g.add(blade);
    }
    const led = new Mesh(
        new SphereGeometry(0.06, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.y = -0.16;
    g.add(motor, led);
    return g;
}

function thermostat(color: number): Object3D {
    const g = new Group();
    const dial = new Mesh(
        new CylinderGeometry(0.25, 0.25, 0.06, 24),
        paintedMat(0xeeeeee)
    );
    dial.rotation.x = Math.PI / 2;
    const ring = new Mesh(
        new TorusGeometry(0.2, 0.02, 8, 24),
        paintedMat(color, {emissive: true})
    );
    ring.position.z = 0.04;
    g.add(dial, ring);
    return g;
}

function vent(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.6, 0.04, 0.6),
        paintedMat(0xeeeeee)
    );
    for (let i = 0; i < 5; i++) {
        const slot = new Mesh(
            new BoxGeometry(0.55, 0.01, 0.04),
            paintedMat(0x111111)
        );
        slot.position.set(0, -0.025, -0.2 + i * 0.1);
        g.add(slot);
    }
    const led = new Mesh(
        new SphereGeometry(0.03, 6, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.25, -0.025, 0.25);
    g.add(body, led);
    return g;
}

function fridge(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(1.2, 2.8, 1.0), paintedMat(0xdddddd));
    body.position.y = 1.4;
    const door = new Mesh(
        new BoxGeometry(0.02, 1.6, 1.0),
        paintedMat(0xcccccc)
    );
    door.position.set(0.61, 2.0, 0);
    const handle = new Mesh(
        new BoxGeometry(0.04, 0.4, 0.05),
        paintedMat(0x222222)
    );
    handle.position.set(0.65, 2.0, -0.4);
    const led = new Mesh(
        new SphereGeometry(0.04, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.55, 2.6, 0);
    g.add(body, door, handle, led);
    return g;
}

function oven(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(0.7, 0.8, 0.7), paintedMat(0x333333));
    body.position.y = 0.4;
    const window = new Mesh(
        new BoxGeometry(0.55, 0.4, 0.02),
        paintedMat(0x111111)
    );
    window.position.set(0, 0.45, 0.36);
    const led = new Mesh(
        new BoxGeometry(0.1, 0.04, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.2, 0.75, 0.36);
    g.add(body, window, led);
    return g;
}

function dishwasher(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.6, 0.85, 0.6),
        paintedMat(0xcccccc)
    );
    body.position.y = 0.425;
    const handle = new Mesh(
        new BoxGeometry(0.4, 0.05, 0.04),
        paintedMat(0x222222)
    );
    handle.position.set(0, 0.78, 0.32);
    const led = new Mesh(
        new BoxGeometry(0.06, 0.03, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.25, 0.75, 0.32);
    g.add(body, handle, led);
    return g;
}

function microwave(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.6, 0.35, 0.4),
        paintedMat(0x222222)
    );
    body.position.y = 0.175;
    const window = new Mesh(
        new BoxGeometry(0.4, 0.25, 0.02),
        paintedMat(0x111111)
    );
    window.position.set(-0.05, 0.175, 0.21);
    const led = new Mesh(
        new BoxGeometry(0.06, 0.03, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.25, 0.3, 0.21);
    g.add(body, window, led);
    return g;
}

function washingMachine(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.6, 0.85, 0.6),
        paintedMat(0xeeeeee)
    );
    body.position.y = 0.425;
    const door = new Mesh(
        new SphereGeometry(0.22, 16, 12),
        paintedMat(0x111111)
    );
    door.position.set(0, 0.45, 0.32);
    const led = new Mesh(
        new BoxGeometry(0.05, 0.03, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.2, 0.75, 0.32);
    g.add(body, door, led);
    return g;
}

function dryer(color: number): Object3D {
    return washingMachine(color); // visually identical in plan view
}

function solarPanel(color: number): Object3D {
    const g = new Group();
    const panel = new Mesh(
        new BoxGeometry(2.0, 0.06, 1.2),
        paintedMat(0x1a3a5a)
    );
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 6; j++) {
            const cell = new Mesh(
                new BoxGeometry(0.3, 0.005, 0.18),
                paintedMat(0x2a4f7f)
            );
            cell.position.set(-0.85 + j * 0.32, 0.035, -0.4 + i * 0.27);
            g.add(cell);
        }
    }
    const led = new Mesh(
        new SphereGeometry(0.05, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.95, 0.04, 0.55);
    g.add(panel, led);
    return g;
}

function solarInverter(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(0.6, 0.8, 0.2), paintedMat(0xdddddd));
    body.position.y = 0.4;
    const screen = new Mesh(
        new BoxGeometry(0.4, 0.18, 0.01),
        paintedMat(color, {emissive: true})
    );
    screen.position.set(0, 0.55, 0.11);
    g.add(body, screen);
    return g;
}

function batteryWall(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(1.2, 1.6, 0.25),
        paintedMat(0x222222)
    );
    body.position.y = 0.8;
    const strip = new Mesh(
        new BoxGeometry(1.0, 0.04, 0.01),
        paintedMat(color, {emissive: true})
    );
    strip.position.set(0, 1.4, 0.13);
    g.add(body, strip);
    return g;
}

function doorbell(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.12, 0.2, 0.06),
        paintedMat(0x333333)
    );
    const button = new Mesh(
        new SphereGeometry(0.04, 12, 8),
        paintedMat(color, {emissive: true})
    );
    button.position.set(0, 0.05, 0.035);
    g.add(body, button);
    return g;
}

function smokeDetector(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new CylinderGeometry(0.15, 0.15, 0.05, 16),
        paintedMat(0xffffff)
    );
    body.rotation.x = Math.PI / 2;
    const led = new Mesh(
        new SphereGeometry(0.015, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.z = 0.03;
    g.add(body, led);
    return g;
}

function motionSensor(color: number): Object3D {
    const g = new Group();
    const dome = new Mesh(
        new SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        paintedMat(0xeeeeee)
    );
    dome.rotation.x = Math.PI;
    const lens = new Mesh(
        new SphereGeometry(0.06, 10, 6),
        paintedMat(color, {emissive: true})
    );
    lens.position.y = -0.04;
    g.add(dome, lens);
    return g;
}

function smartBlind(color: number): Object3D {
    const g = new Group();
    const rod = new Mesh(
        new CylinderGeometry(0.04, 0.04, 1.4, 8),
        paintedMat(0x666666)
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 1.4;
    const slats = new Mesh(
        new BoxGeometry(1.4, 1.0, 0.04),
        paintedMat(0xdddddd)
    );
    slats.position.y = 0.85;
    const led = new Mesh(
        new SphereGeometry(0.03, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.65, 1.4, 0);
    g.add(rod, slats, led);
    return g;
}

function smartCurtain(color: number): Object3D {
    return smartBlind(color); // similar plan footprint
}

function wallOutlet(color: number): Object3D {
    const g = new Group();
    const plate = new Mesh(
        new BoxGeometry(0.14, 0.2, 0.02),
        paintedMat(0xeeeeee)
    );
    const led = new Mesh(
        new SphereGeometry(0.015, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.05, 0.08, 0.015);
    g.add(plate, led);
    return g;
}

function wallSwitch(color: number): Object3D {
    const g = new Group();
    const plate = new Mesh(
        new BoxGeometry(0.1, 0.14, 0.02),
        paintedMat(0xeeeeee)
    );
    const rocker = new Mesh(
        new BoxGeometry(0.07, 0.1, 0.02),
        paintedMat(color, {emissive: true})
    );
    rocker.position.z = 0.015;
    g.add(plate, rocker);
    return g;
}

// ── New Phase D.5 fixtures ───────────────────────────────────────────

function chandelier(color: number): Object3D {
    const g = new Group();
    const cap = new Mesh(
        new CylinderGeometry(0.08, 0.04, 0.12, 8),
        paintedMat(0x333333)
    );
    cap.position.y = 0.5;
    const cable = new Mesh(
        new CylinderGeometry(0.02, 0.02, 0.6, 6),
        paintedMat(0x1a1a1a)
    );
    cable.position.y = 0.2;
    const hub = new Mesh(new SphereGeometry(0.18, 12, 8), paintedMat(0xddccaa));
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const arm = new Mesh(
            new CylinderGeometry(0.015, 0.015, 0.35, 6),
            paintedMat(0xddccaa)
        );
        arm.position.set(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18);
        arm.rotation.z = -Math.PI / 6;
        arm.rotation.y = -a;
        const bulb = new Mesh(
            new SphereGeometry(0.07, 10, 8),
            paintedMat(color, {emissive: true})
        );
        bulb.position.set(Math.cos(a) * 0.35, -0.13, Math.sin(a) * 0.35);
        g.add(arm, bulb);
    }
    g.add(cap, cable, hub);
    return g;
}

function streetLight(color: number): Object3D {
    const g = new Group();
    const base = new Mesh(
        new CylinderGeometry(0.25, 0.3, 0.15, 12),
        paintedMat(0x333333)
    );
    const pole = new Mesh(
        new CylinderGeometry(0.08, 0.08, 4.0, 8),
        paintedMat(0x444444)
    );
    pole.position.y = 2.0;
    const arm = new Mesh(
        new BoxGeometry(0.8, 0.08, 0.08),
        paintedMat(0x444444)
    );
    arm.position.set(0.4, 3.9, 0);
    const head = new Mesh(
        new BoxGeometry(0.5, 0.18, 0.3),
        paintedMat(0x222222)
    );
    head.position.set(0.7, 3.85, 0);
    const lens = new Mesh(
        new BoxGeometry(0.4, 0.05, 0.25),
        paintedMat(color, {emissive: true})
    );
    lens.position.set(0.7, 3.75, 0);
    g.add(base, pole, arm, head, lens);
    return g;
}

function waterHeater(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new CylinderGeometry(0.35, 0.35, 1.5, 16),
        paintedMat(0xdddddd)
    );
    body.position.y = 0.75;
    const top = new Mesh(
        new CylinderGeometry(0.36, 0.36, 0.06, 16),
        paintedMat(0x666666)
    );
    top.position.y = 1.5;
    const led = new Mesh(
        new SphereGeometry(0.04, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.32, 0.4, 0);
    g.add(body, top, led);
    return g;
}

function houseplant(color: number): Object3D {
    const g = new Group();
    const pot = new Mesh(
        new CylinderGeometry(0.22, 0.18, 0.32, 12),
        paintedMat(0x8b5e3c)
    );
    pot.position.y = 0.16;
    for (let i = 0; i < 5; i++) {
        const leaf = new Mesh(
            new BoxGeometry(0.05, 0.6, 0.16),
            paintedMat(0x2d6b2d)
        );
        const a = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.08, 0.55, Math.sin(a) * 0.08);
        leaf.rotation.z = Math.cos(a) * 0.3;
        leaf.rotation.x = Math.sin(a) * 0.3;
        g.add(leaf);
    }
    const sensor = new Mesh(
        new SphereGeometry(0.03, 8, 6),
        paintedMat(color, {emissive: true})
    );
    sensor.position.set(0, 0.32, 0.18);
    g.add(pot, sensor);
    return g;
}

function tv(color: number): Object3D {
    const g = new Group();
    const screen = new Mesh(
        new BoxGeometry(1.4, 0.85, 0.06),
        paintedMat(0x111111)
    );
    const bezel = new Mesh(
        new BoxGeometry(1.5, 0.95, 0.04),
        paintedMat(0x222222)
    );
    bezel.position.z = -0.03;
    const stand = new Mesh(
        new CylinderGeometry(0.04, 0.06, 0.18, 8),
        paintedMat(0x333333)
    );
    stand.position.y = -0.56;
    const base = new Mesh(
        new BoxGeometry(0.5, 0.04, 0.25),
        paintedMat(0x333333)
    );
    base.position.y = -0.66;
    const led = new Mesh(
        new BoxGeometry(0.04, 0.03, 0.01),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.65, -0.4, 0.04);
    g.add(bezel, screen, stand, base, led);
    return g;
}

function monitor(color: number): Object3D {
    const g = new Group();
    const screen = new Mesh(
        new BoxGeometry(0.6, 0.35, 0.04),
        paintedMat(0x111111)
    );
    screen.position.y = 0.2;
    const bezel = new Mesh(
        new BoxGeometry(0.66, 0.41, 0.02),
        paintedMat(0x222222)
    );
    bezel.position.set(0, 0.2, -0.02);
    const stand = new Mesh(
        new CylinderGeometry(0.02, 0.04, 0.12, 8),
        paintedMat(0x333333)
    );
    stand.position.y = -0.04;
    const base = new Mesh(
        new BoxGeometry(0.25, 0.02, 0.18),
        paintedMat(0x333333)
    );
    base.position.y = -0.1;
    const led = new Mesh(
        new BoxGeometry(0.02, 0.015, 0.005),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.28, 0.04, 0.025);
    g.add(bezel, screen, stand, base, led);
    return g;
}

function computer(color: number): Object3D {
    const g = new Group();
    const tower = new Mesh(
        new BoxGeometry(0.22, 0.45, 0.45),
        paintedMat(0x222222)
    );
    tower.position.y = 0.225;
    const led = new Mesh(
        new SphereGeometry(0.015, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.11, 0.4, 0.22);
    g.add(tower, led);
    return g;
}

function smartLock(color: number): Object3D {
    const g = new Group();
    const body = new Mesh(
        new BoxGeometry(0.1, 0.16, 0.06),
        paintedMat(0x444444)
    );
    const deadbolt = new Mesh(
        new CylinderGeometry(0.04, 0.04, 0.03, 12),
        paintedMat(0x999999)
    );
    deadbolt.position.z = 0.035;
    deadbolt.rotation.x = Math.PI / 2;
    const led = new Mesh(
        new SphereGeometry(0.012, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0, -0.06, 0.035);
    g.add(body, deadbolt, led);
    return g;
}

function door(color: number): Object3D {
    const g = new Group();
    const panel = new Mesh(
        new BoxGeometry(0.9, 2.1, 0.05),
        paintedMat(0x8b5e3c)
    );
    panel.position.y = 1.05;
    const knob = new Mesh(new SphereGeometry(0.04, 8, 6), paintedMat(0xddcc55));
    knob.position.set(0.36, 1.0, 0.04);
    const led = new Mesh(
        new SphereGeometry(0.02, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(0.36, 1.3, 0.04);
    g.add(panel, knob, led);
    return g;
}

function garage(color: number): Object3D {
    const g = new Group();
    const panel = new Mesh(
        new BoxGeometry(2.6, 2.2, 0.06),
        paintedMat(0xcccccc)
    );
    panel.position.y = 1.1;
    // Horizontal panel ridges
    for (let i = 0; i < 6; i++) {
        const line = new Mesh(
            new BoxGeometry(2.55, 0.02, 0.07),
            paintedMat(0x999999)
        );
        line.position.set(0, 0.3 + i * 0.32, 0.005);
        g.add(line);
    }
    const led = new Mesh(
        new SphereGeometry(0.04, 8, 6),
        paintedMat(color, {emissive: true})
    );
    led.position.set(1.15, 2.05, 0.04);
    g.add(panel, led);
    return g;
}

function sofa(_color: number): Object3D {
    const g = new Group();
    const seat = new Mesh(
        new BoxGeometry(2.0, 0.5, 0.85),
        paintedMat(0x556677)
    );
    seat.position.y = 0.25;
    const back = new Mesh(new BoxGeometry(2.0, 0.6, 0.2), paintedMat(0x556677));
    back.position.set(0, 0.55, -0.32);
    const armL = new Mesh(
        new BoxGeometry(0.2, 0.6, 0.85),
        paintedMat(0x445566)
    );
    armL.position.set(-0.9, 0.3, 0);
    const armR = armL.clone();
    armR.position.x = 0.9;
    g.add(seat, back, armL, armR);
    return g;
}

function chair(_color: number): Object3D {
    const g = new Group();
    const seat = new Mesh(
        new BoxGeometry(0.5, 0.06, 0.5),
        paintedMat(0x9b8060)
    );
    seat.position.y = 0.45;
    const back = new Mesh(
        new BoxGeometry(0.5, 0.5, 0.06),
        paintedMat(0x9b8060)
    );
    back.position.set(0, 0.72, -0.22);
    for (const [x, z] of [
        [-0.22, -0.22],
        [0.22, -0.22],
        [-0.22, 0.22],
        [0.22, 0.22]
    ]) {
        const leg = new Mesh(
            new CylinderGeometry(0.025, 0.025, 0.45, 6),
            paintedMat(0x6b4a2a)
        );
        leg.position.set(x, 0.225, z);
        g.add(leg);
    }
    g.add(seat, back);
    return g;
}

function table(_color: number): Object3D {
    const g = new Group();
    const top = new Mesh(new BoxGeometry(1.4, 0.06, 0.8), paintedMat(0x9b8060));
    top.position.y = 0.72;
    for (const [x, z] of [
        [-0.65, -0.35],
        [0.65, -0.35],
        [-0.65, 0.35],
        [0.65, 0.35]
    ]) {
        const leg = new Mesh(
            new BoxGeometry(0.05, 0.7, 0.05),
            paintedMat(0x6b4a2a)
        );
        leg.position.set(x, 0.36, z);
        g.add(leg);
    }
    g.add(top);
    return g;
}

function bed(_color: number): Object3D {
    const g = new Group();
    const frame = new Mesh(
        new BoxGeometry(1.6, 0.4, 2.1),
        paintedMat(0x6b4a2a)
    );
    frame.position.y = 0.2;
    const mattress = new Mesh(
        new BoxGeometry(1.5, 0.2, 2.0),
        paintedMat(0xeeeeee)
    );
    mattress.position.y = 0.5;
    const pillow = new Mesh(
        new BoxGeometry(1.4, 0.12, 0.4),
        paintedMat(0xffffff)
    );
    pillow.position.set(0, 0.66, -0.7);
    const headboard = new Mesh(
        new BoxGeometry(1.6, 0.7, 0.08),
        paintedMat(0x4a3018)
    );
    headboard.position.set(0, 0.55, -1.05);
    g.add(frame, mattress, pillow, headboard);
    return g;
}

function bookshelf(_color: number): Object3D {
    const g = new Group();
    const back = new Mesh(
        new BoxGeometry(0.9, 2.0, 0.04),
        paintedMat(0x6b4a2a)
    );
    back.position.set(0, 1.0, -0.18);
    const sideL = new Mesh(
        new BoxGeometry(0.04, 2.0, 0.4),
        paintedMat(0x6b4a2a)
    );
    sideL.position.set(-0.45, 1.0, 0);
    const sideR = sideL.clone();
    sideR.position.x = 0.45;
    g.add(back, sideL, sideR);
    for (let i = 0; i < 4; i++) {
        const shelf = new Mesh(
            new BoxGeometry(0.9, 0.04, 0.4),
            paintedMat(0x6b4a2a)
        );
        shelf.position.y = 0.4 + i * 0.5;
        g.add(shelf);
    }
    return g;
}

function window(_color: number): Object3D {
    const g = new Group();
    const frame = new Mesh(
        new BoxGeometry(1.2, 1.4, 0.06),
        paintedMat(0xeeeeee)
    );
    const glass = new Mesh(
        new BoxGeometry(1.1, 1.3, 0.04),
        paintedMat(0xaaccdd)
    );
    const cross = new Mesh(
        new BoxGeometry(1.1, 0.04, 0.05),
        paintedMat(0xeeeeee)
    );
    const vCross = new Mesh(
        new BoxGeometry(0.04, 1.3, 0.05),
        paintedMat(0xeeeeee)
    );
    g.add(frame, glass, cross, vCross);
    return g;
}

// ───── REGISTRY ─────────────────────────────────────────────────────

export const FIXTURE_REGISTRY: Record<FixtureKind, FixtureSpec> = {
    // Lighting (ceiling-mounted at WALL_HEIGHT; floor/table at 0)
    'ceiling-light': {
        kind: 'ceiling-light',
        label: 'Ceiling light',
        category: 'lighting',
        mountY: 4.5,
        buildPrimitive: ceilingLight
    },
    pendant: {
        kind: 'pendant',
        label: 'Pendant',
        category: 'lighting',
        mountY: 4.5,
        buildPrimitive: pendant
    },
    spotlight: {
        kind: 'spotlight',
        label: 'Spotlight',
        category: 'lighting',
        mountY: 4.5,
        buildPrimitive: spotlight
    },
    'floor-lamp': {
        kind: 'floor-lamp',
        label: 'Floor lamp',
        category: 'lighting',
        mountY: 0,
        buildPrimitive: floorLamp
    },
    'table-lamp': {
        kind: 'table-lamp',
        label: 'Table lamp',
        category: 'lighting',
        mountY: 0,
        buildPrimitive: tableLamp
    },
    'wall-sconce': {
        kind: 'wall-sconce',
        label: 'Wall sconce',
        category: 'lighting',
        mountY: 2.2,
        buildPrimitive: wallSconce
    },
    'led-strip': {
        kind: 'led-strip',
        label: 'LED strip',
        category: 'lighting',
        mountY: 4.4,
        buildPrimitive: ledStrip
    },
    // HVAC
    'ac-wall': {
        kind: 'ac-wall',
        label: 'Wall AC',
        category: 'hvac',
        mountY: 3.0,
        buildPrimitive: acWall
    },
    'ac-ceiling': {
        kind: 'ac-ceiling',
        label: 'Ceiling AC',
        category: 'hvac',
        mountY: 4.4,
        buildPrimitive: acCeiling
    },
    radiator: {
        kind: 'radiator',
        label: 'Radiator',
        category: 'hvac',
        mountY: 0.4,
        buildPrimitive: radiator
    },
    'ceiling-fan': {
        kind: 'ceiling-fan',
        label: 'Ceiling fan',
        category: 'hvac',
        mountY: 4.3,
        buildPrimitive: ceilingFan
    },
    thermostat: {
        kind: 'thermostat',
        label: 'Thermostat',
        category: 'hvac',
        mountY: 1.5,
        buildPrimitive: thermostat
    },
    vent: {
        kind: 'vent',
        label: 'Vent',
        category: 'hvac',
        mountY: 4.4,
        buildPrimitive: vent
    },
    // Appliances (floor-standing)
    fridge: {
        kind: 'fridge',
        label: 'Fridge',
        category: 'appliance',
        mountY: 0,
        buildPrimitive: fridge
    },
    oven: {
        kind: 'oven',
        label: 'Oven',
        category: 'appliance',
        mountY: 0,
        buildPrimitive: oven
    },
    dishwasher: {
        kind: 'dishwasher',
        label: 'Dishwasher',
        category: 'appliance',
        mountY: 0,
        buildPrimitive: dishwasher
    },
    microwave: {
        kind: 'microwave',
        label: 'Microwave',
        category: 'appliance',
        mountY: 1.0,
        buildPrimitive: microwave
    },
    'washing-machine': {
        kind: 'washing-machine',
        label: 'Washing machine',
        category: 'appliance',
        mountY: 0,
        buildPrimitive: washingMachine
    },
    dryer: {
        kind: 'dryer',
        label: 'Dryer',
        category: 'appliance',
        mountY: 0,
        buildPrimitive: dryer
    },
    // Solar
    'solar-panel': {
        kind: 'solar-panel',
        label: 'Solar panel',
        category: 'solar',
        mountY: 5.0,
        buildPrimitive: solarPanel
    },
    'solar-inverter': {
        kind: 'solar-inverter',
        label: 'Solar inverter',
        category: 'solar',
        mountY: 1.5,
        buildPrimitive: solarInverter
    },
    'battery-wall': {
        kind: 'battery-wall',
        label: 'Battery wall',
        category: 'solar',
        mountY: 0,
        buildPrimitive: batteryWall
    },
    // Smart fixtures
    doorbell: {
        kind: 'doorbell',
        label: 'Doorbell',
        category: 'smart',
        mountY: 1.4,
        buildPrimitive: doorbell
    },
    'smoke-detector': {
        kind: 'smoke-detector',
        label: 'Smoke detector',
        category: 'smart',
        mountY: 4.5,
        buildPrimitive: smokeDetector
    },
    'motion-sensor': {
        kind: 'motion-sensor',
        label: 'Motion sensor',
        category: 'smart',
        mountY: 4.5,
        buildPrimitive: motionSensor
    },
    'smart-blind': {
        kind: 'smart-blind',
        label: 'Smart blind',
        category: 'smart',
        mountY: 2.4,
        buildPrimitive: smartBlind
    },
    'smart-curtain': {
        kind: 'smart-curtain',
        label: 'Smart curtain',
        category: 'smart',
        mountY: 2.4,
        buildPrimitive: smartCurtain
    },
    // Wall controls
    'wall-outlet': {
        kind: 'wall-outlet',
        label: 'Wall outlet',
        category: 'control',
        mountY: 0.4,
        buildPrimitive: wallOutlet
    },
    'wall-switch': {
        kind: 'wall-switch',
        label: 'Wall switch',
        category: 'control',
        mountY: 1.2,
        buildPrimitive: wallSwitch
    },
    // Lighting extras
    chandelier: {
        kind: 'chandelier',
        label: 'Chandelier',
        category: 'lighting',
        mountY: 4.2,
        buildPrimitive: chandelier
    },
    'street-light': {
        kind: 'street-light',
        label: 'Street light',
        category: 'lighting',
        mountY: 0,
        buildPrimitive: streetLight
    },
    // HVAC extras
    'water-heater': {
        kind: 'water-heater',
        label: 'Water heater',
        category: 'hvac',
        mountY: 0,
        buildPrimitive: waterHeater
    },
    // Smart extras
    houseplant: {
        kind: 'houseplant',
        label: 'Houseplant',
        category: 'smart',
        mountY: 0,
        buildPrimitive: houseplant
    },
    // Entertainment
    tv: {
        kind: 'tv',
        label: 'TV',
        category: 'entertainment',
        mountY: 1.3,
        buildPrimitive: tv
    },
    monitor: {
        kind: 'monitor',
        label: 'Monitor',
        category: 'entertainment',
        mountY: 0.85,
        buildPrimitive: monitor
    },
    computer: {
        kind: 'computer',
        label: 'Computer',
        category: 'entertainment',
        mountY: 0.7,
        buildPrimitive: computer
    },
    // Smart access
    'smart-lock': {
        kind: 'smart-lock',
        label: 'Smart lock',
        category: 'access',
        mountY: 1.0,
        buildPrimitive: smartLock
    },
    door: {
        kind: 'door',
        label: 'Door',
        category: 'access',
        mountY: 0,
        buildPrimitive: door
    },
    garage: {
        kind: 'garage',
        label: 'Garage door',
        category: 'access',
        mountY: 0,
        buildPrimitive: garage
    },
    // Furniture (context)
    sofa: {
        kind: 'sofa',
        label: 'Sofa',
        category: 'furniture',
        mountY: 0,
        buildPrimitive: sofa
    },
    chair: {
        kind: 'chair',
        label: 'Chair',
        category: 'furniture',
        mountY: 0,
        buildPrimitive: chair
    },
    table: {
        kind: 'table',
        label: 'Table',
        category: 'furniture',
        mountY: 0,
        buildPrimitive: table
    },
    bed: {
        kind: 'bed',
        label: 'Bed',
        category: 'furniture',
        mountY: 0,
        buildPrimitive: bed
    },
    bookshelf: {
        kind: 'bookshelf',
        label: 'Bookshelf',
        category: 'furniture',
        mountY: 0,
        buildPrimitive: bookshelf
    },
    window: {
        kind: 'window',
        label: 'Window',
        category: 'furniture',
        mountY: 1.5,
        buildPrimitive: window
    }
};

// Grouped by category for palette UI.
export const FIXTURES_BY_CATEGORY: Record<FixtureCategory, FixtureSpec[]> =
    (() => {
        const map: Record<FixtureCategory, FixtureSpec[]> = {
            lighting: [],
            hvac: [],
            appliance: [],
            solar: [],
            smart: [],
            control: [],
            entertainment: [],
            access: [],
            furniture: []
        };
        for (const spec of Object.values(FIXTURE_REGISTRY)) {
            map[spec.category].push(spec);
        }
        return map;
    })();

export function getFixture(kind: FixtureKind | undefined): FixtureSpec | null {
    if (!kind) return null;
    return FIXTURE_REGISTRY[kind] ?? null;
}

/** Try /3d/fixtures/{kind}.glb, fall back to the primitive builder.
 *  Drop CC0 GLBs into frontend/public/3d/fixtures/ to upgrade visuals
 *  without code changes. */
export function fixtureGlbPath(kind: FixtureKind): string {
    return `/3d/fixtures/${kind}.glb`;
}

// Module-level cache for re-used primitive geometries (one per kind).
const PRIMITIVE_CACHE = new Map<FixtureKind, Object3D>();

// Loaded glTF cache. When a GLB exists at /3d/fixtures/{kind}.glb,
// async-load it once and re-use the parsed scene; clone per fixture.
const GLB_CACHE = new Map<FixtureKind, Object3D>();
const GLB_PENDING = new Set<FixtureKind>();
const GLB_READY_LISTENERS = new Set<() => void>();
const glbLoader = new GLTFLoader();

// GLB mesh-name pattern for the fixture's state indicator.
const INDICATOR_NAME_RE =
    /\b(bulb|led|light|indicator|glow|lamp|screen|display|emissive|lens)\b/i;

/** Subscribe to "a fixture GLB became available" — used by the scene
 *  renderer to re-run updateDevices so cached GLBs swap in for any
 *  fixture that was rendering its primitive fallback. */
export function onFixtureGlbReady(cb: () => void): () => void {
    GLB_READY_LISTENERS.add(cb);
    return () => GLB_READY_LISTENERS.delete(cb);
}

function startGlbLoad(kind: FixtureKind): void {
    if (GLB_CACHE.has(kind) || GLB_PENDING.has(kind)) return;
    GLB_PENDING.add(kind);
    glbLoader.load(
        fixtureGlbPath(kind),
        (gltf) => {
            GLB_CACHE.set(kind, gltf.scene);
            GLB_PENDING.delete(kind);
            for (const cb of GLB_READY_LISTENERS) cb();
        },
        undefined,
        () => {
            // 404 / decode failure — silent fallback to primitive. No
            // log because missing files are an expected state.
            GLB_PENDING.delete(kind);
        }
    );
}

export function buildFixtureMesh(kind: FixtureKind, color: number): Object3D {
    // Cached GLB wins — clone the parsed scene tree.
    const glb = GLB_CACHE.get(kind);
    if (glb) {
        const cloned = glb.clone(true);
        tagGlbIndicators(cloned, color);
        return cloned;
    }

    // Otherwise kick off the async load (no-op if already in-flight or
    // confirmed missing) and return the primitive immediately.
    startGlbLoad(kind);
    const cached = PRIMITIVE_CACHE.get(kind);
    const built = cached
        ? cached.clone(true)
        : FIXTURE_REGISTRY[kind].buildPrimitive(color);
    if (!cached) PRIMITIVE_CACHE.set(kind, built);
    tagPrimitiveIndicators(built);
    return cached ? built : built.clone(true);
}

// Mark emissive-built meshes so applyFixtureState finds them.
function tagPrimitiveIndicators(root: Object3D): void {
    root.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const mat = child.material;
        if (Array.isArray(mat) || !(mat instanceof MeshStandardMaterial))
            return;
        if (mat.emissive.getHex() === 0x000000) return;
        child.userData.indicator = true;
    });
}

// Upgrade GLB indicator-named meshes to emissive-capable materials.
function tagGlbIndicators(root: Object3D, color: number): void {
    const c = new Color(color);
    root.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        if (!INDICATOR_NAME_RE.test(child.name || '')) return;
        child.userData.indicator = true;
        const mat = child.material;
        if (Array.isArray(mat)) return;
        if (mat instanceof MeshStandardMaterial) {
            mat.emissive.copy(c);
            mat.emissiveIntensity = 0;
            return;
        }
        // Swap non-standard material for one that supports emissive.
        const base = (mat as MeshStandardMaterial & {color?: Color}).color;
        child.material = new MeshStandardMaterial({
            color: base?.clone() ?? new Color(0xffffff),
            roughness: 0.4,
            metalness: 0.1,
            emissive: c,
            emissiveIntensity: 0
        });
    });
}

// Geometry-only export for InstancedMesh integration (Phase E).
export function buildFixtureGeometry(_kind: FixtureKind): BufferGeometry {
    return new BufferGeometry();
}

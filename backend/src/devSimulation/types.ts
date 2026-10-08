export type JsonObject = Record<string, unknown>;

export interface SimulatorComponent {
    key: string;
    config: JsonObject;
    status: JsonObject;
}

export interface DeviceProfile {
    key: string;
    displayName: string;
    idPrefix: string;
    macPrefix: string;
    sourcePaths: readonly string[];
    initialNotificationMethod: 'NotifyFullStatus' | 'NotifyStatus';
    info: JsonObject;
    methods: readonly string[];
    profiles?: JsonObject;
    config: Record<string, JsonObject>;
    status: Record<string, JsonObject>;
}

/** Cold-chain hardware a deployment has paired to a fixture's controller.
 *
 *  A relay measures no air and watches no door, so a store puts BLU sensors in
 *  the fixture and lets the controller relay them. Recording the resulting
 *  component keys here is what stops the telemetry tick guessing: it drives the
 *  sensors the install declares instead of inferring "this must be a fridge"
 *  from how cold a reading is. */
export interface ColdChainFitment {
    /** Status key the case air arrives on — a relayed BLU H&T sensor. */
    probeComponent: string;
    /** Numeric field inside that component. */
    probeField: string;
    /** Status key of the door contact — a relayed BLU Door/Window sensor.
     *  Absent on a fixture whose door nobody instrumented: a walk-in room's
     *  door is a builder's door, not a case lid with a reed on it. */
    doorComponent?: string;
    /** Boolean field inside that component. */
    doorField?: string;
    /** Air temperature the fixture is holding, °C. */
    setpointC: number;
}

/** Occupancy, access and fire sensors a scenario drives on a device.
 *
 *  Same reason as ColdChainFitment: naming the component keys is what stops the
 *  telemetry tick guessing which relayed sensor watches a shop aisle and which
 *  is a stock device that happens to carry the same component. Each field is
 *  read on the one field its component type defines — a BTHome sensor reports
 *  `value`, an Input reports `state`, a Smoke component reports `alarm`. */
export interface PremisesFitment {
    /** BTHome sensor key a relayed BLU Motion broadcasts motion on. */
    motionComponent?: string;
    /** Input key an add-on digital contact reports a door/window state on. */
    contactComponent?: string;
    /** Smoke key the device raises its fire alarm on. */
    smokeComponent?: string;
}

export interface ExpandedDeviceProfile extends DeviceProfile {
    ordinal: number;
    shellyID: string;
    mac: string;
    /** Set only on a controller a scenario has fitted cold-chain hardware to. */
    fixture?: ColdChainFitment;
    /** Set only on a device a scenario has fitted premises sensors to. */
    premises?: PremisesFitment;
    /** Set only on a meter a scenario has clamped on a PV array. Carries the
     *  array's own seed, so the same roof keeps the same soiling all year. */
    solar?: SolarArrayFitment;
}

/** A meter reading a photovoltaic array rather than a load. */
export interface SolarArrayFitment {
    unitSeed: number;
    /** Component whose act_power the array's output is written to. */
    generationComponent: string;
    /** Metered channels that are NOT the array, held at zero: a spare CT left
     *  at its profile baseline reports a load the site has not got, on the very
     *  meter the Solar page reads. */
    spareComponents: readonly string[];
}

export interface ExpandProfileOptions {
    profiles?: readonly string[];
    count?: number;
    firstOrdinal?: number;
}

export interface SimulatorRpcRequest {
    id: number | string;
    method: string;
    params?: JsonObject | null;
    src?: string;
}

export interface SimulatorRpcError {
    code: number;
    message: string;
}

export interface SimulatorRpcResponse {
    id: number | string;
    src: string;
    dst?: string;
    result?: unknown;
    error?: SimulatorRpcError;
}

export interface SimulatorNotification {
    method: 'NotifyEvent' | 'NotifyFullStatus' | 'NotifyStatus';
    src: string;
    params: JsonObject;
}

export interface SimulatorRpcResult {
    response: SimulatorRpcResponse;
    notifications: SimulatorNotification[];
}

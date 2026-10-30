// Adapted from deck.gl TripsLayer 9.4.0.
// Upstream source: https://github.com/visgl/deck.gl/tree/5eded84b438eef83387dc6579c51670389053602/modules/geo-layers/src/trips-layer
// Copyright Vis.gl contributors.
// SPDX-License-Identifier: MIT
// See map-trips-layer.LICENSE for the complete upstream license notice.

import {
    createIterable,
    type AccessorFunction,
    type Attribute,
    type DefaultProps
} from '@deck.gl/core';
import {PathLayer, type PathLayerProps} from '@deck.gl/layers';

type NumericArray = ArrayLike<number>;

type TripsUniformProps = {
    fadeTrail: boolean;
    trailLength: number;
    currentTime: number;
};

const tripsUniforms = {
    name: 'trips',
    source: /* wgsl */ `\
struct TripsUniforms {
  fadeTrail: f32,
  trailLength: f32,
  currentTime: f32,
};

@group(0) @binding(auto)
var<uniform> trips: TripsUniforms;
`,
    vs: `\
layout(std140) uniform tripsUniforms {
  bool fadeTrail;
  float trailLength;
  float currentTime;
} trips;
`,
    fs: `\
layout(std140) uniform tripsUniforms {
  bool fadeTrail;
  float trailLength;
  float currentTime;
} trips;
`,
    uniformTypes: {
        fadeTrail: 'f32',
        trailLength: 'f32',
        currentTime: 'f32'
    }
} as const;

function packTripTimestamps(
    timestamps: NumericArray,
    instanceCount: number = timestamps.length,
    isLoop = false
): Float32Array {
    const packedTimestamps = new Float32Array(instanceCount * 2);

    if (timestamps.length === 0) return packedTimestamps;

    const isClosed = instanceCount > timestamps.length;
    const cycleLength = isLoop
        ? timestamps.length
        : Math.max(timestamps.length - 1, 1);

    for (let index = 0; index < instanceCount; index++) {
        const timestampIndex = isClosed
            ? index % cycleLength
            : Math.min(index, timestamps.length - 1);
        const nextTimestampIndex = isClosed
            ? (timestampIndex + 1) % cycleLength
            : Math.min(timestampIndex + 1, timestamps.length - 1);

        packedTimestamps[index * 2] = timestamps[timestampIndex];
        packedTimestamps[index * 2 + 1] = timestamps[nextTimestampIndex];
    }

    return packedTimestamps;
}

const tripsShaderInjectionsWGSL = {
    '  @location(12) rowIndexes: u32,': /* wgsl */ `
  @location(13) instanceTimestamps: vec2<f32>,`,
    '  @location(5) vJointType: f32,': /* wgsl */ `
  @location(6) vTime: f32,`,
    '    attributes.instanceColors.a * layer.opacity\n  );': /* wgsl */ `

  varyings.vTime = mix(
    attributes.instanceTimestamps.x,
    attributes.instanceTimestamps.y,
    varyings.vPathPosition.y / varyings.vPathLength
  );

  if (trips.fadeTrail > 0.5) {
    varyings.vColor.a *=
      1.0 - (trips.currentTime - varyings.vTime) / trips.trailLength;
  }`,
    '  // DECKGL_FILTER_COLOR': /* wgsl */ `
  if (
    varyings.vTime > trips.currentTime ||
    (trips.fadeTrail > 0.5 && varyings.vTime < trips.currentTime - trips.trailLength)
  ) {
    discard;
  }`
} as const;

const tripsShaderInjectionsGLSL = {
    'vs:#decl': `\
in float instanceTimestamps;
in float instanceNextTimestamps;
out float vTime;
`,
    'vs:#main-end': `\
vTime = instanceTimestamps + (instanceNextTimestamps - instanceTimestamps) * vPathPosition.y / vPathLength;
`,
    'fs:#decl': `\
in float vTime;
`,
    'fs:DECKGL_FILTER_COLOR': `\
if(vTime > trips.currentTime || (trips.fadeTrail && (vTime < trips.currentTime - trips.trailLength))) {
  discard;
}
if(trips.fadeTrail) {
  color.a *= 1.0 - (trips.currentTime - vTime) / trips.trailLength;
}
`
} as const;

type TripsLayerOnlyProps<DataT = unknown> = {
    fadeTrail?: boolean;
    trailLength?: number;
    currentTime?: number;
    getTimestamps?: AccessorFunction<DataT, NumericArray>;
};

export type TripsLayerProps<DataT = unknown> = TripsLayerOnlyProps<DataT> &
    PathLayerProps<DataT>;

const defaultProps: DefaultProps<TripsLayerProps> = {
    fadeTrail: true,
    trailLength: {type: 'number', value: 120, min: 0},
    currentTime: {type: 'number', value: 0, min: 0},
    getTimestamps: {type: 'accessor', value: (d: any) => d.timestamps}
};

/** TripsLayer without the geo-layers package's unrelated 3D/GLTF loaders. */
export class TripsLayer<DataT = any> extends PathLayer<
    DataT,
    Required<TripsLayerOnlyProps<DataT>>
> {
    static layerName = 'TripsLayer';
    static defaultProps = defaultProps;

    getShaders() {
        const shaders = super.getShaders();
        shaders.inject =
            this.context.device.type === 'webgpu'
                ? tripsShaderInjectionsWGSL
                : tripsShaderInjectionsGLSL;
        shaders.modules = [...shaders.modules, tripsUniforms];
        return shaders;
    }

    initializeState() {
        super.initializeState();

        this.getAttributeManager()!.addInstanced({
            ...(this.context.device.type === 'webgpu'
                ? {
                      instanceTimestamps: {
                          size: 2,
                          accessor: 'getTimestamps',
                          update: this.calculateWebGPUTimestamps,
                          bufferGroup: 'path-instance-data'
                      }
                  }
                : {
                      timestamps: {
                          size: 1,
                          accessor: 'getTimestamps',
                          shaderAttributes: {
                              instanceTimestamps: {vertexOffset: 0},
                              instanceNextTimestamps: {vertexOffset: 1}
                          }
                      }
                  })
        });
    }

    protected calculateWebGPUTimestamps(
        attribute: Attribute,
        {data, props}: {data: TripsLayerProps<DataT>['data']; props: TripsLayerProps<DataT>}
    ): void {
        const {pathTesselator} = this.state;
        const {instanceCount, vertexStarts} = pathTesselator;
        const packedTimestamps = new Float32Array(instanceCount * 2);
        const {iterable, objectInfo} = createIterable(data);

        for (const object of iterable) {
            objectInfo.index++;

            const vertexStart = vertexStarts[objectInfo.index];
            const vertexEnd = vertexStarts[objectInfo.index + 1] ?? instanceCount;
            if (vertexEnd <= vertexStart) continue;

            const timestamps = props.getTimestamps?.(object, objectInfo) ?? [];
            packedTimestamps.set(
                packTripTimestamps(
                    timestamps,
                    vertexEnd - vertexStart,
                    props._pathType === 'loop'
                ),
                vertexStart * 2
            );
        }

        attribute.startIndices = vertexStarts;
        attribute.value = packedTimestamps;
    }

    draw(params: Parameters<PathLayer<DataT>['draw']>[0]) {
        const {fadeTrail, trailLength, currentTime} = this.props;
        const tripsProps: TripsUniformProps = {
            fadeTrail,
            trailLength,
            currentTime
        };

        this.state.model!.shaderInputs.setProps({trips: tripsProps});
        super.draw(params);
    }
}

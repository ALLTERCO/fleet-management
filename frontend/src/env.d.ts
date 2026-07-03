import type {ObsLevel} from '@/tools/observability';

declare global {
    interface Window {
        __FM_RUNTIME_CONFIG__?: {
            devMode?: boolean;
            oidc?: {
                authority?: string;
                client_id?: string;
                project_resource_id?: string;
                redirect_uri?: string;
                metadata?: {
                    issuer?: string;
                    token_endpoint?: string;
                };
                [key: string]: any;
            };
            obs_level?: number;
            observability?: boolean;
            debugDefault?: boolean;
            perfTracing?: boolean;
            rpcBaseUrl?: string;
            wsBaseUrl?: string;
            nodeRedEnabled?: boolean;
            nodeRedUrl?: string;
            nodeRedSessionUrl?: string;
            logBufferMax?: number;
            logCategoryMax?: number;
            auditPageSize?: number;
            swUpdatePollIntervalMs?: number;
            zitadelPasswordMinLength?: number;
            mapStyleUrl?: string;
            mapSinglePinZoom?: number;
            mapDetailZoom?: number;
            mapFitPaddingPx?: number;
            mapFitMaxZoom?: number;
            mapFlyDurationMs?: number;
            map3dPitchDeg?: number;
            mapExtrusionMinZoom?: number;
            floorPlanHeightPx?: number;
            floorPlanMobileHeightPx?: number;
            floorPlan3dPlanSize?: number;
            floorPlan3dWallHeight?: number;
            floorPlan3dWallOpacity?: number;
            floorPlan3dPinHeight?: number;
            floorPlan3dPinRadius?: number;
            floorPlan3dCameraFov?: number;
            floorPlan3dCameraHeight?: number;
            floorPlan3dCameraDist?: number;
            floorPlan3dOrbitMinDist?: number;
            floorPlan3dOrbitMaxDist?: number;
            floorPlan3dOrbitDamping?: number;
            floorPlan3dClickThresholdPx?: number;
            floorPlan3dAmbientIntensity?: number;
            floorPlan3dKeyIntensity?: number;
            floorPlan3dFillIntensity?: number;
            floorPlan3dMaxPolarRatio?: number;
            floorPlan3dPixelRatioCap?: number;
            floorPlan3dLabelOpacity?: number;
            floorPlan3dLabelOffsetY?: number;
            floorPlan3dNearPlane?: number;
            floorPlan3dFarPlane?: number;
            floorPlan3dHoverScale?: number;
            floorPlan3dHoverEmissiveBoost?: number;
            floorPlan3dHoverLerp?: number;
            floorPlan3dClickFlashMs?: number;
            floorPlan3dDblclickMs?: number;
            floorPlan3dFlytoMs?: number;
            floorPlan3dIdleOrbitMs?: number;
            floorPlan3dAutoOrbitRadPerSec?: number;
            floorPlan3dInstanceThreshold?: number;
            replayTrailLengthSec?: number;
            mapOverviewZoom?: number;
            mapPitchEaseDurationMs?: number;
            topologyAnimationDurationMs?: number;
            topologyNodeRepulsion?: number;
            topologyIdealEdgeLength?: number;
            topologyEdgeElasticity?: number;
            topologyGravity?: number;
            topologyTile?: boolean;
            ui?: {
                nowTickerMs?: number;
                listSkeletonCount?: number;
                urlSyncDebounceMs?: number;
                duplicateCheckDebounceMs?: number;
                templatePreviewDebounceMs?: number;
                optimisticFlashMs?: number;
                optimisticReconcileTimeoutMs?: number;
                optimisticReaperMs?: number;
                firingsPageSize?: number;
                groupActivityPageSize?: number;
                alertTimer?: {
                    critical?: {amberMins?: number; dangerMins?: number};
                    warning?: {amberMins?: number; dangerMins?: number};
                    info?: {amberMins?: number; dangerMins?: number};
                };
                silence?: {
                    presetMinutes?: number[];
                    tomorrowHour?: number;
                };
                search?: {
                    threshold?: number;
                    ignoreLocation?: boolean;
                };
                toast?: {
                    defaultMs?: number;
                    actionMs?: number;
                    maxStack?: number;
                };
                shortcuts?: Record<string, string>;
            };
            [key: string]: any;
        };
        fmObservability?: (level: ObsLevel) => void;
        fmDebug?: (enabled: boolean) => void;
    }
}

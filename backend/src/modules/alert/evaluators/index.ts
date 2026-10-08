/**
 * Evaluator registry. The engine walks every rule and delegates to the
 * evaluator that claims its kind. Adding a new rule_kind is a one-line
 * registration here plus a new file — no `switch` statement to keep in
 * sync.
 */
import type {AlertRuleKind} from '../../../types/api/alert';
import type {Evaluator} from '../types';
import {anomalyBandEvaluator} from './anomalyBand';
import {approachingNewPeakEvaluator} from './approachingNewPeak';
import {automationRunFailedEvaluator} from './automationRunFailed';
import {backupOperationFailedEvaluator} from './backupOperationFailed';
import {batteryBelowEvaluator} from './batteryBelow';
import {changeEventEvaluator} from './changeEvent';
import {componentStateEvaluator} from './componentState';
import {componentThresholdEvaluator} from './componentThreshold';
import {compositeEvaluator} from './composite';
import {credentialExpiringEvaluator} from './credentialExpiring';
import {deviceBackOnlineEvaluator} from './deviceBackOnline';
import {deviceEventEvaluator} from './deviceEvent';
import {deviceOfflineEvaluator} from './deviceOffline';
import {energyConsumptionThresholdEvaluator} from './energyConsumptionThreshold';
import {firmwareOperationFailedEvaluator} from './firmwareOperationFailed';
import {floodAlarmEvaluator} from './floodAlarm';
import {grafanaAlertEvaluator} from './grafanaAlert';
import {heartbeatEvaluator} from './heartbeat';
import {motionDetectedEvaluator} from './motionDetected';
import {rateOfChangeEvaluator} from './rateOfChange';
import {recordIncompleteEvaluator} from './recordIncomplete';
import {smokeAlarmEvaluator} from './smokeAlarm';
import {stuckSensorEvaluator} from './stuckSensor';
import {systemHealthEvaluator} from './systemHealth';

const EVALUATORS: Partial<Record<AlertRuleKind, Evaluator>> = {
    device_offline: deviceOfflineEvaluator,
    device_back_online: deviceBackOnlineEvaluator,
    battery_below: batteryBelowEvaluator,
    smoke_alarm: smokeAlarmEvaluator,
    flood_alarm: floodAlarmEvaluator,
    motion_detected: motionDetectedEvaluator,
    component_threshold: componentThresholdEvaluator,
    component_state: componentStateEvaluator,
    firmware_operation_failed: firmwareOperationFailedEvaluator,
    backup_operation_failed: backupOperationFailedEvaluator,
    automation_run_failed: automationRunFailedEvaluator,
    grafana_alert: grafanaAlertEvaluator,
    heartbeat: heartbeatEvaluator,
    energy_consumption_threshold: energyConsumptionThresholdEvaluator,
    record_incomplete: recordIncompleteEvaluator,
    approaching_new_peak: approachingNewPeakEvaluator,
    rate_of_change: rateOfChangeEvaluator,
    stuck_sensor: stuckSensorEvaluator,
    composite: compositeEvaluator,
    anomaly_band: anomalyBandEvaluator,
    change_event: changeEventEvaluator,
    device_event: deviceEventEvaluator,
    credential_expiring: credentialExpiringEvaluator,
    system_health: systemHealthEvaluator
};

export function getEvaluator(kind: AlertRuleKind): Evaluator | undefined {
    return EVALUATORS[kind];
}

export function registeredKinds(): AlertRuleKind[] {
    return Object.keys(EVALUATORS) as AlertRuleKind[];
}

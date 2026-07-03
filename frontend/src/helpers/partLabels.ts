const NAMES: Record<string, string> = {
  power: 'Power', total_act_energy: 'Energy', total_act_ret_energy: 'Exported energy',
  voltage: 'Voltage', current: 'Current', switch: 'Switch', relay: 'Switch',
  temperature: 'Temperature', humidity: 'Humidity', cover: 'Cover',
  light: 'Light', opening: 'Open / closed', battery: 'Battery',
  energy: 'Energy', alarm: 'Alarm', tamper: 'Tamper', running: 'Running',
  co2: 'CO2', tvoc: 'TVOC', occupancy: 'Occupancy', motion: 'Motion',
  pressure: 'Pressure', rain: 'Rain', leak: 'Leak', valve: 'Valve',
  gas: 'Gas', carbon_monoxide: 'Carbon monoxide', garage_door: 'Garage door',
  lock: 'Lock', button: 'Button', actuator: 'Actuator', charging: 'Charging',
};
const VISUAL: Record<string, {icon: string; accent: string}> = {
  power: {icon: 'fa-bolt', accent: 'energy'}, total_act_energy: {icon: 'fa-gauge-high', accent: 'energy'},
  voltage: {icon: 'fa-plug', accent: 'switch'}, current: {icon: 'fa-wave-square', accent: 'switch'},
  switch: {icon: 'fa-power-off', accent: 'switch'}, relay: {icon: 'fa-power-off', accent: 'switch'},
  temperature: {icon: 'fa-temperature-half', accent: 'temp'}, humidity: {icon: 'fa-droplet', accent: 'humidity'},
  light: {icon: 'fa-lightbulb', accent: 'switch'}, opening: {icon: 'fa-door-open', accent: 'switch'},
  battery: {icon: 'fa-battery-half', accent: 'generic'}, energy: {icon: 'fa-gauge-high', accent: 'energy'},
  alarm: {icon: 'fa-triangle-exclamation', accent: 'generic'}, tamper: {icon: 'fa-hand', accent: 'generic'},
  running: {icon: 'fa-play', accent: 'generic'}, co2: {icon: 'fa-wind', accent: 'temp'},
  tvoc: {icon: 'fa-flask', accent: 'temp'}, occupancy: {icon: 'fa-person-walking', accent: 'generic'},
  motion: {icon: 'fa-person-running', accent: 'generic'}, pressure: {icon: 'fa-gauge', accent: 'temp'},
  rain: {icon: 'fa-cloud-rain', accent: 'humidity'}, leak: {icon: 'fa-droplet', accent: 'humidity'},
  valve: {icon: 'fa-faucet', accent: 'switch'}, gas: {icon: 'fa-triangle-exclamation', accent: 'generic'},
  carbon_monoxide: {icon: 'fa-skull-crossbones', accent: 'generic'}, garage_door: {icon: 'fa-warehouse', accent: 'switch'},
  lock: {icon: 'fa-lock', accent: 'generic'}, button: {icon: 'fa-hand-pointer', accent: 'generic'},
  actuator: {icon: 'fa-power-off', accent: 'switch'}, charging: {icon: 'fa-charging-station', accent: 'energy'},
};
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export function humaniseLabel(c: {componentType: string; label?: string | null}): string {
  if (c.label && c.label.trim()) return c.label.trim();
  return NAMES[c.componentType] ?? titleCase(c.componentType);
}
export function partVisual(componentType: string): {icon: string; accent: string} {
  return VISUAL[componentType] ?? {icon: 'fa-microchip', accent: 'generic'};
}

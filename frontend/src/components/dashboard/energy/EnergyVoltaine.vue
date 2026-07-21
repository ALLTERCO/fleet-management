<template>
  <div class="evolt" :class="{cold: !view.config.tariff}" ref="rootEl">
<div class="toolbar">
  <div class="seg" role="tablist">
    <button class="on" data-t="overview" role="tab">Overview</button>
    <button data-t="power" role="tab">Power &amp; Quality</button>
    <button data-t="energy" role="tab">Energy &amp; Patterns</button>
    <button data-t="devices" role="tab">Devices</button>
    <button v-if="view.config.solar" data-t="solar" role="tab">{{ assetsTabLabel }}</button>
    <button data-t="insights" role="tab">Carbon &amp; Insights</button>
  </div>
  <DashVoltaineTools
    :range-label="view.meta.rangeLabel"
    :refresh-interval="refreshInterval"
    show-filter
    show-interval
    @pick-range="emit('pick-range', $event)"
    @open-filter="emit('open-filter')"
    @refresh="emit('refresh')"
    @set-interval="emit('set-interval', $event)"
    @open-settings="emit('open-settings')"
    @open-report="repOpen = true"
  />
</div>

<section id="overview" class="on">
  <div v-if="setupItems.length" class="setup">
    <div class="setup-l">
      <b>Finish setting up your fleet</b>
      <span>{{ view.meta.deviceCount }} devices are sending live data. Add a few settings to unlock cost, grouping and appliance insights.</span>
    </div>
    <div class="setup-items">
      <button v-for="it in setupItems" :key="it.key" type="button" class="si" @click="emit('open-settings')">
        <span class="sidot"></span>{{ it.label }} <span class="cta">{{ it.action }} →</span>
      </button>
    </div>
  </div>
  <div class="grid g4">
    <div class="card ctr" style="--i:0">
      <div class="lab">Consumption</div>
      <div class="kpi"><span :data-count="view.overview.consumptionKwh" data-dec="0">0</span><small>kWh</small></div>
      <div v-if="view.overview.consumptionDeltaPct !== null" class="kdelta" :class="view.overview.consumptionDeltaPct > 0 ? 'dn-bad' : 'dn-good'">{{ view.overview.consumptionDeltaPct > 0 ? '▲' : '▼' }} {{ Math.abs(view.overview.consumptionDeltaPct) }}% vs prior</div>
    </div>
    <div class="card ctr" style="--i:1">
      <div class="lab">Cost</div>
      <div class="kpi hide-cold">{{ view.meta.currency }}<span :data-count="view.overview.costValue" data-dec="2">0</span></div>
      <div v-if="view.overview.costDeltaPct !== null" class="kdelta hide-cold" :class="view.overview.costDeltaPct > 0 ? 'dn-bad' : 'dn-good'">{{ view.overview.costDeltaPct > 0 ? '▲' : '▼' }} {{ Math.abs(view.overview.costDeltaPct) }}% vs prior</div>
      <div class="nudge"><b style="font-size:26px;color:var(--faint);font-weight:600">—</b><span class="cta">Set a tariff →</span></div>
    </div>
    <div class="card ctr" style="--i:2">
      <div class="lab">Projected · end of period</div>
      <div class="kpi hide-cold">{{ view.meta.currency }}<span :data-count="view.overview.projectedValue" data-dec="0">0</span></div>
      <div class="nudge"><b style="font-size:26px;color:var(--faint);font-weight:600">—</b><span class="cta">Set a tariff →</span></div>
    </div>
    <div class="card ctr" style="--i:3">
      <div class="lab">Daily average</div>
      <div class="kpi"><span :data-count="view.overview.dailyAvgKwh" data-dec="1">0</span><small>kWh</small></div>
    </div>
  </div>

  <div class="grid g32 mt">
    <div class="card pad0 hero" style="--i:4">
      <div class="head">
        <h3>Consumption &amp; projection</h3>
        <div class="legend">
          <i><span class="dot" style="background:var(--blue)"></span>Consumed</i>
          <i><span class="dot" style="background:var(--green)"></span>Returned</i>
          <i><span class="dot" style="background:var(--faint)"></span>Projection</i>
        </div>
      </div>
      <svg id="mainChart" class="bleed" viewBox="0 0 760 318" preserveAspectRatio="none" style="min-height:220px"></svg>
    </div>
    <div class="grid" style="grid-template-columns:1fr;gap:12px">
      <div class="card" style="--i:5">
        <div class="head" style="margin-bottom:6px"><h3>Bill</h3></div>
        <div class="nudge card-nudge"><span>No tariff configured</span><span class="cta">Set a tariff to build the bill →</span></div>
        <div class="rows hide-cold">
          <div class="row"><span>Energy</span><b>{{ cur(view.overview.bill.energy) }}</b></div>
          <div class="row"><span>Demand charge · {{ view.overview.bill.demandKw }} kW</span><b>{{ cur(view.overview.bill.demand) }}</b></div>
          <div class="row"><span>Standing charge</span><b>{{ cur(view.overview.bill.standing) }}</b></div>
          <div class="row"><span>VAT · {{ view.overview.bill.vatPct }}%</span><b>{{ cur(view.overview.bill.vat) }}</b></div>
          <div class="row total"><span>Bill total</span><b>{{ cur(view.overview.bill.total) }}</b></div>
        </div>
        <div class="sub hide-cold" style="margin-top:9px">vs utility {{ cur(view.overview.bill.vsUtility) }} <span class="delta d-ok">{{ view.overview.bill.deltaPct }}% ✓</span></div>
      </div>
      <div class="card" style="--i:6">
        <div class="head" style="margin-bottom:6px"><h3>Cost · time-of-use</h3></div>
        <div class="nudge card-nudge"><span>No tariff configured</span><span class="cta">Add a tariff to split day / night →</span></div>
        <div class="rows hide-cold">
          <div class="row"><span>TOU energy</span><b>{{ cur(view.overview.tou.energy) }}</b></div>
          <div class="row"><span>Shiftable</span><b style="color:var(--green)">{{ view.overview.tou.shiftKwh }} kWh → {{ cur(view.overview.tou.shiftSave) }}</b></div>
        </div>
        <div class="split hide-cold">
          <i :style="{width: view.overview.tou.dayPct + '%', background: 'var(--blue)'}"></i>
          <i :style="{width: view.overview.tou.nightPct + '%', background: '#3A4150'}"></i>
        </div>
        <div class="sub hide-cold" style="justify-content:space-between;margin-top:2px">
          <span>Day <b>{{ cur(view.overview.tou.dayCost, 0) }}</b></span><span>Night <b>{{ cur(view.overview.tou.nightCost, 0) }}</b></span>
        </div>
      </div>
    </div>
  </div>

  <div class="grid g3 mt">
    <div class="card ctr" style="--i:7">
      <div class="lab">Always-on · baseline load</div>
      <div class="kpi"><span :data-count="view.overview.alwaysOnKwh" data-dec="0">0</span><small>kWh</small></div>
    </div>
    <div class="card ctr" style="--i:8">
      <div class="lab">Voltage quality</div>
      <div class="kpi"><span :style="{color: view.overview.voltagePass ? 'var(--green)' : 'var(--orange)'}">{{ view.overview.voltagePass ? 'PASS' : 'CHECK' }}</span><small>· {{ view.overview.voltageAvgV }} V avg</small></div>
    </div>
    <div class="card ctr" style="--i:9">
      <div class="lab">Data quality</div>
      <div class="kpi"><span :data-count="view.overview.dataQualityPct" data-dec="1">0</span><small>%</small></div>
    </div>
  </div>
</section>

<!-- ================= POWER & QUALITY ================= -->
<section id="power">
  <div class="grid g32">
    <div class="card pad0 hero" style="--i:0">
      <div class="head">
        <h3>Live power</h3>
        <span class="meta num" style="color:var(--green)">{{ view.power.liveNote }}</span>
      </div>
      <div style="padding:0 20px 6px">
        <div class="kpi num" style="font-size:var(--type-heading)"><span id="bigW">{{ view.power.liveKw.toFixed(2) }}</span><small>kW</small></div>
      </div>
      <svg id="liveChart" class="bleed" viewBox="0 0 760 190" preserveAspectRatio="none" style="min-height:180px"></svg>
    </div>
    <div class="grid" style="grid-template-columns:1fr;gap:12px">
      <div class="card ctr" style="--i:1">
        <div class="lab">Peak power · 15-min max</div>
        <div class="kpi"><span :data-count="view.power.peakKw" data-dec="1">0</span><small>kW</small></div>
      </div>
      <div class="card ctr" style="--i:2">
        <div class="lab">Billed demand</div>
        <div class="kpi"><span :data-count="view.power.billedKw" data-dec="1">0</span><small>kW</small></div>
      </div>
      <div class="card ctr" style="--i:3">
        <div class="lab">Load factor</div>
        <div class="kpi"><span :data-count="view.power.loadFactor" data-dec="2">0</span></div>
        <div class="prog"><i class="hbar" :style="{width: (view.power.loadFactor*100)+'%', background:'var(--blue)', '--i':'1'}"></i></div>
      </div>
    </div>
  </div>

  <div class="grid g3 mt">
    <div class="card" style="--i:4">
      <div class="head" style="margin-bottom:6px"><h3>Power quality</h3></div>
      <div class="rows">
        <div class="row"><span>Apparent energy</span><b>{{ view.power.apparentKvah.toLocaleString('en-US') }} kVAh</b></div>
        <div class="row"><span>Reactive energy</span><b>{{ view.power.reactiveKvarh.toLocaleString('en-US') }} kVARh</b></div>
        <div class="row"><span>EN 50160 violations</span><b><span class="pill p-warn">{{ view.power.en50160Events }} events</span></b></div>
        <div class="row"><span>Frequency</span><b>{{ view.power.frequencyHz }} Hz</b></div>
        <div class="row"><span>Freq range · drift</span><b>{{ view.power.frequencyRange }}</b></div>
      </div>
    </div>
    <div class="card" style="--i:5">
      <div class="head" style="margin-bottom:6px"><h3>Electrical measurements</h3></div>
      <div style="display:flex;align-items:center;gap:16px;margin:6px 0 10px">
        <svg width="84" height="50" viewBox="0 0 86 52">
          <path d="M8 48 A38 38 0 0 1 78 48" fill="none" stroke="var(--panel2)" stroke-width="7" stroke-linecap="round"/>
          <path class="draw" d="M8 48 A38 38 0 0 1 78 48" pathLength="1" fill="none" stroke="var(--green)" stroke-width="7" stroke-linecap="round" :style="{strokeDasharray: view.power.powerFactor + ' 1', strokeDashoffset: view.power.powerFactor, animationName: 'pf'}"/>
        </svg>
        <div><div class="kpi"><span :data-count="view.power.powerFactor" data-dec="2">0</span></div>
        <div class="sub" style="margin-top:2px">power factor avg</div></div>
      </div>
      <div class="rows">
        <div class="row"><span>PF range</span><b>{{ view.power.powerFactorRange }}</b></div>
        <div class="row"><span>Voltage avg · range</span><b>{{ view.power.voltageAvgV }} · {{ view.power.voltageRange }}</b></div>
      </div>
    </div>
    <div class="card" style="--i:6">
      <div class="head" style="margin-bottom:6px"><h3>3-phase</h3><span class="meta">imbalance {{ view.power.phaseImbalancePct }}%</span></div>
      <div style="display:grid;gap:9px;margin-top:4px">
        <div v-for="(ph, pi) in view.power.phases" :key="ph.name"><div class="sub" style="margin:0 0 4px;justify-content:space-between"><span>{{ ph.name }}</span><b>{{ ph.watts.toLocaleString('en-US') }} W · {{ ph.volts }} V · {{ ph.amps }} A</b></div><div class="prog" style="margin:0"><i class="hbar" :style="{width: ph.pct+'%', background:'var(--cyan)', '--i': String(pi)}"></i></div></div>
      </div>
      <div class="sub" style="margin-top:10px">worst: <span class="chip" style="color:var(--orange)">{{ view.power.phaseWorst }}</span></div>
    </div>
  </div>
</section>

<!-- ================= ENERGY & PATTERNS ================= -->
<section id="energy">
  <div class="grid g32">
    <div class="card pad0 hero" style="--i:0">
      <div class="head">
        <h3>Daily rhythm</h3>
        <div class="legend">
          <i><span class="dot" style="background:var(--blue)"></span>Weekdays</i>
          <i><span class="dot" style="background:var(--cyan)"></span>Weekends</i>
        </div>
      </div>
      <svg id="rhythm" class="bleed" viewBox="0 0 760 268" preserveAspectRatio="none" style="min-height:220px"></svg>
    </div>
    <div class="grid" style="grid-template-columns:1fr;gap:12px">
      <div class="card" style="--i:1">
        <div class="head" style="margin-bottom:6px"><h3>Energy by utility</h3></div>
        <div class="rows">
          <div class="row" v-for="u in view.energy.utility" :key="u.name"><span>{{ u.name }}</span><b>{{ u.label }}</b></div>
        </div>
      </div>
      <div class="card" style="--i:2">
        <div class="lab">Weekday vs weekend</div>
        <div class="split">
          <i :style="{width: pct(view.energy.weekdayKwh, view.energy.weekdayKwh + view.energy.weekendKwh) + '%', background:'var(--blue)'}"></i>
          <i :style="{width: pct(view.energy.weekendKwh, view.energy.weekdayKwh + view.energy.weekendKwh) + '%', background:'var(--cyan)'}"></i>
        </div>
        <div class="sub" style="justify-content:space-between">
          <span>Weekdays <b>{{ view.energy.weekdayKwh.toLocaleString('en-US') }} kWh</b></span>
          <span>Weekends <b>{{ view.energy.weekendKwh.toLocaleString('en-US') }} kWh</b></span>
        </div>
        <div class="sub">{{ view.energy.weekdayPerDay }} vs {{ view.energy.weekendPerDay }} kWh / day</div>
      </div>
      <div class="card" style="--i:3">
        <div class="lab">Environment</div>
        <div class="sub" style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <span>Temp<br><b style="font-size:var(--type-body)">{{ view.energy.env.temp }}</b></span>
          <span>Humidity<br><b style="font-size:var(--type-body)">{{ view.energy.env.humidity }}</b></span>
          <span>Luminance<br><b style="font-size:var(--type-body)">{{ view.energy.env.luminance }}</b></span>
          <span>Flow<br><b style="font-size:var(--type-body)">{{ view.energy.env.flow }}</b></span>
        </div>
      </div>
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card" style="--i:4">
      <div class="head"><h3>Load-duration curve</h3><span class="meta">hours in each kW band</span></div>
      <svg id="ldc" viewBox="0 0 640 180" width="100%" preserveAspectRatio="none" style="aspect-ratio:640/180"></svg>
    </div>
    <div class="card" style="--i:5">
      <div class="head"><h3>Usage profile</h3><span class="meta">{{ view.energy.peakHourLabel ? `peak hour ${view.energy.peakHourLabel}` : 'hourly average' }}</span></div>
      <svg id="hourly" viewBox="0 0 640 180" width="100%" preserveAspectRatio="none" style="aspect-ratio:640/180"></svg>
    </div>
  </div>
</section>

<!-- ================= DEVICES ================= -->
<section id="devices">
  <div class="grid g32">
    <div class="card" style="--i:0">
      <div class="head"><h3>Top consumers</h3><span class="meta">share of {{ view.devices.shareTotalKwh.toLocaleString('en-US') }} kWh</span></div>
      <div id="devList"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr;gap:12px">
      <div class="card tree" style="--i:1">
        <div class="head" style="margin-bottom:4px"><h3>By location</h3></div>
        <div class="nudge card-nudge"><span>{{ view.meta.deviceCount }} devices are ungrouped</span><span class="cta">Create groups / locations →</span></div>
        <div class="rows hide-cold">
          <div class="row" v-for="(row, ri) in view.devices.byLocation" :key="ri" :class="{in1: row.indent}"><span :class="{muted: row.muted}">{{ row.label }}</span><b :class="{muted: row.muted}">{{ row.value }}</b></div>
        </div>
      </div>
      <div class="card tree" style="--i:2">
        <div class="head" style="margin-bottom:4px"><h3>By kind</h3></div>
        <div class="nudge card-nudge"><span>No appliance kinds set</span><span class="cta">Classify devices →</span></div>
        <div class="rows hide-cold">
          <div class="row" v-for="(row, ri) in view.devices.byKind" :key="ri"><span>{{ row.label }}</span><b>{{ row.value }}</b></div>
        </div>
      </div>
      <div class="card" style="--i:3">
        <div class="lab">Cost allocation · tenants</div>
        <div class="rows" style="margin-top:4px">
          <div class="row" v-for="(row, ri) in view.devices.tenants" :key="ri"><span>{{ row.label }}</span><b>{{ row.value }}</b></div>
        </div>
      </div>
    </div>
  </div>

  <div class="card pad0 mt" style="--i:4">
    <div class="head" style="padding:16px 18px 0;margin-bottom:0"><h3>Meters</h3><span class="meta">per-device data quality</span></div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Meter</th><th>Role</th><th class="r">Live</th><th class="r">Energy</th><th class="r">Cost</th><th class="r">Δ</th><th class="r">Quality</th><th class="r">Status</th></tr></thead>
      <tbody id="meterRows"></tbody>
    </table>
    </div>
  </div>
</section>

<!-- ================= SOLAR & BATTERY ================= -->
<section v-if="view.config.solar" id="solar">
  <div v-if="hasPv" class="card pad0 hero" style="--i:0">
    <div class="head">
      <h3>Energy flow</h3>
    </div>
    <svg id="flow" viewBox="0 0 760 428" width="100%" style="aspect-ratio:760/428;max-width:820px;margin:0 auto;padding:0 10px"></svg>
    <div class="stats">
      <div><div class="sl">Generated</div><div class="sv">{{ view.solar.generatedToday }} <small>kWh</small></div></div>
      <div><div class="sl">Self-consumed</div><div class="sv" style="color:var(--green)">{{ view.solar.selfConsumed }} <small>kWh</small></div></div>
      <div><div class="sl">Exported</div><div class="sv">{{ view.solar.exported }} <small>kWh</small></div></div>
      <div><div class="sl">Imported</div><div class="sv">{{ view.solar.imported }} <small>kWh</small></div></div>
    </div>
  </div>

  <div class="grid g3 mt">
    <div v-if="hasPv" class="card" style="--i:1">
      <div class="head" style="margin-bottom:6px"><h3>PV · {{ view.meta.rangeLabel }}</h3></div>
      <div class="rows">
        <div class="row"><span>Generation</span><b>{{ view.solar.pv.generation.toLocaleString('en-US') }} kWh</b></div>
        <div class="row"><span>Self-consumed</span><b style="color:var(--green)">{{ view.solar.pv.selfConsumed.toLocaleString('en-US') }} kWh</b></div>
        <div class="row"><span>Exported</span><b>{{ view.solar.pv.exported.toLocaleString('en-US') }} kWh</b></div>
        <div class="row"><span>Grid import</span><b>{{ view.solar.pv.gridImport.toLocaleString('en-US') }} kWh</b></div>
        <div class="row"><span>House consumption</span><b>{{ view.solar.pv.house.toLocaleString('en-US') }} kWh</b></div>
      </div>
      <div style="display:flex;gap:12px;margin-top:12px">
        <div style="flex:1">
          <div class="sub" style="margin:0;justify-content:space-between"><span>Self-consumption</span><b>{{ view.solar.pv.selfConsumptionPct }}%</b></div>
          <div class="prog" style="margin-top:6px"><i class="hbar" :style="{width: view.solar.pv.selfConsumptionPct+'%', background:'var(--yellow)', '--i':'0'}"></i></div>
        </div>
        <div style="flex:1">
          <div class="sub" style="margin:0;justify-content:space-between"><span>Self-sufficiency</span><b>{{ view.solar.pv.selfSufficiencyPct }}%</b></div>
          <div class="prog" style="margin-top:6px"><i class="hbar" :style="{width: view.solar.pv.selfSufficiencyPct+'%', background:'var(--green)', '--i':'1'}"></i></div>
        </div>
      </div>
    </div>
    <div class="card" style="--i:2" v-if="view.solar.battery">
      <div class="head" style="margin-bottom:6px"><h3>Battery</h3></div>
      <div class="rows">
        <div class="row"><span>Charged</span><b>{{ view.solar.battery.charged }} kWh</b></div>
        <div class="row"><span>Discharged</span><b>{{ view.solar.battery.discharged }} kWh</b></div>
        <div class="row"><span>Round-trip</span><b style="color:var(--green)">{{ view.solar.battery.roundTripPct }}%</b></div>
        <div class="row"><span>Losses</span><b>{{ view.solar.battery.losses }} kWh</b></div>
      </div>
    </div>
    <div class="card" style="--i:3" v-if="view.solar.ev">
      <div class="head" style="margin-bottom:6px"><h3>EV charging</h3></div>
      <div class="rows">
        <div class="row"><span>Delivered</span><b>{{ view.solar.ev.delivered }} kWh</b></div>
        <div class="row"><span>Sessions</span><b>{{ view.solar.ev.sessions }}</b></div>
        <div class="row"><span>Avg / session</span><b>{{ view.solar.ev.avgPerSession }} kWh</b></div>
        <div class="row"><span>Cost</span><b>{{ cur(view.solar.ev.cost) }}</b></div>
        <div class="row"><span>CO₂ avoided</span><b style="color:var(--green)">{{ view.solar.ev.co2Avoided }} kg</b></div>
      </div>
    </div>
  </div>
</section>

<!-- ================= CARBON & INSIGHTS ================= -->
<section id="insights">
  <div class="grid g4">
    <div class="card ctr" style="--i:0">
      <div class="lab">CO₂ · location-based</div>
      <div class="kpi"><span :data-count="view.carbon.locationBasedKg" data-dec="0">0</span><small>kg</small></div>
    </div>
    <div class="card ctr" style="--i:1">
      <div class="lab">CO₂ · market-based</div>
      <div class="kpi"><span :data-count="view.carbon.marketBasedKg" data-dec="0">0</span><small>kg</small></div>
    </div>
    <div v-if="hasPv" class="card ctr" style="--i:2">
      <div class="lab">Avoided by solar</div>
      <div class="kpi">−<span :data-count="view.carbon.avoidedKg" data-dec="0">0</span><small>kg</small></div>
    </div>
    <div class="card ctr" style="--i:3">
      <div class="lab">Equivalent</div>
      <div class="kpi"><span :data-count="view.carbon.equivalentKm" data-dec="0">0</span><small>km driven</small></div>
    </div>
  </div>

  <div class="card mt" style="--i:4">
    <div class="head"><h3>CO₂ budget</h3><span class="meta">budget {{ view.carbon.budgetKg.toLocaleString('en-US') }} kg · current {{ view.carbon.projectedKg.toLocaleString('en-US') }} kg</span></div>
    <div class="prog" style="height:8px"><i class="hbar" :style="{width: view.carbon.usedPct+'%', background:'var(--green)', '--i':'0'}"></i></div>
    <div class="sub" style="justify-content:space-between"><span><b>{{ view.carbon.usedPct }}%</b> used in this range</span><span>overshoot <span class="delta d-warn">+{{ view.carbon.overshootPct }}%</span></span></div>
  </div>

  <div class="grid g2 mt">
    <div class="card" style="--i:5">
      <div class="head" style="margin-bottom:4px"><h3>Anomalies</h3></div>
      <div id="anoms"></div>
    </div>
    <div class="card" style="--i:6">
      <div class="head" style="margin-bottom:4px"><h3>Recommendations</h3></div>
      <div id="recs"></div>
    </div>
  </div>
</section>

<div v-if="repOpen" class="mov on" @click.self="repOpen = false">
  <div class="modal rep-modal">
    <div class="mhd">
      <div>
        <h3>Download report</h3>
        <p class="msub">{{ view.meta.rangeLabel }} · {{ view.meta.deviceCount }} devices · {{ view.meta.currency }}</p>
      </div>
      <button class="mx" @click="repOpen = false">✕</button>
    </div>
    <div class="mpanel">
      <div class="field">
        <div class="fl">What to include</div>
        <div class="rep-types">
          <button
            v-for="t in REPORT_TYPES"
            :key="t.key"
            class="rep-type"
            :class="{on: repKind === t.key}"
            @click="repKind = t.key"
          >
            <span class="rt-name">{{ t.name }}</span>
            <span class="rt-desc">{{ t.desc }}</span>
          </button>
        </div>
      </div>
      <div class="field">
        <div class="fl">Detail level</div>
        <div class="seg2">
          <button v-for="g in GRANULARITIES" :key="g.key" :class="{on: repGran === g.key}" @click="repGran = g.key">{{ g.label }}</button>
        </div>
      </div>
      <div class="field">
        <div class="fl">Format</div>
        <div class="seg2">
          <button v-for="f in FORMATS" :key="f.key" :class="{on: repFormat === f.key}" @click="repFormat = f.key">{{ f.label }}</button>
        </div>
      </div>
      <template v-if="repKind === 'interval'">
        <div class="field">
          <div class="fl">Metrics</div>
          <div class="rep-chips">
            <button v-for="m in REP_METRICS" :key="m.key" type="button" class="rep-chip" :class="{on: repMetrics[m.key]}" @click="repMetrics[m.key] = !repMetrics[m.key]">{{ m.label }}</button>
          </div>
        </div>
        <label class="rep-check"><input type="checkbox" v-model="repPerDevice" /> One row per device</label>
      </template>
      <div v-if="repKind === 'energy'" class="field">
        <div class="fl">Optional sections <span class="rep-hint-inline">· core sections always included</span></div>
        <div class="rep-chips">
          <button v-for="s in REP_SECTIONS" :key="s.key" type="button" class="rep-chip" :class="{on: repSections[s.key]}" @click="repSections[s.key] = !repSections[s.key]">{{ s.label }}</button>
        </div>
      </div>
      <p class="rep-note">Uses this dashboard's date range, scope and tariff. Change those in Settings.</p>
    </div>
    <div class="mft">
      <button class="btn-ghost" @click="repOpen = false">Cancel</button>
      <button class="btn-primary" @click="onGenerate">Generate report</button>
    </div>
  </div>
</div>
<div class="tt" id="tt"></div>
  </div>
</template>

<script setup>
// Faithful port of the approved Voltaine energy-dashboard mock, made data-driven.
// Purely presentational: every value + chart series comes from the `d` prop
// (the EnergyDashboardData contract). When `d` is omitted the dev fixture renders,
// so the exact visual stays verifiable in the standalone preview.
import {computed, onMounted, onUnmounted, reactive, ref} from 'vue';
import DashVoltaineTools from '@/components/dashboard/DashVoltaineTools.vue';
import {resolveEnergyDashboardView} from './energyDashboard.view';

const props = defineProps({
    // EnergyDashboardData (see energyDashboard.types.ts). null => dev fixture.
    d: {type: Object, default: null},
    // Tab to open on mount — lets the parent preserve the active tab across a
    // renderKey remount (refresh / lazy-loaded data) instead of resetting to Overview.
    initialTab: {type: String, default: 'overview'},
    // Live auto-refresh cadence in ms (0 = off). Drives the header interval picker.
    refreshInterval: {type: Number, default: 0},
});
const emit = defineEmits(['pick-range', 'generate-report', 'open-filter', 'open-settings', 'refresh', 'tab-change', 'set-interval']);

const rootEl = ref(null);
let cleanups = [];

// Download report menu — exposes what report.generate honours. Range, scope and
// tariff come from the dashboard's own settings (one source, not re-asked).
const repOpen = ref(false);
const repKind = ref('energy');
const repGran = ref('day');
const repFormat = ref('html');
const repPerDevice = ref(true);
const repMetrics = reactive({consumption: true, returned: false, voltage: false, current: false, power: false});
const repSections = reactive({demand: true, solar: true, battery: true, ev: true, tenant: true});
const REPORT_TYPES = [
    {key: 'energy', name: 'Energy summary', desc: 'Consumption, cost and generation for the period — a formatted report to read or share.'},
    {key: 'interval', name: 'Load profile', desc: 'Every reading at each interval, per device — a spreadsheet for your own analysis.'},
    {key: 'energy_dump', name: 'Per-phase dump', desc: 'Energy per phase (L1/L2/L3), used and returned, one row per meter and interval.'},
];
const GRANULARITIES = [
    {key: 'fifteen_minutes', label: '15 min'},
    {key: 'hour', label: 'Hourly'},
    {key: 'day', label: 'Daily'},
    {key: 'month', label: 'Monthly'},
];
const FORMATS = [
    {key: 'html', label: 'HTML report'},
    {key: 'csv', label: 'CSV data'},
];
const REP_METRICS = [
    {key: 'consumption', label: 'Consumption'},
    {key: 'returned', label: 'Returned'},
    {key: 'voltage', label: 'Voltage'},
    {key: 'current', label: 'Current'},
    {key: 'power', label: 'Power'},
];
const REP_SECTIONS = [
    {key: 'demand', label: 'Demand'},
    {key: 'solar', label: 'Solar'},
    {key: 'battery', label: 'Battery'},
    {key: 'ev', label: 'EV'},
    {key: 'tenant', label: 'Tenant'},
];
function onGenerate() {
    emit('generate-report', {
        kind: repKind.value,
        granularity: repGran.value,
        format: repFormat.value,
        perDevice: repPerDevice.value,
        metrics: REP_METRICS.filter((m) => repMetrics[m.key]).map((m) => m.key),
        sections: REP_SECTIONS.filter((s) => repSections[s.key]).map((s) => s.key),
    });
    repOpen.value = false;
}

const view = computed(() => resolveEnergyDashboardView(props.d));
const hasPv = computed(() => {
    const s = view.value.solar;
    return s.generatedToday > 0 || s.pv.generation > 0 || s.pv.exported > 0 || s.flow.solar > 0;
});
const hasBattery = computed(() => view.value.solar.battery !== null);
const hasEv = computed(() => view.value.solar.ev !== null);
const assetsTabLabel = computed(() => {
    const pv = hasPv.value;
    const battery = hasBattery.value;
    const ev = hasEv.value;
    if (pv && battery && ev) return 'Solar, Battery & EV';
    if (pv && battery) return 'Solar & Battery';
    if (pv && ev) return 'Solar & EV';
    if (pv) return 'Solar';
    if (battery && ev) return 'Battery & EV';
    if (battery) return 'Battery';
    if (ev) return 'EV charging';
    return 'Energy assets';
});

// Setup nudges — only the things still unconfigured, so the card guides the user
// to finish setup and disappears once everything is set.
const setupItems = computed(() => {
    const c = view.value.config;
    const items = [];
    if (!c.tariff) items.push({key: 'tariff', label: 'Tariff', action: 'Add'});
    if (!c.groups) items.push({key: 'groups', label: 'Groups & locations', action: 'Create'});
    if (!c.kinds) items.push({key: 'kinds', label: 'Appliance kinds', action: 'Classify'});
    return items;
});

// Format a number in the dashboard currency; '—' when absent/invalid (no tariff).
function cur(n, dec = 2) {
    if (!Number.isFinite(Number(n))) return '—';
    return view.value.meta.currency + Number(n).toLocaleString('en-US', {minimumFractionDigits: dec, maximumFractionDigits: dec});
}

function pct(value, total) {
    const v = Number(value);
    const t = Number(total);
    return t > 0 && Number.isFinite(v) ? (v / t) * 100 : 0;
}

onMounted(() => {
  const root = rootEl.value;
  if (!root) return;

(()=> {

const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* tabs */
const tabs=$$('.seg button'), secs=$$('section');
function activateTab(t){
  tabs.forEach(x=>x.classList.toggle('on',x===t));
  secs.forEach(s=>{
    s.classList.remove('on');
    if(s.id===t.dataset.t){void s.offsetWidth;s.classList.add('on');runCounts(s);}
  });
}
tabs.forEach(t=>t.addEventListener('click',()=>{
  activateTab(t);
  emit('tab-change', t.dataset.t);
}));
// Restore the parent-preserved tab on (re)mount — default 'overview'.
const wantBtn = tabs.find(t=>t.dataset.t===props.initialTab);
if(wantBtn && props.initialTab!=='overview') activateTab(wantBtn);
function runCounts(scope){
  scope.querySelectorAll('[data-count]').forEach(el=>{
    const target=parseFloat(el.dataset.count),dec=+el.dataset.dec||0,t0=performance.now(),dur=reduced?1:1000;
    if(isNaN(target)){el.textContent='—';return;}
    (function step(t){
      const p=Math.min((t-t0)/dur,1),e=1-(1-p) ** 3;
      el.textContent=(target*e).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
      if(p<1)requestAnimationFrame(step);
    })(t0);
  });
}
runCounts($('#overview'));

/* svg helpers */
const NS='http://www.w3.org/2000/svg';
const el=(n,a)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;};
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function smooth(pts){
  if(!pts.length) return '';                 // empty series → no path (no data yet)
  let d=`M${pts[0][0]},${pts[0][1]}`;
  for(let i=1;i<pts.length;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i],m=(x0+x1)/2;d+=` C${m},${y0} ${m},${y1} ${x1},${y1}`;}
  return d;
}
// Round a raw max up to a clean axis top with a whole-number step (1/2/2.5/5 ×10ⁿ),
// so the y-axis shows tidy round labels instead of 233.11-style numbers.
function niceScale(rawMax){
  const max=rawMax>0?rawMax:1;
  const rough=max/4;
  const pow=10 ** Math.floor(Math.log10(rough));
  const n=rough/pow;
  const step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*pow;
  return {top:Math.ceil(max/step)*step,step};
}
function xhair(svg,pointsFn,tip){
  const tt=$('#tt');const vb=svg.viewBox.baseVal;
  const ln=el('line',{y1:vb.y,y2:vb.y+vb.height,stroke:'rgba(255,255,255,.22)','stroke-width':1,opacity:0});
  const dc=el('circle',{r:4,fill:'#fff',stroke:'#0A0C10','stroke-width':2,opacity:0});
  svg.append(ln,dc);
  svg.addEventListener('mousemove',e=>{
    const pts=pointsFn();if(!pts.length)return;const rc=svg.getBoundingClientRect();
    const mx=(e.clientX-rc.left)/rc.width*vb.width;
    let bi=0,bd=1e9;for(let i=0;i<pts.length;i++){const d=Math.abs(pts[i][0]-mx);if(d<bd){bd=d;bi=i;}}
    const x=pts[bi][0],y=pts[bi][1];
    ln.setAttribute('x1',x);ln.setAttribute('x2',x);ln.setAttribute('opacity',1);
    dc.setAttribute('cx',x);dc.setAttribute('cy',y);dc.setAttribute('opacity',1);
    tt.innerHTML=tip(bi);tt.style.opacity=1;tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY-14)+'px';
  });
  svg.addEventListener('mouseleave',()=>{ln.setAttribute('opacity',0);dc.setAttribute('opacity',0);tt.style.opacity=0;});
}
function defer(fn){
  let cancelled=false;
  const run=()=>{if(!cancelled)fn();};
  if('requestIdleCallback' in window){
    const id=window.requestIdleCallback(run,{timeout:900});
    cleanups.push(()=>{cancelled=true;window.cancelIdleCallback?.(id);});
  }else{
    const id=setTimeout(run,0);
    cleanups.push(()=>{cancelled=true;clearTimeout(id);});
  }
}

/* ---- overview chart (full-bleed) ---- */
(()=> {
  const svg=$('#mainChart'),W=760,H=318,P={l:52,r:20,t:16,b:28};
  const V=view.value;
  const cons=V.overview.consumption.map(p=>p.value);
  const ret=V.overview.returned.map(p=>p.value);
  const proj=V.overview.projection.map(p=>p.value);
  const labels=V.overview.consumption.map(p=>p.label);
  const nd=cons.length, np=proj.length, N=Math.max(2,nd+np);
  const {top:ymax,step}=niceScale(Math.max(0,...cons,...ret,...proj));
  const fmt=v=>step<1?v.toFixed(1):Math.round(v).toLocaleString('en-US');
  const X=i=>P.l+(W-P.l-P.r)*i/(N-1), Y=v=>H-P.b-(H-P.t-P.b)*v/ymax;
  for(let val=0;val<=ymax+step*0.01;val+=step){
    svg.append(el('line',{x1:P.l,x2:W-P.r,y1:Y(val),y2:Y(val),class:'gl'}));
    const t=el('text',{x:P.l-8,y:Y(val)+3,class:'axis','text-anchor':'end'});t.textContent=fmt(val);svg.append(t);
  }
  if(nd) [0,Math.floor((nd-1)/2),nd-1].forEach(i=>{
    const t=el('text',{x:X(i),y:H-10,class:'axis','text-anchor':'middle'});t.textContent=labels[i]||'';svg.append(t);
  });
  const defs=el('defs',{});
  defs.innerHTML=`<linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A84FF" stop-opacity=".16"/><stop offset="1" stop-color="#0A84FF" stop-opacity="0"/></linearGradient>`;
  svg.append(defs);
  const cpts=cons.map((v,i)=>[X(i),Y(v)]);
  if(nd) svg.append(el('path',{d:smooth(cpts)+`L${X(nd-1)},${Y(0)} L${X(0)},${Y(0)} Z`,fill:'url(#ga)',class:'fade'}));
  if(np) svg.append(el('path',{d:smooth(proj.map((v,i)=>[X(nd-1+i),Y(v)])),fill:'none',stroke:'#5D646F','stroke-width':1.8,'stroke-dasharray':'4 6',class:'fade','stroke-linecap':'round'}));
  if(ret.length) svg.append(el('path',{d:smooth(ret.map((v,i)=>[X(i),Y(v)])),fill:'none',stroke:'#30D158','stroke-width':1.8,class:'draw',pathLength:1,'stroke-linecap':'round',opacity:.9}));
  if(nd) svg.append(el('path',{d:smooth(cpts),fill:'none',stroke:'#0A84FF','stroke-width':2.2,class:'draw',pathLength:1,'stroke-linecap':'round'}));
  const tt=$('#tt'),hl=el('line',{y1:P.t,y2:H-P.b,stroke:'rgba(255,255,255,.2)','stroke-width':1,opacity:0});
  const hc=el('circle',{r:4,fill:'#0A84FF',stroke:'#0A0C10','stroke-width':2,opacity:0});
  svg.append(hl,hc);
  svg.addEventListener('mousemove',e=>{
    const rc=svg.getBoundingClientRect();
    const i=Math.round(((e.clientX-rc.left)/rc.width*W-P.l)/((W-P.l-P.r)/(N-1)));
    if(i<0||i>=nd){tt.style.opacity=0;hl.setAttribute('opacity',0);hc.setAttribute('opacity',0);return;}
    hl.setAttribute('x1',X(i));hl.setAttribute('x2',X(i));hl.setAttribute('opacity',1);
    hc.setAttribute('cx',X(i));hc.setAttribute('cy',Y(cons[i]));hc.setAttribute('opacity',1);
    const rt=ret[i]!=null?`<br><span style="color:var(--green)">↩ ${ret[i].toFixed(1)} kWh returned</span>`:'';
    tt.innerHTML=`<small>${esc(labels[i]||'')}</small>${cons[i].toFixed(1)} kWh${rt}`;
    tt.style.opacity=1;tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY-14)+'px';
  });
  svg.addEventListener('mouseleave',()=>{tt.style.opacity=0;hl.setAttribute('opacity',0);hc.setAttribute('opacity',0);});
})();

defer(()=>{
/* ---- live power (full-bleed) ---- */
(()=> {
  const svg=$('#liveChart'),W=760,H=190;
  let data=view.value.power.live.map(p=>p.value).filter(Number.isFinite);
  if(!data.length) data=[Number.isFinite(view.value.power.liveKw)?view.value.power.liveKw:0];
  const n=data.length, ymax=Math.max(4.5,...data)*1.1;
  const X=i=>n>1?W*i/(n-1):W/2, Y=v=>H-8-(H-26)*v/ymax;
  const defs=el('defs',{});
  defs.innerHTML=`<linearGradient id="gl2" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A84FF" stop-opacity=".16"/><stop offset="1" stop-color="#0A84FF" stop-opacity="0"/></linearGradient>`;
  svg.append(defs);
  [1,2,3].forEach(g=>svg.append(el('line',{x1:0,x2:W,y1:Y(ymax*g/4),y2:Y(ymax*g/4),class:'gl'})));
  const pts=data.map((v,i)=>[X(i),Y(v)]);
  svg.append(el('path',{d:smooth(pts)+`L${W},${H} L0,${H} Z`,fill:'url(#gl2)'}));
  svg.append(el('path',{d:smooth(pts),fill:'none',stroke:'#0A84FF','stroke-width':2.2,'stroke-linecap':'round',class:'draw',pathLength:1}));
  if(n) svg.append(el('circle',{cx:X(n-1),cy:Y(data[n-1]),r:4,fill:'#0A84FF',stroke:'#0A0C10','stroke-width':2}));
  xhair(svg,()=>data.map((v,i)=>[X(i),Y(v)]),i=>'<small>power</small>'+data[i].toFixed(2)+' kW');
})();

/* ---- daily rhythm (replaces heatmap) ---- */
(()=> {
  const svg=$('#rhythm'),W=760,H=268,P={l:38,r:20,t:16,b:28};
  const wd=view.value.energy.rhythmWeekday.map(p=>p.value);
  const we=view.value.energy.rhythmWeekend.map(p=>p.value);
  const peakH=wd.length?wd.indexOf(Math.max(...wd)):0;
  const ymax=Math.max(1,...wd,...we)*1.15;
  const X=h=>P.l+(W-P.l-P.r)*h/23, Y=v=>H-P.b-(H-P.t-P.b)*v/ymax;
  const scale=niceScale(ymax);
  for(let v=0;v<=scale.top+scale.step*0.01;v+=scale.step){
    svg.append(el('line',{x1:P.l,x2:W-P.r,y1:Y(v),y2:Y(v),class:'gl'}));
    const t=el('text',{x:P.l-8,y:Y(v)+3,class:'axis','text-anchor':'end'});t.textContent=(scale.step<1?v.toFixed(1):Math.round(v))+' kWh';svg.append(t);
  }
  [0,6,12,18,23].forEach(h=>{
    const t=el('text',{x:X(h),y:H-10,class:'axis','text-anchor':'middle'});t.textContent=String(h).padStart(2,'0')+':00';svg.append(t);
  });
  const defs=el('defs',{});
  defs.innerHTML=`<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A84FF" stop-opacity=".14"/><stop offset="1" stop-color="#0A84FF" stop-opacity="0"/></linearGradient>`;
  svg.append(defs);
  const wpts=wd.map((v,h)=>[X(h),Y(v)]);
  if(wpts.length)svg.append(el('path',{d:smooth(wpts)+`L${X(23)},${Y(0)} L${X(0)},${Y(0)} Z`,fill:'url(#gr)',class:'fade'}));
  if(we.length)svg.append(el('path',{d:smooth(we.map((v,h)=>[X(h),Y(v)])),fill:'none',stroke:'#64D2FF','stroke-width':1.8,class:'draw',pathLength:1,'stroke-linecap':'round',opacity:.85}));
  if(wpts.length)svg.append(el('path',{d:smooth(wpts),fill:'none',stroke:'#0A84FF','stroke-width':2.2,class:'draw',pathLength:1,'stroke-linecap':'round'}));
  if(wd.length){
    svg.append(el('circle',{cx:X(peakH),cy:Y(wd[peakH]),r:4,fill:'#FF9F0A',stroke:'#0A0C10','stroke-width':2,class:'fade'}));
    const t=el('text',{x:X(peakH),y:Y(wd[peakH])-10,class:'axis','text-anchor':'middle',fill:'#FF9F0A'});t.textContent='peak '+String(peakH).padStart(2,'0')+':00';svg.append(t);
  }
  xhair(svg,()=>wd.map((v,h)=>[X(h),Y(v)]),h=>'<small>'+String(h).padStart(2,'0')+':00</small>'+wd[h].toFixed(2)+' kW \u00b7 wknd '+(we[h]??0).toFixed(2));
})();

/* ---- hourly bars ---- */
(()=> {
  const svg=$('#hourly'),W=640,H=180;
  const vals=view.value.energy.hourly.map(p=>p.value);
  const max=Math.max(1,...vals),bw=(W-40)/24-5;
  xhair(svg,()=>vals.map((v,h)=>[26+h*((W-40)/24)+bw/2,H-22-(H-40)*v/max]),h=>'<small>'+h+':00</small>'+vals[h].toFixed(2)+' kWh');
  vals.forEach((v,h)=>{
    const bh=(H-40)*v/max,x=26+h*((W-40)/24),peak=h===19;
    svg.append(el('rect',{x,y:H-22-bh,width:bw,height:bh,rx:3.5,class:'bar',
      fill:peak?'#FF9F0A':'#0A84FF',opacity:peak?1:.75,style:`--i:${h}`}));
    if(h%4===0){const t=el('text',{x:x+bw/2,y:H-7,class:'axis','text-anchor':'middle'});t.textContent=h+'h';svg.append(t);}
  });
})();

/* ---- load duration ---- */
(()=> {
  const svg=$('#ldc'),W=640,H=180,P={l:34,r:12,t:12,b:24};
  const pts=view.value.energy.loadDuration.map(p=>p.value);const n=pts.length;const aoKw=view.value.energy.alwaysOnW/1000;
  const scale=niceScale(Math.max(aoKw,...pts));
  const X=i=>n>1?P.l+(W-P.l-P.r)*i/(n-1):P.l, Y=v=>H-P.b-(H-P.t-P.b)*v/scale.top;
  for(let v=0;v<=scale.top+scale.step*0.01;v+=scale.step){
    svg.append(el('line',{x1:P.l,x2:W-P.r,y1:Y(v),y2:Y(v),class:'gl'}));
    const t=el('text',{x:P.l-7,y:Y(v)+3,class:'axis','text-anchor':'end'});t.textContent=(scale.step<1?v.toFixed(1):Math.round(v))+' kW';svg.append(t);
  }
  const totalHours=Math.max(0,Math.round(view.value.meta.rangeHours||0));
  [['0 h',0],[`${Math.round(totalHours*0.25)} h`,Math.round((n-1)*0.25)],[`${Math.round(totalHours*0.5)} h`,Math.round((n-1)*0.5)],[`${totalHours} h`,n-1]].forEach(([s,i])=>{
    const t=el('text',{x:X(i),y:H-8,class:'axis','text-anchor':'middle'});t.textContent=s;svg.append(t);
  });
  const defs=el('defs',{});
  defs.innerHTML=`<linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#64D2FF" stop-opacity=".14"/><stop offset="1" stop-color="#64D2FF" stop-opacity="0"/></linearGradient>`;
  svg.append(defs);
  const path=pts.map((v,i)=>[X(i),Y(v)]);
  if(n)svg.append(el('path',{d:smooth(path)+`L${X(n-1)},${Y(0)} L${X(0)},${Y(0)} Z`,fill:'url(#gd)',class:'fade'}));
  if(n)svg.append(el('path',{d:smooth(path),fill:'none',stroke:'#64D2FF','stroke-width':2.2,class:'draw',pathLength:1,'stroke-linecap':'round'}));
  svg.append(el('line',{x1:P.l,x2:W-P.r,y1:Y(aoKw),y2:Y(aoKw),stroke:'#30D158','stroke-width':1.4,'stroke-dasharray':'3 5',class:'fade'}));
  const t=el('text',{x:W-P.r,y:Y(aoKw)-6,class:'axis','text-anchor':'end',fill:'#30D158'});t.textContent='always-on '+view.value.energy.alwaysOnW+' W';svg.append(t);
  xhair(svg,()=>pts.map((v,i)=>[X(i),Y(v)]),i=>'<small>'+Math.round(i/(n-1)*720)+' h</small>'+pts[i].toFixed(2)+' kW');
})();

/* ---- energy flow (rebuilt) ----
   Balance: solar 3.28 kW out → home 2.41 + battery 0.63 + EV 0.24. Grid idle 0.00.
   Each path is drawn FROM source TO target; the dash animation moves dots start→end,
   so direction is always correct. */
(()=> {
  const svg=$('#flow');
  if(!svg)return;
  const F=view.value.solar.flow;
  const J=[380,208]; // junction
  const nodes={
    solar:  {x:380,y:82,  c:'#FFD60A', name:'Solar',  val:F.solar.toFixed(2),   unit:'kW', state:F.solar>0?'generating':'idle', icon:'sun'},
    grid:   {x:122,y:208, c:'#A9B2BE', name:'Grid',   val:F.grid.toFixed(2),    unit:'kW', state:F.grid>0?'importing':'idle',   icon:'grid'},
    home:   {x:638,y:208, c:'#0A84FF', name:'Home',   val:F.home.toFixed(2),    unit:'kW', state:'consuming',                   icon:'home', id:'fHome'},
    batt:   {x:248,y:340, c:'#30D158', name:'Battery',val:Math.abs(F.battery).toFixed(2), unit:'kW', state:F.battery>0?'discharging':F.battery<0?'charging':'idle', icon:'batt'},
    ev:     {x:512,y:340, c:'#64D2FF', name:'EV',     val:F.ev.toFixed(2),      unit:'kW', state:F.ev>0?'charging':'idle',      icon:'ev'},
  };
  const R=44;
  // edge helper: start/end trimmed to node circles, gentle curve through junction side
  function edge(a,b,curve){
    const dxa=J[0]-a.x,dya=J[1]-a.y,la=Math.hypot(dxa,dya);
    const dxb=b.x-J[0],dyb=b.y-J[1],lb=Math.hypot(dxb,dyb);
    const s=[a.x+dxa/la*(R+6),a.y+dya/la*(R+6)];
    const e=[b.x-dxb/lb*(R+6),b.y-dyb/lb*(R+6)];
    return `M${s[0]},${s[1]} Q${J[0]},${J[1]} ${e[0]},${e[1]}`;
  }
  // flows: source → target, speed ∝ power
  const flows=[
    {d:edge(nodes.solar,nodes.home), c:'#0A84FF', dur:1.1},   // solar → home
    {d:edge(nodes.solar,nodes.batt), c:'#30D158', dur:2.0},   // solar → battery
    {d:edge(nodes.solar,nodes.ev),   c:'#64D2FF', dur:2.6},   // solar → EV
  ];
  // idle grid rail
  svg.append(el('path',{d:`M${nodes.grid.x+R+6},${nodes.grid.y} L${J[0]-8},${J[1]}`,class:'flow-rail idle'}));
  flows.forEach(f=>{
    svg.append(el('path',{d:f.d,class:'flow-rail'}));
    const p=el('path',{d:f.d,class:'flow-dots',stroke:f.c});
    p.style.animationDuration=f.dur+'s';
    svg.append(p);
  });
  // junction
  svg.append(el('circle',{cx:J[0],cy:J[1],r:5,fill:'#FFD60A',opacity:.9}));
  svg.append(el('circle',{cx:J[0],cy:J[1],r:10,fill:'none',stroke:'rgba(255,214,10,.3)','stroke-width':1.5}));

  const icons={
    sun:'<circle cx="0" cy="0" r="4.5"/><path d="M0 -10v3M0 7v3M-10 0h3M7 0h3M-7.1 -7.1l2.1 2.1M5 5l2.1 2.1M7.1 -7.1L5 -5M-5 5l-2.1 2.1"/>',
    home:'<path d="M-9 0 L0 -8 L9 0"/><path d="M-6.5 -1.5 V8 H6.5 V-1.5"/>',
    grid:'<path d="M-6 9 L0 -9 L6 9"/><path d="M-4.5 3 H4.5 M-3 -2 H3"/>',
    batt:'<rect x="-8" y="-5" width="14" height="10" rx="2"/><path d="M8.5 -2 v4"/><path d="M-4.5 0 h7"/>',
    ev:'<path d="M-9 3 h18 M-7 3 v-4 l2.5 -4 h9 l2.5 4 v4"/><circle cx="-4.5" cy="5.5" r="1.8"/><circle cx="4.5" cy="5.5" r="1.8"/>'
  };
  for(const k in nodes){
    const n=nodes[k],g=el('g',{class:'fnode'});
    g.append(el('circle',{class:'halo',cx:n.x,cy:n.y,r:R+10,fill:n.c}));
    g.append(el('circle',{class:'body',cx:n.x,cy:n.y,r:R,stroke:n.c}));
    const ic=el('g',{class:'fic',stroke:n.c,transform:`translate(${n.x},${n.y-16})`});
    ic.innerHTML=icons[n.icon];g.append(ic);
    const val=el('text',{class:'fval',x:n.x,y:n.y+13});val.textContent=n.val;if(n.id)val.id=n.id;g.append(val);
    const un=el('text',{class:'funit',x:n.x,y:n.y+26});un.textContent=n.unit;g.append(un);
    const nm=el('text',{class:'fname',x:n.x,y:n.y-R-14});nm.textContent=n.name;g.append(nm);
    const st=el('text',{class:'fstate',x:n.x,y:n.y+R+18,fill:n.state==='idle'?'var(--faint)':n.c});st.textContent=n.state;g.append(st);
    svg.append(g);
  }
})();

/* ---- devices ---- */
(()=> {
  const cy=view.value.meta.currency;
  const consumers=view.value.devices.consumers;
  const maxShare=Math.max(1,...consumers.map(c=>c.sharePct));
  const list=$('#devList');
  consumers.forEach((d,i)=>{
    const cls=d.deltaKind==='bad'?'p-bad':d.deltaKind==='up'?'p-warn':'p-ok';
    const row=document.createElement('div');row.className='dev';
    row.innerHTML=`
      <div class="nm"><b>${esc(d.name)}</b><small>${esc(d.meta)}</small>
        <div class="track"><i class="hbar" style="width:${d.sharePct/maxShare*100}%;--i:${i}"></i></div></div>
      <div class="val">${esc(d.kwh)} kWh<small>${esc(cy)}${esc(d.cost)} · ${esc(d.sharePct)}%</small></div>
      <div class="val">${esc(d.liveW)} W<small>live</small></div>
      <div class="val"><span class="pill ${cls}">${esc(d.deltaLabel)}</span></div>`;
    list.append(row);
  });
  const tb=$('#meterRows');
  view.value.devices.meters.forEach(m=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${esc(m.meter)}</td><td class="mut">${esc(m.role)}</td><td class="r">${esc(m.live)}</td><td class="r">${esc(m.energy)}</td><td class="r">${esc(m.cost)}</td><td class="r mut">${esc(m.delta)}</td><td class="r">${esc(m.quality)}</td>
      <td class="r"><span class="pill ${m.online?'p-ok':'p-bad'}">${esc(m.status)}</span></td>`;
    tb.append(tr);
  });
})();

/* ---- anomalies & recommendations ---- */
(()=> {
  const icons={
    v:'<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"/>',
    ph:'<path d="M12 3v18M5 8h14M5 16h14"/>',
    hi:'<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    ao:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    co:'<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3v9h9"/>',
    off:'<path d="M18.4 5.6 5.6 18.4M12 3a9 9 0 1 1-9 9"/>'
  };
  function rowHTML(color,icon,title,body,pill,pillCls){
    return `<div class="alert-row">
      <div class="glyph" style="background:${esc(color)}18;color:${esc(color)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </div>
      <div><h4>${esc(title)}</h4><p>${esc(body)}</p></div>
      <div class="st"><span class="pill ${esc(pillCls)}">${esc(pill)}</span></div></div>`;
  }
  const alertHTML=a=>rowHTML(a.color,icons[a.icon]||'',a.title,a.body,a.pill,a.pillClass);
  $('#anoms').innerHTML=view.value.carbon.anomalies.map(alertHTML).join('');
  $('#recs').innerHTML=view.value.carbon.recommendations.map(alertHTML).join('');
})();
});
})();

  // ---- report modal: close on Escape (the range menu owns its own dismissal) ----
  const onDoc=(ev,fn)=>{document.addEventListener(ev,fn);cleanups.push(()=>document.removeEventListener(ev,fn));};
  onDoc('keydown',(e)=>{if(e.key==='Escape'){repOpen.value=false;}});
});

onUnmounted(() => { cleanups.forEach((f) => f()); cleanups = []; });
</script>


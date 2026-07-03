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
  <div class="tools">
    <div class="ed-tool-wrap">
      <button class="range num" title="Change date range" @click.stop="rangeMenu = !rangeMenu">{{ view.meta.rangeLabel }} <span style="opacity:.6">▾</span></button>
      <div v-if="rangeMenu" class="rmenu" @click.stop>
        <button v-for="r in RANGES" :key="r.key" type="button" @click="pickRange(r.key)">{{ r.label }}</button>
        <div class="rmenu-custom">
          <div class="rmenu-clabel">Custom range</div>
          <div class="rmenu-crow">
            <input v-model="customFrom" type="date" class="rmenu-cinput" aria-label="From date" />
            <input v-model="customTo" type="date" class="rmenu-cinput" aria-label="To date" />
          </div>
          <button type="button" class="rmenu-apply" :disabled="!customFrom || !customTo" @click="applyCustom">Apply</button>
        </div>
      </div>
    </div>
    <button class="ic" title="Filter devices" aria-label="Filter devices" @click="emit('open-filter')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg></button>
    <button class="ic" title="Refresh" aria-label="Refresh" @click="emit('refresh')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
    <button class="ic" title="Dashboard settings" aria-label="Dashboard settings" @click="emit('open-settings')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
    <button class="rep-btn" title="Download report" @click="repOpen = true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M8 10l4 4 4-4M5 20h14"/></svg> Report</button>
  </div>
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
        <div class="kpi num" style="font-size:38px"><span id="bigW">{{ view.power.liveKw.toFixed(2) }}</span><small>kW</small></div>
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
          <span>Temp<br><b style="font-size:15px">{{ view.energy.env.temp }}</b></span>
          <span>Humidity<br><b style="font-size:15px">{{ view.energy.env.humidity }}</b></span>
          <span>Luminance<br><b style="font-size:15px">{{ view.energy.env.luminance }}</b></span>
          <span>Flow<br><b style="font-size:15px">{{ view.energy.env.flow }}</b></span>
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
import {resolveEnergyDashboardView} from './energyDashboard.view';

const props = defineProps({
    // EnergyDashboardData (see energyDashboard.types.ts). null => dev fixture.
    d: {type: Object, default: null},
    // Tab to open on mount — lets the parent preserve the active tab across a
    // renderKey remount (refresh / lazy-loaded data) instead of resetting to Overview.
    initialTab: {type: String, default: 'overview'},
});
const emit = defineEmits(['pick-range', 'generate-report', 'open-filter', 'open-settings', 'refresh', 'tab-change']);

const rootEl = ref(null);
let cleanups = [];

// Date-range presets (Voltaine style); the parent resolves a key → from/to.
const RANGES = [
    {key: '24h', label: 'Last 24 hours'},
    {key: '7d', label: 'Last 7 days'},
    {key: '30d', label: 'Last 30 days'},
    {key: '90d', label: 'Last 90 days'},
    {key: 'month', label: 'This month'},
    {key: 'last_month', label: 'Last month'},
    {key: 'ytd', label: 'Year to date'},
    {key: 'last_year', label: 'Last year'},
];
const rangeMenu = ref(false);
const customFrom = ref('');
const customTo = ref('');
function pickRange(key) {
    emit('pick-range', {key});
    rangeMenu.value = false;
}
function applyCustom() {
    if (!customFrom.value || !customTo.value) return;
    emit('pick-range', {key: 'custom', from: customFrom.value, to: customTo.value});
    rangeMenu.value = false;
}

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

(function(){
"use strict";
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
      const p=Math.min((t-t0)/dur,1),e=1-Math.pow(1-p,3);
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
  const pow=Math.pow(10,Math.floor(Math.log10(rough)));
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
(function(){
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
    tt.innerHTML=`<small>${labels[i]||''}</small>${cons[i].toFixed(1)} kWh${rt}`;
    tt.style.opacity=1;tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY-14)+'px';
  });
  svg.addEventListener('mouseleave',()=>{tt.style.opacity=0;hl.setAttribute('opacity',0);hc.setAttribute('opacity',0);});
})();

defer(()=>{
/* ---- live power (full-bleed) ---- */
(function(){
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
(function(){
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
(function(){
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
(function(){
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
(function(){
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
(function(){
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
(function(){
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
      <div class="glyph" style="background:${color}18;color:${color}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </div>
      <div><h4>${esc(title)}</h4><p>${esc(body)}</p></div>
      <div class="st"><span class="pill ${pillCls}">${esc(pill)}</span></div></div>`;
  }
  const alertHTML=a=>rowHTML(a.color,icons[a.icon]||'',a.title,a.body,a.pill,a.pillClass);
  $('#anoms').innerHTML=view.value.carbon.anomalies.map(alertHTML).join('');
  $('#recs').innerHTML=view.value.carbon.recommendations.map(alertHTML).join('');
})();
});
})();

  // ---- toolbar dropdowns: close range menu / report menu on outside click + Escape ----
  const onDoc=(ev,fn)=>{document.addEventListener(ev,fn);cleanups.push(()=>document.removeEventListener(ev,fn));};
  onDoc('click',(e)=>{if(rangeMenu.value&&!e.target.closest('.ed-tool-wrap'))rangeMenu.value=false;});
  onDoc('keydown',(e)=>{if(e.key==='Escape'){rangeMenu.value=false;repOpen.value=false;}});
});

onUnmounted(() => { cleanups.forEach((f) => f()); cleanups = []; });
</script>

<style>
.evolt,.evolt *{box-sizing:border-box}
.evolt{
  --bg:#0A0C10;
  --panel:#13161C;
  --panel2:#181C23;
  --hair:rgba(255,255,255,.055);
  --hair2:rgba(255,255,255,.10);
  --ink:#F5F6F8;
  --sub:#9AA1AC;
  --faint:#5D646F;
  --blue:#0A84FF;
  --green:#30D158;
  --yellow:#FFD60A;
  --orange:#FF9F0A;
  --red:#FF453A;
  --cyan:#64D2FF;
  --grey:#A9B2BE;
  --r:18px;
  --font:'Inter',-apple-system,'SF Pro Text',system-ui,sans-serif;
}
.evolt *{margin:0;padding:0;box-sizing:border-box}
.evolt{
  /* transparent + fills the host container so the app's glass surface shows through */
  color:var(--ink);font-family:var(--font);
  font-size:14.5px;line-height:1.52;letter-spacing:-.008em;
  -webkit-font-smoothing:antialiased;
}
.evolt .num{font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.evolt{display:flex;flex-direction:column;width:100%}
.evolt header{display:flex;align-items:center;gap:14px;margin-bottom:20px;flex-wrap:wrap}
.evolt .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(160deg,#1E232B,#12151A);
  border:1px solid var(--hair2);display:grid;place-items:center;flex:0 0 auto}
.evolt .site h1{font-size:15px;font-weight:650;letter-spacing:-.02em}
.evolt .site p{font-size:11.5px;color:var(--faint);font-weight:450}
.evolt .hsp{flex:1}
.evolt .live{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--hair);
  border-radius:99px;padding:7px 14px 7px 11px;font-weight:500}
.evolt .ldot{width:7px;height:7px;border-radius:50%;background:var(--green);position:relative}
.evolt .ldot::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--green);
  opacity:0;animation:ping 2.4s ease-out infinite}
@keyframes ping{0%{transform:scale(.4);opacity:.7}70%{transform:scale(1.1);opacity:0}100%{opacity:0}}
.evolt .live b{font-weight:600;font-size:13px}
.evolt .live span{color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.evolt .range{font:500 12px var(--font);color:var(--sub);background:var(--panel);border:1px solid var(--hair);
  border-radius:99px;padding:8px 14px;cursor:pointer}
.evolt .range:hover{color:var(--ink);border-color:var(--hair2)}
.evolt .ic{cursor:pointer}
.evolt .ed-tool-wrap{position:relative}
.evolt .rmenu{position:absolute;top:calc(100% + 6px);right:0;min-width:180px;background:var(--panel);border:1px solid var(--hair2);border-radius:12px;padding:6px;z-index:30;box-shadow:0 20px 50px rgba(0,0,0,.55)}
.evolt .rmenu button{display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--ink);font:500 12.5px var(--font);padding:8px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.evolt .rmenu button:hover{background:var(--panel2)}
.evolt .rmenu-custom{border-top:1px solid var(--hair);margin-top:6px;padding:8px 4px 2px}
.evolt .rmenu-clabel{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);padding:0 6px 6px}
.evolt .rmenu-crow{display:flex;gap:6px;padding:0 4px 6px}
.evolt .rmenu-cinput{flex:1;min-width:0;background:#0E1116;border:1px solid var(--hair2);border-radius:8px;padding:6px 8px;color:var(--ink);font:500 11.5px var(--font)}
.evolt .rmenu-apply{display:block;width:calc(100% - 8px);margin:0 4px;text-align:center;background:var(--blue);color:#fff;border:none;border-radius:8px;padding:7px;font:600 12px var(--font);cursor:pointer}
.evolt .rmenu-apply:disabled{opacity:.4;cursor:not-allowed}
.evolt .toolbar{display:flex;align-items:center;gap:14px;margin:2px 0 24px;flex-wrap:wrap}
.evolt .tools{display:flex;align-items:center;gap:10px;margin-left:auto;flex-wrap:wrap}
.evolt .seg{display:flex;gap:2px;background:#14171D;border:1px solid var(--hair);border-radius:13px;
  padding:3px;overflow-x:auto;scrollbar-width:none;max-width:100%}
.evolt .seg::-webkit-scrollbar{display:none}
.evolt .seg button{appearance:none;border:none;background:transparent;color:var(--sub);cursor:pointer;
  font:500 12.5px var(--font);letter-spacing:-.01em;padding:8px 16px;border-radius:10px;
  white-space:nowrap;transition:color .2s,background .2s}
.evolt .seg button:hover{color:var(--ink)}
.evolt .seg button.on{background:#252A33;color:var(--ink);font-weight:600;
  box-shadow:0 1px 4px rgba(0,0,0,.35),inset 0 .5px 0 rgba(255,255,255,.07)}
.evolt .seg button:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.evolt section{display:none}
.evolt section.on{display:block}
.evolt .grid{display:grid;gap:11px}
.evolt .g4{grid-template-columns:repeat(4,1fr)}
.evolt .g3{grid-template-columns:repeat(3,1fr)}
.evolt .g2{grid-template-columns:repeat(2,1fr)}
.evolt .g32{grid-template-columns:1.75fr 1fr}
.evolt .mt{margin-top:12px}
@media(max-width:940px){.evolt .g4{grid-template-columns:repeat(2,1fr)}
.evolt .g3{grid-template-columns:repeat(2,1fr)}
.evolt .g32{grid-template-columns:1fr}}
@media(max-width:560px){.evolt .g4,
.evolt .g3,
.evolt .g2{grid-template-columns:1fr}}
.evolt .card{background:var(--panel);border:1px solid var(--hair);border-radius:var(--r);
  padding:15px 20px;position:relative;overflow:hidden}
.evolt .card.pad0{padding:0}
.evolt .on .card{animation:rise .5s cubic-bezier(.25,.7,.3,1) both;animation-delay:calc(var(--i,0)*45ms)}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.evolt .lab{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--sub);margin-bottom:10px}
.evolt .ctr{text-align:center;display:flex;flex-direction:column;justify-content:center}
.evolt .ctr .sub{justify-content:center}
.evolt .kpi{font-size:34px;font-weight:600;letter-spacing:-.03em;line-height:1.15;font-variant-numeric:tabular-nums}
.evolt .kpi small{font-size:13px;color:var(--sub);font-weight:500;margin-left:3px;letter-spacing:-.01em}
.evolt .kdelta{font-size:11px;font-weight:600;margin-top:6px;letter-spacing:.01em}
.evolt .kdelta.dn-good{color:var(--green)}
.evolt .kdelta.dn-bad{color:var(--orange)}
.evolt .sub{font-size:12px;color:var(--sub);margin-top:6px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-weight:450}
.evolt .sub b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.evolt .delta{font-size:11px;font-weight:600;padding:2px 7px;border-radius:99px;font-variant-numeric:tabular-nums}
.evolt .d-up{color:var(--red);background:rgba(255,69,58,.12)}
.evolt .d-dn{color:var(--green);background:rgba(48,209,88,.12)}
.evolt .d-ok{color:var(--green);background:rgba(48,209,88,.12)}
.evolt .d-warn{color:var(--orange);background:rgba(255,159,10,.12)}
.evolt .chip{font-size:11px;color:var(--sub);background:var(--panel2);border:1px solid var(--hair);
  padding:2.5px 9px;border-radius:99px;font-weight:500;font-variant-numeric:tabular-nums}
.evolt .head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.evolt .head h3{font-size:15px;font-weight:650;letter-spacing:-.015em}
.evolt .head span.meta{font-size:11px;color:var(--faint);font-weight:500}
.evolt .legend{display:flex;gap:14px;flex-wrap:wrap}
.evolt .legend i{display:inline-flex;align-items:center;gap:6px;font-style:normal;font-size:11px;color:var(--sub);font-weight:500}
.evolt .dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.evolt .hero{display:flex;flex-direction:column}
.evolt .hero .head{padding:16px 20px 0;margin-bottom:10px}
.evolt .hero svg.bleed{width:100%;flex:1;min-height:0;height:auto}
.evolt .hero .foot{padding:0 20px 16px}
.evolt .rows{margin-top:2px}
.evolt .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  padding:7px 0;border-bottom:1px solid var(--hair);font-size:12.5px;color:var(--sub);font-weight:450}
.evolt .row:last-child{border-bottom:none}
.evolt .row b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.evolt .row.total{border-top:1px solid var(--hair2);margin-top:2px;padding-top:9px}
.evolt .row.total span{color:var(--ink);font-weight:600}
.evolt svg{display:block}
.evolt text{font-family:var(--font);font-variant-numeric:tabular-nums}
.evolt .axis{font-size:9.5px;fill:var(--faint);font-weight:500}
.evolt .gl{stroke:rgba(255,255,255,.045)}
.evolt .on path.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.3s .2s cubic-bezier(.4,0,.2,1) forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.evolt .on .fade{opacity:0;animation:fade .7s .55s forwards}
@keyframes fade{to{opacity:1}}
.evolt .on .bar{transform:scaleY(0);transform-origin:bottom;animation:grow .6s cubic-bezier(.25,.7,.3,1) forwards;
  animation-delay:calc(.12s + var(--i,0)*18ms)}
@keyframes grow{to{transform:scaleY(1)}}
.evolt .on .hbar{transform:scaleX(0);transform-origin:left;animation:growx .7s cubic-bezier(.25,.7,.3,1) forwards;
  animation-delay:calc(.15s + var(--i,0)*55ms)}
@keyframes growx{to{transform:scaleX(1)}}
.evolt .prog{height:5px;border-radius:99px;background:var(--panel2);overflow:hidden;margin-top:10px}
.evolt .prog i{display:block;height:100%;border-radius:99px}
.evolt .split{display:flex;height:7px;border-radius:99px;overflow:hidden;margin:11px 0 9px;gap:2px}
.evolt .split i{height:100%;border-radius:99px}
.evolt .dev{display:grid;grid-template-columns:1fr 96px 78px 64px;gap:12px;align-items:center;
  padding:11px 0;border-bottom:1px solid var(--hair)}
.evolt .dev:last-child{border-bottom:none}
.evolt .dev .nm b{font-size:13px;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}
.evolt .dev .nm small{font-size:10.5px;color:var(--faint);font-weight:450}
.evolt .dev .track{height:4px;border-radius:99px;background:var(--panel2);margin-top:7px;overflow:hidden}
.evolt .dev .track i{display:block;height:100%;border-radius:99px;background:var(--blue)}
.evolt .dev .val{font-size:12.5px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.evolt .dev .val small{display:block;color:var(--faint);font-size:10px;font-weight:450}
.evolt .tree .row{padding:6.5px 0}
.evolt .tree .in1{padding-left:18px}
.evolt .tree .muted{color:var(--faint)}
.evolt table{width:100%;border-collapse:collapse;font-size:12px}
.evolt th{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);
  text-align:left;padding:12px 18px;border-bottom:1px solid var(--hair)}
.evolt td{padding:10px 18px;border-bottom:1px solid var(--hair);font-variant-numeric:tabular-nums;font-weight:500}
.evolt tr:last-child td{border-bottom:none}
.evolt td.mut{color:var(--sub);font-weight:450}
.evolt th.r,
.evolt td.r{text-align:right}
.evolt .pill{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px}
.evolt .p-ok{color:var(--green);background:rgba(48,209,88,.1)}
.evolt .p-bad{color:var(--red);background:rgba(255,69,58,.1)}
.evolt .p-warn{color:var(--orange);background:rgba(255,159,10,.1)}
.evolt .flow-rail{fill:none;stroke:rgba(255,255,255,.07);stroke-width:2}
.evolt .flow-rail.idle{stroke-dasharray:2 6;stroke:rgba(255,255,255,.09)}
.evolt .flow-dots{fill:none;stroke-width:3.5;stroke-linecap:round;stroke-dasharray:.5 12;animation:flow linear infinite}
@keyframes flow{to{stroke-dashoffset:-12.5}}
.evolt .fnode circle.body{fill:#161A21;stroke-width:1.5}
.evolt .fnode circle.halo{opacity:.10}
.evolt .fnode .fic{stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;fill:none}
.evolt .fnode .fname{font-size:10px;fill:var(--sub);text-anchor:middle;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.evolt .fnode .fval{font-size:16px;fill:var(--ink);text-anchor:middle;font-weight:650;letter-spacing:-.02em}
.evolt .fnode .funit{font-size:9.5px;fill:var(--faint);text-anchor:middle;font-weight:500}
.evolt .fnode .fstate{font-size:9.5px;text-anchor:middle;font-weight:600}
.evolt .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--hair)}
.evolt .stats>div{padding:13px 20px;border-right:1px solid var(--hair)}
.evolt .stats>div:last-child{border-right:none}
.evolt .stats .sl{font-size:11.5px;font-weight:600;color:var(--sub);letter-spacing:.02em}
.evolt .stats .sv{font-size:16px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:1px}
.evolt .stats .sv small{font-size:10.5px;color:var(--sub);font-weight:500}
@media(max-width:560px){.evolt .stats{grid-template-columns:repeat(2,1fr)}
.evolt .stats>div:nth-child(2){border-right:none}}
.evolt .alert-row{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--hair)}
.evolt .alert-row:last-child{border-bottom:none}
.evolt .glyph{width:30px;height:30px;flex:0 0 auto;border-radius:9px;display:grid;place-items:center}
.evolt .alert-row h4{font-size:12.5px;font-weight:600;letter-spacing:-.01em}
.evolt .alert-row p{font-size:11.5px;color:var(--sub);font-weight:450;margin-top:1px}
.evolt .alert-row p b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.evolt .alert-row .st{margin-left:auto;flex:0 0 auto}
.evolt footer{margin-top:36px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;
  color:var(--faint);font-size:10.5px;font-weight:500;letter-spacing:.02em}
.evolt .tt{position:fixed;pointer-events:none;background:rgba(18,21,27,.92);backdrop-filter:blur(8px);
  border:1px solid var(--hair2);border-radius:11px;padding:8px 12px;font-size:11.5px;font-weight:600;
  font-variant-numeric:tabular-nums;z-index:10;opacity:0;transition:opacity .15s;
  box-shadow:0 10px 30px rgba(0,0,0,.5)}
.evolt .tt small{display:block;color:var(--sub);font-weight:500;font-size:10px;margin-bottom:2px}
@media (prefers-reduced-motion: reduce){.evolt *,
.evolt *::before,
.evolt *::after{animation-duration:.01ms!important;animation-delay:0ms!important;transition-duration:.01ms!important}}
@keyframes pf{to{stroke-dashoffset:0}}
.evolt .ic{width:36px;height:36px;border-radius:99px;background:var(--panel);border:1px solid var(--hair);color:var(--sub);display:grid;place-items:center;cursor:pointer;transition:color .2s,background .2s,border-color .2s;flex:0 0 auto}
.evolt .ic:hover{color:var(--ink);border-color:var(--hair2)}
.evolt .ic.on{color:var(--ink);background:var(--panel2);border-color:var(--hair2)}
.evolt .ic.spin svg{animation:spin .7s linear}
@keyframes spin{to{transform:rotate(360deg)}}
.evolt .fpop{position:fixed;top:66px;right:34px;width:322px;background:var(--panel);border:1px solid var(--hair2);border-radius:16px;padding:16px 18px;z-index:30;box-shadow:0 22px 54px rgba(0,0,0,.55);display:none}
.evolt .fpop.on{display:block}
.evolt .fpop .fh{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
.evolt .fpop .fh h4{font-size:13px;font-weight:650;letter-spacing:-.01em}
.evolt .fg{margin-bottom:14px}
.evolt .fl{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
.evolt .fc{display:flex;flex-wrap:wrap;gap:6px}
.evolt .fchip{font-size:12px;color:var(--sub);background:var(--panel2);border:1px solid var(--hair);padding:6px 12px;border-radius:99px;cursor:pointer;font-weight:500}
.evolt .fchip:hover{color:var(--ink)}
.evolt .fchip.on{color:var(--ink);background:#252A33;border-color:var(--hair2);font-weight:600}
.evolt .fhint{font-size:11px;color:var(--faint);border-top:1px solid var(--hair);padding-top:11px;line-height:1.5}
.evolt .fhint a{color:var(--blue);text-decoration:none}
.evolt .rep-btn{display:inline-flex;align-items:center;gap:7px;background:var(--blue);color:#fff;border:none;border-radius:99px;padding:8px 15px;font:600 12.5px var(--font);cursor:pointer;flex:0 0 auto}
.evolt .rep-btn:hover{filter:brightness(1.08)}
.evolt .mov{position:fixed;inset:0;background:rgba(6,8,12,.72);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:100;padding:24px}
.evolt .mov.on{display:flex}
.evolt .modal{width:760px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--hair2);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.evolt .rep-modal{width:520px}
.evolt .rep-types{display:flex;flex-direction:column;gap:9px}
.evolt .rep-type{display:flex;flex-direction:column;gap:3px;text-align:left;background:#0E1116;border:1px solid var(--hair2);border-radius:13px;padding:13px 15px;cursor:pointer;transition:border-color .12s,background .12s}
.evolt .rep-type:hover{border-color:var(--hair2);background:#12161C}
.evolt .rep-type.on{border-color:var(--blue);background:rgba(68,149,209,.09)}
.evolt .rt-name{font:600 13.5px var(--font);color:var(--ink)}
.evolt .rt-desc{font:450 12px var(--font);color:var(--faint);line-height:1.45}
.evolt .rep-note{font:450 11.5px var(--font);color:var(--faint);line-height:1.5;margin:2px 0 0}
.evolt .rep-chips{display:flex;flex-wrap:wrap;gap:6px}
.evolt .rep-chip{font-size:12px;color:var(--sub);background:var(--panel2);border:1px solid var(--hair);padding:6px 12px;border-radius:99px;cursor:pointer;font-weight:500}
.evolt .rep-chip:hover{color:var(--ink)}
.evolt .rep-chip.on{color:var(--ink);background:#252A33;border-color:var(--hair2);font-weight:600}
.evolt .rep-check{display:flex;align-items:center;gap:9px;font-size:12.5px;font-weight:500;color:var(--sub);cursor:pointer;margin-bottom:14px}
.evolt .rep-hint-inline{text-transform:none;font-weight:450;color:var(--faint)}
.evolt .mhd{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--hair)}
.evolt .mhd h3{font-size:15px;font-weight:650;letter-spacing:-.02em}
.evolt .msub{font-size:11.5px;color:var(--faint);font-weight:450;margin-top:1px}
.evolt .mx{width:30px;height:30px;border-radius:9px;background:transparent;border:1px solid transparent;color:var(--sub);cursor:pointer;font-size:15px}
.evolt .mx:hover{background:var(--panel2);color:var(--ink)}
.evolt .mbody{display:grid;grid-template-columns:186px 1fr;min-height:0;flex:1}
.evolt .mrail{border-right:1px solid var(--hair);padding:12px;display:flex;flex-direction:column;gap:2px;background:#111419;overflow:auto}
.evolt .mtab{appearance:none;border:none;background:transparent;color:var(--sub);cursor:pointer;font:500 13px var(--font);text-align:left;padding:9px 12px;border-radius:9px}
.evolt .mtab:hover{color:var(--ink);background:var(--panel2)}
.evolt .mtab.on{color:var(--ink);background:var(--panel2);font-weight:600}
.evolt .mpanel{padding:20px 22px;overflow:auto}
.evolt .mview{display:none}
.evolt .mview.on{display:block}
.evolt .field{margin-bottom:16px}
.evolt .field .fl{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
.evolt .field input,
.evolt .field select{width:100%;background:#0E1116;border:1px solid var(--hair2);border-radius:10px;padding:9px 11px;color:var(--ink);font:500 13px var(--font)}
.evolt .frow{display:flex;gap:10px}
.evolt .seg2{display:inline-flex;flex-wrap:wrap;gap:2px;background:#14171D;border:1px solid var(--hair);border-radius:11px;padding:3px}
.evolt .seg2 button{appearance:none;border:none;background:transparent;color:var(--sub);cursor:pointer;font:500 12px var(--font);padding:7px 13px;border-radius:8px;white-space:nowrap}
.evolt .seg2 button:hover{color:var(--ink)}
.evolt .seg2 button.on{background:#252A33;color:var(--ink);font-weight:600}
.evolt .chkrow{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--sub);font-weight:500;margin-top:10px;cursor:pointer}
.evolt .chks{display:flex;flex-direction:column;gap:9px;margin-top:4px}
.evolt .mft{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 22px;border-top:1px solid var(--hair)}
.evolt .btn-primary{background:var(--blue);color:#fff;border:none;border-radius:11px;padding:9px 18px;font:600 13px var(--font);cursor:pointer}
.evolt .btn-primary:hover{filter:brightness(1.08)}
.evolt .btn-ghost{background:transparent;color:var(--sub);border:1px solid var(--hair2);border-radius:11px;padding:9px 16px;font:500 13px var(--font);cursor:pointer}
.evolt .btn-ghost:hover{color:var(--ink)}
.evolt{min-height:100%;flex:1}
.evolt section.on>.grid{flex-shrink:0}
.evolt section.on>.grid:has(.hero){flex-shrink:1}
.evolt section{flex:1 1 auto}
.evolt section.on{display:flex;flex-direction:column;gap:11px;min-height:0}
.evolt .mt{margin-top:0}
.evolt section.on>.grid:has(.hero){flex:1 1 auto;min-height:0}
.evolt section.on .hero{height:100%}
.evolt #solar.on>.hero{flex:1 1 auto;min-height:0}
.evolt #devices.on>.grid:first-of-type{flex:1 1 auto;min-height:0}
.evolt #insights.on>.grid:last-of-type{flex:1 1 auto;min-height:0}
.evolt section.on>.grid:has(.hero)>.grid{align-content:stretch;grid-auto-rows:1fr}
.evolt .nudge{display:none;flex-direction:column;align-items:center;gap:5px;color:var(--faint);font-size:12px;font-weight:500;text-align:center}
.evolt .nudge .cta{color:var(--blue);font-weight:600;cursor:pointer}
.evolt .card-nudge{align-items:flex-start;text-align:left;padding:16px 0 6px}
.evolt.cold .hide-cold{display:none!important}
.evolt.cold .nudge{display:flex}
.evolt .setup{display:flex;flex-wrap:wrap;align-items:center;gap:18px;background:linear-gradient(180deg,rgba(10,132,255,.09),var(--panel));border:1px solid rgba(10,132,255,.28);border-radius:var(--r);padding:16px 20px;margin-bottom:16px}
.evolt .setup-l{display:flex;flex-direction:column;gap:2px;flex:1;min-width:260px}
.evolt .setup-l b{font-size:15px;font-weight:650}
.evolt .setup-l span{font-size:12.5px;color:var(--sub)}
.evolt .setup-items{display:flex;flex-wrap:wrap;gap:8px}
.evolt .si{display:flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--hair);border-radius:99px;padding:7px 13px;font-size:12px;font-weight:500;color:var(--sub);appearance:none;cursor:pointer;font-family:var(--font)}
.evolt .si:hover{border-color:rgba(10,132,255,.5);color:var(--ink)}
.evolt .sidot{width:7px;height:7px;border-radius:50%;background:var(--orange);flex:0 0 auto}
.evolt .si .cta{color:var(--blue);font-weight:600;cursor:pointer;margin-left:2px}
</style>

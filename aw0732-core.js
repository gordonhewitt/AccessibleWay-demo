/* AccessibleWay 0.7.3.2 — Airport Route ↔ Motion Evidence Data Contract
 * Additive, local-only adapter. Airport route authority stays in engine.html.
 * No absolute positioning, distance calibration, route adherence or statistical confidence.
 */
(function(root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AW0732 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const MAX_EVENTS = 50000, MAX_WINDOWS = 25000, MAX_POINTS = 20000;
  const STATES = new Set(['stationary', 'moving-like', 'turning-like', 'uncertain']);
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const safeString = (s, max = 240) => typeof s === 'string' ? s.slice(0, max) : '';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function hash(str) { // Non-security fingerprint, detects changes in simulated route geometry.
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function normalizeRouteMessage(msg) {
    if (!msg || msg.type !== 'AW_NAV_STATE' || msg.source !== 'airport-engine-064')
      throw Error('Not an AccessibleWay airport-engine navigation state.');
    if (!Array.isArray(msg.points) || msg.points.length > MAX_POINTS)
      throw Error('Airport route points are missing or exceed the safe limit.');
    const points = msg.points.map((p, i) => {
      if (!p || !finite(p.x) || !finite(p.y) || !finite(p.floor) || p.floor < 0 || p.floor > 100)
        throw Error('Invalid airport route point at index ' + i + '.');
      return {x: p.x, y: p.y, floor: p.floor,
        kind: safeString(p.kind, 100), transition: safeString(p.transition, 40)};
    });
    const active = points.length >= 2;
    const idx = finite(msg.index) ? clamp(Math.trunc(msg.index), 0, Math.max(0, points.length - 1)) : 0;
    const engineId = safeString(msg.routeIdentity, 600);
    const fingerprint = active ? hash(JSON.stringify({points,
      start: safeString(msg.start), destination: safeString(msg.destination),
      wheelchair: !!msg.wheelchair, preference: safeString(msg.preference, 40)})) : null;
    const transitions = points.slice(1).filter((p, i) => p.floor !== points[i].floor).length;
    return {active, points, index: idx, fingerprint, engineId, transitions,
      start: safeString(msg.start), destination: safeString(msg.destination),
      destinationName: safeString(msg.destinationName),
      wheelchair: !!msg.wheelchair, preference: safeString(msg.preference, 40),
      currentFloor: points[idx] ? points[idx].floor : null,
      guidance: safeString(msg.event && msg.event.text, 500),
      phase: safeString(msg.event && msg.event.phase, 80)};
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  function standardDeviation(a) {
    if (!a.length) return 0;
    const m = mean(a);
    return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
  }
  const headingDifference = (a, b) => ((b - a + 540) % 360) - 180;
  // Recordings arrive at different sensor rates. The repository's synthetic sample
  // uses 520 ms intervals (roughly 2 Hz), so a fixed 2-second / 8-reading window
  // previously rejected every otherwise valid part of that sample.
  function observedIntervalMs(samples) {
    const gaps = [];
    for (let i = 1; i < samples.length; i++) {
      const delta = samples[i].t - samples[i - 1].t;
      if (finite(delta) && delta > 0) gaps.push(delta);
    }
    if (!gaps.length) return null;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }
  function windowLengthMs(samples) {
    const interval = observedIntervalMs(samples);
    if (!finite(interval)) throw Error('Recording contains no advancing sensor timestamps.');
    // Keep >=8 readings per window whenever the observed rate allows it.
    // Never label these windows as fixed two-second windows.
    return clamp(Math.ceil(interval * 8 / 100) * 100, 2000, 15000);
  }
  function windowsForSamples(samples) {
    if (samples.length < 12) throw Error('At least 12 valid sensor observations are required.');
    const first = samples[0].t, end = samples[samples.length - 1].t;
    if (end - first > MAX_WINDOWS * 2000)
      throw Error('Recording time span is too long. Split the recording.');
    const duration = windowLengthMs(samples);
    const output = [];
    let left = 0, right = 0;
    for (let at = first; at + 1500 <= end; at += duration) {
      while (left < samples.length && samples[left].t < at) left++;
      right = Math.max(right, left);
      while (right < samples.length && samples[right].t < at + duration) right++;
      const subset = samples.slice(left, right);
      const magnitudes = subset.map(x => Math.hypot(x.acc.x, x.acc.y, x.acc.z));
      if (magnitudes.length < 8) continue;
      const headings = subset.filter(x => finite(x.heading)).map(x => x.heading);
      const variation = standardDeviation(magnitudes);
      const turn = headings.length > 2 ? headingDifference(headings[0], headings[headings.length - 1]) : null;
      let state = 'uncertain';
      if (variation < 0.25 && (!finite(turn) || Math.abs(turn) < 8)) state = 'stationary';
      else if (finite(turn) && Math.abs(turn) > 25) state = 'turning-like';
      else if (variation > 0.75) state = 'moving-like';
      output.push({startMs: at - first, endMs: Math.min(at + duration, end) - first,
        samples: subset.length, accelerationSd: variation,
        relativeHeadingChangeDeg: turn, state});
    }
    return output;
  }
  function normalizeWindow(w, i) {
    if (!w || !finite(w.startMs) || !finite(w.endMs) || w.startMs < 0 || w.endMs < w.startMs ||
        !finite(w.accelerationSd) || w.accelerationSd < 0 || !STATES.has(w.state) ||
        (w.relativeHeadingChangeDeg !== null && w.relativeHeadingChangeDeg !== undefined && !finite(w.relativeHeadingChangeDeg))) {
      throw Error('Invalid analysis window ' + i + '.');
    }
    return {startMs: w.startMs, endMs: w.endMs,
      samples: finite(w.samples) ? Math.max(0, Math.trunc(w.samples)) : null,
      accelerationSd: w.accelerationSd,
      relativeHeadingChangeDeg: finite(w.relativeHeadingChangeDeg) ? w.relativeHeadingChangeDeg : null,
      state: w.state};
  }
  function counts(windows) {
    const out = {stationary: 0, 'moving-like': 0, 'turning-like': 0, uncertain: 0};
    windows.forEach(w => {out[w.state]++;});
    return out;
  }
  function normalizeEvidence(input, filename) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a JSON object.');
    const label = safeString(filename || 'unnamed JSON', 100);
    if (input.analysisType === 'experimental_motion_evidence') {
      if (input.version !== '0.7.3' || !Array.isArray(input.windows) || input.windows.length > MAX_WINDOWS)
        throw Error('Expected the AccessibleWay 0.7.3 trajectory analysis export.');
      if (input.absolutePositionAvailable !== false || input.routeAdherenceVerified !== false || input.confidenceCalibrated !== false)
        throw Error('Report lacks mandatory non-positioning / uncalibrated evidence flags.');
      const windows = input.windows.map(normalizeWindow);
      if (!windows.length) throw Error('Analysis report contains no usable windows.');
      return {kind: '0.7.3 analysis', label, originFormat: safeString(input.source && input.source.format, 80),
        windows, windowCounts: counts(windows),
        sensorSamples: finite(input.sensorSamples) ? Math.trunc(input.sensorSamples) : 0,
        durationSeconds: finite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : windows[windows.length - 1].endMs / 1000,
        assumptionWarning: 'The source report may include assumed route length, speed and start location. Those assumptions are NOT used to locate the passenger on the airport graph.'};
    }
    if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS)
      throw Error('Expected a raw recording with no more than 50,000 events, or a 0.7.3 analysis export.');
    const samples = input.events.filter(e => e && e.kind === 'sensor' && finite(e.t) && e.acc &&
      finite(e.acc.x) && finite(e.acc.y) && finite(e.acc.z)).map(e => ({
      t: e.t, acc: {x: e.acc.x, y: e.acc.y, z: e.acc.z},
      heading: finite(e.heading) ? e.heading : null
    })).sort((a, b) => a.t - b.t);
    if (samples.length < 12) throw Error('Too few valid, timestamped sensor observations.');
    const intervalMs = observedIntervalMs(samples);
    const windows = windowsForSamples(samples);
    if (!windows.length) throw Error('No analysable motion windows: recording is too short or too sparse for eight readings per window.');
    const analysisWindowMs = windowLengthMs(samples);
    const isSynthetic = /\bsynthetic\b/i.test(safeString(input.description, 600));
    return {kind: 'raw recording (analysed locally)', label,
      originFormat: safeString(input.format, 80), windows, windowCounts: counts(windows),
      sensorSamples: samples.length,
      analysisWindowMs,
      durationSeconds: Math.max(0, (samples[samples.length - 1].t - samples[0].t) / 1000),
      assumptionWarning: (isSynthetic ? 'Synthetic replay: NOT measured passenger observations. ' : '') +
        'Observation interval approximately ' + Math.round(intervalMs) + ' ms; adaptive analysis windows ' +
        (analysisWindowMs / 1000).toFixed(2) + ' s. Motion labels are uncalibrated heuristics, not measured distance, route adherence or positioning.'};
  }
  function associate(route, evidence) {
    if (!route || !route.active || !route.fingerprint || route.points.length < 2)
      throw Error('Calculate an airport candidate route before associating evidence.');
    if (!evidence || !evidence.windows || !evidence.windows.length)
      throw Error('Load motion evidence before associating it with the route.');
    return {
      format: 'AccessibleWay-route-evidence-0.7.3.2',
      associationType: 'operator_selected_scenario_only',
      airportRoute: {
        routeFingerprint: route.fingerprint,
        engineRouteIdentity: route.engineId,
        start: route.start, destination: route.destination,
        waypointCount: route.points.length, floorTransitions: route.transitions,
        wheelchairPreference: route.wheelchair, verticalPreference: route.preference,
        geometryIsSimulated: true, distancesCalibrated: false,
        liftStairAccessibilityVerified: false
      },
      motionEvidence: {
        fileLabel: evidence.label, sourceKind: evidence.kind,
        format: evidence.originFormat, sensorSamples: evidence.sensorSamples,
        durationSeconds: evidence.durationSeconds,
        windowCounts: {...evidence.windowCounts},
        windows: evidence.windows.map(w => ({...w}))
      },
      absolutePositionAvailable: false,
      routeAdherenceVerified: false,
      confidenceCalibrated: false,
      temporalAlignmentEstablished: false,
      spatialAlignmentEstablished: false,
      routeProgressInferredFromSensors: false,
      guidanceSafetyVerified: false,
      warning: 'Scenario association only. No evidence that these observations occurred on the simulated route; no measured map distance or validated positioning.'
    };
  }
  return {normalizeRouteMessage, normalizeEvidence, associate, windowsForSamples, standardDeviation, headingDifference};
});

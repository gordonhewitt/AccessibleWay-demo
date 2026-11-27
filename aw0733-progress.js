/* AccessibleWay 0.7.3.3 - experimental hypothesis, NOT positioning. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AW0733 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const STATES = new Set(['stationary', 'moving-like', 'turning-like', 'uncertain']);

  function validateInputs(route, evidence, params) {
    if (!route || route.active !== true || typeof route.fingerprint !== 'string' || !route.fingerprint ||
        !Array.isArray(route.points) || route.points.length < 2)
      throw Error('Calculate a candidate airport route first.');
    if (!evidence || !Array.isArray(evidence.windows) || !evidence.windows.length || evidence.windows.length > 25000)
      throw Error('Load motion evidence before generating a hypothesis.');
    if (!params || params.anchor !== 'operator_asserted_route_start' || params.routeFingerprint !== route.fingerprint)
      throw Error('The operator must explicitly anchor the evidence to the current route origin.');
    const len = params.operatorRouteLengthMetres;
    const lo = params.assumedMinSpeedMetresPerSecond;
    const hi = params.assumedMaxSpeedMetresPerSecond;
    if (!finite(len) || len <= 0 || len > 100000)
      throw Error('Enter a positive operator-supplied scenario route length in metres.');
    if (!finite(lo) || !finite(hi) || lo < 0 || hi <= 0 || lo > hi || hi > 6)
      throw Error('Enter a valid explicit speed range in metres per second.');
    return { len, lo, hi };
  }

  function buildProgressHypothesis(route, evidence, params) {
    const { len, lo, hi } = validateInputs(route, evidence, params);
    let lastEnd = -1, cumulativeLower = 0, cumulativeUpper = 0;
    const windows = evidence.windows.map((w, index) => {
      if (!w || !finite(w.startMs) || !finite(w.endMs) || w.startMs < 0 ||
          w.endMs <= w.startMs || w.startMs < lastEnd - 0.001 || !STATES.has(w.state))
        throw Error('Invalid or overlapping evidence window at index ' + index + '.');
      lastEnd = w.endMs;
      const seconds = (w.endMs - w.startMs) / 1000;
      let lower = 0, upper = 0;
      if (w.state === 'moving-like') { lower = lo * seconds; upper = hi * seconds; }
      else if (w.state === 'turning-like' || w.state === 'uncertain') { upper = hi * seconds; }
      // No distance is assumed for windows labelled stationary.
      // All labels are heuristic: the resulting bounds are conditional, not guaranteed.
      cumulativeLower += lower;
      cumulativeUpper += upper;
      return {
        index, startMs: w.startMs, endMs: w.endMs, state: w.state,
        assumedLowerDistanceMetres: Number(cumulativeLower.toFixed(3)),
        assumedUpperDistanceMetres: Number(cumulativeUpper.toFixed(3)),
        hypotheticalLowerPercent: Number((100 * clamp(cumulativeLower / len, 0, 1)).toFixed(2)),
        hypotheticalUpperPercent: Number((100 * clamp(cumulativeUpper / len, 0, 1)).toFixed(2))
      };
    });
    return {
      format: 'AccessibleWay-progress-hypothesis-0.7.3.3',
      status: 'hypothesis_only_not_navigation',
      routeFingerprint: route.fingerprint,
      sourceKind: evidence.kind || 'unverified sensor evidence',
      assumptionBasis: {
        anchor: 'operator_asserted_route_start',
        routeLengthMetres: len,
        routeLengthProvidedByOperator: true,
        routeLengthValidatedAgainstAirport: false,
        minimumAssumedSpeedMetresPerSecond: lo,
        maximumAssumedSpeedMetresPerSecond: hi
      },
      windows,
      output: {
        hypotheticalLowerPercent: windows[windows.length - 1].hypotheticalLowerPercent,
        hypotheticalUpperPercent: windows[windows.length - 1].hypotheticalUpperPercent,
        calculatedAtEvidenceMs: windows[windows.length - 1].endMs
      },
      absolutePositionVerified: false,
      routeAdherenceVerified: false,
      temporalAlignmentVerified: false,
      geographicAlignmentVerified: false,
      calibratedConfidenceAvailable: false,
      estimatedArrivalVerified: false,
      automaticNavigationAllowed: false,
      warning: 'Illustrative conditional range only. Motion labels, timing, route origin, route length and travel speed are not measured or validated together. Do not treat as passenger location, route completion, guidance or arrival.'
    };
  }
  function stillMatchesRoute(hypothesis, route) {
    return !!(hypothesis && route && route.active && hypothesis.routeFingerprint === route.fingerprint);
  }
  return { buildProgressHypothesis, stillMatchesRoute };
});

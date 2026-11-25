# AccessibleWay 0.7.0.12 — Public Engineering Demonstration

Static GitHub Pages deployment of the accepted 0.7.0.12 engineering prototype. **Experimental only; not for actual wayfinding or accessibility assistance.** The airport graph and route data are simulated.

## Contents
- `index.html` — combined engineering / mobile experience
- `engine.html` — airport route graph and controls
- `experience.html` — mobile and wearable previews
- `sample_replay.json` — synthetic observations for Recorded Replay

## Deploy
Create a separate public repository, suggested `accessibleway-demo`, owned by `gordonhewitt`. Upload these five files to the repository root. In Settings → Pages select Deploy from a branch, `main`, `/(root)`. Expected URL: `https://gordonhewitt.github.io/accessibleway-demo/`. This URL is only proposed until Pages is enabled.

## Use
Open the published `index.html`. Calculate an airport route in the engineering panel, select and enable audio, then use manual Advance Step or Play Journey. To test Recorded Replay, choose that mode, import `sample_replay.json`, and press Replay. The sample may end before the journey does; that is expected.

## Privacy and limits
This is a public static site. Do not upload actual sensor recordings, personal information, credentials or private NTT DATA assets. The Live Device mode is disabled because a static GitHub Pages site cannot host the local bridge. The underlying application is a prototype and has not been certified for accessibility or safety-critical navigation.

## Versioning
Keep this repository independent from `accessibleway-sensor-test`. This package is a public demo of **0.7.0.12**, not the 0.7.2 sensor collector.

# Authoring workflow

Liquid authoring is an offline data workflow. The runtime consumes scene JSON and evaluates it deterministically; it does not run live physics, solve constraints, or mutate scene data during playback.

## Canonical assets

SVG assets are canonicalized from `shared/assets/*.svg` into `shared/assets/manifest.json`:

```sh
npm run assets:check
npm run assets:generate
```

`tools/canonicalize-assets.mjs` parses `M`, `L`, `H`, `V`, `C`, and `Z` path data, resolves relative commands, rounds coordinates to six decimals, splits subpaths, records bounds and SHA-256 path hashes, and names known Addy subpaths. The current manifest includes `addy-a`, `addy-spinner`, and `addy-wordmark`.

After scene or asset changes, mirror shared resources into the npm and Swift packages:

```sh
npm run resources:check
npm run resources:generate
```

## Generated scenes

`shared/scenes/spinner-to-addy.v2.json`, `shared/scenes/addy-logo-wave.v2.json`, `shared/scenes/addy-logo-wave-wordmark.v2.json`, `shared/scenes/addy-logo-wave-wordmark-replay.v2.json`, and their golden sample checkpoints are generated from `tools/author-spinner-to-addy.mjs`. The wave's step timing and spring are `WAVE_STEP_MS` and `WAVE_SPRING`, the number of wave steps before the wordmark is `WAVE_STEPS_BEFORE_WORDMARK`, and the letters' landing is `SETTLE_MS`, `SETTLE_SHARPEN_END`, `SETTLE_RETURN_START`, `SETTLE_SPRING`, `SETTLE_PUSH`, and `SETTLE_SWELL`. The replay variation's letter drop is `EXIT_ORDER`, `EXIT_STAGGER_MS`, `EXIT_LIFT`, `EXIT_LIFT_MS`, `EXIT_FALL_MS`, `EXIT_FALL_DISTANCE`, and `EXIT_BEAT_MS`. Tune the timing constants near the top (`DROP_STAGGER_MS`, `DROP_FALL_MS`, `DROP_BOUNCE`, `DROP_SETTLE_MS`, `BEAT_MS`, `MORPH_SPEED`) or the letter poses, then run `npm run scene:addy`, `npm run resources:generate`, `npm run build`, and `npm run visual:generate:full`. The Addy project blueprint "Regenerate Addy logo animation" runs these steps and opens the demo page. `npm run scene:addy:check` fails when either generated file is stale, and the script refuses to write a scene whose keyframes would be out of order.

## Author package

`@liquid/author` exports:

- `loadScene`, `normalizeScene`, `cloneScene`, `canonicalSerialize`, and validation helpers.
- `AuthoringDocument` for working/committed scene state, `dirty`, `diff`, snapshots, restore, reset, and commit.
- v1 patch helpers: `insertPose`, `patchPose`, `removePose`.
- v2 patch helpers: `insertKeyframe`, `patchKeyframe`, `removeKeyframe`.
- `compileAuthoringDocument` for building v2 scenes from higher-level authoring input.
- `runAuthorCli` and the `liquid-author` binary.

The CLI supports:

```sh
liquid-author validate <scene.json>
liquid-author normalize <scene.json> [--out out.json]
liquid-author patch <scene.json> --patch patch.json [--out out.json]
liquid-author export <scene.json> [--out out.json]
```

Patch JSON uses the exported `ScenePatch` union. For v2, patches operate on existing track keyframes; they do not add new tracks or component definitions.

## V2 compiler

`compileAuthoringDocument(input)` emits a schema v2 scene. Input tracks define stable components with `from` and `to` primitives, source/target endpoints, optional timing, and optional constraints.

Supported constraints are:

- `pin`: places a component point at a progress.
- `adhesion`: writes group `blendRadius` material at a progress.
- `release`: emits a semantic `release` event.
- `step`: emits a semantic `step` event.
- `materialRamp`: writes component or group material values at start/end.
- `overshootSettle`: inserts an overshoot keyframe and a settle keyframe.
- `stretchLimit`: caps capsule target length during compilation.
- `snapToTarget`: inserts target states and `$track.targetMix`/`$track.cornerSharpness` material.

The compiler output is still ordinary scene data: stable component definitions, ordered keyframes, material maps, semantic events, and reduced-motion metadata.

## Labs

The web lab loads the bundled capsule scene, the focused A+d v2 study, and the complete Addy v2 scene. For v1 it exposes temporary material tuning and pose insertion. For v2 it exposes track, component, and keyframe selection plus basic primitive and `$track` material controls. It can snapshot, diff, commit/reset the working document, export canonical JSON, and copy JSON.

The native lab loads the same scene set and can start on the complete v2 Addy scene with:

```sh
swift run LiquidLabMac --v2
```

Use the focused A+d study when tuning the first two tracks:

```sh
swift run LiquidLabMac --ad
```

It focuses on playback, scrubbing, reduced motion, debug overlays, and v2 track status rather than full authoring.

## Validation and approval

For scene changes, run the checks that match the changed surface:

```sh
npm run assets:check
npm run resources:check
npm run typecheck
npm test
swift test
npm run parity
npm run parity:v2
npm run parity:full
npm run visual:check
npm run visual:check:full
```

Use `npm run visual:generate` or `npm run resources:generate` only when you intentionally approve the corresponding generated change.

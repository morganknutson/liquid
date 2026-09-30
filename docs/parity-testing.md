# Cross-platform parity

Parity has three layers:

1. Evaluator parity compares canonical JSON frame descriptions from Swift and TypeScript.
2. Visual parity compares alpha masks at fixed scene sizes and scales with a raster tolerance.
3. Browser GPU tests compare WebGL2 output against the CPU renderer for the v2 scene and verify fallback behavior.

The shared sample manifests include normal key poses and authored event/threshold-adjacent timestamps. Each platform evaluates samples independently through public APIs. Dump, compare, and golden-generation tools contain no animation formulas beyond calling those APIs.

Run the canonical parity workflows after building package outputs:

```sh
npm run build
npm run parity
```

`npm run parity` runs all evaluator contracts. `npm run parity:v1` checks `shared/scenes/capsule-to-a.v1.json` with `shared/golden/capsule-to-a.samples.json`; `npm run parity:v2` checks the A+d study at `shared/scenes/spinner-to-ad.v2.json` with `shared/golden/spinner-to-ad.samples.json`; `npm run parity:full` checks the complete Addy scene at `shared/scenes/spinner-to-addy.v2.json` with `shared/golden/spinner-to-addy.samples.json`.

Both commands write TypeScript and Swift evaluator dumps to a temporary directory, run `node tools/compare-parity.mjs --tolerance 0.000001`, and remove the temporary files unless `node tools/run-parity.mjs --keep-temp` is used.

Individual tools are available for debugging:

```sh
node tools/dump-ts.mjs --out /tmp/liquid-ts.json
swift run LiquidFixtureDump shared/scenes/capsule-to-a.v1.json shared/golden/capsule-to-a.samples.json /tmp/liquid-swift.json
node tools/compare-parity.mjs --tolerance 0.000001 /tmp/liquid-ts.json /tmp/liquid-swift.json

node tools/dump-ts.mjs --scene shared/scenes/spinner-to-ad.v2.json --samples shared/golden/spinner-to-ad.samples.json --out /tmp/liquid-v2-ts.json
swift run LiquidFixtureDump shared/scenes/spinner-to-ad.v2.json shared/golden/spinner-to-ad.samples.json /tmp/liquid-v2-swift.json
node tools/compare-parity.mjs --tolerance 0.000001 /tmp/liquid-v2-ts.json /tmp/liquid-v2-swift.json

node tools/dump-ts.mjs --scene shared/scenes/spinner-to-addy.v2.json --samples shared/golden/spinner-to-addy.samples.json --out /tmp/liquid-full-ts.json
swift run LiquidFixtureDump shared/scenes/spinner-to-addy.v2.json shared/golden/spinner-to-addy.samples.json /tmp/liquid-full-swift.json
node tools/compare-parity.mjs --tolerance 0.000001 /tmp/liquid-full-ts.json /tmp/liquid-full-swift.json
```

Canonical asset manifests are checked and regenerated with:

```sh
npm run assets:check
npm run assets:generate
```

Scene resources are copied from `shared/` into the npm and Swift resource packages with:

```sh
npm run resources:check
npm run resources:generate
```

The visual parity golden is generated from TypeScript through public `@liquid/core` and `@liquid/web` APIs:

```sh
npm run visual:generate
npm run visual:check
```

The committed v1 visual golden is `shared/golden/capsule-to-a.visual.json`; the committed A+d v2 matrix is `shared/golden/spinner-to-ad.visual.json` at 132x52 and 264x104; the committed full Addy v2 matrix is `shared/golden/spinner-to-addy.visual.json` at 132x70 and 264x139, matching the logo's aspect ratio. The aggregate `visual:*` scripts process all three, while `visual:*:v1`, `visual:*:v2`, and `visual:*:full` are available for focused checks.

Visual golden entries store unpremultiplied 8-bit alpha masks as base64, plus SHA-256, coverage, solid-pixel count, and bounds metadata for deterministic diagnostics. `npm run visual:check` regenerates the JSON in memory and fails if the committed file is stale.

Exact comparisons:

- schema, scene, and fixture versions;
- sample labels and normalized progress;
- v1 phase ids and active threshold ids;
- v2 active semantic events, track ids, local progress, component ids, component kinds, operations, materials, and primitives;
- render mode;
- source/target endpoint commands.

Tolerance comparisons:

- points, radii, material numbers, target mix, opacity, sharpness, and local progress: absolute error at most `0.000001`;
- TypeScript visual alpha masks: exact byte-for-byte match against the shared golden;
- Swift visual alpha masks: per sample, maximum per-pixel alpha delta `4`, at most `320` differing pixels, and total alpha delta at most `512`. Failures report the sample label and progress. The Addy logo scenes allow a per-pixel delta of `96` on at most `2400` pixels (total `12000`): pushed and swollen letters, which land sharp before they settle, sample cached distance rasters bilinearly, which rounds sharp corners by a fraction of a pixel at the small golden sizes, while the TypeScript golden evaluates exact distances.

Evaluation order must not matter. Parity tests evaluate the same timestamps forward, backward, and shuffled.

Browser GPU coverage lives in Playwright:

```sh
npm run test:e2e
```

`apps/lab-web/tests/gpu.spec.ts` loads the v2 scene, requests `backend: "auto"`, verifies WebGL2 when available, compares source/field/target silhouettes against `backend: "cpu"`, exercises reduced motion and resize, and verifies CPU fallback when WebGL2 is unavailable.

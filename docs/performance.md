# Performance

Liquid keeps CPU renderers as the correctness oracle and uses GPU backends for production v2 playback. Treat benchmark numbers as local observations, not portable guarantees.

## Commands

Build first:

```sh
npm run build
```

Node CPU benchmark:

```sh
npm run benchmark:web
node tools/benchmark.mjs --scales=1 --iterations=2 --warmup=1
```

Browser player benchmark:

```sh
npm run benchmark:browser
node tools/benchmark-browser.mjs --backend=auto --iterations=30 --warmup=8 --max-backing-dimension=384
node tools/benchmark-browser.mjs --backend=auto --enforce-budget
node tools/benchmark-browser.mjs --scene=spinner-to-addy --backend=webgl2 --iterations=30 --warmup=8 --max-backing-dimension=384 --enforce-budget
```

Swift benchmark:

```sh
npm run benchmark:swift
swift run -c release LiquidBenchmark --backend=auto --scales=1 --iterations=3 --warmup=1
swift run -c release LiquidBenchmark --scenes=spinner-to-addy --backend=metal --scales=1 --iterations=3 --warmup=1 --enforce-budgets
```

Root `npm run benchmark` runs the web and Swift CPU benchmark scripts. Budgets are conservative guardrails and are enforced only when the relevant `--enforce-*` flag is used.

## Current budgets

Node public CPU raster path, p95 milliseconds:

| Scene | 1x | 2x | 3x |
| --- | ---: | ---: | ---: |
| `capsule-to-a` | 40 | 120 | 260 |
| `spinner-to-ad` | 240 | 900 | 2200 |
| `spinner-to-addy` | 1200 | 4800 | 10800 |

Swift render-alpha-mask path, p95 milliseconds:

| Scene | 1x | 2x | 3x |
| --- | ---: | ---: | ---: |
| `capsule-to-a` | 35 | 110 | 240 |
| `spinner-to-ad` | 220 | 850 | 2100 |
| `spinner-to-addy` | 900 | 3600 | 8400 |

Browser player budget defaults to `16.7ms` p95 when `--enforce-budget` is passed.

## Representative local run

Measured on 2026-07-20 at 19:00 EDT on Apple M5 Max, macOS 26.5.1, Node v26.3.0, Swift 6.3.3. These were short runs intended to document current order of magnitude.

| Command | Scene | Backend/path | Size | Samples | Warm median | Warm p95 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `node tools/benchmark.mjs --scales=1 --iterations=2 --warmup=1` | `capsule-to-a` | TS CPU stateless `evaluateFrame+rasterizeFrame` | 159x151 | 12 | 2.742ms | 13.007ms |
| same | `spinner-to-ad` | TS CPU stateless `evaluateFrame+rasterizeFrame` | 528x207 | 8 | 159.835ms | 226.218ms |
| `node tools/benchmark-browser.mjs --backend=auto --iterations=10 --warmup=3 --max-backing-dimension=384` | `spinner-to-ad` | browser player, resolved `webgl2` | 384x150 backing | 8 | 3.5ms | 5.9ms |
| `swift run -c release LiquidBenchmark --scales=1 --iterations=2 --warmup=1 --samples=dual-adhesion --scenes=spinner-to-ad --backend=auto` | `spinner-to-ad` | Swift benchmark, resolved `metal` | 528x207 | 1 | 1.029ms | 1.721ms |
| `node tools/benchmark-browser.mjs --scene=spinner-to-addy --backend=webgl2 --iterations=50 --warmup=10 --max-backing-dimension=512 --budget-ms=16.7 --enforce-budget` | `spinner-to-addy` | browser player, `webgl2` | 512x200 backing | 10 | 7.8ms | 11.6ms |
| `swift run -c release LiquidBenchmark --scenes=spinner-to-addy --backend=metal --scales=2 --iterations=20 --warmup=5 --budget-ms=16.7 --enforce-budgets` | `spinner-to-addy` | Swift benchmark, `metal` | 1056x414 | 10 | 2.897ms | 3.287ms |

The Node CPU v2 result measures the stateless public rasterizer and does not include `LiquidCanvasRenderer` target-raster caches. The browser and Swift player paths reuse renderer state and are closer to production playback.

The complete `spinner-to-addy` scene has separate parity and visual-golden gates (`npm run parity:full`, `npm run visual:check:full`). Its isolated warm production paths passed the 16.7ms p95 budget in the run above. The browser lab uses a scene-aspect 512px WebGL2 backing for liquid field frames and up to 2× DPR for exact vector endpoints, avoiding both 4:3 overdraw and low-resolution endpoint scaling. Cold playback is smooth as well, because endpoint rasters are only built when sampled and are warmed ahead of use (see the rendering model). A cold, frame-by-frame playthrough of the logo scene in Chromium's WebGL2 backend had a worst frame of 5.9ms at a 512x270 backing, 5.5ms at 1024x540, and 9.4ms at 2048x1080. Before, preparing those rasters blocked one frame for 0.8s, 3.1s, and 12.5s respectively. A cold Metal playthrough at 1200x633 had p50 5.0ms and p95 6.8ms. The only slower frame was the first, static one (29ms), which builds the pill mask. At a 2048x1080 Metal backing p95 is about 20ms, dominated by the per-frame CGImage readback, so keep native logos at or below `AddyLogoView`'s 1600px backing cap.

## Backend choice

Use CPU when you need oracle behavior, parity diagnostics, deterministic alpha golden generation, or unsupported environments.

Use WebGL2 on the web for v2 scenes when `LiquidCanvasPlayer.chosenBackend` resolves to `"webgl2"`. Capacity is 8 tracks and 48 total components, not counting rigid tracks; tracks clipped away entirely are skipped per frame, and a frame that still needs more falls back to the CPU renderer.

Use Metal on macOS for v2 scenes when `LiquidPlayerRenderStyle.backend` is `.auto` or `.metal` and `selectedRendererBackend` resolves to `.metal`. Capacity is 8 painted tracks per frame (tracks clipped away entirely are skipped), 16 components per track, and 4096 ribbon segments.

Keep backing dimensions capped for UI playback. The current examples use `maxBackingDimension: 384` on the web and `LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 512)` on macOS.

# Liquid

Liquid is Addy's deterministic, cross-platform shape-motion framework. It describes art-directed liquid transformations once and evaluates the same motion language in TypeScript and Swift, with web and macOS renderers for playback.

The repository ships three reference scenes:

- `capsule-to-a.v1.json`: the original single spinner capsule to exact Addy A study.
- `spinner-to-ad.v2.json`: a focused generic track-based A+d motion study with staggered tracks, stable components, authored adhesion/release events, target snapping, and exact endpoint vectors.
- `spinner-to-addy.v2.json`: the complete Addy logo animation. Four ticks drop into the pill and flow into the A, d, d, y wordmark, using the exact paths from `shared/assets/addy-logo-ticks.svg` and `addy-logo-wordmark.svg`.

## Repository layout

- `shared/` — canonical assets, scene schemas, fixtures, and golden samples
- `packages/liquid-core` — pure TypeScript evaluator, validation, SDF helpers, and serializers
- `packages/liquid-web` — framework-independent Canvas player, CPU renderer, and WebGL2 backend
- `packages/liquid-author` — scene normalization, patching, snapshots, v2 authoring compiler, and CLI
- `packages/liquid-scenes` — npm resource package for bundled scenes, samples, and assets
- `packages/addy-logo` — drop-in animated Addy logo for websites (`<addy-logo>` and `mountAddyLogo`)
- `apps/lab-web` — browser motion lab
- `Sources/LiquidCore` — pure Swift evaluator
- `Sources/LiquidMac` — Core Graphics player/renderer and optional Metal backend
- `Sources/LiquidScenes` — SwiftPM resource package for bundled scenes, samples, and assets
- `Sources/AddyLogo` — drop-in animated Addy logo for macOS apps (`AddyLogoView`)
- `Sources/LiquidLabMac` — native motion lab
- `tools/` — asset canonicalization, resource sync, parity, golden, and benchmark tooling

The project intentionally keeps native evaluators over one shared data contract. Parity tooling checks that the TypeScript and Swift implementations continue to emit matching frame descriptions.

## Use the Addy logo

Three variations share the same drop-in: the ticks become the wordmark (default); they run Addy's pill wave on loop (`variant="wave"` / `AddyLogoView(variant: .wave)`); or they wave three times and then become the wordmark (`variant="wave-wordmark"` / `AddyLogoView(variant: .waveThenWordmark)`). On a website, register the element once and place it anywhere; children are shown until the animation is ready:

```html
<addy-logo style="width: 320px"><img src="/addy-logo.svg" alt="Addy" /></addy-logo>
<script type="module">
  import { defineAddyLogoElement } from "@liquid/addy-logo";
  defineAddyLogoElement();
</script>
```

In a macOS app, add the `AddyLogo` SwiftPM product and use `AddyLogoView().frame(width: 240)`. See [docs/integration.md](docs/integration.md) for options, sizing, and lifecycle. The lab serves a live demo at `/addy-logo.html`.

## Run the labs

Install the web workspace once, then launch either lab from the repository root:

```sh
npm install
npm run dev --workspace @liquid/lab-web
swift run LiquidLabMac
```

The labs can load the v1 capsule scene, the focused v2 A+d study, and the complete v2 Addy wordmark scene. The browser lab includes direct scrubbing, reduced motion, debug overlays, v1 tuning controls, v2 track/component/keyframe controls, snapshots, diffs, and canonical JSON export. The native lab uses SwiftUI as a thin host around `LiquidCore` and `LiquidMac`; `swift run LiquidLabMac --v2` starts on the complete Addy v2 scene, while `swift run LiquidLabMac --ad` opens the A+d study.

The standalone consumers live in `examples/web` and `Sources/LiquidExampleMac`.

## Verify

```sh
npm run typecheck
npm test
swift test
npm run test:e2e
npm run parity
npm run visual:check
```

`npm test` includes the unit/tool suites and the aggregate evaluator contract gate. `npm run parity` checks v1, the A+d v2 study, and the full Addy v2 scene; `parity:v1`, `parity:v2`, and `parity:full` remain available for focused debugging. Each independently evaluates canonical samples in Swift and TypeScript and compares serialized frames at `0.000001` tolerance. `npm run visual:check` verifies the committed TypeScript alpha-silhouette goldens; `visual:check:v1`, `visual:check:v2`, and `visual:check:full` are available for targeted checks. Update them intentionally with `npm run visual:generate` or `npm run visual:generate:full` only after approving a scene change.

## Core guarantees

- `evaluate(scene, progress)` is pure and history-independent.
- Exact supplied endpoint vectors render at scene progress `0` and `1` for v1, and at local track progress `0` and `1` for v2.
- Easing, track timing, material ramps, semantic events, and precision are specified in shared data.
- Reduced motion is an authored crossfade, not a slowed liquid animation.
- CPU paths are the parity oracle; WebGL2 and Metal are optional production backends for v2 playback.

## Docs

- [Scene format](docs/scene-format.md)
- [Rendering model](docs/rendering-model.md)
- [Authoring workflow](docs/authoring-workflow.md)
- [Integration](docs/integration.md)
- [Parity testing](docs/parity-testing.md)
- [Performance](docs/performance.md)

# Liquid scene format

Liquid scenes are data, not simulations. Given the same scene and normalized progress, every implementation must return the same frame description within the declared numeric tolerance. Runtime playback evaluates authored data; it does not run live physics or solve constraints.

The repository contains two schema families:

- `schemaVersion: 1` in `shared/scenes/capsule-to-a.v1.json`, a fixed capsule-to-A motion study.
- `schemaVersion: 2` in `shared/scenes/spinner-to-ad.v2.json`, a generic track/component model used by the focused A+d study.
- `schemaVersion: 2` in `shared/scenes/spinner-to-addy.v2.json`, the complete four-track Addy wordmark transformation.

## Shared rules

Clamp input progress to `0...1` before evaluation. Supported easing names are:

- `linear`
- `smoothStep`
- `smootherStep`
- `easeInCubic`
- `easeOutCubic`

All points, capsule radii, and scalar material values interpolate component-wise. There is no accumulated state, randomness, or wall-clock input.

Endpoint path commands are ordered as one or more closed, `M`-started contours. `L`, `C`, and `Z` require an open contour; every contour must end with `Z`, and any following contour must then start with a new `M`. Requiring explicit closure keeps Canvas, Core Graphics, and signed-distance fills consistent.

Each endpoint includes `assetId`, `shapeId`, an affine `transform`, and canonical path `commands`. Endpoint commands are returned exactly at endpoint progress; renderers must not substitute generated geometry there.

Reduced motion is an authored `crossfade`. `fadeStart` must be less than `fadeEnd`. Source opacity remains `1` before the fade interval, target opacity reaches `1` after it, and geometry is sampled at the source state while opacities crossfade.

## Schema v1

The v1 scene has one global `source`, one global `target`, ordered `phases`, `thresholds`, and `poses`.

- Phases are ordered, contiguous half-open intervals: `start <= t < end`; the last phase also contains `t = 1`.
- A threshold is active when `threshold.at <= t`.
- Poses are strictly ordered by `at`, start at `0`, and end at `1`.
- A pose's `easing` controls interpolation from the previous pose into that pose.

At `t = 0`, evaluators return `sourcePath` and the exact canonical source commands. At `0 < t < 1`, evaluators return `field`. At `t = 1`, evaluators return `targetPath` and the exact canonical target commands. Renderers must not substitute generated geometry at either endpoint.

The capsule-to-A fixture maps spinner shape `bar-left`, the third serialized spinner subpath, index `2`, into the A coordinate space without altering its path commands.

## Schema v2

The v2 scene replaces v1 global poses with `tracks`. Each track owns:

- `source` and `target` endpoints.
- `timing.start` and `timing.end` in global scene progress.
- Stable `components` with `id`, `kind`, `operation`, and optional `groupId`.
- Strictly ordered `keyframes` from local progress `0` to `1`.
- Optional `interpolation`: `keyframeEasing` (default) or `monotoneCubic`.
- Optional semantic `events`.

With `keyframeEasing`, each keyframe's `easing` shapes the segment that ends at that keyframe, so values come to rest or change speed abruptly at every keyframe. With `monotoneCubic`, every numeric channel (point coordinates, radii, ellipse rotation, and numeric material values) follows a monotone cubic Hermite spline through all keyframes and keyframe `easing` is ignored:

```text
u = (localProgress - k[i-1].at) / (k[i].at - k[i-1].at)
value = h00(u)·y[i-1] + h10(u)·h·m[i-1] + h01(u)·y[i] + h11(u)·h·m[i]
m[0] = m[last] = 0
m[j] = 0 when (y[j] - y[j-1]) and (y[j+1] - y[j]) differ in sign or either is zero
m[j] = (w0 + w1) / (w0 / d0 + w1 / d1) otherwise, with d0, d1 the neighbouring slopes,
       w0 = 2·h1 + h0 and w1 = h1 + 2·h0
```

Values pass through every keyframe, never overshoot between keyframes, move with continuous velocity through interior keyframes, and start and finish at rest. A material channel missing from a neighbouring keyframe contributes a zero tangent. Strings and booleans still switch at the next keyframe.

`track.localProgress = clamp01((sceneProgress - timing.start) / (timing.end - timing.start))`.

Every keyframe must include one state for every stable component definition. Component ids and primitive kinds stay stable across the track so interpolation is deterministic. Primitive kinds are:

- `capsule`: line segment plus radius.
- `ribbon`: cubic centerline plus start/end radius.
- `ellipse`: center, radii, and optional rotation.

A v2 scene may also list `backdrop` endpoints: exact vector shapes drawn on every frame, in every render mode including reduced motion, composited over the tracks with the scene fill rule. Use it for static framing such as the Addy pill. An optional `loop: { start }` marks a loop region: looping playback wraps back to `start` (normalized progress) instead of 0, so an intro before it plays once; under reduced motion such scenes hold at their end instead of looping. The numeric group material `$track.opacity` (default 1) fades a track while it is drawn as a field. The numeric `$track` materials `offsetX`, `offsetY`, `scale`, `originX`, and `originY` (defaults 0, 0, 1, 0, 0) place a whole track: its shapes, including its exact endpoints, are scaled about the origin and then moved by the offset, in every render mode. An optional `clip` endpoint restricts where tracks draw: every track's coverage is multiplied by the clip shape's coverage before the backdrop is composited. The backdrop itself is not clipped. Use it so shapes can enter from behind a frame.

Composition operations are `union` and `subtract`. Material values are finite numbers, strings, or booleans stored on component ids or group ids. Current renderers consume numeric `blendRadius`, `targetMix`, and `cornerSharpness`; other material fields are preserved in frame output for authoring/debugging.

At local progress `0`, a track returns `sourcePath`; at local progress `1`, it returns `targetPath`; between them it returns `field`. Reduced motion returns per-track `crossfade`.

Semantic events are reported in evaluated samples. `step` events are active after their local `at`; `release` events are active from `at` until `end`.

The bundled v2 A+d study is `spinner-to-ad`: duration `1900ms`, coordinate space `528x207`, and two tracks:

- `spinner-left-to-a`, global timing `0...0.78`, four components, ten keyframes.
- `spinner-inner-left-to-d1`, global timing `0.18...1`, three components, seven keyframes.

The complete v2 Addy scene is `spinner-to-addy`: the Addy logo artwork in its own `2973x1568` coordinate space, about 2s long (the exact length follows the timing constants in its authoring script). Its source endpoints are the four ticks `tick-1`…`tick-4` from `shared/assets/addy-logo-ticks.svg`, its targets are `letter-a`, `letter-d1`, `letter-d2`, and `letter-y` from `shared/assets/addy-logo-wordmark.svg`, its `backdrop` is the pill outline shared by both files, and its `clip` is the pill's outer edge, so every exact shape is the artwork's own path and nothing draws outside the pill. Its tracks use `monotoneCubic` interpolation and are generated by `tools/author-spinner-to-addy.mjs` (`npm run scene:addy`, checked by `npm run scene:addy:check`) from the canonical asset manifest. Motion is authored in the original 528x207 wordmark units and mapped into the logo space by one affine transform. Each letter is a few poses on a millisecond timeline:

- Intro: the pill starts empty. Each source endpoint is its tick lifted above the pill, and tracks are clipped to the pill, so the ticks drop in through its top edge left to right (`DROP_STAGGER_MS`, `DROP_FALL_MS`). Each one stretches as it falls, overshoots below its resting spot while squashing, springs back above it, and settles within `DROP_SETTLE_MS` (`DROP_BOUNCE`). All four rest together for a beat (`BEAT_MS`) before the A starts.
- Letters: the morphs keep their left-to-right cascade, with every forming duration and offset scaled by `MORPH_SPEED`. While forming, each letter also drifts outward from the wordmark's center (A left, y right, the d's a third as far; `SETTLE_PUSH`) and swells slightly about its own center (`SETTLE_SWELL`). Over `SETTLE_MS` it then lands: it eases continuously from its rounded formed pose into the exact glyph, fully sharp by `SETTLE_SHARPEN_END` of the landing while still pushed and swollen, and from `SETTLE_RETURN_START` a damped spring (`SETTLE_SPRING`) carries it back into place and back to 100%, just past and back, so the settle happens on the sharp letters. The push and swell are track placement materials, so they move the sharp glyph itself as well as the liquid shape.
- A: the bar gathers into a squash and splits from the bottom into two legs; the crossbar grows inward from both legs, closing the counter where the halves meet.
- d: the bar slides right into the stem and drags the bowl out behind it; the bowl curls into a hook whose tip rejoins the stem, so the counter closes by reconnection rather than opening as a speck.
- y: the arms unzip from the top as a V; the bowl is a U whose ends run down the arm centerlines, so the notch is tangent-continuous with the arms. The descender drips from the right arm and curls left beneath the bowl without touching it.

The final pose of each track is fitted to its target glyph, and `targetMix`/`cornerSharpness` ramp up while the letter is still settling, so the soft shape flows into the exact glyph without stopping first. Because the source bars start off-stage, reduced motion fades the wordmark in. The third variation, `addy-logo-wave-wordmark`, is also generated by the script. It plays the drop-in and `WAVE_STEPS_BEFORE_WORDMARK` (2) steps of the pill wave, then forms the wordmark on the wave's rhythm (when the next step would have fired), with the same cascade, forming speed, and spring landing. Each letter forms from whichever pill ends up in its slot (`wave-to-a`, `wave-to-d1`, `wave-to-d2`, `wave-to-y`); pills that left the row (`wave-pill-*`) stay faded out. It plays once and holds on the wordmark.

The Addy logo wave, `addy-logo-wave`, is generated by the same script and shares the drop-in. After the last tick settles it runs Addy's pill wave (`BouncingDotsView` in the Addy app) with six pooled pills (`wave-pill-1`…`wave-pill-6`, the first four being the dropped ticks). Every `WAVE_STEP_MS` (700ms), the leftmost pill springs one slot left and fades out (`$track.opacity`), the others spring one slot left and resize to their new slot, and a pooled pill springs in from the right. The spring (mass 1, stiffness 180, damping 18) and the step logic replay the app's, including the zero-velocity retarget from the current value. The curves are sampled into monotone cubic keyframes about every 39ms. Slots use the logo's tick positions and heights. The scene's `loop` region spans one full turn of the pool (six steps), so each pill returns exactly to its starting state; pills travel back to the entry point only while fully transparent. Its targets are the resting pill layout at the loop start, so reduced motion fades in four still ticks.

Holes are formed only by reconnection, never by a subtract primitive growing from a point inside solid ink. Ribbon centerlines that bound a visible hole keep their curvature radius above their stroke radius so the inner edge never folds into a cusp.

## Canonical numbers

Serialized parity output rounds finite numbers to six decimal places and normalizes negative zero to zero. Endpoint path commands are compared exactly after canonicalization. Continuous evaluated values use an absolute tolerance of `0.000001`.

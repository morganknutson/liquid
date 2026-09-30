# Liquid rendering model

Liquid has two renderer roles:

- CPU renderers are the parity oracle. TypeScript and Swift both evaluate public frame data and rasterize signed-distance fields in inspectable code.
- GPU renderers are production accelerators for v2 playback. They preserve the same scene/frame semantics and fall back to CPU when unavailable or over capacity.

Endpoint vectors are exact. At source/target/crossfade render modes, web Canvas and Swift Core Graphics draw transformed endpoint commands directly instead of thresholding procedural fields.

## V1 field

The v1 field is fixed to the capsule-to-A study: left leg, right leg, crossbar, and temporary bridge. Each visible stroke is a capsule SDF. A zero-length capsule is a circle; a radius of zero is omitted from composition.

With blend radius `k = 0`, composition uses ordinary `min`. Otherwise it uses polynomial smooth union:

```text
h = max(k - abs(a - b), 0) / k
smoothMin(a, b, k) = min(a, b) - h³ * k / 6
```

`cornerSharpness` reduces the authored smooth-union radius before composition:

```text
effectiveBlendRadius = blendRadius * (1 - cornerSharpness)
```

The temporary bridge is present only while its evaluated radius is greater than zero. The v1 fixture places poses at `0.719999` and `0.72` to make its authored release deterministic and directly testable.

## V2 field

The v2 field renders each evaluated track independently, then composites tracks with source-over alpha. Track components can be capsules, cubic ribbons, or ellipses. Component operations are `union` and `subtract`; unions use smooth union with the component/group/track `blendRadius` after applying track `cornerSharpness`.

The target endpoint path is converted to a signed distance using the scene fill rule. Line segments are exact. Cubic segments use 32 deterministic subdivisions. When numeric group material `$track.targetMix` is present, the renderer blends procedural and target distances:

```text
distance = proceduralDistance * (1 - targetMix) + targetDistance * targetMix
```

At `targetMix = 1`, the field threshold is the target silhouette. At endpoint progress, renderers bypass field sampling and draw exact vector commands.

## CPU paths

`@liquid/web` exposes `LiquidCanvasRenderer` and `rasterizeFrame`. Swift exposes `LiquidCGRenderer`. These CPU paths are used for parity, visual goldens, debugging, and fallback.

Renderer caches are implementation details. Web Canvas caches target distance rasters per scene/track/endpoint/output size. Swift Core Graphics caches endpoint distance rasters inside the renderer instance.

Endpoint distance rasters come from `signedDistanceRaster` (TypeScript) and `LiquidSDF.signedDistanceRaster` (Swift), which implement the same algorithm. Pixels within 1.5px of a flattened segment get exact distances. Two raster sweeps then pass each pixel's nearest segment to its neighbours and re-measure the exact distance to every candidate. The sign comes from one scanline winding pass using the same crossing rules as the per-point distance. Results match the per-point distance to within a few hundredths of a pixel everywhere, at a cost linear in pixels rather than pixels × segments. A 2048x1080 letter raster takes about 100ms instead of about 3s.

Placed tracks (`$track` `offsetX`/`offsetY`/`scale` about `originX`/`originY`) are drawn by sampling each visible point where it came from in the track's own space and scaling distances back up by the placement. Cached endpoint rasters are then read bilinearly rather than rebuilt, so a letter can move and scale every frame without new raster work. Exact vector endpoint frames apply the same transform to the path.

Backdrop shapes are drawn as exact vectors on Canvas and WebGL. The CPU mask path and both Swift renderers rasterize them once per output size into a cached coverage mask.

## GPU paths

`LiquidCanvasPlayer` selects WebGL2 only for v2 scenes when `backend` is `"auto"` or `"webgl2"` and capabilities support the scene. Otherwise it falls back to CPU. WebGL2 capacity is currently:

- `maxTracks = 8`
- `maxComponents = 48`
- `ribbonSubdivisions = 32`

`LiquidPlayer` on macOS selects Metal when `LiquidPlayerRenderStyle.backend` is `.auto` or `.metal`, the scene is v2, debug overlays are disabled, and `LiquidMetalRenderer.canRender` succeeds. Otherwise it falls back to Core Graphics. Metal capacity is currently:

- `maxTracks = 8`
- `maxComponentsPerTrack = 16`
- `maxRibbonSegments = 4096`

Both GPU paths prepare endpoint distance rasters on the CPU and run procedural field composition on the GPU. A raster is only built when a frame samples it: a source for `sourcePath`, a target for `targetPath`, or a field track whose `targetMix` is above zero. Endpoints lying entirely outside the output contribute zero coverage and are skipped. While a field track still has `targetMix = 0`, its target raster is warmed ahead of time so nothing heavy lands on the frame where blending starts. WebGL2 builds it in resumable slices and uploads it a band of rows at a time, using what is left of an 8ms frame target after rendering (at least 2ms). Metal builds it on a background queue. WebGL2 uploads only texture layers whose raster changed, and `LiquidCanvasPlayer` draws one field frame at construction so the driver's first-draw setup never lands on a moving frame. Frames where every track shows an exact endpoint (each on its source or target, or all crossfading) take the 2D/vector path, with each track's placement applied. Tracks on an exact endpoint lying entirely outside the scene's clip are dropped before rendering, and WebGL2 keeps cached rasters for every track in the scene, including ones clipped away for a while, so replays reuse them. The Swift renderers key rasters by the shape itself, so tracks drawing the same glyph share one.

## Coverage and sizing

Map scene coordinates to device pixels uniformly, preserving aspect ratio. Convert distance to alpha with a symmetric one-device-pixel coverage ramp. The exact raster edge may differ between Canvas, Core Graphics, WebGL2, and Metal, so parity treats evaluator numbers and vector endpoints more strictly than pixels.

Debug overlays may show evaluated centerlines, radii, the anchor, bounds, phases, and thresholds. They must not influence field evaluation.

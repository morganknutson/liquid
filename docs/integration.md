# Integration

Liquid scenes can be consumed from npm packages on the web or from SwiftPM modules on macOS. Load a bundled scene, create a player, choose backend and sizing options, and destroy the player when the host view unmounts.

## Addy logo

The animated Addy logo ships as ready-made wrappers around three scenes that share the same drop-in: `spinner-to-addy` (the ticks become the wordmark), `addy-logo-wave` (Addy's pill wave loops), and `addy-logo-wave-wordmark` (the pills wave three times, then become the wordmark): `@liquid/addy-logo` for websites and the `AddyLogo` SwiftPM product for macOS apps. Both size to the width they are given, keep the artwork's 2973:1568 aspect ratio, fill with the surrounding text color by default, follow the system reduced-motion setting (a 180ms fade instead of the full animation), and hold on the exact wordmark when done.

### Website

```ts
import { defineAddyLogoElement } from "@liquid/addy-logo";
defineAddyLogoElement(); // registers <addy-logo>; safe to call more than once and during SSR
```

```html
<addy-logo style="width: 320px">
  <img src="/addy-logo.svg" alt="Addy" />
</addy-logo>
```

- Children are a fallback: they render during server rendering and without JavaScript, and are hidden once the first frame is drawn. Use `shared/assets/addy-logo-wordmark.svg`, the logo's final frame.
- Attributes: `variant` (`wordmark`, the default; `wave` for the looping pill wave, which loops unless `loop="false"`; or `wave-wordmark` to wave three times and then become the wordmark), `color` (any CSS color; defaults to the element's `color`), `autoplay` (`visible`, the default, plays once the logo is half in view; `immediate`; or `none`), `loop`, and `label` (accessible name, default `Addy`).
- Methods `play()`, `pause()`, and `replay()`. A `complete` event fires when a non-looping play reaches the wordmark.
- Without the custom element (for example inside a framework component), call `mountAddyLogo(container, options)` and `destroy()` the returned handle on unmount. It takes the same options plus `onComplete`, `scene` (a preloaded scene), and `sceneURL`. `handle.ready` resolves with the underlying `LiquidCanvasPlayer`.

In React, use the element directly after calling `defineAddyLogoElement()` in an effect, or mount imperatively:

```tsx
useEffect(() => {
  const logo = mountAddyLogo(ref.current!, { autoplay: "visible" });
  return () => logo.destroy();
}, []);
```

The scene JSON (about 5KB gzipped) is fetched once from `@liquid/scenes` through `new URL(..., import.meta.url)`, which Vite, webpack 5, and Next.js bundle as an asset. Instances on the same page share it. The wrapper uses WebGL2 when available, with a backing store up to 2048px. Otherwise it uses the CPU renderer capped at 640px. No workers or `blob:` URLs are used, so it works under a strict Content Security Policy.

### macOS app

Add the `AddyLogo` product from this package, then:

```swift
import AddyLogo

AddyLogoView()                                  // plays once on appear, in the foreground color
    .frame(width: 240)

AddyLogoView(color: .accentColor, loop: true)

AddyLogoView(variant: .wave)                   // drop in, then Addy's pill wave until paused
AddyLogoView(variant: .waveThenWordmark)       // drop in, wave three times, then the wordmark

@StateObject var logo = try! AddyLogoController()
AddyLogoView(controller: logo, playsOnAppear: false) { print("done") }
Button("Replay") { logo.replay() }
```

`AddyLogoView` resolves dynamic colors like `.primary` against the view's color scheme, renders through Metal when available (Core Graphics otherwise) with a backing capped at 1600px, pauses on disappear, and exposes the accessibility label "Addy" as an image. `AddyLogoController` adds `play()`, `pause()`, `replay()`, `showWordmark()`, and a published `isComplete`.

## Web

`@liquid/scenes` exports resource URLs. `@liquid/web` exports `LiquidCanvasPlayer`, the CPU renderer, and the WebGL2 backend.

```ts
import type { LiquidSceneV2 } from "@liquid/core";
import { spinnerToAddySceneURL } from "@liquid/scenes";
import { LiquidCanvasPlayer } from "@liquid/web";

const canvas = document.querySelector<HTMLCanvasElement>("#liquid");
if (!canvas) throw new Error("Missing #liquid canvas");

const scene = await fetch(spinnerToAddySceneURL.href).then((response) => response.json()) as LiquidSceneV2;

const player = new LiquidCanvasPlayer(canvas, scene, {
  autoplay: true,
  loop: true,
  backend: "auto",
  fillStyle: "#f8fafc",
  reducedMotion: "system",
  maxBackingScale: 2,
  maxBackingDimension: 384,
  observeResize: true,
});

console.log(player.chosenBackend, player.capabilities);

window.addEventListener("beforeunload", () => {
  player.destroy();
});
```

Backend options are `"auto"`, `"cpu"`, and `"webgl2"`. `"auto"` chooses WebGL2 only for v2 scenes when the browser supports the renderer and the scene is within capacity. v1 scenes and unsupported v2 scenes fall back to CPU.

Sizing is controlled by the canvas CSS box plus optional `logicalSize`, `backingScale`, `maxBackingScale`, and `maxBackingDimension`. The default caps backing scale to `2` and the longest backing dimension to `384`. Call `resize(logicalSize)` if your layout system knows the logical size before the browser reports one.

Playback lifecycle:

- `play()`, `pause()`, `restart()`, and `seek(progress)` control time.
- `setReducedMotion(true | false | "system")` switches reduced-motion mode.
- `setFillStyle(color)` updates fill color.
- `destroy()` cancels animation, disconnects resize/media listeners, and releases renderer caches.

## Swift

SwiftPM products are `LiquidCore`, `LiquidMac`, and `LiquidScenes`. `LiquidScenes` bundles the same scenes, samples, and assets as `@liquid/scenes`.

```swift
import AppKit
import SwiftUI
import LiquidCore
import LiquidMac
import LiquidScenes

@MainActor
private func makeLiquidPlayer() throws -> LiquidPlayer {
    let anyScene = try LiquidScenes.loadScene(.spinnerToAddy)
    let options = LiquidPlaybackOptions(
        autoplay: true,
        loop: true,
        reducedMotion: .system
    )

    switch anyScene {
    case let .v1(scene):
        return LiquidPlayer(scene: scene, options: options)
    case let .v2(scene):
        return try LiquidPlayer(scene: scene, options: options)
    }
}

struct LiquidLogoView: View {
    @StateObject private var player: LiquidPlayer

    init() throws {
        _player = StateObject(wrappedValue: try makeLiquidPlayer())
    }

    var body: some View {
        LiquidView(
            player: player,
            backingOptions: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 512),
            renderStyle: LiquidPlayerRenderStyle(
                fillRed: 0.92,
                fillGreen: 0.95,
                fillBlue: 1.0,
                backend: .auto
            )
        )
        .frame(width: 264, height: 104)
        .onDisappear {
            player.destroy()
        }
    }
}
```

Backend options are `.auto`, `.coreGraphics`, and `.metal`. `.auto` uses Metal only for v2 scenes when Metal is available, debug overlays are disabled, and the scene/frame is within capacity. Otherwise `LiquidPlayer` falls back to Core Graphics and updates `selectedRendererBackend`.

For manual rendering, use:

```swift
let backing = liquidBackingSize(
    logicalSize: CGSize(width: 264, height: 104),
    displayScale: NSScreen.main?.backingScaleFactor ?? 1,
    options: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 512)
)
let image = player.renderCGImage(backingSize: backing)
```

Reduced motion resolves from `.system`, `.enabled`, or `.disabled`. `LiquidView` reads SwiftUI `accessibilityReduceMotion` and forwards it to the player. Outside `LiquidView`, call `setSystemPrefersReducedMotion(_:)` or `setReducedMotionOverride(_:)`.

## Resource imports

Web resource URLs:

```ts
import {
  capsuleToASceneURL,
  spinnerToAdSceneURL,
  spinnerToAddySceneURL,
  capsuleToASamplesURL,
  spinnerToAdSamplesURL,
  spinnerToAddySamplesURL,
  assetManifestURL,
  resourceManifestURL,
} from "@liquid/scenes";
```

Swift resource helpers:

```swift
let scene = try LiquidScenes.loadScene(.spinnerToAddy)
let samples = try LiquidScenes.loadSampleManifest(.spinnerToAddy)
let assetURL = try LiquidScenes.assetURL(named: "addy-wordmark.svg")
let manifestData = try LiquidScenes.resourceManifestData()
```

Use `spinnerToAdSceneURL` / `.spinnerToAd` when you need the narrower A+d motion study instead of the complete Addy wordmark scene.

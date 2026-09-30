import AppKit
import Combine
import CoreGraphics
import Foundation
import LiquidCore
import SwiftUI

public enum LiquidReducedMotionOverride: Equatable, Sendable {
    case system
    case enabled
    case disabled
}

public struct LiquidPlaybackOptions: Equatable, Sendable {
    public var autoplay: Bool
    public var loop: Bool
    public var reducedMotion: LiquidReducedMotionOverride
    public var frameInterval: TimeInterval

    public init(
        autoplay: Bool = false,
        loop: Bool = false,
        reducedMotion: LiquidReducedMotionOverride = .system,
        frameInterval: TimeInterval = 1.0 / 60.0
    ) {
        self.autoplay = autoplay
        self.loop = loop
        self.reducedMotion = reducedMotion
        self.frameInterval = frameInterval
    }
}

public struct LiquidPlayerRenderStyle: Equatable, Sendable {
    public var fillRed: Double
    public var fillGreen: Double
    public var fillBlue: Double
    public var debug: LiquidDebugOptions
    public var backend: LiquidRendererBackend

    public init(
        fillRed: Double = 0.92,
        fillGreen: Double = 0.95,
        fillBlue: Double = 1,
        debug: LiquidDebugOptions = LiquidDebugOptions(),
        backend: LiquidRendererBackend = .auto
    ) {
        self.fillRed = fillRed
        self.fillGreen = fillGreen
        self.fillBlue = fillBlue
        self.debug = debug
        self.backend = backend
    }

    public func renderOptions(width: Int, height: Int) -> LiquidRenderOptions {
        LiquidRenderOptions(width: width, height: height, fillRed: fillRed, fillGreen: fillGreen, fillBlue: fillBlue, debug: debug)
    }
}

@MainActor
public final class LiquidPlayer: ObservableObject {
    public let anyScene: AnyLiquidScene
    public let renderer: LiquidCGRenderer
    public private(set) var selectedRendererBackend: LiquidResolvedRendererBackend
    public private(set) var rendererCapabilities: LiquidMetalCapabilities

    public var scene: LiquidScene {
        guard case let .v1(scene) = anyScene else {
            preconditionFailure("LiquidPlayer.scene is only available for v1 scenes; use sceneV2 or anyScene for v2 playback.")
        }
        return scene
    }

    public var sceneV2: LiquidSceneV2? {
        if case let .v2(scene) = anyScene { return scene }
        return nil
    }

    @Published public private(set) var progress: Double
    @Published public private(set) var frame: LiquidFrame
    @Published public private(set) var frameV2: LiquidFrameV2?
    @Published public private(set) var anyFrame: AnyLiquidFrame
    @Published public private(set) var isPlaying: Bool
    @Published public private(set) var isDestroyed: Bool

    public private(set) var options: LiquidPlaybackOptions
    public private(set) var systemPrefersReducedMotion: Bool

    private let evaluator: LiquidEvaluator
    private var metalRenderer: LiquidMetalRenderer?
    private var playbackTask: Task<Void, Never>?
    private var playStartTime: TimeInterval
    private var playStartProgress: Double

    public init(
        scene: LiquidScene,
        options: LiquidPlaybackOptions = LiquidPlaybackOptions(),
        renderer: LiquidCGRenderer = LiquidCGRenderer(),
        evaluator: LiquidEvaluator = LiquidEvaluator(),
        systemPrefersReducedMotion: Bool = false,
        now: TimeInterval = LiquidPlayer.currentTime()
    ) {
        self.anyScene = .v1(scene)
        self.options = options
        self.renderer = renderer
        self.evaluator = evaluator
        self.selectedRendererBackend = .coreGraphics
        self.rendererCapabilities = LiquidMetalRenderer.systemCapabilities()
        self.systemPrefersReducedMotion = systemPrefersReducedMotion
        self.progress = 0
        let initialFrame = evaluator.evaluate(scene: scene, progress: 0, reducedMotion: LiquidPlayer.resolveReducedMotion(options.reducedMotion, systemPrefersReducedMotion: systemPrefersReducedMotion))
        self.frame = initialFrame
        self.frameV2 = nil
        self.anyFrame = .v1(initialFrame)
        self.isPlaying = false
        self.isDestroyed = false
        self.playStartTime = now
        self.playStartProgress = 0

        if options.autoplay {
            play(now: now)
        }
    }

    public init(
        scene: LiquidSceneV2,
        options: LiquidPlaybackOptions = LiquidPlaybackOptions(),
        renderer: LiquidCGRenderer = LiquidCGRenderer(),
        evaluator: LiquidEvaluator = LiquidEvaluator(),
        systemPrefersReducedMotion: Bool = false,
        now: TimeInterval = LiquidPlayer.currentTime()
    ) throws {
        self.anyScene = .v2(scene)
        self.options = options
        self.renderer = renderer
        self.evaluator = evaluator
        self.selectedRendererBackend = .coreGraphics
        self.rendererCapabilities = LiquidMetalRenderer.systemCapabilities()
        self.systemPrefersReducedMotion = systemPrefersReducedMotion
        self.progress = 0
        let initialFrame = try evaluator.evaluateChecked(scene: scene, progress: 0, reducedMotion: LiquidPlayer.resolveReducedMotion(options.reducedMotion, systemPrefersReducedMotion: systemPrefersReducedMotion))
        self.frame = LiquidPlayer.placeholderFrame(progress: 0)
        self.frameV2 = initialFrame
        self.anyFrame = .v2(initialFrame)
        self.isPlaying = false
        self.isDestroyed = false
        self.playStartTime = now
        self.playStartProgress = 0

        if options.autoplay {
            play(now: now)
        }
    }

    deinit {
        playbackTask?.cancel()
    }

    /// Playback length: the scene's reduced-motion duration while reduced motion is on.
    public var durationSeconds: TimeInterval {
        let durationMs: Double
        switch anyScene {
        case let .v1(scene):
            durationMs = usesReducedMotion ? scene.reducedMotion.durationMs : scene.durationMs
        case let .v2(scene):
            durationMs = usesReducedMotion ? scene.reducedMotion.durationMs : scene.durationMs
        }
        return max(durationMs / 1000, 0.000001)
    }

    public var usesReducedMotion: Bool {
        Self.resolveReducedMotion(options.reducedMotion, systemPrefersReducedMotion: systemPrefersReducedMotion)
    }

    public func setOptions(_ options: LiquidPlaybackOptions, now: TimeInterval = LiquidPlayer.currentTime()) {
        let wasPlaying = isPlaying
        if wasPlaying {
            pause(now: now)
        }
        self.options = options
        updateFrame()
        if wasPlaying || options.autoplay {
            play(now: now)
        }
    }

    public func setReducedMotionOverride(_ override: LiquidReducedMotionOverride, now: TimeInterval = LiquidPlayer.currentTime()) {
        tick(now: now)
        options.reducedMotion = override
        rebasePlayback(now: now)
        updateFrame()
    }

    public func setSystemPrefersReducedMotion(_ systemPrefersReducedMotion: Bool, now: TimeInterval = LiquidPlayer.currentTime()) {
        guard self.systemPrefersReducedMotion != systemPrefersReducedMotion else { return }
        tick(now: now)
        self.systemPrefersReducedMotion = systemPrefersReducedMotion
        rebasePlayback(now: now)
        updateFrame()
    }

    // Keeps progress continuous when the playback duration changes mid-play.
    private func rebasePlayback(now: TimeInterval) {
        playStartTime = now
        playStartProgress = progress
    }

    public func play(now: TimeInterval = LiquidPlayer.currentTime(), startsClock: Bool = true) {
        guard !isDestroyed else { return }
        if progress >= 1, !options.loop {
            seek(progress: 0, now: now)
        }
        playStartTime = now
        playStartProgress = progress
        isPlaying = true
        if startsClock {
            startPlaybackTask()
        }
    }

    public func pause(now: TimeInterval = LiquidPlayer.currentTime()) {
        guard !isDestroyed else { return }
        tick(now: now)
        isPlaying = false
        stopPlaybackTask()
    }

    public func seek(progress rawProgress: Double, now: TimeInterval = LiquidPlayer.currentTime()) {
        guard !isDestroyed else { return }
        progress = LiquidMath.clamp01(rawProgress)
        playStartTime = now
        playStartProgress = progress
        updateFrame()
    }

    public func restart(now: TimeInterval = LiquidPlayer.currentTime(), startsClock: Bool = true) {
        guard !isDestroyed else { return }
        seek(progress: 0, now: now)
        play(now: now, startsClock: startsClock)
    }

    public func tick(now: TimeInterval = LiquidPlayer.currentTime()) {
        guard isPlaying, !isDestroyed else { return }
        let elapsed = max(0, now - playStartTime)
        let rawProgress = playStartProgress + elapsed / durationSeconds

        if let loopStart {
            if rawProgress < 1 {
                progress = max(0, rawProgress)
            } else {
                progress = loopStart + (rawProgress - 1).truncatingRemainder(dividingBy: 1 - loopStart)
            }
            playStartTime = now
            playStartProgress = progress
        } else {
            progress = LiquidMath.clamp01(rawProgress)
            if rawProgress >= 1 {
                isPlaying = false
                stopPlaybackTask()
            }
        }
        updateFrame()
    }

    /// Where looping playback wraps to, or nil when playback should not loop. Scenes
    /// with a loop region replay it after their intro; reduced motion holds instead.
    private var loopStart: Double? {
        guard options.loop else { return nil }
        guard case let .v2(scene) = anyScene, let loop = scene.loop else { return 0 }
        return usesReducedMotion ? nil : loop.start
    }

    public func destroy() {
        isPlaying = false
        isDestroyed = true
        metalRenderer?.clearCaches()
        stopPlaybackTask()
    }

    public func renderCGImage(
        backingSize: LiquidBackingSize,
        style: LiquidPlayerRenderStyle = LiquidPlayerRenderStyle()
    ) -> CGImage? {
        guard !isDestroyed, backingSize.width > 0, backingSize.height > 0 else { return nil }
        if case let .v2(scene) = anyScene,
           case let .v2(frame) = anyFrame,
           style.backend != .coreGraphics,
           let metalImage = renderMetalCGImage(scene: scene, frame: frame, backingSize: backingSize, style: style) {
            selectedRendererBackend = .metal
            return metalImage
        }
        selectedRendererBackend = .coreGraphics
        return renderer.renderCGImage(
            scene: anyScene,
            frame: anyFrame,
            options: style.renderOptions(width: backingSize.width, height: backingSize.height)
        )
    }

    public func renderCGImage(
        logicalSize: CGSize,
        displayScale: Double,
        backingOptions: LiquidBackingScaleOptions = LiquidBackingScaleOptions(),
        style: LiquidPlayerRenderStyle = LiquidPlayerRenderStyle()
    ) -> CGImage? {
        renderCGImage(
            backingSize: liquidBackingSize(logicalSize: logicalSize, displayScale: displayScale, options: backingOptions),
            style: style
        )
    }

    public static func resolveReducedMotion(
        _ override: LiquidReducedMotionOverride,
        systemPrefersReducedMotion: Bool
    ) -> Bool {
        switch override {
        case .system:
            return systemPrefersReducedMotion
        case .enabled:
            return true
        case .disabled:
            return false
        }
    }

    public static func currentTime() -> TimeInterval {
        ProcessInfo.processInfo.systemUptime
    }

    private func updateFrame() {
        switch anyScene {
        case let .v1(scene):
            let next = evaluator.evaluate(scene: scene, progress: progress, reducedMotion: usesReducedMotion)
            frame = next
            frameV2 = nil
            anyFrame = .v1(next)
        case let .v2(scene):
            let next = try! evaluator.evaluateChecked(scene: scene, progress: progress, reducedMotion: usesReducedMotion)
            frameV2 = next
            anyFrame = .v2(next)
        }
    }

    private static func placeholderFrame(progress: Double) -> LiquidFrame {
        let point = LiquidPoint(x: 0, y: 0)
        let capsule = LiquidCapsule(start: point, end: point, radius: 0)
        return LiquidFrame(
            progress: progress,
            phase: "",
            events: [],
            renderMode: .field,
            sourceOpacity: 1,
            targetOpacity: 0,
            frame: LiquidPoseFrame(
                anchor: point,
                leftLeg: capsule,
                rightLeg: capsule,
                crossbar: capsule,
                bridge: capsule,
                blendRadius: 0,
                targetMix: 0,
                cornerSharpness: 0
            ),
            endpointCommands: nil
        )
    }

    private func startPlaybackTask() {
        stopPlaybackTask()
        let interval = max(options.frameInterval, 1.0 / 120.0)
        playbackTask = Task { @MainActor [weak self] in
            while let self, !Task.isCancelled, self.isPlaying, !self.isDestroyed {
                self.tick(now: Self.currentTime())
                let nanoseconds = UInt64((interval * 1_000_000_000).rounded())
                try? await Task.sleep(nanoseconds: nanoseconds)
            }
        }
    }

    private func stopPlaybackTask() {
        playbackTask?.cancel()
        playbackTask = nil
    }

    private func renderMetalCGImage(
        scene: LiquidSceneV2,
        frame: LiquidFrameV2,
        backingSize: LiquidBackingSize,
        style: LiquidPlayerRenderStyle
    ) -> CGImage? {
        let renderer = metalRenderer ?? LiquidMetalRenderer()
        guard let renderer else {
            rendererCapabilities = LiquidMetalRenderer.systemCapabilities()
            return nil
        }
        metalRenderer = renderer
        rendererCapabilities = renderer.capabilities
        guard renderer.canRender(scene: scene, frame: frame, width: backingSize.width, height: backingSize.height) else {
            return nil
        }
        return renderer.renderCGImage(
            scene: scene,
            frame: frame,
            options: style.renderOptions(width: backingSize.width, height: backingSize.height)
        )
    }
}

@MainActor
public final class LiquidPlayerView: NSView {
    public let player: LiquidPlayer
    public var backingOptions: LiquidBackingScaleOptions {
        didSet { renderNow() }
    }
    public var renderStyle: LiquidPlayerRenderStyle {
        didSet { renderNow() }
    }

    private var cancellable: AnyCancellable?

    public init(
        player: LiquidPlayer,
        backingOptions: LiquidBackingScaleOptions = LiquidBackingScaleOptions(),
        renderStyle: LiquidPlayerRenderStyle = LiquidPlayerRenderStyle()
    ) {
        self.player = player
        self.backingOptions = backingOptions
        self.renderStyle = renderStyle
        super.init(frame: .zero)
        wantsLayer = true
        layer?.contentsGravity = .resize
        layer?.magnificationFilter = .linear
        layer?.minificationFilter = .linear
        cancellable = player.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in
                self?.renderNow()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    public override func layout() {
        super.layout()
        renderNow()
    }

    public override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        renderNow()
    }

    public func setSystemPrefersReducedMotion(_ systemPrefersReducedMotion: Bool) {
        player.setSystemPrefersReducedMotion(systemPrefersReducedMotion)
        renderNow()
    }

    public func renderNow() {
        let backingSize = liquidBackingSize(
            logicalSize: bounds.size,
            displayScale: Double(window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 1),
            options: backingOptions
        )
        guard let image = player.renderCGImage(backingSize: backingSize, style: renderStyle) else {
            layer?.contents = nil
            return
        }
        layer?.contentsScale = CGFloat(backingSize.scale)
        layer?.contents = image
    }

    public func clearRenderedContents() {
        layer?.contents = nil
    }
}

public struct LiquidView: NSViewRepresentable {
    @ObservedObject private var player: LiquidPlayer
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

    private var backingOptions: LiquidBackingScaleOptions
    private var renderStyle: LiquidPlayerRenderStyle

    public init(
        player: LiquidPlayer,
        backingOptions: LiquidBackingScaleOptions = LiquidBackingScaleOptions(),
        renderStyle: LiquidPlayerRenderStyle = LiquidPlayerRenderStyle()
    ) {
        self._player = ObservedObject(wrappedValue: player)
        self.backingOptions = backingOptions
        self.renderStyle = renderStyle
    }

    public func makeNSView(context: Context) -> LiquidPlayerView {
        let view = LiquidPlayerView(player: player, backingOptions: backingOptions, renderStyle: renderStyle)
        view.setSystemPrefersReducedMotion(accessibilityReduceMotion)
        return view
    }

    public func updateNSView(_ nsView: LiquidPlayerView, context: Context) {
        nsView.backingOptions = backingOptions
        nsView.renderStyle = renderStyle
        nsView.setSystemPrefersReducedMotion(accessibilityReduceMotion)
        nsView.renderNow()
    }

    public static func dismantleNSView(_ nsView: LiquidPlayerView, coordinator: ()) {
        nsView.clearRenderedContents()
    }
}

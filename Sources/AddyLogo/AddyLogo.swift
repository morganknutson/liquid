import AppKit
import Combine
import LiquidCore
import LiquidMac
import LiquidScenes
import SwiftUI

/// Size of the Addy logo artwork (pill, ticks, and wordmark) in scene units.
public enum AddyLogoMetrics {
    public static let width: Double = 2973
    public static let height: Double = 1568
    public static let aspectRatio = width / height
}

/// Which animation plays after the ticks drop into the pill.
public enum AddyLogoVariant: Sendable {
    /// Flows into the Addy wordmark and holds.
    case wordmark
    /// Runs Addy's pill wave, looping until paused.
    case wave
    /// Waves three times, then flows into the Addy wordmark and holds.
    case waveThenWordmark

    var bundledScene: LiquidBundledScene {
        switch self {
        case .wordmark: return .spinnerToAddy
        case .wave: return .addyLogoWave
        case .waveThenWordmark: return .addyLogoWaveWordmark
        }
    }
}

/// Owns playback of the animated Addy logo. Create one when you need to replay or
/// pause the logo from outside the view; otherwise `AddyLogoView` makes its own.
@MainActor
public final class AddyLogoController: ObservableObject {
    public let player: LiquidPlayer
    /// True once a non-looping play has reached the wordmark.
    @Published public private(set) var isComplete = false

    private var completionHandlers: [UUID: () -> Void] = [:]
    private var cancellable: AnyCancellable?

    /// - Parameters:
    ///   - variant: The animation after the drop-in. Defaults to the wordmark.
    ///   - loop: Loop playback. Defaults to `true` for the wave and `false` for the wordmark.
    public init(variant: AddyLogoVariant = .wordmark, loop: Bool? = nil) throws {
        guard case let .v2(scene) = try LiquidScenes.loadScene(variant.bundledScene) else {
            throw LiquidValidationError.invalidScene("The bundled Addy logo scene must be schema v2")
        }
        player = try LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(autoplay: false, loop: loop ?? (variant == .wave), reducedMotion: .system))
        cancellable = player.$isPlaying.dropFirst().sink { [weak self] isPlaying in
            Task { @MainActor in self?.playbackChanged(isPlaying: isPlaying) }
        }
    }

    /// Plays from the current position, or from the empty pill after completing.
    public func play() {
        isComplete = false
        player.play()
    }

    public func pause() {
        player.pause()
    }

    /// Plays again from the empty pill.
    public func replay() {
        isComplete = false
        player.restart()
    }

    /// Shows the finished wordmark without animating.
    public func showWordmark() {
        player.pause()
        player.seek(progress: 1)
        isComplete = true
    }

    func onComplete(_ handler: @escaping () -> Void) -> UUID {
        let id = UUID()
        completionHandlers[id] = handler
        return id
    }

    func removeCompletionHandler(_ id: UUID) {
        completionHandlers[id] = nil
    }

    private func playbackChanged(isPlaying: Bool) {
        guard !isPlaying, !player.options.loop, player.progress >= 1, !isComplete else { return }
        isComplete = true
        for handler in completionHandlers.values { handler() }
    }
}

/// The animated Addy logo: the pill, four ticks that drop in, and the liquid
/// transition into the wordmark. Sizes to the width it is given and keeps the
/// artwork's aspect ratio.
///
/// ```swift
/// AddyLogoView()                       // plays once on appear in the foreground color
///     .frame(width: 240)
/// AddyLogoView(color: .accentColor, loop: true)
/// AddyLogoView(variant: .wave)          // drop-in, then Addy's pill wave on loop
/// ```
public struct AddyLogoView: View {
    @StateObject private var ownedController: AddyLogoControllerBox
    private let externalController: AddyLogoController?
    private let color: Color?
    private let playsOnAppear: Bool
    private let onComplete: (() -> Void)?

    /// - Parameters:
    ///   - color: Fill color. Defaults to the environment's foreground style (`.primary`).
    ///   - playsOnAppear: Start playing when the view appears. Otherwise it shows the empty pill until played.
    ///   - variant: The animation after the drop-in: the wordmark (default) or Addy's pill wave.
    ///   - loop: Loop playback. Defaults to `true` for the wave and `false` for the wordmark.
    ///   - onComplete: Called each time a non-looping play reaches its end.
    public init(variant: AddyLogoVariant = .wordmark, color: Color? = nil, playsOnAppear: Bool = true, loop: Bool? = nil, onComplete: (() -> Void)? = nil) {
        _ownedController = StateObject(wrappedValue: AddyLogoControllerBox(variant: variant, loop: loop))
        externalController = nil
        self.color = color
        self.playsOnAppear = playsOnAppear
        self.onComplete = onComplete
    }

    /// Renders a logo whose playback is driven by `controller`.
    public init(controller: AddyLogoController, color: Color? = nil, playsOnAppear: Bool = true, onComplete: (() -> Void)? = nil) {
        _ownedController = StateObject(wrappedValue: AddyLogoControllerBox(controller: nil))
        externalController = controller
        self.color = color
        self.playsOnAppear = playsOnAppear
        self.onComplete = onComplete
    }

    public var body: some View {
        Group {
            if let controller = externalController ?? ownedController.controller {
                AddyLogoPlayerView(controller: controller, color: color, playsOnAppear: playsOnAppear, onComplete: onComplete)
            } else {
                Color.clear
            }
        }
        .aspectRatio(AddyLogoMetrics.aspectRatio, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel("Addy")
        .accessibilityAddTraits(.isImage)
    }
}

@MainActor
private final class AddyLogoControllerBox: ObservableObject {
    let controller: AddyLogoController?

    init(variant: AddyLogoVariant, loop: Bool?) {
        controller = try? AddyLogoController(variant: variant, loop: loop)
    }

    init(controller: AddyLogoController?) {
        self.controller = controller
    }
}

private struct AddyLogoPlayerView: View {
    @ObservedObject var controller: AddyLogoController
    let color: Color?
    let playsOnAppear: Bool
    let onComplete: (() -> Void)?

    @Environment(\.colorScheme) private var colorScheme
    @State private var completionHandler: UUID?

    var body: some View {
        LiquidView(
            player: controller.player,
            // Metal renders the field on the GPU; the cap keeps large logos smooth.
            backingOptions: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 1600),
            renderStyle: renderStyle
        )
        .onAppear {
            if let onComplete {
                completionHandler = controller.onComplete(onComplete)
            }
            if playsOnAppear, !controller.player.isPlaying, !controller.isComplete {
                controller.play()
            }
        }
        .onDisappear {
            if let completionHandler {
                controller.removeCompletionHandler(completionHandler)
            }
            completionHandler = nil
            controller.pause()
        }
    }

    private var renderStyle: LiquidPlayerRenderStyle {
        let (red, green, blue) = rgb(color ?? .primary)
        return LiquidPlayerRenderStyle(fillRed: red, fillGreen: green, fillBlue: blue, backend: .auto)
    }

    // Resolves dynamic colors such as `.primary` against the view's color scheme.
    private func rgb(_ color: Color) -> (Double, Double, Double) {
        let appearance = NSAppearance(named: colorScheme == .dark ? .darkAqua : .aqua)
        var components = (red: 0.0, green: 0.0, blue: 0.0)
        (appearance ?? NSAppearance.currentDrawing()).performAsCurrentDrawingAppearance {
            if let resolved = NSColor(color).usingColorSpace(.sRGB) {
                components = (Double(resolved.redComponent), Double(resolved.greenComponent), Double(resolved.blueComponent))
            }
        }
        return components
    }
}

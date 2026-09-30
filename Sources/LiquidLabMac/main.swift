import AppKit
import Foundation
import LiquidCore
import LiquidMac
import SwiftUI

@main
struct LiquidLabMacApp: App {
    var body: some Scene {
        WindowGroup("Liquid Lab") {
            LiquidLabView()
                .frame(minWidth: 760, minHeight: 580)
        }
    }
}

private enum LabSceneChoice: String, CaseIterable, Identifiable {
    case capsuleToA
    case spinnerToAddy
    case spinnerToAD

    var id: String { rawValue }

    var title: String {
        switch self {
        case .capsuleToA:
            return "Capsule to A"
        case .spinnerToAddy:
            return "Spinner to Addy"
        case .spinnerToAD:
            return "Spinner to A+d study"
        }
    }

    var fileName: String {
        switch self {
        case .capsuleToA:
            return "capsule-to-a.v1.json"
        case .spinnerToAddy:
            return "spinner-to-addy.v2.json"
        case .spinnerToAD:
            return "spinner-to-ad.v2.json"
        }
    }

    static var initial: LabSceneChoice {
        if CommandLine.arguments.contains("--v2") || CommandLine.arguments.contains("--addy") {
            return .spinnerToAddy
        }
        if CommandLine.arguments.contains("--ad") || CommandLine.arguments.contains("--ad-study") {
            return .spinnerToAD
        }
        return .capsuleToA
    }
}

struct LiquidLabView: View {
    @State private var scene: AnyLiquidScene?
    @State private var selectedScene = LabSceneChoice.initial
    @State private var progress: Double = 0
    @State private var isPlaying = true
    @State private var reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    @State private var showCenterlines = false
    @State private var showRadii = false
    @State private var tuning = LiquidLabTuning.defaults
    @State private var playbackAnchorProgress: Double = 0
    @State private var playbackAnchorDate = Date()
    @State private var loadError: String?
    private let evaluator = LiquidEvaluator()
    private let renderer = LiquidCGRenderer()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let currentProgress = scene.map { playbackProgress(scene: $0, now: timeline.date) } ?? progress
            VStack(spacing: 16) {
                header(progress: currentProgress)
                renderView(progress: currentProgress)
                controls(displayProgress: currentProgress)
            }
            .padding(24)
            .background(Color(red: 0.055, green: 0.06, blue: 0.075))
            .foregroundStyle(.white)
        }
        .task {
            loadSelectedScene()
        }
        .onChange(of: selectedScene) { _ in
            loadSelectedScene()
        }
    }

    private func header(progress: Double) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Liquid Lab")
                    .font(.system(size: 22, weight: .semibold))
                Text(statusText(progress: progress))
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.62))
                    .lineLimit(2)
            }
            Spacer()
            Picker("Scene", selection: $selectedScene) {
                ForEach(LabSceneChoice.allCases) { choice in
                    Text(choice.title).tag(choice)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 260)
            Toggle("Reduce motion", isOn: reduceMotionBinding)
                .toggleStyle(.switch)
        }
    }

    private func controls(displayProgress: Double) -> some View {
        VStack(spacing: 12) {
            HStack {
                Button(isPlaying ? "Pause" : "Play") {
                    togglePlayback()
                }
                Button("Restart") {
                    setProgress(0)
                    isPlaying = true
                }
                Toggle("Centerlines", isOn: $showCenterlines)
                    .toggleStyle(.checkbox)
                Toggle("Radii", isOn: $showRadii)
                    .toggleStyle(.checkbox)
                Spacer()
                Text(String(format: "%.3f", displayProgress))
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
            }
            Slider(value: progressBinding(displayProgress: displayProgress), in: 0...1)
            Divider()
                .overlay(.white.opacity(0.12))
            if case .v1? = scene {
                v1TuningControls
            } else if case let .v2(scene)? = scene {
                v2StatusControls(scene: scene, progress: displayProgress)
            } else if let loadError {
                Text(loadError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.red.opacity(0.8))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.055))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var v1TuningControls: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Temporary tuning")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.76))
                Spacer()
                Button("Reset") {
                    tuning = .defaults
                }
                .controlSize(.small)
                .disabled(tuning == .defaults)
            }
            VStack(spacing: 8) {
                tuningRow(
                    "Leg gap",
                    value: $tuning.legSeparation,
                    range: -16...18,
                    step: 0.5,
                    text: String(format: "%+.1f", tuning.legSeparation)
                )
                tuningRow(
                    "Goo",
                    value: $tuning.gooStrength,
                    range: 0.2...1.8,
                    step: 0.05,
                    text: String(format: "%.2fx", tuning.gooStrength)
                )
                tuningRow(
                    "Bridge",
                    value: $tuning.bridgeThickness,
                    range: 0...1.9,
                    step: 0.05,
                    text: String(format: "%.2fx", tuning.bridgeThickness)
                )
                tuningRow(
                    "Crossbar",
                    value: $tuning.crossbarThickness,
                    range: 0.35...1.8,
                    step: 0.05,
                    text: String(format: "%.2fx", tuning.crossbarThickness)
                )
                tuningRow(
                    "Target bias",
                    value: $tuning.targetBias,
                    range: -0.22...0.22,
                    step: 0.01,
                    text: String(format: "%+.2f", tuning.targetBias)
                )
            }
        }
    }

    private func v2StatusControls(scene: LiquidSceneV2, progress: Double) -> some View {
        let frame = try? evaluator.evaluateChecked(scene: scene, progress: progress, reducedMotion: reducedMotion)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Generic v2 playback")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.76))
                Spacer()
                Text("\(scene.tracks.count) tracks")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.62))
            }
            ForEach(frame?.tracks ?? [], id: \.id) { track in
                HStack(spacing: 10) {
                    Text(track.id)
                        .frame(width: 190, alignment: .leading)
                    Text(track.renderMode.rawValue)
                        .frame(width: 72, alignment: .leading)
                    Text(String(format: "local %.3f", track.localProgress))
                    Spacer()
                    Text(String(format: "mix %.2f", track.material.groups["$track"]?["targetMix"]?.numberValue ?? 0))
                }
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.68))
            }
        }
    }

    private func statusText(progress: Double) -> String {
        guard let scene else { return loadError ?? "loading scene" }
        let duration = playbackDuration(scene: scene)
        switch scene {
        case let .v1(scene):
            let frame = evaluator.evaluate(scene: scene, progress: progress, reducedMotion: reducedMotion)
            return "\(selectedScene.title) | v1 | \(frame.phase) | \(frame.renderMode.rawValue) | \(Int(progress * duration))ms"
        case let .v2(scene):
            guard let frame = try? evaluator.evaluateChecked(scene: scene, progress: progress, reducedMotion: reducedMotion) else {
                return "\(selectedScene.title) | v2 | invalid scene"
            }
            let modes = frame.tracks.map { "\($0.id):\($0.renderMode.rawValue)" }.joined(separator: " ")
            return "\(selectedScene.title) | v2 | \(modes) | \(Int(progress * duration))ms"
        }
    }

    @ViewBuilder
    private func renderView(progress: Double) -> some View {
        if let scene {
            switch scene {
            case let .v1(scene):
                let frame = tunedFrame(evaluator.evaluate(scene: scene, progress: progress, reducedMotion: reducedMotion))
                LiquidFrameImage(scene: scene, frame: frame, renderer: renderer, showCenterlines: showCenterlines, showRadii: showRadii)
                    .aspectRatio(scene.coordinateSpace.width / scene.coordinateSpace.height, contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0.085, green: 0.095, blue: 0.115))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            case let .v2(scene):
                if let frame = try? evaluator.evaluateChecked(scene: scene, progress: progress, reducedMotion: reducedMotion) {
                    LiquidAnyFrameImage(scene: .v2(scene), frame: .v2(frame), renderer: renderer, showCenterlines: showCenterlines, showRadii: showRadii)
                        .aspectRatio(scene.coordinateSpace.width / scene.coordinateSpace.height, contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(red: 0.085, green: 0.095, blue: 0.115))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Text("Invalid v2 scene")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func progressBinding(displayProgress: Double) -> Binding<Double> {
        Binding(
            get: { displayProgress },
            set: { newValue in
                setProgress(newValue)
                isPlaying = false
            }
        )
    }

    private var reduceMotionBinding: Binding<Bool> {
        Binding(
            get: { reducedMotion },
            set: { newValue in
                if let scene {
                    setProgress(playbackProgress(scene: scene, now: Date()))
                }
                reducedMotion = newValue
                playbackAnchorDate = Date()
                playbackAnchorProgress = progress
            }
        )
    }

    private func tuningRow(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, text: String) -> some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
                .frame(width: 76, alignment: .leading)
            Slider(value: value, in: range, step: step)
                .controlSize(.small)
            Text(text)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.68))
                .frame(width: 54, alignment: .trailing)
        }
    }

    private func tunedFrame(_ frame: LiquidFrame) -> LiquidFrame {
        guard frame.renderMode == .field, frame.progress > 0, frame.progress < 1 else {
            return frame
        }
        var tuned = frame
        tuned.frame = tuning.apply(to: frame.frame)
        return tuned
    }

    private func playbackProgress(scene: AnyLiquidScene, now: Date) -> Double {
        guard isPlaying else {
            return progress
        }
        let durationSeconds = max(playbackDuration(scene: scene) / 1000, 0.000001)
        let rawProgress = playbackAnchorProgress + now.timeIntervalSince(playbackAnchorDate) / durationSeconds
        return rawProgress - floor(rawProgress)
    }

    private func playbackDuration(scene: AnyLiquidScene) -> Double {
        switch scene {
        case let .v1(scene):
            return reducedMotion ? scene.reducedMotion.durationMs : scene.durationMs
        case let .v2(scene):
            return reducedMotion ? scene.reducedMotion.durationMs : scene.durationMs
        }
    }

    private func setProgress(_ newValue: Double) {
        progress = min(1, max(0, newValue))
        playbackAnchorProgress = progress
        playbackAnchorDate = Date()
    }

    private func togglePlayback() {
        if isPlaying {
            if let scene {
                setProgress(playbackProgress(scene: scene, now: Date()))
            }
            isPlaying = false
        } else {
            playbackAnchorProgress = progress
            playbackAnchorDate = Date()
            isPlaying = true
        }
    }

    private func loadSelectedScene() {
        do {
            scene = try LiquidLoader.loadAnyScene(from: sceneURL(for: selectedScene))
            loadError = nil
            setProgress(0)
            tuning = .defaults
        } catch {
            scene = nil
            loadError = error.localizedDescription
        }
    }

    private func sceneURL(for choice: LabSceneChoice) -> URL {
        if let explicitPath = CommandLine.arguments.dropFirst().first(where: { !$0.hasPrefix("--") }) {
            return URL(fileURLWithPath: explicitPath)
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            .appendingPathComponent("shared/scenes")
            .appendingPathComponent(choice.fileName)
    }
}

private struct LiquidLabTuning: Equatable {
    static let defaults = LiquidLabTuning()

    var legSeparation: Double = 0
    var gooStrength: Double = 1
    var bridgeThickness: Double = 1
    var crossbarThickness: Double = 1
    var targetBias: Double = 0

    func apply(to frame: LiquidPoseFrame) -> LiquidPoseFrame {
        LiquidPoseFrame(
            anchor: frame.anchor,
            leftLeg: offset(frame.leftLeg, by: -legSeparation),
            rightLeg: offset(frame.rightLeg, by: legSeparation),
            crossbar: scaledRadius(frame.crossbar, by: crossbarThickness),
            bridge: scaledRadius(frame.bridge, by: bridgeThickness),
            blendRadius: max(0, frame.blendRadius * gooStrength),
            targetMix: clamp01(frame.targetMix + targetBias),
            cornerSharpness: clamp01(frame.cornerSharpness + targetBias)
        )
    }

    private func offset(_ capsule: LiquidCapsule, by x: Double) -> LiquidCapsule {
        LiquidCapsule(
            start: shifted(capsule.start, by: x),
            end: shifted(capsule.end, by: x),
            radius: capsule.radius
        )
    }

    private func scaledRadius(_ capsule: LiquidCapsule, by factor: Double) -> LiquidCapsule {
        LiquidCapsule(start: capsule.start, end: capsule.end, radius: max(0, capsule.radius * factor))
    }

    private func shifted(_ point: LiquidPoint, by x: Double) -> LiquidPoint {
        LiquidPoint(x: point.x + x, y: point.y)
    }

    private func clamp01(_ value: Double) -> Double {
        min(1, max(0, value))
    }
}

struct LiquidFrameImage: NSViewRepresentable {
    var scene: LiquidScene
    var frame: LiquidFrame
    var renderer: LiquidCGRenderer
    var showCenterlines: Bool
    var showRadii: Bool

    func makeNSView(context: Context) -> LiquidImageView {
        LiquidImageView()
    }

    func updateNSView(_ view: LiquidImageView, context: Context) {
        let options = LiquidRenderOptions(
            width: 512,
            height: 488,
            debug: LiquidDebugOptions(showsCenterlines: showCenterlines, showsRadii: showRadii)
        )
        view.image = renderer.renderCGImage(scene: scene, frame: frame, options: options).map { NSImage(cgImage: $0, size: NSSize(width: options.width, height: options.height)) }
    }
}

struct LiquidAnyFrameImage: NSViewRepresentable {
    var scene: AnyLiquidScene
    var frame: AnyLiquidFrame
    var renderer: LiquidCGRenderer
    var showCenterlines: Bool
    var showRadii: Bool

    func makeNSView(context: Context) -> LiquidImageView {
        LiquidImageView()
    }

    func updateNSView(_ view: LiquidImageView, context: Context) {
        let options = LiquidRenderOptions(
            width: 704,
            height: 276,
            debug: LiquidDebugOptions(showsCenterlines: showCenterlines, showsRadii: showRadii)
        )
        view.image = renderer.renderCGImage(scene: scene, frame: frame, options: options).map { NSImage(cgImage: $0, size: NSSize(width: options.width, height: options.height)) }
    }
}

final class LiquidImageView: NSImageView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        imageScaling = .scaleProportionallyUpOrDown
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        imageScaling = .scaleProportionallyUpOrDown
    }
}

import Foundation

public enum LiquidLoader {
    public static func loadScene(from data: Data) throws -> LiquidScene {
        let scene = try JSONDecoder().decode(LiquidScene.self, from: data)
        try LiquidValidator.validate(scene)
        return scene
    }

    public static func loadScene(from url: URL) throws -> LiquidScene {
        try loadScene(from: Data(contentsOf: url))
    }

    public static func loadSampleManifest(from data: Data, sceneId: String? = nil) throws -> LiquidSampleManifest {
        let manifest = try JSONDecoder().decode(LiquidSampleManifest.self, from: data)
        try LiquidValidator.validate(manifest, sceneId: sceneId)
        return manifest
    }

    public static func loadSampleManifest(from url: URL, sceneId: String? = nil) throws -> LiquidSampleManifest {
        try loadSampleManifest(from: Data(contentsOf: url), sceneId: sceneId)
    }
}

public enum LiquidValidator {
    public static func validate(_ scene: LiquidScene) throws {
        guard scene.schemaVersion == 1 else { throw LiquidValidationError.invalidScene("schemaVersion must be 1") }
        guard !scene.id.isEmpty else { throw LiquidValidationError.invalidScene("id must not be empty") }
        guard scene.fixtureVersion >= 1 else { throw LiquidValidationError.invalidScene("fixtureVersion must be >= 1") }
        guard scene.durationMs.isFinite && scene.durationMs > 0 else { throw LiquidValidationError.invalidScene("durationMs must be positive and finite") }
        guard scene.coordinateSpace.width.isFinite, scene.coordinateSpace.width > 0,
              scene.coordinateSpace.height.isFinite, scene.coordinateSpace.height > 0 else {
            throw LiquidValidationError.invalidScene("coordinateSpace must be positive and finite")
        }
        guard scene.source.commands.count >= 2, scene.target.commands.count >= 2 else {
            throw LiquidValidationError.invalidScene("endpoints must contain at least two commands")
        }
        try validatePathCommands(scene.source.commands, endpoint: "source")
        try validatePathCommands(scene.target.commands, endpoint: "target")
        guard scene.phases.isEmpty == false else { throw LiquidValidationError.invalidScene("phases must not be empty") }
        guard scene.poses.count >= 2 else { throw LiquidValidationError.invalidScene("poses must contain at least two entries") }
        try validateFinite(scene)
        try validatePhases(scene.phases)
        try validatePoses(scene.poses)
        try validateReducedMotion(scene.reducedMotion)
    }

    public static func validate(_ manifest: LiquidSampleManifest, sceneId: String? = nil) throws {
        guard manifest.schemaVersion == 1 else { throw LiquidValidationError.invalidSamples("sample schemaVersion must be 1") }
        if let sceneId {
            guard manifest.sceneId == sceneId else { throw LiquidValidationError.invalidSamples("sample sceneId does not match scene") }
        }
        var labels = Set<String>()
        for sample in manifest.samples {
            guard sample.progress.isFinite, sample.progress >= 0, sample.progress <= 1 else {
                throw LiquidValidationError.invalidSamples("sample progress must be finite within 0...1")
            }
            guard labels.insert(sample.label).inserted else {
                throw LiquidValidationError.invalidSamples("duplicate sample label \(sample.label)")
            }
        }
    }

    private static func validatePhases(_ phases: [LiquidPhase]) throws {
        for (index, phase) in phases.enumerated() {
            guard !phase.id.isEmpty else { throw LiquidValidationError.invalidScene("phase id must not be empty") }
            guard phase.start.isFinite, phase.end.isFinite, phase.start >= 0, phase.end <= 1, phase.start < phase.end else {
                throw LiquidValidationError.invalidScene("phase \(phase.id) has invalid interval")
            }
            if index == 0 {
                guard phase.start == 0 else { throw LiquidValidationError.invalidScene("first phase must start at 0") }
            } else {
                let previous = phases[index - 1]
                guard abs(previous.end - phase.start) <= 0.000000001 else {
                    throw LiquidValidationError.invalidScene("phases must be contiguous")
                }
            }
            if index == phases.count - 1 {
                guard phase.end == 1 else { throw LiquidValidationError.invalidScene("last phase must end at 1") }
            }
        }
    }

    private static func validatePoses(_ poses: [LiquidPose]) throws {
        for (index, pose) in poses.enumerated() {
            guard pose.at.isFinite, pose.at >= 0, pose.at <= 1 else {
                throw LiquidValidationError.invalidScene("pose progress must be finite within 0...1")
            }
            if index == 0 {
                guard pose.at == 0 else { throw LiquidValidationError.invalidScene("first pose must be at 0") }
            } else {
                guard poses[index - 1].at < pose.at else { throw LiquidValidationError.invalidScene("poses must be strictly ordered") }
            }
            if index == poses.count - 1 {
                guard pose.at == 1 else { throw LiquidValidationError.invalidScene("last pose must be at 1") }
            }
        }
    }

    private static func validateReducedMotion(_ reducedMotion: LiquidReducedMotion) throws {
        guard reducedMotion.mode == "crossfade" else { throw LiquidValidationError.invalidScene("only crossfade reduced motion is supported") }
        guard reducedMotion.durationMs.isFinite, reducedMotion.durationMs > 0 else {
            throw LiquidValidationError.invalidScene("reducedMotion durationMs must be positive and finite")
        }
        guard reducedMotion.fadeStart.isFinite, reducedMotion.fadeEnd.isFinite,
              reducedMotion.fadeStart >= 0, reducedMotion.fadeStart <= 1,
              reducedMotion.fadeEnd >= 0, reducedMotion.fadeEnd <= 1,
              reducedMotion.fadeStart < reducedMotion.fadeEnd else {
            throw LiquidValidationError.invalidScene("reducedMotion fade interval is invalid")
        }
    }

    private static func validatePathCommands(_ commands: [LiquidPathCommand], endpoint: String) throws {
        var hasOpenContour = false
        for (index, command) in commands.enumerated() {
            switch command {
            case .move:
                guard hasOpenContour == false else {
                    throw LiquidValidationError.invalidScene("\(endpoint).commands[\(index)] must follow Z before starting another contour")
                }
                hasOpenContour = true
            case .line, .cubic:
                guard hasOpenContour else {
                    throw LiquidValidationError.invalidScene("\(endpoint).commands[\(index)] must follow M")
                }
            case .close:
                guard hasOpenContour else {
                    throw LiquidValidationError.invalidScene("\(endpoint).commands[\(index)] must follow M")
                }
                hasOpenContour = false
            }
        }
        guard hasOpenContour == false else {
            throw LiquidValidationError.invalidScene("\(endpoint).commands must close every contour with Z")
        }
    }

    private static func validateFinite(_ scene: LiquidScene) throws {
        func check(_ value: Double, _ name: String) throws {
            guard value.isFinite else { throw LiquidValidationError.invalidScene("\(name) must be finite") }
        }

        try check(scene.source.transform.translateX, "source.transform.translateX")
        try check(scene.source.transform.translateY, "source.transform.translateY")
        try check(scene.source.transform.scaleX, "source.transform.scaleX")
        try check(scene.source.transform.scaleY, "source.transform.scaleY")
        try check(scene.target.transform.translateX, "target.transform.translateX")
        try check(scene.target.transform.translateY, "target.transform.translateY")
        try check(scene.target.transform.scaleX, "target.transform.scaleX")
        try check(scene.target.transform.scaleY, "target.transform.scaleY")

        for command in scene.source.commands + scene.target.commands {
            for value in command.values ?? [] {
                try check(value, "path command value")
            }
        }

        for threshold in scene.thresholds {
            guard !threshold.id.isEmpty else { throw LiquidValidationError.invalidScene("threshold id must not be empty") }
            try check(threshold.at, "threshold.at")
        }

        for pose in scene.poses {
            try validateFinite(pose.frame)
        }
    }

    private static func validateFinite(_ frame: LiquidPoseFrame) throws {
        func check(_ point: LiquidPoint, _ name: String) throws {
            guard point.x.isFinite, point.y.isFinite else { throw LiquidValidationError.invalidScene("\(name) must be finite") }
        }
        func check(_ capsule: LiquidCapsule, _ name: String) throws {
            try check(capsule.start, "\(name).start")
            try check(capsule.end, "\(name).end")
            guard capsule.radius.isFinite, capsule.radius >= 0 else {
                throw LiquidValidationError.invalidScene("\(name).radius must be finite and non-negative")
            }
        }

        try check(frame.anchor, "anchor")
        try check(frame.leftLeg, "leftLeg")
        try check(frame.rightLeg, "rightLeg")
        try check(frame.crossbar, "crossbar")
        try check(frame.bridge, "bridge")
        guard frame.blendRadius.isFinite, frame.blendRadius >= 0 else { throw LiquidValidationError.invalidScene("blendRadius must be finite and non-negative") }
        guard frame.targetMix.isFinite, frame.targetMix >= 0, frame.targetMix <= 1 else { throw LiquidValidationError.invalidScene("targetMix must be finite within 0...1") }
        guard frame.cornerSharpness.isFinite, frame.cornerSharpness >= 0, frame.cornerSharpness <= 1 else {
            throw LiquidValidationError.invalidScene("cornerSharpness must be finite within 0...1")
        }
    }
}

public struct LiquidEvaluator: Sendable {
    public init() {}

    public func evaluate(scene: LiquidScene, progress rawProgress: Double, reducedMotion: Bool = false) -> LiquidFrame {
        let progress = LiquidMath.clamp01(rawProgress)
        let poseFrame = interpolatedFrame(scene: scene, progress: progress)
        let phase = phaseId(scene: scene, progress: progress)
        let events = scene.thresholds
            .filter { $0.at <= progress }
            .map(\.id)

        if reducedMotion {
            let fade = reducedMotionOpacity(scene.reducedMotion, progress: progress)
            return LiquidFrame(
                progress: progress,
                phase: phase,
                events: events,
                renderMode: .crossfade,
                sourceOpacity: fade.source,
                targetOpacity: fade.target,
                frame: scene.poses.first?.frame ?? poseFrame,
                endpointCommands: nil
            )
        }

        if progress == 0 {
            return LiquidFrame(
                progress: progress,
                phase: phase,
                events: events,
                renderMode: .sourcePath,
                sourceOpacity: 1,
                targetOpacity: 0,
                frame: poseFrame,
                endpointCommands: scene.source.commands
            )
        }

        if progress == 1 {
            return LiquidFrame(
                progress: progress,
                phase: phase,
                events: events,
                renderMode: .targetPath,
                sourceOpacity: 0,
                targetOpacity: 1,
                frame: poseFrame,
                endpointCommands: scene.target.commands
            )
        }

        return LiquidFrame(
            progress: progress,
            phase: phase,
            events: events,
            renderMode: .field,
            sourceOpacity: 1,
            targetOpacity: 0,
            frame: poseFrame,
            endpointCommands: nil
        )
    }

    public func makeOutput(scene: LiquidScene, manifest: LiquidSampleManifest, reducedMotion: Bool = false) throws -> LiquidFrameOutput {
        try LiquidValidator.validate(scene)
        try LiquidValidator.validate(manifest, sceneId: scene.id)
        let samples = manifest.samples.map { request in
            LiquidFrameSample(label: request.label, frame: evaluate(scene: scene, progress: request.progress, reducedMotion: reducedMotion))
        }
        return LiquidFrameOutput(schemaVersion: 1, sceneId: scene.id, fixtureVersion: scene.fixtureVersion, samples: samples)
    }

    private func phaseId(scene: LiquidScene, progress: Double) -> String {
        if progress == 1 {
            return scene.phases.last?.id ?? ""
        }
        return scene.phases.first { phase in
            phase.start <= progress && progress < phase.end
        }?.id ?? scene.phases.last?.id ?? ""
    }

    private func reducedMotionOpacity(_ reducedMotion: LiquidReducedMotion, progress: Double) -> (source: Double, target: Double) {
        if progress <= reducedMotion.fadeStart {
            return (1, 0)
        }
        if progress >= reducedMotion.fadeEnd {
            return (0, 1)
        }
        let local = (progress - reducedMotion.fadeStart) / (reducedMotion.fadeEnd - reducedMotion.fadeStart)
        let clamped = LiquidMath.clamp01(local)
        return (1 - clamped, clamped)
    }

    private func interpolatedFrame(scene: LiquidScene, progress: Double) -> LiquidPoseFrame {
        guard let first = scene.poses.first else {
            return LiquidPoseFrame(
                anchor: LiquidPoint(x: 0, y: 0),
                leftLeg: LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 0), radius: 0),
                rightLeg: LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 0), radius: 0),
                crossbar: LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 0), radius: 0),
                bridge: LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 0), radius: 0),
                blendRadius: 0,
                targetMix: 0,
                cornerSharpness: 0
            )
        }

        if progress <= first.at {
            return first.frame
        }
        for index in 1..<scene.poses.count {
            let previous = scene.poses[index - 1]
            let next = scene.poses[index]
            if progress <= next.at {
                if progress == next.at {
                    return next.frame
                }
                let local = (progress - previous.at) / (next.at - previous.at)
                let eased = next.easing.apply(local)
                return LiquidPoseFrame.interpolate(from: previous.frame, to: next.frame, progress: eased)
            }
        }
        return scene.poses.last?.frame ?? first.frame
    }
}

extension LiquidPoseFrame {
    public static func interpolate(from start: LiquidPoseFrame, to end: LiquidPoseFrame, progress: Double) -> LiquidPoseFrame {
        LiquidPoseFrame(
            anchor: LiquidPoint.interpolate(from: start.anchor, to: end.anchor, progress: progress),
            leftLeg: LiquidCapsule.interpolate(from: start.leftLeg, to: end.leftLeg, progress: progress),
            rightLeg: LiquidCapsule.interpolate(from: start.rightLeg, to: end.rightLeg, progress: progress),
            crossbar: LiquidCapsule.interpolate(from: start.crossbar, to: end.crossbar, progress: progress),
            bridge: LiquidCapsule.interpolate(from: start.bridge, to: end.bridge, progress: progress),
            blendRadius: interpolateDouble(start.blendRadius, end.blendRadius, progress),
            targetMix: interpolateDouble(start.targetMix, end.targetMix, progress),
            cornerSharpness: interpolateDouble(start.cornerSharpness, end.cornerSharpness, progress)
        )
    }
}

extension LiquidPoint {
    public static func interpolate(from start: LiquidPoint, to end: LiquidPoint, progress: Double) -> LiquidPoint {
        LiquidPoint(
            x: interpolateDouble(start.x, end.x, progress),
            y: interpolateDouble(start.y, end.y, progress)
        )
    }
}

extension LiquidCapsule {
    public static func interpolate(from start: LiquidCapsule, to end: LiquidCapsule, progress: Double) -> LiquidCapsule {
        LiquidCapsule(
            start: LiquidPoint.interpolate(from: start.start, to: end.start, progress: progress),
            end: LiquidPoint.interpolate(from: start.end, to: end.end, progress: progress),
            radius: interpolateDouble(start.radius, end.radius, progress)
        )
    }
}

private func interpolateDouble(_ start: Double, _ end: Double, _ progress: Double) -> Double {
    start + (end - start) * progress
}

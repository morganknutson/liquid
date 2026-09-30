import Foundation

public struct LiquidSize: Codable, Equatable, Sendable {
    public var width: Double
    public var height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

public struct LiquidPoint: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct LiquidTransform: Codable, Equatable, Sendable {
    public var translateX: Double
    public var translateY: Double
    public var scaleX: Double
    public var scaleY: Double

    public init(translateX: Double, translateY: Double, scaleX: Double, scaleY: Double) {
        self.translateX = translateX
        self.translateY = translateY
        self.scaleX = scaleX
        self.scaleY = scaleY
    }

    public func apply(to point: LiquidPoint) -> LiquidPoint {
        LiquidPoint(
            x: point.x * scaleX + translateX,
            y: point.y * scaleY + translateY
        )
    }
}

public enum LiquidFillRule: String, Codable, Sendable {
    case nonzero
    case evenodd
}

public enum LiquidEasing: String, Codable, Sendable {
    case linear
    case smoothStep
    case smootherStep
    case easeInCubic
    case easeOutCubic

    public func apply(_ x: Double) -> Double {
        let t = LiquidMath.clamp01(x)
        switch self {
        case .linear:
            return t
        case .smoothStep:
            return t * t * (3 - 2 * t)
        case .smootherStep:
            return t * t * t * (t * (6 * t - 15) + 10)
        case .easeInCubic:
            return t * t * t
        case .easeOutCubic:
            let inverted = 1 - t
            return 1 - inverted * inverted * inverted
        }
    }
}

public enum LiquidPathCommand: Codable, Equatable, Sendable {
    case move(Double, Double)
    case line(Double, Double)
    case cubic(Double, Double, Double, Double, Double, Double)
    case close

    private enum CodingKeys: String, CodingKey {
        case type
        case values
    }

    public var type: String {
        switch self {
        case .move: return "M"
        case .line: return "L"
        case .cubic: return "C"
        case .close: return "Z"
        }
    }

    public var values: [Double]? {
        switch self {
        case let .move(x, y), let .line(x, y):
            return [x, y]
        case let .cubic(x1, y1, x2, y2, x, y):
            return [x1, y1, x2, y2, x, y]
        case .close:
            return nil
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "M":
            let values = try container.decode([Double].self, forKey: .values)
            guard values.count == 2 else { throw LiquidValidationError.invalidPathCommand("M requires two values") }
            self = .move(values[0], values[1])
        case "L":
            let values = try container.decode([Double].self, forKey: .values)
            guard values.count == 2 else { throw LiquidValidationError.invalidPathCommand("L requires two values") }
            self = .line(values[0], values[1])
        case "C":
            let values = try container.decode([Double].self, forKey: .values)
            guard values.count == 6 else { throw LiquidValidationError.invalidPathCommand("C requires six values") }
            self = .cubic(values[0], values[1], values[2], values[3], values[4], values[5])
        case "Z":
            self = .close
        default:
            throw LiquidValidationError.invalidPathCommand("Unsupported command \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        if let values {
            try container.encode(values, forKey: .values)
        }
    }

    public func transformed(by transform: LiquidTransform) -> LiquidPathCommand {
        switch self {
        case let .move(x, y):
            let point = transform.apply(to: LiquidPoint(x: x, y: y))
            return .move(point.x, point.y)
        case let .line(x, y):
            let point = transform.apply(to: LiquidPoint(x: x, y: y))
            return .line(point.x, point.y)
        case let .cubic(x1, y1, x2, y2, x, y):
            let p1 = transform.apply(to: LiquidPoint(x: x1, y: y1))
            let p2 = transform.apply(to: LiquidPoint(x: x2, y: y2))
            let p = transform.apply(to: LiquidPoint(x: x, y: y))
            return .cubic(p1.x, p1.y, p2.x, p2.y, p.x, p.y)
        case .close:
            return .close
        }
    }
}

public struct LiquidEndpoint: Codable, Equatable, Sendable {
    public var assetId: String
    public var shapeId: String
    public var transform: LiquidTransform
    public var commands: [LiquidPathCommand]

    public init(assetId: String, shapeId: String, transform: LiquidTransform, commands: [LiquidPathCommand]) {
        self.assetId = assetId
        self.shapeId = shapeId
        self.transform = transform
        self.commands = commands
    }

    public var transformedCommands: [LiquidPathCommand] {
        commands.map { $0.transformed(by: transform) }
    }
}

public struct LiquidPhase: Codable, Equatable, Sendable {
    public var id: String
    public var start: Double
    public var end: Double

    public init(id: String, start: Double, end: Double) {
        self.id = id
        self.start = start
        self.end = end
    }
}

public struct LiquidThreshold: Codable, Equatable, Sendable {
    public var id: String
    public var at: Double

    public init(id: String, at: Double) {
        self.id = id
        self.at = at
    }
}

public struct LiquidCapsule: Codable, Equatable, Sendable {
    public var start: LiquidPoint
    public var end: LiquidPoint
    public var radius: Double

    public init(start: LiquidPoint, end: LiquidPoint, radius: Double) {
        self.start = start
        self.end = end
        self.radius = radius
    }
}

public struct LiquidPoseFrame: Codable, Equatable, Sendable {
    public var anchor: LiquidPoint
    public var leftLeg: LiquidCapsule
    public var rightLeg: LiquidCapsule
    public var crossbar: LiquidCapsule
    public var bridge: LiquidCapsule
    public var blendRadius: Double
    public var targetMix: Double
    public var cornerSharpness: Double

    public init(
        anchor: LiquidPoint,
        leftLeg: LiquidCapsule,
        rightLeg: LiquidCapsule,
        crossbar: LiquidCapsule,
        bridge: LiquidCapsule,
        blendRadius: Double,
        targetMix: Double,
        cornerSharpness: Double
    ) {
        self.anchor = anchor
        self.leftLeg = leftLeg
        self.rightLeg = rightLeg
        self.crossbar = crossbar
        self.bridge = bridge
        self.blendRadius = blendRadius
        self.targetMix = targetMix
        self.cornerSharpness = cornerSharpness
    }
}

public struct LiquidPose: Codable, Equatable, Sendable {
    public var at: Double
    public var easing: LiquidEasing
    public var frame: LiquidPoseFrame

    public init(at: Double, easing: LiquidEasing, frame: LiquidPoseFrame) {
        self.at = at
        self.easing = easing
        self.frame = frame
    }
}

public struct LiquidReducedMotion: Codable, Equatable, Sendable {
    public var mode: String
    public var durationMs: Double
    public var fadeStart: Double
    public var fadeEnd: Double

    public init(mode: String, durationMs: Double, fadeStart: Double, fadeEnd: Double) {
        self.mode = mode
        self.durationMs = durationMs
        self.fadeStart = fadeStart
        self.fadeEnd = fadeEnd
    }
}

public struct LiquidScene: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var fixtureVersion: Int
    public var durationMs: Double
    public var coordinateSpace: LiquidSize
    public var fillRule: LiquidFillRule
    public var source: LiquidEndpoint
    public var target: LiquidEndpoint
    public var phases: [LiquidPhase]
    public var thresholds: [LiquidThreshold]
    public var poses: [LiquidPose]
    public var reducedMotion: LiquidReducedMotion

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case id
        case fixtureVersion
        case durationMs
        case coordinateSpace
        case fillRule
        case source
        case target
        case phases
        case thresholds
        case poses
        case reducedMotion
    }

    public init(
        schemaVersion: Int,
        id: String,
        fixtureVersion: Int,
        durationMs: Double,
        coordinateSpace: LiquidSize,
        fillRule: LiquidFillRule,
        source: LiquidEndpoint,
        target: LiquidEndpoint,
        phases: [LiquidPhase],
        thresholds: [LiquidThreshold],
        poses: [LiquidPose],
        reducedMotion: LiquidReducedMotion
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.fixtureVersion = fixtureVersion
        self.durationMs = durationMs
        self.coordinateSpace = coordinateSpace
        self.fillRule = fillRule
        self.source = source
        self.target = target
        self.phases = phases
        self.thresholds = thresholds
        self.poses = poses
        self.reducedMotion = reducedMotion
    }
}

public enum LiquidRenderMode: String, Codable, Sendable {
    case sourcePath
    case field
    case targetPath
    case crossfade
}

public struct LiquidFrame: Equatable, Sendable {
    public var progress: Double
    public var phase: String
    public var events: [String]
    public var renderMode: LiquidRenderMode
    public var sourceOpacity: Double
    public var targetOpacity: Double
    public var frame: LiquidPoseFrame
    public var endpointCommands: [LiquidPathCommand]?

    public init(
        progress: Double,
        phase: String,
        events: [String],
        renderMode: LiquidRenderMode,
        sourceOpacity: Double,
        targetOpacity: Double,
        frame: LiquidPoseFrame,
        endpointCommands: [LiquidPathCommand]?
    ) {
        self.progress = progress
        self.phase = phase
        self.events = events
        self.renderMode = renderMode
        self.sourceOpacity = sourceOpacity
        self.targetOpacity = targetOpacity
        self.frame = frame
        self.endpointCommands = endpointCommands
    }
}

public struct LiquidSampleRequest: Codable, Equatable, Sendable {
    public var label: String
    public var progress: Double

    public init(label: String, progress: Double) {
        self.label = label
        self.progress = progress
    }
}

public struct LiquidSampleManifest: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var sceneId: String
    public var samples: [LiquidSampleRequest]

    public init(schemaVersion: Int, sceneId: String, samples: [LiquidSampleRequest]) {
        self.schemaVersion = schemaVersion
        self.sceneId = sceneId
        self.samples = samples
    }
}

public struct LiquidFrameSample: Equatable, Sendable {
    public var label: String
    public var frame: LiquidFrame

    public init(label: String, frame: LiquidFrame) {
        self.label = label
        self.frame = frame
    }
}

public struct LiquidFrameOutput: Equatable, Sendable {
    public var schemaVersion: Int
    public var sceneId: String
    public var fixtureVersion: Int
    public var samples: [LiquidFrameSample]

    public init(schemaVersion: Int, sceneId: String, fixtureVersion: Int, samples: [LiquidFrameSample]) {
        self.schemaVersion = schemaVersion
        self.sceneId = sceneId
        self.fixtureVersion = fixtureVersion
        self.samples = samples
    }
}

public enum LiquidValidationError: Error, LocalizedError, Equatable {
    case invalidScene(String)
    case invalidPathCommand(String)
    case invalidSamples(String)

    public var errorDescription: String? {
        switch self {
        case let .invalidScene(message), let .invalidPathCommand(message), let .invalidSamples(message):
            return message
        }
    }
}

public enum LiquidMath {
    public static func clamp01(_ value: Double) -> Double {
        min(1, max(0, value))
    }

    public static func finite(_ value: Double) -> Bool {
        value.isFinite
    }
}

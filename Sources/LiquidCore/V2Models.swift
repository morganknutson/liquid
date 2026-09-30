import Foundation

public enum LiquidMaterialScalar: Codable, Equatable, Sendable {
    case number(Double)
    case string(String)
    case bool(Bool)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else {
            self = .bool(try container.decode(Bool.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .number(value):
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        }
    }

    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }
}

public typealias LiquidMaterialValues = [String: LiquidMaterialScalar]

public enum LiquidComponentKind: String, Codable, Sendable {
    case capsule
    case ribbon
    case ellipse
}

public enum LiquidCompositionOperation: String, Codable, Sendable {
    case union
    case subtract
}

public enum LiquidSemanticEventKind: String, Codable, Sendable {
    case step
    case release
}

public struct LiquidRibbon: Codable, Equatable, Sendable {
    public var p0: LiquidPoint
    public var p1: LiquidPoint
    public var p2: LiquidPoint
    public var p3: LiquidPoint
    public var startRadius: Double
    public var endRadius: Double

    public init(p0: LiquidPoint, p1: LiquidPoint, p2: LiquidPoint, p3: LiquidPoint, startRadius: Double, endRadius: Double) {
        self.p0 = p0
        self.p1 = p1
        self.p2 = p2
        self.p3 = p3
        self.startRadius = startRadius
        self.endRadius = endRadius
    }
}

public struct LiquidEllipse: Codable, Equatable, Sendable {
    public var center: LiquidPoint
    public var radiusX: Double
    public var radiusY: Double
    public var rotation: Double?

    public init(center: LiquidPoint, radiusX: Double, radiusY: Double, rotation: Double? = nil) {
        self.center = center
        self.radiusX = radiusX
        self.radiusY = radiusY
        self.rotation = rotation
    }
}

public enum LiquidPrimitive: Codable, Equatable, Sendable {
    case capsule(LiquidCapsule)
    case ribbon(LiquidRibbon)
    case ellipse(LiquidEllipse)

    private enum CodingKeys: String, CodingKey {
        case kind
        case start
        case end
        case radius
        case p0
        case p1
        case p2
        case p3
        case startRadius
        case endRadius
        case center
        case radiusX
        case radiusY
        case rotation
    }

    public var kind: LiquidComponentKind {
        switch self {
        case .capsule:
            return .capsule
        case .ribbon:
            return .ribbon
        case .ellipse:
            return .ellipse
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(LiquidComponentKind.self, forKey: .kind)
        switch kind {
        case .capsule:
            self = .capsule(LiquidCapsule(
                start: try container.decode(LiquidPoint.self, forKey: .start),
                end: try container.decode(LiquidPoint.self, forKey: .end),
                radius: try container.decode(Double.self, forKey: .radius)
            ))
        case .ribbon:
            self = .ribbon(LiquidRibbon(
                p0: try container.decode(LiquidPoint.self, forKey: .p0),
                p1: try container.decode(LiquidPoint.self, forKey: .p1),
                p2: try container.decode(LiquidPoint.self, forKey: .p2),
                p3: try container.decode(LiquidPoint.self, forKey: .p3),
                startRadius: try container.decode(Double.self, forKey: .startRadius),
                endRadius: try container.decode(Double.self, forKey: .endRadius)
            ))
        case .ellipse:
            self = .ellipse(LiquidEllipse(
                center: try container.decode(LiquidPoint.self, forKey: .center),
                radiusX: try container.decode(Double.self, forKey: .radiusX),
                radiusY: try container.decode(Double.self, forKey: .radiusY),
                rotation: try container.decodeIfPresent(Double.self, forKey: .rotation)
            ))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        switch self {
        case let .capsule(capsule):
            try container.encode(capsule.start, forKey: .start)
            try container.encode(capsule.end, forKey: .end)
            try container.encode(capsule.radius, forKey: .radius)
        case let .ribbon(ribbon):
            try container.encode(ribbon.p0, forKey: .p0)
            try container.encode(ribbon.p1, forKey: .p1)
            try container.encode(ribbon.p2, forKey: .p2)
            try container.encode(ribbon.p3, forKey: .p3)
            try container.encode(ribbon.startRadius, forKey: .startRadius)
            try container.encode(ribbon.endRadius, forKey: .endRadius)
        case let .ellipse(ellipse):
            try container.encode(ellipse.center, forKey: .center)
            try container.encode(ellipse.radiusX, forKey: .radiusX)
            try container.encode(ellipse.radiusY, forKey: .radiusY)
            try container.encodeIfPresent(ellipse.rotation, forKey: .rotation)
        }
    }
}

public struct LiquidComponentDefinition: Codable, Equatable, Sendable {
    public var id: String
    public var kind: LiquidComponentKind
    public var operation: LiquidCompositionOperation
    public var groupId: String?

    public init(id: String, kind: LiquidComponentKind, operation: LiquidCompositionOperation, groupId: String? = nil) {
        self.id = id
        self.kind = kind
        self.operation = operation
        self.groupId = groupId
    }
}

public struct LiquidComponentState: Codable, Equatable, Sendable {
    public var id: String
    public var primitive: LiquidPrimitive

    public init(id: String, primitive: LiquidPrimitive) {
        self.id = id
        self.primitive = primitive
    }
}

public struct LiquidKeyframeMaterial: Codable, Equatable, Sendable {
    public var components: [String: LiquidMaterialValues]?
    public var groups: [String: LiquidMaterialValues]?

    public init(components: [String: LiquidMaterialValues]? = nil, groups: [String: LiquidMaterialValues]? = nil) {
        self.components = components
        self.groups = groups
    }
}

public struct LiquidTrackKeyframe: Codable, Equatable, Sendable {
    public var at: Double
    public var easing: LiquidEasing
    public var components: [LiquidComponentState]
    public var material: LiquidKeyframeMaterial?

    public init(at: Double, easing: LiquidEasing, components: [LiquidComponentState], material: LiquidKeyframeMaterial? = nil) {
        self.at = at
        self.easing = easing
        self.components = components
        self.material = material
    }
}

public struct LiquidTrackTiming: Codable, Equatable, Sendable {
    public var start: Double
    public var end: Double

    public init(start: Double, end: Double) {
        self.start = start
        self.end = end
    }
}

public struct LiquidSemanticEvent: Codable, Equatable, Sendable {
    public var id: String
    public var kind: LiquidSemanticEventKind
    public var at: Double
    public var end: Double?
    public var componentId: String?
    public var payload: LiquidMaterialValues?

    public init(id: String, kind: LiquidSemanticEventKind, at: Double, end: Double? = nil, componentId: String? = nil, payload: LiquidMaterialValues? = nil) {
        self.id = id
        self.kind = kind
        self.at = at
        self.end = end
        self.componentId = componentId
        self.payload = payload
    }
}

public enum LiquidTrackInterpolation: String, Codable, Sendable {
    case keyframeEasing
    case monotoneCubic
}

public struct LiquidTrack: Codable, Equatable, Sendable {
    public var id: String
    public var source: LiquidEndpoint
    public var target: LiquidEndpoint
    public var timing: LiquidTrackTiming
    public var interpolation: LiquidTrackInterpolation?
    /// When true, the track always draws its exact target shape, moved by its `$track`
    /// placement, instead of a liquid field.
    public var rigid: Bool?
    public var components: [LiquidComponentDefinition]
    public var keyframes: [LiquidTrackKeyframe]
    public var events: [LiquidSemanticEvent]?

    public init(
        id: String,
        source: LiquidEndpoint,
        target: LiquidEndpoint,
        timing: LiquidTrackTiming,
        interpolation: LiquidTrackInterpolation? = nil,
        rigid: Bool? = nil,
        components: [LiquidComponentDefinition],
        keyframes: [LiquidTrackKeyframe],
        events: [LiquidSemanticEvent]? = nil
    ) {
        self.id = id
        self.source = source
        self.target = target
        self.timing = timing
        self.interpolation = interpolation
        self.rigid = rigid
        self.components = components
        self.keyframes = keyframes
        self.events = events
    }
}

public struct LiquidSceneLoop: Codable, Equatable, Sendable {
    public var start: Double

    public init(start: Double) {
        self.start = start
    }
}

/// A named point in normalized progress that hosts can seek to.
public struct LiquidSceneMarker: Codable, Equatable, Sendable {
    public var id: String
    public var at: Double

    public init(id: String, at: Double) {
        self.id = id
        self.at = at
    }
}

public struct LiquidSceneV2: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var fixtureVersion: Int
    public var durationMs: Double
    public var coordinateSpace: LiquidSize
    public var fillRule: LiquidFillRule
    public var tracks: [LiquidTrack]
    /// Exact vector shapes drawn on every frame beneath the tracks, e.g. a static frame around the motion.
    public var backdrop: [LiquidEndpoint]?
    /// When present, tracks are only drawn inside this shape. The backdrop is not clipped.
    public var clip: LiquidEndpoint?
    /// When present, looping playback wraps back to `start` instead of 0, so an intro plays once.
    public var loop: LiquidSceneLoop?
    /// Named points in normalized progress, e.g. where the main animation starts after an outro.
    public var markers: [LiquidSceneMarker]?
    public var reducedMotion: LiquidReducedMotion

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case id
        case fixtureVersion
        case durationMs
        case coordinateSpace
        case fillRule
        case tracks
        case backdrop
        case clip
        case loop
        case markers
        case reducedMotion
    }

    public init(
        schemaVersion: Int,
        id: String,
        fixtureVersion: Int,
        durationMs: Double,
        coordinateSpace: LiquidSize,
        fillRule: LiquidFillRule,
        tracks: [LiquidTrack],
        backdrop: [LiquidEndpoint]? = nil,
        clip: LiquidEndpoint? = nil,
        loop: LiquidSceneLoop? = nil,
        markers: [LiquidSceneMarker]? = nil,
        reducedMotion: LiquidReducedMotion
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.fixtureVersion = fixtureVersion
        self.durationMs = durationMs
        self.coordinateSpace = coordinateSpace
        self.fillRule = fillRule
        self.tracks = tracks
        self.backdrop = backdrop
        self.clip = clip
        self.loop = loop
        self.markers = markers
        self.reducedMotion = reducedMotion
    }
}

public enum AnyLiquidScene: Equatable, Sendable {
    case v1(LiquidScene)
    case v2(LiquidSceneV2)

    public var schemaVersion: Int {
        switch self {
        case .v1:
            return 1
        case .v2:
            return 2
        }
    }

    public var id: String {
        switch self {
        case let .v1(scene):
            return scene.id
        case let .v2(scene):
            return scene.id
        }
    }

    public var fixtureVersion: Int {
        switch self {
        case let .v1(scene):
            return scene.fixtureVersion
        case let .v2(scene):
            return scene.fixtureVersion
        }
    }

    public var durationMs: Double {
        switch self {
        case let .v1(scene):
            return scene.durationMs
        case let .v2(scene):
            return scene.durationMs
        }
    }

    public var coordinateSpace: LiquidSize {
        switch self {
        case let .v1(scene):
            return scene.coordinateSpace
        case let .v2(scene):
            return scene.coordinateSpace
        }
    }
}

extension AnyLiquidScene: Codable {
    private enum CodingKeys: String, CodingKey {
        case schemaVersion
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .schemaVersion)
        switch version {
        case 1:
            self = .v1(try LiquidScene(from: decoder))
        case 2:
            self = .v2(try LiquidSceneV2(from: decoder))
        default:
            throw LiquidValidationError.invalidScene("schemaVersion must be 1 or 2")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .v1(scene):
            try scene.encode(to: encoder)
        case let .v2(scene):
            try scene.encode(to: encoder)
        }
    }
}

public struct LiquidActiveSemanticEvent: Codable, Equatable, Sendable {
    public var id: String
    public var kind: LiquidSemanticEventKind
    public var trackId: String
    public var at: Double
    public var end: Double?
    public var componentId: String?
    public var payload: LiquidMaterialValues?

    public init(id: String, kind: LiquidSemanticEventKind, trackId: String, at: Double, end: Double? = nil, componentId: String? = nil, payload: LiquidMaterialValues? = nil) {
        self.id = id
        self.kind = kind
        self.trackId = trackId
        self.at = at
        self.end = end
        self.componentId = componentId
        self.payload = payload
    }
}

public struct LiquidComponentFrame: Equatable, Sendable {
    public var id: String
    public var kind: LiquidComponentKind
    public var operation: LiquidCompositionOperation
    public var groupId: String?
    public var primitive: LiquidPrimitive
    public var material: LiquidMaterialValues

    public init(id: String, kind: LiquidComponentKind, operation: LiquidCompositionOperation, groupId: String? = nil, primitive: LiquidPrimitive, material: LiquidMaterialValues = [:]) {
        self.id = id
        self.kind = kind
        self.operation = operation
        self.groupId = groupId
        self.primitive = primitive
        self.material = material
    }
}

public struct LiquidTrackFrameMaterial: Equatable, Sendable {
    public var components: [String: LiquidMaterialValues]
    public var groups: [String: LiquidMaterialValues]

    public init(components: [String: LiquidMaterialValues] = [:], groups: [String: LiquidMaterialValues] = [:]) {
        self.components = components
        self.groups = groups
    }
}

public struct LiquidTrackFrame: Equatable, Sendable {
    public var id: String
    public var progress: Double
    public var localProgress: Double
    public var renderMode: LiquidRenderMode
    public var sourceOpacity: Double
    public var targetOpacity: Double
    public var source: LiquidEndpoint
    public var target: LiquidEndpoint
    public var endpointCommands: [LiquidPathCommand]?
    public var components: [LiquidComponentFrame]
    public var material: LiquidTrackFrameMaterial

    public init(
        id: String,
        progress: Double,
        localProgress: Double,
        renderMode: LiquidRenderMode,
        sourceOpacity: Double,
        targetOpacity: Double,
        source: LiquidEndpoint,
        target: LiquidEndpoint,
        endpointCommands: [LiquidPathCommand]?,
        components: [LiquidComponentFrame],
        material: LiquidTrackFrameMaterial
    ) {
        self.id = id
        self.progress = progress
        self.localProgress = localProgress
        self.renderMode = renderMode
        self.sourceOpacity = sourceOpacity
        self.targetOpacity = targetOpacity
        self.source = source
        self.target = target
        self.endpointCommands = endpointCommands
        self.components = components
        self.material = material
    }
}

public struct LiquidFrameV2: Equatable, Sendable {
    public var label: String
    public var progress: Double
    public var events: [LiquidActiveSemanticEvent]
    public var tracks: [LiquidTrackFrame]

    public init(label: String = "", progress: Double, events: [LiquidActiveSemanticEvent], tracks: [LiquidTrackFrame]) {
        self.label = label
        self.progress = progress
        self.events = events
        self.tracks = tracks
    }
}

public enum AnyLiquidFrame: Equatable, Sendable {
    case v1(LiquidFrame)
    case v2(LiquidFrameV2)
}

public struct LiquidFrameSampleV2: Equatable, Sendable {
    public var label: String
    public var frame: LiquidFrameV2

    public init(label: String, frame: LiquidFrameV2) {
        self.label = label
        self.frame = frame
    }
}

public struct LiquidFrameOutputV2: Equatable, Sendable {
    public var schemaVersion: Int
    public var sceneId: String
    public var fixtureVersion: Int
    public var samples: [LiquidFrameSampleV2]

    public init(schemaVersion: Int, sceneId: String, fixtureVersion: Int, samples: [LiquidFrameSampleV2]) {
        self.schemaVersion = schemaVersion
        self.sceneId = sceneId
        self.fixtureVersion = fixtureVersion
        self.samples = samples
    }
}

public enum AnyLiquidFrameOutput: Equatable, Sendable {
    case v1(LiquidFrameOutput)
    case v2(LiquidFrameOutputV2)
}

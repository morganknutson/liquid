import Foundation

extension LiquidLoader {
    public static func loadSceneV2(from data: Data) throws -> LiquidSceneV2 {
        let scene = try JSONDecoder().decode(LiquidSceneV2.self, from: data)
        try LiquidValidator.validate(scene)
        return scene
    }

    public static func loadSceneV2(from url: URL) throws -> LiquidSceneV2 {
        try loadSceneV2(from: Data(contentsOf: url))
    }

    public static func loadAnyScene(from data: Data) throws -> AnyLiquidScene {
        let scene = try JSONDecoder().decode(AnyLiquidScene.self, from: data)
        try LiquidValidator.validate(scene)
        return scene
    }

    public static func loadAnyScene(from url: URL) throws -> AnyLiquidScene {
        try loadAnyScene(from: Data(contentsOf: url))
    }
}

extension LiquidValidator {
    public static func validate(_ scene: AnyLiquidScene) throws {
        switch scene {
        case let .v1(scene):
            try validate(scene)
        case let .v2(scene):
            try validate(scene)
        }
    }

    public static func validate(_ scene: LiquidSceneV2) throws {
        guard scene.schemaVersion == 2 else { throw LiquidValidationError.invalidScene("schemaVersion must be 2") }
        guard !scene.id.isEmpty else { throw LiquidValidationError.invalidScene("id must not be empty") }
        guard scene.fixtureVersion >= 1 else { throw LiquidValidationError.invalidScene("fixtureVersion must be >= 1") }
        guard scene.durationMs.isFinite && scene.durationMs > 0 else { throw LiquidValidationError.invalidScene("durationMs must be positive and finite") }
        guard scene.coordinateSpace.width.isFinite, scene.coordinateSpace.width > 0,
              scene.coordinateSpace.height.isFinite, scene.coordinateSpace.height > 0 else {
            throw LiquidValidationError.invalidScene("coordinateSpace must be positive and finite")
        }
        guard scene.tracks.isEmpty == false else { throw LiquidValidationError.invalidScene("scene.tracks must not be empty") }
        try validateReducedMotionV2(scene.reducedMotion)
        for (index, shape) in (scene.backdrop ?? []).enumerated() {
            try validateEndpointV2(shape, path: "scene.backdrop[\(index)]")
        }
        if let clip = scene.clip {
            try validateEndpointV2(clip, path: "scene.clip")
        }
        if let loop = scene.loop {
            guard loop.start.isFinite, loop.start >= 0, loop.start < 1 else {
                throw LiquidValidationError.invalidScene("scene.loop.start must satisfy 0 <= start < 1")
            }
        }

        var trackIds = Set<String>()
        for (trackIndex, track) in scene.tracks.enumerated() {
            let trackPath = "scene.tracks[\(trackIndex)]"
            guard !track.id.isEmpty else { throw LiquidValidationError.invalidScene("\(trackPath).id must not be empty") }
            guard trackIds.insert(track.id).inserted else { throw LiquidValidationError.invalidScene("\(trackPath).id must be unique") }
            try validateEndpointV2(track.source, path: "\(trackPath).source")
            try validateEndpointV2(track.target, path: "\(trackPath).target")
            guard track.timing.start.isFinite, track.timing.end.isFinite,
                  track.timing.start >= 0, track.timing.start <= 1,
                  track.timing.end >= 0, track.timing.end <= 1,
                  track.timing.start < track.timing.end else {
                throw LiquidValidationError.invalidScene("\(trackPath).timing must satisfy 0 <= start < end <= 1")
            }
            guard track.components.isEmpty == false else { throw LiquidValidationError.invalidScene("\(trackPath).components must not be empty") }
            guard track.keyframes.count >= 2 else { throw LiquidValidationError.invalidScene("\(trackPath).keyframes must contain at least two keyframes") }

            var definitions: [String: LiquidComponentDefinition] = [:]
            for (index, definition) in track.components.enumerated() {
                guard !definition.id.isEmpty else { throw LiquidValidationError.invalidScene("\(trackPath).components[\(index)].id must not be empty") }
                guard definitions[definition.id] == nil else { throw LiquidValidationError.invalidScene("\(trackPath).components[\(index)].id must be unique") }
                definitions[definition.id] = definition
            }

            var previousAt = -Double.infinity
            for (keyframeIndex, keyframe) in track.keyframes.enumerated() {
                let keyframePath = "\(trackPath).keyframes[\(keyframeIndex)]"
                guard keyframe.at.isFinite, keyframe.at >= 0, keyframe.at <= 1, keyframe.at > previousAt else {
                    throw LiquidValidationError.invalidScene("\(trackPath).keyframes must be strictly ordered in 0...1")
                }
                guard keyframe.components.count == definitions.count else {
                    throw LiquidValidationError.invalidScene("\(keyframePath).components must match stable component definitions")
                }
                var seenStates = Set<String>()
                for (stateIndex, state) in keyframe.components.enumerated() {
                    guard !state.id.isEmpty else { throw LiquidValidationError.invalidScene("\(keyframePath).components[\(stateIndex)].id must not be empty") }
                    guard seenStates.insert(state.id).inserted else { throw LiquidValidationError.invalidScene("\(keyframePath).components[\(stateIndex)].id must be unique") }
                    guard let definition = definitions[state.id] else {
                        throw LiquidValidationError.invalidScene("\(keyframePath).components[\(stateIndex)].id must match a component definition")
                    }
                    guard state.primitive.kind == definition.kind else {
                        throw LiquidValidationError.invalidScene("\(keyframePath).components[\(stateIndex)].primitive.kind must match stable component definition")
                    }
                    try validatePrimitiveV2(state.primitive, path: "\(keyframePath).components[\(stateIndex)].primitive")
                }
                for id in definitions.keys where seenStates.contains(id) == false {
                    throw LiquidValidationError.invalidScene("\(keyframePath).components must include stable component \(id)")
                }
                try validateMaterialV2(keyframe.material, path: "\(keyframePath).material")
                previousAt = keyframe.at
            }
            guard track.keyframes.first?.at == 0, track.keyframes.last?.at == 1 else {
                throw LiquidValidationError.invalidScene("\(trackPath).keyframes must start at 0 and end at 1")
            }

            if let events = track.events {
                var eventIds = Set<String>()
                for (eventIndex, event) in events.enumerated() {
                    let eventPath = "\(trackPath).events[\(eventIndex)]"
                    guard !event.id.isEmpty else { throw LiquidValidationError.invalidScene("\(eventPath).id must not be empty") }
                    guard eventIds.insert(event.id).inserted else { throw LiquidValidationError.invalidScene("\(eventPath).id must be unique") }
                    guard event.at.isFinite, event.at >= 0, event.at <= 1 else {
                        throw LiquidValidationError.invalidScene("\(eventPath).at must be in 0...1")
                    }
                    switch event.kind {
                    case .release:
                        guard let end = event.end, end.isFinite, end > event.at, end <= 1 else {
                            throw LiquidValidationError.invalidScene("\(eventPath).end must be greater than at and <= 1")
                        }
                    case .step:
                        guard event.end == nil else {
                            throw LiquidValidationError.invalidScene("\(eventPath).end is only valid for release events")
                        }
                    }
                    if let componentId = event.componentId, definitions[componentId] == nil {
                        throw LiquidValidationError.invalidScene("\(eventPath).componentId must match a component definition")
                    }
                    try validateMaterialValuesV2(event.payload ?? [:], path: "\(eventPath).payload")
                }
            }
        }
    }

    private static func validateEndpointV2(_ endpoint: LiquidEndpoint, path: String) throws {
        guard !endpoint.assetId.isEmpty, !endpoint.shapeId.isEmpty else {
            throw LiquidValidationError.invalidScene("\(path) assetId and shapeId must not be empty")
        }
        try validatePathCommandsV2(endpoint.commands, endpoint: "\(path).commands")
        for value in [
            endpoint.transform.translateX,
            endpoint.transform.translateY,
            endpoint.transform.scaleX,
            endpoint.transform.scaleY
        ] where value.isFinite == false {
            throw LiquidValidationError.invalidScene("\(path).transform must be finite")
        }
    }

    private static func validatePathCommandsV2(_ commands: [LiquidPathCommand], endpoint: String) throws {
        guard commands.count >= 2 else { throw LiquidValidationError.invalidScene("\(endpoint) must contain at least two commands") }
        var hasOpenContour = false
        for (index, command) in commands.enumerated() {
            switch command {
            case .move:
                guard hasOpenContour == false else {
                    throw LiquidValidationError.invalidScene("\(endpoint)[\(index)] must follow Z before starting another contour")
                }
                hasOpenContour = true
            case .line, .cubic:
                guard hasOpenContour else {
                    throw LiquidValidationError.invalidScene("\(endpoint)[\(index)] must follow M")
                }
            case .close:
                guard hasOpenContour else {
                    throw LiquidValidationError.invalidScene("\(endpoint)[\(index)] must follow M")
                }
                hasOpenContour = false
            }
            for value in command.values ?? [] where value.isFinite == false {
                throw LiquidValidationError.invalidScene("\(endpoint)[\(index)] values must be finite")
            }
        }
        guard hasOpenContour == false else {
            throw LiquidValidationError.invalidScene("\(endpoint) must close every contour with Z")
        }
    }

    private static func validatePrimitiveV2(_ primitive: LiquidPrimitive, path: String) throws {
        switch primitive {
        case let .capsule(capsule):
            guard capsule.start.x.isFinite, capsule.start.y.isFinite,
                  capsule.end.x.isFinite, capsule.end.y.isFinite,
                  capsule.radius.isFinite, capsule.radius >= 0 else {
                throw LiquidValidationError.invalidScene("\(path) capsule values must be finite and non-negative")
            }
        case let .ribbon(ribbon):
            for point in [ribbon.p0, ribbon.p1, ribbon.p2, ribbon.p3] {
                guard point.x.isFinite, point.y.isFinite else { throw LiquidValidationError.invalidScene("\(path) ribbon points must be finite") }
            }
            guard ribbon.startRadius.isFinite, ribbon.endRadius.isFinite, ribbon.startRadius >= 0, ribbon.endRadius >= 0 else {
                throw LiquidValidationError.invalidScene("\(path) ribbon radii must be finite and non-negative")
            }
        case let .ellipse(ellipse):
            guard ellipse.center.x.isFinite, ellipse.center.y.isFinite,
                  ellipse.radiusX.isFinite, ellipse.radiusY.isFinite,
                  ellipse.radiusX >= 0, ellipse.radiusY >= 0,
                  (ellipse.rotation?.isFinite ?? true) else {
                throw LiquidValidationError.invalidScene("\(path) ellipse values must be finite and non-negative")
            }
        }
    }

    private static func validateReducedMotionV2(_ reducedMotion: LiquidReducedMotion) throws {
        guard reducedMotion.mode == "crossfade" else { throw LiquidValidationError.invalidScene("scene.reducedMotion.mode must be crossfade") }
        guard reducedMotion.durationMs.isFinite, reducedMotion.durationMs > 0 else {
            throw LiquidValidationError.invalidScene("scene.reducedMotion.durationMs must be > 0")
        }
        guard reducedMotion.fadeStart.isFinite, reducedMotion.fadeEnd.isFinite,
              reducedMotion.fadeStart >= 0, reducedMotion.fadeStart <= 1,
              reducedMotion.fadeEnd >= 0, reducedMotion.fadeEnd <= 1,
              reducedMotion.fadeStart < reducedMotion.fadeEnd else {
            throw LiquidValidationError.invalidScene("scene.reducedMotion fadeStart must be less than fadeEnd and within 0...1")
        }
    }

    private static func validateMaterialV2(_ material: LiquidKeyframeMaterial?, path: String) throws {
        guard let material else { return }
        for (id, values) in material.components ?? [:] {
            try validateMaterialValuesV2(values, path: "\(path).components.\(id)")
        }
        for (id, values) in material.groups ?? [:] {
            try validateMaterialValuesV2(values, path: "\(path).groups.\(id)")
        }
    }

    private static func validateMaterialValuesV2(_ values: LiquidMaterialValues, path: String) throws {
        for (key, scalar) in values {
            if case let .number(value) = scalar, value.isFinite == false {
                throw LiquidValidationError.invalidScene("\(path).\(key) must be finite")
            }
        }
    }
}

extension LiquidEvaluator {
    public func evaluateChecked(scene: LiquidSceneV2, progress rawProgress: Double, reducedMotion: Bool = false) throws -> LiquidFrameV2 {
        try LiquidValidator.validate(scene)
        return evaluateValidated(scene: scene, progress: rawProgress, reducedMotion: reducedMotion)
    }

    @available(*, deprecated, message: "Use evaluateChecked(scene:progress:reducedMotion:) and handle validation errors explicitly.")
    public func evaluate(scene: LiquidSceneV2, progress rawProgress: Double, reducedMotion: Bool = false) -> LiquidFrameV2? {
        try? evaluateChecked(scene: scene, progress: rawProgress, reducedMotion: reducedMotion)
    }

    public func evaluateChecked(scene: AnyLiquidScene, progress: Double, reducedMotion: Bool = false) throws -> AnyLiquidFrame {
        switch scene {
        case let .v1(scene):
            return .v1(evaluate(scene: scene, progress: progress, reducedMotion: reducedMotion))
        case let .v2(scene):
            return .v2(try evaluateChecked(scene: scene, progress: progress, reducedMotion: reducedMotion))
        }
    }

    @available(*, deprecated, message: "Use evaluateChecked(scene:progress:reducedMotion:) and handle validation errors explicitly.")
    public func evaluate(scene: AnyLiquidScene, progress: Double, reducedMotion: Bool = false) -> AnyLiquidFrame? {
        try? evaluateChecked(scene: scene, progress: progress, reducedMotion: reducedMotion)
    }

    private func evaluateValidated(scene: LiquidSceneV2, progress rawProgress: Double, reducedMotion: Bool = false) -> LiquidFrameV2 {
        let progress = LiquidMath.clamp01(rawProgress)
        let tracks = scene.tracks.map { evaluateTrack(scene: scene, track: $0, progress: progress, reducedMotion: reducedMotion) }
        return LiquidFrameV2(
            progress: progress,
            events: scene.tracks.flatMap { activeEvents(track: $0, progress: progress) },
            tracks: tracks
        )
    }

    public func makeOutput(scene: LiquidSceneV2, manifest: LiquidSampleManifest, reducedMotion: Bool = false) throws -> LiquidFrameOutputV2 {
        try LiquidValidator.validate(scene)
        try LiquidValidator.validate(manifest, sceneId: scene.id)
        let samples = manifest.samples.map { request in
            let frame = evaluateValidated(scene: scene, progress: request.progress, reducedMotion: reducedMotion)
            return LiquidFrameSampleV2(label: request.label, frame: LiquidFrameV2(label: request.label, progress: frame.progress, events: frame.events, tracks: frame.tracks))
        }
        return LiquidFrameOutputV2(schemaVersion: 2, sceneId: scene.id, fixtureVersion: scene.fixtureVersion, samples: samples)
    }

    public func makeOutput(scene: AnyLiquidScene, manifest: LiquidSampleManifest, reducedMotion: Bool = false) throws -> AnyLiquidFrameOutput {
        switch scene {
        case let .v1(scene):
            return .v1(try makeOutput(scene: scene, manifest: manifest, reducedMotion: reducedMotion))
        case let .v2(scene):
            return .v2(try makeOutput(scene: scene, manifest: manifest, reducedMotion: reducedMotion))
        }
    }

    private func evaluateTrack(scene: LiquidSceneV2, track: LiquidTrack, progress: Double, reducedMotion: Bool) -> LiquidTrackFrame {
        let localProgress = trackLocalProgress(track: track, progress: progress)
        let sampledProgress = reducedMotion ? 0 : localProgress
        let primitiveFor: (String) -> LiquidPrimitive
        let componentMaterials: [String: LiquidMaterialValues]
        let groupMaterials: [String: LiquidMaterialValues]
        if track.interpolation == .monotoneCubic {
            let segment = LiquidSplineSegment(keyframes: track.keyframes, progress: sampledProgress)
            primitiveFor = { LiquidSpline.primitive(track.keyframes, componentId: $0, segment: segment) }
            componentMaterials = LiquidSpline.materialSection(track.keyframes, section: \.components, segment: segment)
            groupMaterials = LiquidSpline.materialSection(track.keyframes, section: \.groups, segment: segment)
        } else {
            let (previous, next, local) = keyframePair(track: track, progress: sampledProgress)
            let previousStates = Dictionary(uniqueKeysWithValues: previous.components.map { ($0.id, $0) })
            let nextStates = Dictionary(uniqueKeysWithValues: next.components.map { ($0.id, $0) })
            primitiveFor = { id in LiquidComponentState.interpolate(from: previousStates[id]!, to: nextStates[id]!, progress: local).primitive }
            componentMaterials = materialRecord(previous.material?.components, next.material?.components, progress: local)
            groupMaterials = materialRecord(previous.material?.groups, next.material?.groups, progress: local)
        }
        let opacity = reducedMotion
            ? reducedMotionOpacityV2(scene.reducedMotion, progress: progress)
            : (source: localProgress == 1 ? 0 : 1, target: localProgress == 0 ? 0 : (localProgress == 1 ? 1 : 0))
        let renderMode: LiquidRenderMode = reducedMotion ? .crossfade : (localProgress == 0 ? .sourcePath : (localProgress == 1 ? .targetPath : .field))
        let endpointCommands: [LiquidPathCommand]? = reducedMotion ? nil : (localProgress == 0 ? track.source.commands : (localProgress == 1 ? track.target.commands : nil))
        let components = track.components.map { definition in
            LiquidComponentFrame(
                id: definition.id,
                kind: definition.kind,
                operation: definition.operation,
                groupId: definition.groupId,
                primitive: primitiveFor(definition.id),
                material: componentMaterials[definition.id] ?? [:]
            )
        }
        return LiquidTrackFrame(
            id: track.id,
            progress: progress,
            localProgress: localProgress,
            renderMode: renderMode,
            sourceOpacity: opacity.source,
            targetOpacity: opacity.target,
            source: track.source,
            target: track.target,
            endpointCommands: endpointCommands,
            components: components,
            material: LiquidTrackFrameMaterial(components: componentMaterials, groups: groupMaterials)
        )
    }

    private func keyframePair(track: LiquidTrack, progress: Double) -> (LiquidTrackKeyframe, LiquidTrackKeyframe, Double) {
        for index in 1..<track.keyframes.count {
            let previous = track.keyframes[index - 1]
            let next = track.keyframes[index]
            if progress <= next.at {
                let span = next.at - previous.at
                let local = span <= 0 ? 1 : (progress - previous.at) / span
                return (previous, next, next.easing.apply(local))
            }
        }
        let last = track.keyframes[track.keyframes.count - 1]
        return (last, last, 1)
    }

    private func trackLocalProgress(track: LiquidTrack, progress: Double) -> Double {
        LiquidMath.clamp01((progress - track.timing.start) / (track.timing.end - track.timing.start))
    }

    private func reducedMotionOpacityV2(_ reducedMotion: LiquidReducedMotion, progress: Double) -> (source: Double, target: Double) {
        let local = LiquidMath.clamp01((progress - reducedMotion.fadeStart) / (reducedMotion.fadeEnd - reducedMotion.fadeStart))
        return (1 - local, local)
    }

    private func activeEvents(track: LiquidTrack, progress: Double) -> [LiquidActiveSemanticEvent] {
        let eventEpsilon = 0.000000001
        let local = trackLocalProgress(track: track, progress: progress)
        return (track.events ?? []).compactMap { event in
            switch event.kind {
            case .step:
                guard local + eventEpsilon >= event.at else { return nil }
            case .release:
                guard local + eventEpsilon >= event.at, local < (event.end ?? event.at) - eventEpsilon else { return nil }
            }
            return LiquidActiveSemanticEvent(
                id: event.id,
                kind: event.kind,
                trackId: track.id,
                at: event.at,
                end: event.end,
                componentId: event.componentId,
                payload: event.payload
            )
        }
    }

    private func materialRecord(_ a: [String: LiquidMaterialValues]?, _ b: [String: LiquidMaterialValues]?, progress: Double) -> [String: LiquidMaterialValues] {
        let keys = Set((a ?? [:]).keys).union((b ?? [:]).keys).sorted()
        var output: [String: LiquidMaterialValues] = [:]
        for key in keys {
            output[key] = interpolateMaterial(a?[key] ?? [:], b?[key] ?? [:], progress: progress)
        }
        return output
    }

    private func interpolateMaterial(_ a: LiquidMaterialValues, _ b: LiquidMaterialValues, progress: Double) -> LiquidMaterialValues {
        let keys = Set(a.keys).union(b.keys).sorted()
        var output: LiquidMaterialValues = [:]
        for key in keys {
            output[key] = interpolateScalar(a[key], b[key], progress: progress)
        }
        return output
    }

    private func interpolateScalar(_ a: LiquidMaterialScalar?, _ b: LiquidMaterialScalar?, progress: Double) -> LiquidMaterialScalar {
        if case let .number(aValue) = a, case let .number(bValue) = b {
            return .number(lerp(aValue, bValue, progress))
        }
        if b == nil {
            return a ?? .number(0)
        }
        if a == nil {
            return b!
        }
        return progress < 1 ? a! : b!
    }
}

extension LiquidComponentState {
    public static func interpolate(from start: LiquidComponentState, to end: LiquidComponentState, progress: Double) -> LiquidComponentState {
        LiquidComponentState(id: start.id, primitive: LiquidPrimitive.interpolate(from: start.primitive, to: end.primitive, progress: progress))
    }
}

extension LiquidPrimitive {
    public static func interpolate(from start: LiquidPrimitive, to end: LiquidPrimitive, progress: Double) -> LiquidPrimitive {
        switch (start, end) {
        case let (.capsule(a), .capsule(b)):
            return .capsule(LiquidCapsule.interpolate(from: a, to: b, progress: progress))
        case let (.ribbon(a), .ribbon(b)):
            return .ribbon(LiquidRibbon(
                p0: LiquidPoint.interpolate(from: a.p0, to: b.p0, progress: progress),
                p1: LiquidPoint.interpolate(from: a.p1, to: b.p1, progress: progress),
                p2: LiquidPoint.interpolate(from: a.p2, to: b.p2, progress: progress),
                p3: LiquidPoint.interpolate(from: a.p3, to: b.p3, progress: progress),
                startRadius: lerp(a.startRadius, b.startRadius, progress),
                endRadius: lerp(a.endRadius, b.endRadius, progress)
            ))
        case let (.ellipse(a), .ellipse(b)):
            return .ellipse(LiquidEllipse(
                center: LiquidPoint.interpolate(from: a.center, to: b.center, progress: progress),
                radiusX: lerp(a.radiusX, b.radiusX, progress),
                radiusY: lerp(a.radiusY, b.radiusY, progress),
                rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, progress)
            ))
        default:
            return start
        }
    }
}

private func lerp(_ start: Double, _ end: Double, _ progress: Double) -> Double {
    start + (end - start) * progress
}

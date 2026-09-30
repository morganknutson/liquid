import Foundation
import Testing
@testable import LiquidCore

struct LiquidCoreTests {
    @Test func sceneLoadsAndValidates() throws {
        let scene = try loadScene()
        #expect(scene.id == "capsule-to-a")
        #expect(scene.poses.count == 10)
        #expect(scene.source.shapeId == "bar-left")
    }

    @Test func keyGoldenExpectationsMatch() throws {
        let scene = try loadScene()
        let expected = try loadExpected()
        let evaluator = LiquidEvaluator()

        for pose in expected.keyPoses {
            let frame = evaluator.evaluate(scene: scene, progress: pose.progress)
            #expect(frame.phase == pose.phase)
            #expect(frame.renderMode.rawValue == pose.renderMode)
            #expect(abs(frame.frame.bridge.radius - pose.bridgeRadius) <= expected.tolerance)
            #expect(abs(frame.frame.targetMix - pose.targetMix) <= expected.tolerance)
        }
    }

    @Test func endpointsReturnExactCanonicalCommands() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let source = evaluator.evaluate(scene: scene, progress: -1)
        let target = evaluator.evaluate(scene: scene, progress: 2)

        #expect(source.progress == 0)
        #expect(source.renderMode == .sourcePath)
        #expect(source.endpointCommands == scene.source.commands)
        #expect(target.progress == 1)
        #expect(target.renderMode == .targetPath)
        #expect(target.endpointCommands == scene.target.commands)
    }

    @Test func shuffledAndReverseSeekingIsDeterministic() throws {
        let scene = try loadScene()
        let manifest = try loadManifest(sceneId: scene.id)
        let evaluator = LiquidEvaluator()
        let forward = try evaluator.makeOutput(scene: scene, manifest: manifest)
        let reversedManifest = LiquidSampleManifest(schemaVersion: 1, sceneId: scene.id, samples: manifest.samples.reversed())
        let reversed = try evaluator.makeOutput(scene: scene, manifest: reversedManifest)
        let shuffledManifest = LiquidSampleManifest(schemaVersion: 1, sceneId: scene.id, samples: [manifest.samples[4], manifest.samples[0], manifest.samples[8], manifest.samples[5]])
        let shuffled = try evaluator.makeOutput(scene: scene, manifest: shuffledManifest)

        #expect(forward.samples.first?.frame == reversed.samples.last?.frame)
        #expect(shuffled.samples[0].frame == forward.samples[4].frame)
        #expect(shuffled.samples[1].frame == forward.samples[0].frame)
        #expect(shuffled.samples[3].frame == forward.samples[5].frame)
    }

    @Test func reducedMotionCrossfadesWithoutMorphing() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let sourcePose = scene.poses[0].frame
        let fadeStart = evaluator.evaluate(scene: scene, progress: scene.reducedMotion.fadeStart, reducedMotion: true)
        let fadeEnd = evaluator.evaluate(scene: scene, progress: scene.reducedMotion.fadeEnd, reducedMotion: true)
        let before = evaluator.evaluate(scene: scene, progress: 0.1, reducedMotion: true)
        let middle = evaluator.evaluate(scene: scene, progress: 0.5, reducedMotion: true)
        let after = evaluator.evaluate(scene: scene, progress: 0.9, reducedMotion: true)

        #expect(before.renderMode == .crossfade)
        #expect(fadeStart.sourceOpacity == 1)
        #expect(fadeStart.targetOpacity == 0)
        #expect(before.sourceOpacity == 1)
        #expect(before.targetOpacity == 0)
        #expect(middle.frame == sourcePose)
        #expect(abs(middle.sourceOpacity - 0.5) < 0.000001)
        #expect(abs(middle.targetOpacity - 0.5) < 0.000001)
        #expect(fadeEnd.sourceOpacity == 0)
        #expect(fadeEnd.targetOpacity == 1)
        #expect(after.sourceOpacity == 0)
        #expect(after.targetOpacity == 1)
    }

    @Test func reducedMotionFadeIntervalMustIncrease() throws {
        var scene = try loadScene()
        scene.reducedMotion.fadeStart = 0.5
        scene.reducedMotion.fadeEnd = 0.5

        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(scene)
        }
    }

    @Test func endpointPathCommandGrammarIsValidatedBeforeEvaluation() throws {
        var lineBeforeMove = try loadScene()
        lineBeforeMove.source.commands = [.line(0, 0)] + lineBeforeMove.source.commands
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(lineBeforeMove)
        }

        var lineAfterClose = try loadScene()
        lineAfterClose.target.commands = [.move(0, 0), .close, .line(1, 1)]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(lineAfterClose)
        }

        var unclosedContour = try loadScene()
        unclosedContour.target.commands = [.move(0, 0), .line(1, 1)]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(unclosedContour)
        }

        var moveBeforeClose = try loadScene()
        moveBeforeClose.target.commands = [.move(0, 0), .line(1, 1), .move(2, 2), .close]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(moveBeforeClose)
        }

        var multipleSubpaths = try loadScene()
        multipleSubpaths.target.commands = [
            .move(0, 0),
            .line(1, 0),
            .close,
            .move(2, 0),
            .line(3, 0),
            .close
        ]
        try LiquidValidator.validate(multipleSubpaths)

        #expect(throws: LiquidValidationError.self) {
            _ = try LiquidEvaluator().makeOutput(scene: lineAfterClose, manifest: loadManifest(sceneId: lineAfterClose.id))
        }
    }

    @Test func fieldMathMatchesCapsuleAndSmoothUnionDefinitions() {
        let capsule = LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 10, y: 0), radius: 2)
        #expect(abs(LiquidSDF.capsuleDistance(point: LiquidPoint(x: 5, y: 0), capsule: capsule) + 2) < 0.000001)
        #expect(abs(LiquidSDF.capsuleDistance(point: LiquidPoint(x: 5, y: 3), capsule: capsule) - 1) < 0.000001)
        #expect(abs(LiquidSDF.smoothUnion(1, 3, blendRadius: 0) - 1) < 0.000001)
        #expect(LiquidSDF.smoothUnion(1, 1.5, blendRadius: 2) < 1)
    }

    @Test func cornerSharpnessTightensSmoothUnionSoftness() {
        let empty = LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 0), radius: 0)
        let rounded = LiquidPoseFrame(
            anchor: LiquidPoint(x: 2, y: 0),
            leftLeg: LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 0, y: 10), radius: 2),
            rightLeg: LiquidCapsule(start: LiquidPoint(x: 4, y: 0), end: LiquidPoint(x: 4, y: 10), radius: 2),
            crossbar: empty,
            bridge: empty,
            blendRadius: 6,
            targetMix: 0,
            cornerSharpness: 0
        )
        var sharp = rounded
        sharp.cornerSharpness = 1

        let point = LiquidPoint(x: 2, y: 5)
        #expect(abs(LiquidSDF.proceduralDistance(point: point, frame: rounded) + 1) < 0.000000001)
        #expect(abs(LiquidSDF.proceduralDistance(point: point, frame: sharp)) < 0.000000001)
    }

    @Test func targetPathDistanceUsesFillRule() {
        let square: [LiquidPathCommand] = [
            .move(0, 0), .line(10, 0), .line(10, 10), .line(0, 10), .close
        ]
        #expect(LiquidSDF.targetPathDistance(point: LiquidPoint(x: 5, y: 5), commands: square, fillRule: .nonzero) < 0)
        #expect(LiquidSDF.targetPathDistance(point: LiquidPoint(x: 20, y: 5), commands: square, fillRule: .nonzero) > 0)
    }

    @Test func preparedPathDistanceMatchesConveniencePathDistance() {
        let commands: [LiquidPathCommand] = [
            .move(0, 0),
            .cubic(18, -6, 24, 18, 12, 24),
            .line(0, 18),
            .close,
            .move(4, 7),
            .line(8, 7),
            .line(8, 12),
            .line(4, 12),
            .close
        ]
        let prepared = LiquidPreparedPath(commands: commands, cubicSubdivisions: 12)
        let points = [
            LiquidPoint(x: 2, y: 2),
            LiquidPoint(x: 6, y: 9),
            LiquidPoint(x: 13, y: 12),
            LiquidPoint(x: 24, y: 24)
        ]

        for fillRule in [LiquidFillRule.nonzero, .evenodd] {
            for point in points {
                let convenience = LiquidSDF.targetPathDistance(point: point, commands: commands, fillRule: fillRule, cubicSubdivisions: 12)
                let preparedDistance = LiquidSDF.targetPathDistance(point: point, preparedPath: prepared, fillRule: fillRule)
                #expect(abs(convenience - preparedDistance) < 0.000000001)
            }
        }
    }

    @Test func canonicalOutputSerializesRoundedSamples() throws {
        let scene = try loadScene()
        let manifest = try loadManifest(sceneId: scene.id)
        let output = try LiquidEvaluator().makeOutput(scene: scene, manifest: manifest)
        let json = output.canonicalJSONString()
        #expect(json.contains("\"sceneId\": \"capsule-to-a\""))
        #expect(json.contains("\"label\": \"before-adhesion-release\""))
        #expect(json.contains("\"progress\": 0.719999"))
        #expect(!json.contains("-0"))
    }

    @Test func duplicateSampleLabelsAreRejected() throws {
        let manifest = LiquidSampleManifest(
            schemaVersion: 1,
            sceneId: "capsule-to-a",
            samples: [
                LiquidSampleRequest(label: "same", progress: 0),
                LiquidSampleRequest(label: "same", progress: 1)
            ]
        )
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(manifest, sceneId: "capsule-to-a")
        }
    }

    @Test func anySceneDecodesV1AndV2Safely() throws {
        let v1Data = try Data(contentsOf: rootURL().appendingPathComponent("shared/scenes/capsule-to-a.v1.json"))
        let v1 = try LiquidLoader.loadAnyScene(from: v1Data)
        #expect(v1.schemaVersion == 1)
        #expect(v1.id == "capsule-to-a")

        let v2Data = try JSONEncoder().encode(v2FixtureScene())
        let v2 = try LiquidLoader.loadAnyScene(from: v2Data)
        #expect(v2.schemaVersion == 2)
        #expect(v2.id == "generic-v2-test")
    }

    @Test func v2TracksUseLocalProgressExactEndpointsAndStableOutput() throws {
        let scene = v2FixtureScene()
        try LiquidValidator.validate(scene)
        let evaluator = LiquidEvaluator()
        let before = try evaluator.evaluateChecked(scene: scene, progress: 0.1)
        let middle = try evaluator.evaluateChecked(scene: scene, progress: 0.5)
        let after = try evaluator.evaluateChecked(scene: scene, progress: 0.9)

        let oBefore = try requireTrack(before, id: "letter-o")
        let oMiddle = try requireTrack(middle, id: "letter-o")
        let oAfter = try requireTrack(after, id: "letter-o")
        #expect(oBefore.localProgress == 0)
        #expect(oBefore.renderMode == .sourcePath)
        #expect(oBefore.endpointCommands == scene.tracks[0].source.commands)
        #expect(abs(oMiddle.localProgress - 0.5) < 0.000001)
        #expect(oMiddle.renderMode == .field)
        #expect(oMiddle.endpointCommands == nil)
        #expect(oAfter.localProgress == 1)
        #expect(oAfter.renderMode == .targetPath)
        #expect(oAfter.endpointCommands == scene.tracks[0].target.commands)

        guard case let .ellipse(outer) = oMiddle.components[0].primitive else {
            Issue.record("outer component should remain an ellipse")
            return
        }
        #expect(abs(outer.center.x - 30) < 0.000001)
        #expect(abs((oMiddle.material.components["outer"]?["opacity"]?.numberValue ?? 0) - 0.75) < 0.000001)

        let manifest = LiquidSampleManifest(schemaVersion: 1, sceneId: scene.id, samples: [LiquidSampleRequest(label: "mid", progress: 0.5)])
        let output = try evaluator.makeOutput(scene: scene, manifest: manifest)
        #expect(output.schemaVersion == 2)
        #expect(output.samples[0].frame == LiquidFrameV2(label: "mid", progress: middle.progress, events: middle.events, tracks: middle.tracks))
        #expect(try evaluator.evaluateChecked(scene: scene, progress: 0.5) == evaluator.evaluateChecked(scene: scene, progress: 0.5))
    }

    @Test func v2StepAndReleaseEventsUseTrackLocalWindows() throws {
        let scene = v2FixtureScene()
        let evaluator = LiquidEvaluator()
        #expect(try evaluator.evaluateChecked(scene: scene, progress: 0.34).events.map(\.id) == [])
        #expect(try evaluator.evaluateChecked(scene: scene, progress: 0.35).events.map(\.id) == ["release"])
        #expect(try evaluator.evaluateChecked(scene: scene, progress: 0.5).events.map(\.id) == ["snap", "release"])
        #expect(try evaluator.evaluateChecked(scene: scene, progress: 0.65).events.map(\.id) == ["snap"])
    }

    @Test func v2SDFSupportsSubtractCountersRibbonAndTrackRelaxation() throws {
        let frame = try LiquidEvaluator().evaluateChecked(scene: v2FixtureScene(), progress: 0.5)
        let oTrack = try requireTrack(frame, id: "letter-o")
        let ribbonTrack = try requireTrack(frame, id: "ribbon")

        #expect(LiquidSDF.trackFieldDistance(point: LiquidPoint(x: 30, y: 20), track: oTrack) > 0)
        #expect(LiquidSDF.trackFieldDistance(point: LiquidPoint(x: 24, y: 20), track: oTrack) < 0)
        #expect(LiquidSDF.trackFieldDistance(point: LiquidPoint(x: 15, y: 15), track: ribbonTrack) < 5)
        #expect(abs(LiquidSDF.targetMix(track: ribbonTrack) - 0.5) < 0.000001)
    }

    @Test func preparedRibbonUsesFixedSegmentsAndMatchesReferenceDistance() {
        let ribbon = LiquidRibbon(
            p0: LiquidPoint(x: 0, y: 10),
            p1: LiquidPoint(x: 8, y: -4),
            p2: LiquidPoint(x: 20, y: 24),
            p3: LiquidPoint(x: 32, y: 10),
            startRadius: 1.25,
            endRadius: 4.5
        )
        let prepared = LiquidSDF.prepareRibbon(ribbon)
        #expect(prepared.segments.count == 32)

        for point in [
            LiquidPoint(x: 3, y: 8),
            LiquidPoint(x: 12, y: 12),
            LiquidPoint(x: 18, y: 17),
            LiquidPoint(x: 34, y: 9)
        ] {
            let reference = referenceRibbonDistance(point: point, ribbon: ribbon)
            let preparedDistance = LiquidSDF.preparedRibbonDistance(point: point, ribbon: prepared)
            #expect(abs(reference - preparedDistance) < 0.000000001)
        }
    }

    @Test func preparedTrackFieldMatchesReferenceDistanceAndResolvedScalars() throws {
        let frame = try LiquidEvaluator().evaluateChecked(scene: v2FixtureScene(), progress: 0.5)
        let oTrack = try requireTrack(frame, id: "letter-o")
        let ribbonTrack = try requireTrack(frame, id: "ribbon")
        let preparedO = LiquidSDF.prepareTrackField(track: oTrack)
        let preparedRibbon = LiquidSDF.prepareTrackField(track: ribbonTrack)

        #expect(preparedO.components.count == oTrack.components.count)
        #expect(preparedRibbon.components.count == ribbonTrack.components.count)
        #expect(abs(preparedRibbon.targetMix - 0.5) < 0.000001)
        #expect(preparedRibbon.components.allSatisfy { abs($0.blendRadius - 0.5) < 0.000001 })

        for track in [oTrack, ribbonTrack] {
            let prepared = LiquidSDF.prepareTrackField(track: track)
            for point in [
                LiquidPoint(x: 15, y: 15),
                LiquidPoint(x: 24, y: 20),
                LiquidPoint(x: 30, y: 20),
                LiquidPoint(x: 42, y: 28)
            ] {
                let reference = referenceTrackFieldDistance(point: point, track: track)
                let preparedDistance = LiquidSDF.preparedTrackFieldDistance(point: point, track: prepared)
                #expect(abs(reference - preparedDistance) < 0.000000001)
            }
        }
    }

    @Test func v2ReducedMotionCrossfadesStaticSourceComponents() throws {
        let scene = v2FixtureScene()
        let evaluator = LiquidEvaluator()
        let start = try requireTrack(evaluator.evaluateChecked(scene: scene, progress: 0.25, reducedMotion: true), id: "letter-o")
        let middle = try requireTrack(evaluator.evaluateChecked(scene: scene, progress: 0.5, reducedMotion: true), id: "letter-o")
        let end = try requireTrack(evaluator.evaluateChecked(scene: scene, progress: 0.75, reducedMotion: true), id: "letter-o")
        let source = try requireTrack(evaluator.evaluateChecked(scene: scene, progress: 0), id: "letter-o")

        #expect(start.renderMode == .crossfade)
        #expect(start.sourceOpacity == 1)
        #expect(abs(middle.sourceOpacity - 0.5) < 0.000001)
        #expect(end.targetOpacity == 1)
        #expect(middle.endpointCommands == nil)
        #expect(middle.components[0].primitive == source.components[0].primitive)
    }

    @Test func v2ValidationRejectsUnstableComponentsAndInvalidEvents() throws {
        var unstableKind = v2FixtureScene()
        unstableKind.tracks[0].keyframes[1].components[1] = LiquidComponentState(
            id: "counter",
            primitive: .capsule(LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 1, y: 1), radius: 1))
        )
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(unstableKind)
        }

        var missingComponent = v2FixtureScene()
        missingComponent.tracks[0].keyframes[0].components.removeLast()
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(missingComponent)
        }

        var invalidRelease = v2FixtureScene()
        invalidRelease.tracks[0].events = [LiquidSemanticEvent(id: "bad", kind: .release, at: 0.8, end: 0.7)]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(invalidRelease)
        }

        var missingReleaseEnd = v2FixtureScene()
        missingReleaseEnd.tracks[0].events = [LiquidSemanticEvent(id: "bad", kind: .release, at: 0.8, componentId: "counter")]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(missingReleaseEnd)
        }

        var stepWithEnd = v2FixtureScene()
        stepWithEnd.tracks[0].events = [LiquidSemanticEvent(id: "bad", kind: .step, at: 0.8, end: 0.9, componentId: "outer")]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(stepWithEnd)
        }

        var missingEventComponent = v2FixtureScene()
        missingEventComponent.tracks[0].events = [LiquidSemanticEvent(id: "bad", kind: .step, at: 0.8, componentId: "missing")]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(missingEventComponent)
        }

        var invalidPayload = v2FixtureScene()
        invalidPayload.tracks[0].events = [LiquidSemanticEvent(id: "bad", kind: .step, at: 0.8, componentId: "outer", payload: ["threshold": .number(.nan)])]
        #expect(throws: LiquidValidationError.self) {
            try LiquidValidator.validate(invalidPayload)
        }
    }

    @Test func v2DirectEvaluationRequiresValidScene() throws {
        var malformed = v2FixtureScene()
        malformed.tracks[0].keyframes[0].components.removeLast()

        #expect(throws: LiquidValidationError.self) {
            try LiquidEvaluator().evaluateChecked(scene: malformed, progress: 0.5)
        }
        #expect(LiquidEvaluator().evaluate(scene: malformed, progress: 0.5) == nil)
    }

    @Test func v2CanonicalOutputSerializesSchemaTwoSamples() throws {
        let scene = v2FixtureScene()
        let manifest = LiquidSampleManifest(schemaVersion: 1, sceneId: scene.id, samples: [LiquidSampleRequest(label: "mid", progress: 0.5)])
        let output = try LiquidEvaluator().makeOutput(scene: AnyLiquidScene.v2(scene), manifest: manifest)
        let json = output.canonicalJSONString()
        #expect(json.contains("\"schemaVersion\": 2"))
        #expect(json.contains("\"sceneId\": \"generic-v2-test\""))
        #expect(json.contains("\"tracks\""))
        #expect(json.contains("\"kind\": \"ribbon\""))
    }

    @Test func fullAddySceneHasFourExactEndpointTracks() throws {
        let scene = try loadFullAddyScene()
        let manifest = try loadFullAddyManifest(sceneId: scene.id)
        try LiquidValidator.validate(scene)
        try LiquidValidator.validate(manifest, sceneId: scene.id)
        #expect(scene.id == "spinner-to-addy")
        #expect(scene.coordinateSpace == LiquidSize(width: 2973, height: 1568))
        #expect(scene.backdrop?.map(\.shapeId) == ["pill"])
        #expect(scene.tracks.count == 4)
        #expect(scene.tracks.map(\.source.shapeId) == ["tick-1", "tick-2", "tick-3", "tick-4"])
        #expect(scene.tracks.map(\.target.shapeId) == ["letter-a", "letter-d1", "letter-d2", "letter-y"])

        let evaluator = LiquidEvaluator()
        let source = try evaluator.evaluateChecked(scene: scene, progress: 0)
        let target = try evaluator.evaluateChecked(scene: scene, progress: 1)
        #expect(source.tracks.map(\.renderMode) == [.sourcePath, .sourcePath, .sourcePath, .sourcePath])
        #expect(source.tracks.map(\.localProgress) == [0, 0, 0, 0])
        #expect(target.tracks.map(\.renderMode) == [.targetPath, .targetPath, .targetPath, .targetPath])
        #expect(target.tracks.map(\.localProgress) == [1, 1, 1, 1])

        for index in scene.tracks.indices {
            #expect(target.tracks[index].endpointCommands == scene.tracks[index].target.commands)
        }

        let output = try evaluator.makeOutput(scene: AnyLiquidScene.v2(scene), manifest: LiquidSampleManifest(schemaVersion: 1, sceneId: scene.id, samples: [LiquidSampleRequest(label: "target", progress: 1)]))
        guard case let .v2(v2Output) = output else {
            Issue.record("full Addy output should use schema v2")
            return
        }
        #expect(v2Output.sceneId == "spinner-to-addy")
        #expect(v2Output.samples[0].frame == LiquidFrameV2(label: "target", progress: target.progress, events: target.events, tracks: target.tracks))
        #expect(scene.tracks.allSatisfy { $0.interpolation == .monotoneCubic })
    }

    @Test func distanceRasterMatchesExactDistanceEverywhereIncludingOffRasterPaths() {
        let ring: [LiquidPathCommand] = [
            .move(0, 0), .line(10, 0), .line(10, 10), .line(0, 10), .close,
            .move(3, 3), .line(3, 7), .line(7, 7), .cubic(7, 5, 7, 4, 7, 3), .close,
        ]
        let shifted = ring.map { $0.transformed(by: LiquidTransform(translateX: 0, translateY: -30, scaleX: 1, scaleY: 1)) }
        let (width, height, scale, offsetX, offsetY) = (37, 29, 2.5, 3.2, 1.7)
        for commands in [ring, shifted] {
            let path = LiquidPreparedPath(commands: commands)
            for fillRule in [LiquidFillRule.nonzero, .evenodd] {
                let raster = LiquidSDF.signedDistanceRaster(preparedPath: path, fillRule: fillRule, width: width, height: height, scale: scale, offsetX: offsetX, offsetY: offsetY)
                for y in 0..<height {
                    for x in 0..<width {
                        let point = LiquidPoint(x: (Double(x) + 0.5 - offsetX) / scale, y: (Double(y) + 0.5 - offsetY) / scale)
                        let exact = LiquidSDF.targetPathDistance(point: point, preparedPath: path, fillRule: fillRule)
                        let value = raster[y * width + x]
                        #expect((value < 0) == (exact < 0))
                        #expect(abs(value - exact) * scale < 0.05)
                    }
                }
            }
        }
    }

    @Test func monotoneCubicTracksPassThroughKeyframesWithoutOvershoot() throws {
        let square: [LiquidPathCommand] = [.move(0, 0), .line(10, 0), .line(10, 10), .line(0, 10), .close]
        let identity = LiquidTransform(translateX: 0, translateY: 0, scaleX: 1, scaleY: 1)
        let keyframe = { (at: Double, x: Double, radius: Double, blend: Double) in
            LiquidTrackKeyframe(
                at: at,
                easing: .smoothStep,
                components: [LiquidComponentState(id: "stroke", primitive: .capsule(LiquidCapsule(start: LiquidPoint(x: x, y: 10), end: LiquidPoint(x: x, y: 20), radius: radius)))],
                material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(blend)]])
            )
        }
        let scene = LiquidSceneV2(
            schemaVersion: 2,
            id: "spline",
            fixtureVersion: 1,
            durationMs: 1000,
            coordinateSpace: LiquidSize(width: 100, height: 100),
            fillRule: .nonzero,
            tracks: [LiquidTrack(
                id: "stroke",
                source: LiquidEndpoint(assetId: "source", shapeId: "source", transform: identity, commands: square),
                target: LiquidEndpoint(assetId: "target", shapeId: "target", transform: identity, commands: square),
                timing: LiquidTrackTiming(start: 0, end: 1),
                interpolation: .monotoneCubic,
                components: [LiquidComponentDefinition(id: "stroke", kind: .capsule, operation: .union, groupId: "ink")],
                keyframes: [keyframe(0, 0, 4, 0), keyframe(0.3, 30, 8, 6), keyframe(0.7, 40, 8, 2), keyframe(1, 100, 12, 0)]
            )],
            reducedMotion: LiquidReducedMotion(mode: "crossfade", durationMs: 120, fadeStart: 0.25, fadeEnd: 0.75)
        )
        let evaluator = LiquidEvaluator()
        func sample(_ progress: Double) throws -> (x: Double, radius: Double, blend: Double) {
            let track = try evaluator.evaluateChecked(scene: scene, progress: progress).tracks[0]
            guard case let .capsule(capsule) = track.components[0].primitive, case let .number(blend) = track.material.groups["ink"]?["blendRadius"] else {
                throw LiquidValidationError.invalidScene("expected capsule and blend radius")
            }
            return (capsule.start.x, capsule.radius, blend)
        }

        let knot = try sample(0.3)
        #expect(abs(knot.x - 30) < 1e-9 && abs(knot.radius - 8) < 1e-9 && abs(knot.blend - 6) < 1e-9)
        let hold = try sample(0.5)
        #expect(abs(hold.radius - 8) < 1e-9)
        var previous = try sample(0).x
        for index in 1...100 {
            let x = try sample(Double(index) / 100).x
            #expect(x >= previous && x <= 100)
            previous = x
        }
        let middle = try sample(0.42)
        #expect(abs(middle.x - 33.4181) < 1e-4)
    }
}

private struct ExpectedGolden: Decodable {
    var schemaVersion: Int
    var sceneId: String
    var fixtureVersion: Int
    var tolerance: Double
    var keyPoses: [KeyPose]
}

private struct KeyPose: Decodable {
    var progress: Double
    var phase: String
    var renderMode: String
    var bridgeRadius: Double
    var targetMix: Double
}

private func rootURL() -> URL {
    URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
}

private func loadScene() throws -> LiquidScene {
    try LiquidLoader.loadScene(from: rootURL().appendingPathComponent("shared/scenes/capsule-to-a.v1.json"))
}

private func loadManifest(sceneId: String) throws -> LiquidSampleManifest {
    try LiquidLoader.loadSampleManifest(from: rootURL().appendingPathComponent("shared/golden/capsule-to-a.samples.json"), sceneId: sceneId)
}

private func loadFullAddyScene() throws -> LiquidSceneV2 {
    try LiquidLoader.loadSceneV2(from: rootURL().appendingPathComponent("shared/scenes/spinner-to-addy.v2.json"))
}

private func loadFullAddyManifest(sceneId: String) throws -> LiquidSampleManifest {
    try LiquidLoader.loadSampleManifest(from: rootURL().appendingPathComponent("shared/golden/spinner-to-addy.samples.json"), sceneId: sceneId)
}

private func loadExpected() throws -> ExpectedGolden {
    try JSONDecoder().decode(ExpectedGolden.self, from: Data(contentsOf: rootURL().appendingPathComponent("shared/golden/capsule-to-a.expected.json")))
}

private func requireTrack(_ frame: LiquidFrameV2, id: String) throws -> LiquidTrackFrame {
    guard let track = frame.tracks.first(where: { $0.id == id }) else {
        Issue.record("missing v2 track \(id)")
        throw LiquidValidationError.invalidScene("missing v2 track \(id)")
    }
    return track
}

private func referenceTrackFieldDistance(point: LiquidPoint, track: LiquidTrackFrame) -> Double {
    var distance = Double.infinity
    for component in track.components {
        let next = referencePrimitiveDistance(point: point, primitive: component.primitive)
        if distance.isInfinite {
            distance = component.operation == .subtract ? -next : next
            continue
        }
        if component.operation == .subtract {
            distance = max(distance, -next)
        } else {
            distance = LiquidSDF.smoothUnion(distance, next, blendRadius: referenceBlendRadius(component: component, track: track))
        }
    }
    return distance
}

private func referencePrimitiveDistance(point: LiquidPoint, primitive: LiquidPrimitive) -> Double {
    switch primitive {
    case let .capsule(capsule):
        return LiquidSDF.capsuleDistance(point: point, capsule: capsule)
    case let .ribbon(ribbon):
        return referenceRibbonDistance(point: point, ribbon: ribbon)
    case let .ellipse(ellipse):
        return LiquidSDF.ellipseDistance(point: point, ellipse: ellipse)
    }
}

private func referenceRibbonDistance(point: LiquidPoint, ribbon: LiquidRibbon, subdivisions: Int = LiquidSDF.ribbonSubdivisions) -> Double {
    var distance = Double.infinity
    var previous = ribbon.p0
    let steps = max(1, subdivisions)
    for step in 1...steps {
        let segmentStartT = Double(step - 1) / Double(steps)
        let segmentEndT = Double(step) / Double(steps)
        let next = referenceCubicPoint(start: ribbon.p0, c1: ribbon.p1, c2: ribbon.p2, end: ribbon.p3, t: segmentEndT)
        let segment = referenceSegmentDistance(point: point, a: previous, b: next)
        let curveT = segmentStartT + (segmentEndT - segmentStartT) * segment.t
        let radius = ribbon.startRadius + (ribbon.endRadius - ribbon.startRadius) * curveT
        distance = min(distance, segment.distance - radius)
        previous = next
    }
    return distance
}

private func referenceCubicPoint(start: LiquidPoint, c1: LiquidPoint, c2: LiquidPoint, end: LiquidPoint, t: Double) -> LiquidPoint {
    let mt = 1 - t
    let mt2 = mt * mt
    let t2 = t * t
    return LiquidPoint(
        x: mt2 * mt * start.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * end.x,
        y: mt2 * mt * start.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * end.y
    )
}

private func referenceSegmentDistance(point: LiquidPoint, a: LiquidPoint, b: LiquidPoint) -> (distance: Double, t: Double) {
    let vx = b.x - a.x
    let vy = b.y - a.y
    let wx = point.x - a.x
    let wy = point.y - a.y
    let length = vx * vx + vy * vy
    let t = length == 0 ? 0 : min(1, max(0, (wx * vx + wy * vy) / length))
    let x = a.x + vx * t
    let y = a.y + vy * t
    return (LiquidVector(x: point.x - x, y: point.y - y).length, t)
}

private func referenceBlendRadius(component: LiquidComponentFrame, track: LiquidTrackFrame) -> Double {
    let blendRadius = referenceMaterialNumber(component: component, track: track, key: "blendRadius")
    let cornerSharpness = referenceMaterialNumber(track: track, key: "cornerSharpness")
    return blendRadius * (1 - LiquidMath.clamp01(cornerSharpness))
}

private func referenceMaterialNumber(component: LiquidComponentFrame, track: LiquidTrackFrame, key: String) -> Double {
    if let value = component.material[key]?.numberValue {
        return value
    }
    if let groupId = component.groupId, let value = track.material.groups[groupId]?[key]?.numberValue {
        return value
    }
    return 0
}

private func referenceMaterialNumber(track: LiquidTrackFrame, key: String) -> Double {
    track.material.groups["$track"]?[key]?.numberValue ?? 0
}

private func v2FixtureScene() -> LiquidSceneV2 {
    let squarePath: [LiquidPathCommand] = [
        .move(0, 0),
        .line(10, 0),
        .line(10, 10),
        .line(0, 10),
        .close
    ]
    let identity = LiquidTransform(translateX: 0, translateY: 0, scaleX: 1, scaleY: 1)
    return LiquidSceneV2(
        schemaVersion: 2,
        id: "generic-v2-test",
        fixtureVersion: 1,
        durationMs: 1000,
        coordinateSpace: LiquidSize(width: 100, height: 100),
        fillRule: .nonzero,
        tracks: [
            LiquidTrack(
                id: "letter-o",
                source: LiquidEndpoint(assetId: "source", shapeId: "o-source", transform: identity, commands: squarePath),
                target: LiquidEndpoint(assetId: "target", shapeId: "o-target", transform: LiquidTransform(translateX: 1, translateY: 2, scaleX: 2, scaleY: 2), commands: squarePath),
                timing: LiquidTrackTiming(start: 0.2, end: 0.8),
                components: [
                    LiquidComponentDefinition(id: "outer", kind: .ellipse, operation: .union, groupId: "ink"),
                    LiquidComponentDefinition(id: "counter", kind: .ellipse, operation: .subtract, groupId: "cut")
                ],
                keyframes: [
                    LiquidTrackKeyframe(
                        at: 0,
                        easing: .linear,
                        components: [
                            LiquidComponentState(id: "outer", primitive: .ellipse(LiquidEllipse(center: LiquidPoint(x: 20, y: 20), radiusX: 10, radiusY: 12))),
                            LiquidComponentState(id: "counter", primitive: .ellipse(LiquidEllipse(center: LiquidPoint(x: 20, y: 20), radiusX: 3, radiusY: 4)))
                        ],
                        material: LiquidKeyframeMaterial(
                            components: ["outer": ["opacity": .number(0.5)], "counter": ["opacity": .number(1)]],
                            groups: ["ink": ["blendRadius": .number(0)]]
                        )
                    ),
                    LiquidTrackKeyframe(
                        at: 1,
                        easing: .smoothStep,
                        components: [
                            LiquidComponentState(id: "outer", primitive: .ellipse(LiquidEllipse(center: LiquidPoint(x: 40, y: 20), radiusX: 12, radiusY: 12))),
                            LiquidComponentState(id: "counter", primitive: .ellipse(LiquidEllipse(center: LiquidPoint(x: 40, y: 20), radiusX: 4, radiusY: 4)))
                        ],
                        material: LiquidKeyframeMaterial(
                            components: ["outer": ["opacity": .number(1)], "counter": ["opacity": .number(1)]],
                            groups: ["ink": ["blendRadius": .number(0)]]
                        )
                    )
                ],
                events: [
                    LiquidSemanticEvent(id: "snap", kind: .step, at: 0.5, componentId: "outer"),
                    LiquidSemanticEvent(id: "release", kind: .release, at: 0.25, end: 0.75, componentId: "counter")
                ]
            ),
            LiquidTrack(
                id: "ribbon",
                source: LiquidEndpoint(assetId: "source", shapeId: "ribbon-source", transform: identity, commands: squarePath),
                target: LiquidEndpoint(assetId: "target", shapeId: "ribbon-target", transform: identity, commands: squarePath),
                timing: LiquidTrackTiming(start: 0, end: 1),
                components: [
                    LiquidComponentDefinition(id: "stem", kind: .capsule, operation: .union, groupId: "ink"),
                    LiquidComponentDefinition(id: "curve", kind: .ribbon, operation: .union, groupId: "ink")
                ],
                keyframes: [
                    LiquidTrackKeyframe(
                        at: 0,
                        easing: .linear,
                        components: [
                            LiquidComponentState(id: "stem", primitive: .capsule(LiquidCapsule(start: LiquidPoint(x: 0, y: 0), end: LiquidPoint(x: 10, y: 0), radius: 2))),
                            LiquidComponentState(id: "curve", primitive: .ribbon(LiquidRibbon(p0: LiquidPoint(x: 0, y: 10), p1: LiquidPoint(x: 10, y: 0), p2: LiquidPoint(x: 20, y: 20), p3: LiquidPoint(x: 30, y: 10), startRadius: 1, endRadius: 3)))
                        ],
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)], "$track": ["targetMix": .number(0), "cornerSharpness": .number(0)]])
                    ),
                    LiquidTrackKeyframe(
                        at: 1,
                        easing: .linear,
                        components: [
                            LiquidComponentState(id: "stem", primitive: .capsule(LiquidCapsule(start: LiquidPoint(x: 0, y: 5), end: LiquidPoint(x: 10, y: 5), radius: 3))),
                            LiquidComponentState(id: "curve", primitive: .ribbon(LiquidRibbon(p0: LiquidPoint(x: 0, y: 20), p1: LiquidPoint(x: 10, y: 10), p2: LiquidPoint(x: 20, y: 30), p3: LiquidPoint(x: 30, y: 20), startRadius: 2, endRadius: 4)))
                        ],
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)], "$track": ["targetMix": .number(1), "cornerSharpness": .number(1)]])
                    )
                ]
            )
        ],
        reducedMotion: LiquidReducedMotion(mode: "crossfade", durationMs: 120, fadeStart: 0.25, fadeEnd: 0.75)
    )
}

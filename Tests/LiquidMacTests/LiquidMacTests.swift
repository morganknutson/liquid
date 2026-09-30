import CoreGraphics
import Foundation
import Testing
@testable import LiquidCore
@testable import LiquidMac

struct LiquidMacTests {
    @Test func backingSizeRespectsDisplayScaleAndCaps() {
        let uncapped = liquidBackingSize(
            logicalSize: CGSize(width: 120, height: 80),
            displayScale: 2,
            options: LiquidBackingScaleOptions(maxScale: 3, maxBackingDimension: nil)
        )
        #expect(uncapped.width == 240)
        #expect(uncapped.height == 160)
        #expect(uncapped.scale == 2)

        let cappedScale = liquidBackingSize(
            logicalSize: CGSize(width: 300, height: 150),
            displayScale: 3,
            options: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 384)
        )
        #expect(cappedScale.width == 384)
        #expect(cappedScale.height == 192)
        #expect(abs(cappedScale.scale - 1.28) < 0.0000001)

        let empty = liquidBackingSize(logicalSize: .zero, displayScale: 2)
        #expect(empty.width == 0)
        #expect(empty.height == 0)
    }

    @MainActor
    @Test func playerTimingIsDeterministicAndClampsAtEnd() throws {
        let scene = try loadScene()
        let player = LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(loop: false), now: 10)
        player.play(now: 10, startsClock: false)
        player.tick(now: 10 + player.durationSeconds * 0.5)
        #expect(abs(player.progress - 0.5) < 0.0000001)
        #expect(player.isPlaying)

        player.tick(now: 10 + player.durationSeconds * 2)
        #expect(player.progress == 1)
        #expect(!player.isPlaying)
        #expect(player.frame.renderMode == .targetPath)
    }

    @MainActor
    @Test func playerLoopingWrapsProgressDeterministically() throws {
        let scene = try loadScene()
        let player = LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(loop: true), now: 4)
        player.play(now: 4, startsClock: false)
        player.tick(now: 4 + player.durationSeconds * 1.25)
        #expect(abs(player.progress - 0.25) < 0.0000001)
        #expect(player.isPlaying)
    }

    @MainActor
    @Test func reducedMotionOverrideAndSystemPreferenceDriveEvaluatedFrame() throws {
        let scene = try loadScene()
        let player = LiquidPlayer(
            scene: scene,
            options: LiquidPlaybackOptions(reducedMotion: .system),
            systemPrefersReducedMotion: false
        )
        player.seek(progress: 0.5)
        #expect(player.frame.renderMode == .field)

        player.setSystemPrefersReducedMotion(true)
        #expect(player.usesReducedMotion)
        #expect(player.frame.renderMode == .crossfade)

        player.setReducedMotionOverride(.disabled)
        #expect(!player.usesReducedMotion)
        #expect(player.frame.renderMode == .field)
    }

    @MainActor
    @Test func playerRendersWithOwnedRendererAndStopsAfterDestroy() throws {
        let scene = try loadScene()
        let player = LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(loop: false), now: 2)
        player.seek(progress: 0.6, now: 2)
        let image = player.renderCGImage(
            logicalSize: CGSize(width: 160, height: 152),
            displayScale: 2,
            backingOptions: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 384)
        )
        #expect(image?.width == 320)
        #expect(image?.height == 304)

        player.play(now: 2, startsClock: false)
        player.destroy()
        player.tick(now: 100)
        #expect(player.isDestroyed)
        #expect(!player.isPlaying)
        #expect(player.renderCGImage(logicalSize: CGSize(width: 160, height: 152), displayScale: 2) == nil)
    }

    @Test func sceneResourceBuildsSharedSceneURLAndLoadsScene() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let url = LiquidSceneResource.sharedSceneURL(named: "capsule-to-a.v1.json", searchFrom: root)
        #expect(url.path.hasSuffix("shared/scenes/capsule-to-a.v1.json"))
        let scene = try LiquidSceneResource.loadSharedScene(named: "capsule-to-a.v1.json", searchFrom: root)
        #expect(scene.id == "capsule-to-a")
    }

    @Test func rendererProducesDeterministicAlphaMasks() throws {
        let scene = try loadScene()
        let frame = LiquidEvaluator().evaluate(scene: scene, progress: 0.6)
        let renderer = LiquidCGRenderer()
        let first = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let second = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        #expect(first == second)
    }

    @Test func alphaMaskContainsSilhouetteCoverage() throws {
        let scene = try loadScene()
        let frame = LiquidEvaluator().evaluate(scene: scene, progress: 0.75)
        let mask = LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 128, height: 128)
        let covered = mask.pixels.filter { $0 > 0 }.count
        let solid = mask.pixels.filter { $0 == 255 }.count
        #expect(covered > 100)
        #expect(solid > 50)
    }

    @Test func endpointCommandTransformIsExactForSourcePath() throws {
        let scene = try loadScene()
        let renderer = LiquidCGRenderer()
        let commands = renderer.transformedEndpointCommands(scene.source)
        guard case let .move(x, y) = commands[0] else {
            Issue.record("first command should be move")
            return
        }
        #expect(abs(x - (27.0996 + 52.3954)) < 0.0000001)
        #expect(abs(y - (22.8516 - 22.8516)) < 0.0000001)
    }

    @Test func cgPathIsAvailableForExactEndpointDrawing() throws {
        let scene = try loadScene()
        let renderer = LiquidCGRenderer()
        let path = renderer.makeCGPath(commands: scene.target.commands, applying: scene.target.transform)
        #expect(!path.isEmpty)
        #expect(path.boundingBox.width > 150)
        #expect(path.boundingBox.height > 150)
    }

    @Test func rendererCreatesImageForEndpointAndFieldFrames() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let sourceImage = renderer.renderCGImage(scene: scene, frame: evaluator.evaluate(scene: scene, progress: 0), options: LiquidRenderOptions(width: 160, height: 152))
        let fieldImage = renderer.renderCGImage(scene: scene, frame: evaluator.evaluate(scene: scene, progress: 0.6), options: LiquidRenderOptions(width: 160, height: 152))
        #expect(sourceImage != nil)
        #expect(fieldImage != nil)
    }

    @Test func debugOptionsChangeExactEndpointImageAndKeepFillVisible() throws {
        let scene = try loadScene()
        let frame = LiquidEvaluator().evaluate(scene: scene, progress: 0)
        let renderer = LiquidCGRenderer()
        let plainOptions = LiquidRenderOptions(width: 160, height: 152, fillRed: 0.24, fillGreen: 0.48, fillBlue: 0.72)
        let plain = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: frame, options: plainOptions)))

        for debugCase in debugOptionCases() {
            var options = plainOptions
            options.debug = debugCase.options
            let debug = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: frame, options: options)))
            #expect(debug != plain, "\(debugCase.label) should change exact endpoint image pixels")
            #expect(fillPixelCount(debug, red: options.fillRed, green: options.fillGreen, blue: options.fillBlue) > 50)
        }
    }

    @Test func disabledDebugOptionsMatchDefaultRenderingPixels() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let frames = [
            evaluator.evaluate(scene: scene, progress: 0),
            evaluator.evaluate(scene: scene, progress: 0.6),
            frame(from: evaluator.evaluate(scene: scene, progress: 0.5), mode: .crossfade, sourceOpacity: 0.45, targetOpacity: 0.55)
        ]
        let defaultOptions = LiquidRenderOptions(width: 160, height: 152)
        let disabledOptions = LiquidRenderOptions(width: 160, height: 152, debug: LiquidDebugOptions())

        for frame in frames {
            let defaultPixels = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: frame, options: defaultOptions)))
            let disabledPixels = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: frame, options: disabledOptions)))
            #expect(disabledPixels == defaultPixels)
        }
    }

    @Test func debugOptionsChangeFieldAndCrossfadeImagesWithoutChangingAlphaMasks() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let width = 160
        let height = 152
        let fieldFrame = evaluator.evaluate(scene: scene, progress: 0.6)
        let crossfadeBase = evaluator.evaluate(scene: scene, progress: 0.5)
        let crossfadeFrame = frame(from: crossfadeBase, mode: .crossfade, sourceOpacity: 0.45, targetOpacity: 0.55)
        let plainOptions = LiquidRenderOptions(width: width, height: height)
        let plainField = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: fieldFrame, options: plainOptions)))
        let plainCrossfade = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: crossfadeFrame, options: plainOptions)))
        let fieldMaskBefore = renderer.renderAlphaMask(scene: scene, frame: fieldFrame, width: width, height: height)
        let crossfadeMaskBefore = renderer.renderAlphaMask(scene: scene, frame: crossfadeFrame, width: width, height: height)

        for debugCase in debugOptionCases() {
            var options = plainOptions
            options.debug = debugCase.options
            let debugField = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: fieldFrame, options: options)))
            let debugCrossfade = try rgbaPixels(from: try requireImage(renderer.renderCGImage(scene: scene, frame: crossfadeFrame, options: options)))
            #expect(debugField != plainField, "\(debugCase.label) should change field image pixels")
            #expect(debugCrossfade != plainCrossfade, "\(debugCase.label) should change crossfade image pixels")
        }

        #expect(renderer.renderAlphaMask(scene: scene, frame: fieldFrame, width: width, height: height) == fieldMaskBefore)
        #expect(renderer.renderAlphaMask(scene: scene, frame: crossfadeFrame, width: width, height: height) == crossfadeMaskBefore)
    }

    @Test func crossfadeEndpointsMatchTransformedEndpointMasks() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let width = 96
        let height = 96
        let base = evaluator.evaluate(scene: scene, progress: 0.5)
        let source = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .sourcePath), width: width, height: height)
        let target = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .targetPath), width: width, height: height)
        let sourceCrossfade = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .crossfade, sourceOpacity: 1, targetOpacity: 0), width: width, height: height)
        let targetCrossfade = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .crossfade, sourceOpacity: 0, targetOpacity: 1), width: width, height: height)

        #expect(sourceCrossfade == source)
        #expect(targetCrossfade == target)
    }

    @Test func crossfadeBlendsSourceAndTargetAlphaMasks() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let width = 96
        let height = 96
        let base = evaluator.evaluate(scene: scene, progress: 0.5)
        let source = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .sourcePath), width: width, height: height)
        let target = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .targetPath), width: width, height: height)
        let crossfade = renderer.renderAlphaMask(scene: scene, frame: frame(from: base, mode: .crossfade, sourceOpacity: 0.25, targetOpacity: 0.5), width: width, height: height)

        for index in crossfade.pixels.indices {
            let sourceContribution = Double(source.pixels[index]) / 255 * 0.25
            let targetContribution = Double(target.pixels[index]) / 255 * 0.5
            let expectedValue = min(255, max(0, (sourceContribution + targetContribution) * 255))
            let expected = UInt8(expectedValue.rounded())
            #expect(abs(Int(crossfade.pixels[index]) - Int(expected)) <= 1)
        }
    }

    @Test func reusedRendererMatchesFreshRendererAfterSourceGeometryChanges() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let width = 96
        let height = 96
        let base = evaluator.evaluate(scene: scene, progress: 0.5, reducedMotion: true)
        _ = renderer.renderAlphaMask(scene: scene, frame: base, width: width, height: height)

        var changed = scene
        changed.source.transform.translateX += 18
        let changedFrame = evaluator.evaluate(scene: changed, progress: 0.5, reducedMotion: true)
        let reused = renderer.renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height)
        let fresh = LiquidCGRenderer().renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height)

        #expect(reused == fresh)
    }

    @Test func reusedRendererMatchesFreshRendererAfterTargetGeometryAndFillRuleChanges() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let width = 128
        let height = 128
        let base = evaluator.evaluate(scene: scene, progress: 0.72)
        _ = renderer.renderAlphaMask(scene: scene, frame: base, width: width, height: height)

        var changed = scene
        changed.target.commands = nestedSquareCommands()
        changed.target.transform = LiquidTransform(translateX: 0, translateY: 0, scaleX: 1, scaleY: 1)
        changed.fillRule = .evenodd
        let changedFrame = frame(from: base, mode: .targetPath)
        let reused = renderer.renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height)
        let fresh = LiquidCGRenderer().renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height)

        #expect(reused == fresh)

        changed.fillRule = .nonzero
        let nonzero = renderer.renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height)
        let evenoddSolidPixels = reused.pixels.filter { $0 == 255 }.count
        let nonzeroSolidPixels = nonzero.pixels.filter { $0 == 255 }.count
        #expect(nonzero == LiquidCGRenderer().renderAlphaMask(scene: changed, frame: changedFrame, width: width, height: height))
        #expect(nonzeroSolidPixels > evenoddSolidPixels)
    }

    @Test func distanceRasterInvalidatesWhenOutputDimensionsChange() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let renderer = LiquidCGRenderer()
        let frame = evaluator.evaluate(scene: scene, progress: 0.68)
        let first = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let differentSize = renderer.renderAlphaMask(scene: scene, frame: frame, width: 80, height: 72)
        let restoredSize = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)

        #expect(differentSize.width == 80)
        #expect(differentSize.height == 72)
        #expect(restoredSize == first)
        #expect(restoredSize == LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96))
    }

    @Test func fieldRenderingSkipsTargetDistanceWhenTargetMixIsZero() throws {
        let scene = try loadScene()
        let evaluator = LiquidEvaluator()
        let base = evaluator.evaluate(scene: scene, progress: 0.4)
        let proceduralOnly = frame(from: base, mode: .field, poseFrame: poseFrame(from: base.frame, targetMix: 0))

        var changed = scene
        changed.target.commands = []
        let renderer = LiquidCGRenderer()
        let normal = renderer.renderAlphaMask(scene: scene, frame: proceduralOnly, width: 96, height: 96)
        let missingTarget = renderer.renderAlphaMask(scene: changed, frame: proceduralOnly, width: 96, height: 96)

        #expect(missingTarget == normal)
    }

    @Test func rendererMatchesSharedVisualGoldenForNormalMotionSamples() throws {
        let scene = try loadScene()
        let manifest = try loadSampleManifest(sceneId: scene.id)
        let golden = try loadVisualGolden()
        #expect(golden.sceneId == scene.id)
        #expect(golden.fixtureVersion == scene.fixtureVersion)
        #expect(golden.resolution.width == 160)
        #expect(golden.resolution.height == 152)
        #expect(golden.samples.map(\.label) == manifest.samples.map(\.label))

        let renderer = LiquidCGRenderer()
        let evaluator = LiquidEvaluator()
        let byLabel = Dictionary(uniqueKeysWithValues: golden.samples.map { ($0.label, $0) })
        let tolerance = VisualTolerance(maxPixelDelta: 4, maxDifferingPixels: 320, maxTotalDelta: 512)

        for sample in manifest.samples {
            guard let expected = byLabel[sample.label] else {
                Issue.record("missing visual golden sample \(sample.label)")
                continue
            }
            let frame = evaluator.evaluate(scene: scene, progress: sample.progress)
            let actual = renderer.renderAlphaMask(scene: scene, frame: frame, width: golden.resolution.width, height: golden.resolution.height)
            let expectedPixels = try expected.alphaPixels(expectedCount: golden.resolution.width * golden.resolution.height)
            let mismatch = compareAlpha(actual.pixels, expectedPixels, tolerance: tolerance)
            #expect(
                mismatch == nil,
                "visual sample \(sample.label) progress \(sample.progress) exceeded tolerance \(tolerance): \(mismatch ?? "")"
            )
        }
    }

    @Test func rendererMatchesSharedV2VisualGoldenForSpinnerToAdSamples() throws {
        let scene = try loadV2Scene()
        let manifest = try loadV2SampleManifest(sceneId: scene.id)
        let golden = try loadV2VisualGolden()
        #expect(golden.sceneId == scene.id)
        #expect(golden.fixtureVersion == scene.fixtureVersion)
        #expect(golden.resolutions.map { "\($0.width)x\($0.height)" } == ["132x52", "264x104"])

        let renderer = LiquidCGRenderer()
        let evaluator = LiquidEvaluator()
        let tolerance = VisualTolerance(maxPixelDelta: 8, maxDifferingPixels: 2_400, maxTotalDelta: 12_000)

        for resolution in golden.resolutions {
            let samples = try #require(resolution.samples)
            #expect(samples.map(\.label) == manifest.samples.map(\.label))
            let byLabel = Dictionary(uniqueKeysWithValues: samples.map { ($0.label, $0) })
            for sample in manifest.samples {
                guard let expected = byLabel[sample.label] else {
                    Issue.record("missing v2 visual golden sample \(sample.label) at \(resolution.width)x\(resolution.height)")
                    continue
                }
                let frame = try evaluator.evaluateChecked(scene: scene, progress: sample.progress)
                #expect(expected.trackRenderModes == Dictionary(uniqueKeysWithValues: frame.tracks.map { ($0.id, $0.renderMode.rawValue) }))
                #expect(expected.activeEventIds == frame.events.map(\.id))
                let actual = renderer.renderAlphaMask(scene: scene, frame: frame, width: resolution.width, height: resolution.height)
                let expectedPixels = try expected.alphaPixels(expectedCount: resolution.width * resolution.height)
                let mismatch = compareAlpha(actual.pixels, expectedPixels, tolerance: tolerance)
                #expect(
                    mismatch == nil,
                    "v2 visual sample \(sample.label) \(resolution.width)x\(resolution.height) progress \(sample.progress) exceeded tolerance \(tolerance): \(mismatch ?? "")"
                )
            }
        }
    }

    @Test(arguments: ["addy-logo-wave", "addy-logo-wave-wordmark"])
    func rendererMatchesSharedAddyLogoWaveVisualGoldens(sceneName: String) throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let scene = try LiquidLoader.loadSceneV2(from: root.appendingPathComponent("shared/scenes/\(sceneName).v2.json"))
        let manifest = try LiquidLoader.loadSampleManifest(from: root.appendingPathComponent("shared/golden/\(sceneName).samples.json"), sceneId: scene.id)
        let golden = try JSONDecoder().decode(V2VisualGolden.self, from: Data(contentsOf: root.appendingPathComponent("shared/golden/\(sceneName).visual.json")))
        #expect(golden.sceneId == scene.id)
        #expect((scene.loop != nil) == (sceneName == "addy-logo-wave"))

        let renderer = LiquidCGRenderer()
        let evaluator = LiquidEvaluator()
        // Placed (pushed and swollen) letters sample cached distance rasters bilinearly, which
        // rounds sharp corners by a fraction of a pixel at these tiny sizes; the TypeScript
        // golden evaluates exact distances. Letters land sharp while still placed, so the
        // exact glyph corners are sampled too. Allow a larger per-pixel delta on few pixels.
        let tolerance = VisualTolerance(maxPixelDelta: 96, maxDifferingPixels: 2_400, maxTotalDelta: 12_000)
        for resolution in golden.resolutions {
            let byLabel = Dictionary(uniqueKeysWithValues: try #require(resolution.samples).map { ($0.label, $0) })
            for sample in manifest.samples {
                let expected = try #require(byLabel[sample.label])
                let frame = try evaluator.evaluateChecked(scene: scene, progress: sample.progress)
                let actual = renderer.renderAlphaMask(scene: scene, frame: frame, width: resolution.width, height: resolution.height)
                let mismatch = compareAlpha(actual.pixels, try expected.alphaPixels(expectedCount: resolution.width * resolution.height), tolerance: tolerance)
                #expect(mismatch == nil, "wave sample \(sample.label) \(resolution.width)x\(resolution.height): \(mismatch ?? "")")
            }
        }
    }

    @Test func rendererMatchesSharedFullAddyVisualGoldenForSamples() throws {
        let scene = try loadFullAddyScene()
        let manifest = try loadFullAddySampleManifest(sceneId: scene.id)
        let golden = try loadFullAddyVisualGolden()
        #expect(golden.sceneId == scene.id)
        #expect(golden.fixtureVersion == scene.fixtureVersion)
        #expect(scene.tracks.map(\.target.shapeId) == ["letter-a", "letter-d1", "letter-d2", "letter-y"])
        #expect(golden.resolutions.map { "\($0.width)x\($0.height)" } == ["132x70", "264x139"])

        let renderer = LiquidCGRenderer()
        let evaluator = LiquidEvaluator()
        // Placed (pushed and swollen) letters sample cached distance rasters bilinearly, which
        // rounds sharp corners by a fraction of a pixel at these tiny sizes; the TypeScript
        // golden evaluates exact distances. Letters land sharp while still placed, so the
        // exact glyph corners are sampled too. Allow a larger per-pixel delta on few pixels.
        let tolerance = VisualTolerance(maxPixelDelta: 96, maxDifferingPixels: 2_400, maxTotalDelta: 12_000)

        for resolution in golden.resolutions {
            let samples = try #require(resolution.samples)
            #expect(samples.map(\.label) == manifest.samples.map(\.label))
            let byLabel = Dictionary(uniqueKeysWithValues: samples.map { ($0.label, $0) })
            for sample in manifest.samples {
                guard let expected = byLabel[sample.label] else {
                    Issue.record("missing full Addy visual golden sample \(sample.label) at \(resolution.width)x\(resolution.height)")
                    continue
                }
                let frame = try evaluator.evaluateChecked(scene: scene, progress: sample.progress)
                #expect(expected.trackRenderModes == Dictionary(uniqueKeysWithValues: frame.tracks.map { ($0.id, $0.renderMode.rawValue) }))
                #expect(expected.activeEventIds == frame.events.map(\.id))
                let actual = renderer.renderAlphaMask(scene: scene, frame: frame, width: resolution.width, height: resolution.height)
                let expectedPixels = try expected.alphaPixels(expectedCount: resolution.width * resolution.height)
                let mismatch = compareAlpha(actual.pixels, expectedPixels, tolerance: tolerance)
                #expect(
                    mismatch == nil,
                    "full Addy visual sample \(sample.label) \(resolution.width)x\(resolution.height) progress \(sample.progress) exceeded tolerance \(tolerance): \(mismatch ?? "")"
                )
            }
        }
    }

    @Test func rendererCompositesV2TracksDeterministically() throws {
        let scene = v2RendererScene()
        let frame = try LiquidEvaluator().evaluateChecked(scene: scene, progress: 0.5)
        let renderer = LiquidCGRenderer()
        let first = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let second = renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let fresh = LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)

        #expect(first == second)
        #expect(first == fresh)
        #expect(first.pixels.filter { $0 > 0 }.count > 80)
        #expect(renderer.renderCGImage(scene: scene, frame: frame, options: LiquidRenderOptions(width: 96, height: 96)) != nil)
    }

    @Test func optimizedV2RendererMatchesReferenceFieldMask() throws {
        let scene = v2RendererScene()
        let frame = try LiquidEvaluator().evaluateChecked(scene: scene, progress: 0.5)
        let actual = LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let reference = referenceV2AlphaMask(scene: scene, frame: frame, width: 96, height: 96)

        #expect(actual == reference)
    }

    @MainActor
    @Test func playerSupportsV2ScenesWithoutV1InitializerChanges() throws {
        let scene = v2RendererScene()
        let player = try LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(loop: false), now: 10)
        #expect(player.sceneV2?.id == scene.id)
        player.seek(progress: 0.5, now: 10)
        #expect(player.frameV2?.tracks.count == 2)
        #expect(player.renderCGImage(logicalSize: CGSize(width: 80, height: 80), displayScale: 2) != nil)
    }

    @Test func metalCapabilitiesExposeBoundedFallbackContract() throws {
        let capabilities = LiquidMetalRenderer.systemCapabilities()
        #expect(capabilities.maxTracks == LiquidMetalRenderer.maxTracks)
        #expect(capabilities.maxComponentsPerTrack == LiquidMetalRenderer.maxComponentsPerTrack)
        #expect(capabilities.maxRibbonSegments == LiquidMetalRenderer.maxRibbonSegments)
        if capabilities.isSupported {
            #expect(capabilities.deviceName?.isEmpty == false)
            #expect(capabilities.reason == nil)
        }
    }

    @Test func metalRendererRejectsScenesBeyondDocumentedCapacity() throws {
        guard let renderer = LiquidMetalRenderer() else { return }
        let scene = v2RendererScene(componentCount: LiquidMetalRenderer.maxComponentsPerTrack + 1)
        let frame = try LiquidEvaluator().evaluateChecked(scene: scene, progress: 0.5)
        #expect(!renderer.canRender(scene: scene, frame: frame, width: 64, height: 64))
    }

    @Test func metalRendererProducesNonemptyV2RenderModes() throws {
        guard let renderer = LiquidMetalRenderer() else { return }
        let scene = v2RendererScene()
        let evaluator = LiquidEvaluator()
        let frames = [
            try evaluator.evaluateChecked(scene: scene, progress: 0),
            try evaluator.evaluateChecked(scene: scene, progress: 0.5),
            try evaluator.evaluateChecked(scene: scene, progress: 1),
            try evaluator.evaluateChecked(scene: scene, progress: 0.5, reducedMotion: true)
        ]

        for frame in frames {
            let mask = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96))
            #expect(mask.width == 96)
            #expect(mask.height == 96)
            #expect(mask.pixels.contains { $0 > 0 })
        }
        #expect(renderer.renderCGImage(scene: scene, frame: frames[1], options: LiquidRenderOptions(width: 96, height: 96)) != nil)
    }

    @Test func metalRendererMatchesCoreGraphicsAlphaWithinTolerance() throws {
        guard let renderer = LiquidMetalRenderer() else { return }
        let scene = v2RendererScene()
        let frame = try LiquidEvaluator().evaluateChecked(scene: scene, progress: 0.5)
        let metal = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96))
        let coreGraphics = LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96)
        let tolerance = VisualTolerance(maxPixelDelta: 20, maxDifferingPixels: 900, maxTotalDelta: 7_500)

        let mismatch = compareAlpha(metal.pixels, coreGraphics.pixels, tolerance: tolerance)
        #expect(mismatch == nil, "Metal vs Core Graphics alpha exceeded tolerance \(tolerance): \(mismatch ?? "")")
    }

    @Test func metalMatchesCoreGraphicsForPushedAndSwollenLetters() throws {
        guard let renderer = LiquidMetalRenderer() else { return }
        let scene = try loadFullAddyScene()
        let manifest = try loadFullAddySampleManifest(sceneId: scene.id)
        let evaluator = LiquidEvaluator()
        // Sample the landing, where letters are placed away from their rest pose.
        let landing = try #require(manifest.samples.first { $0.label == "sharpening" })
        let frame = try evaluator.evaluateChecked(scene: scene, progress: landing.progress)
        #expect(frame.tracks.contains { LiquidSDF.trackPlacement(track: $0) != nil })
        let metal = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 264, height: 139))
        let coreGraphics = LiquidCGRenderer().renderAlphaMask(scene: scene, frame: frame, width: 264, height: 139)
        let tolerance = VisualTolerance(maxPixelDelta: 20, maxDifferingPixels: 900, maxTotalDelta: 7_500)
        let mismatch = compareAlpha(metal.pixels, coreGraphics.pixels, tolerance: tolerance)
        #expect(mismatch == nil, "Metal vs Core Graphics alpha exceeded tolerance \(tolerance): \(mismatch ?? "")")
    }

    @Test func metalRendererHandlesResizeAndExplicitCleanup() throws {
        guard let renderer = LiquidMetalRenderer() else { return }
        let scene = v2RendererScene()
        let frame = try LiquidEvaluator().evaluateChecked(scene: scene, progress: 0.5)
        let first = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96))
        let resized = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 80, height: 72))
        renderer.clearCaches()
        let restored = try #require(renderer.renderAlphaMask(scene: scene, frame: frame, width: 96, height: 96))

        #expect(resized.width == 80)
        #expect(resized.height == 72)
        #expect(restored == first)
    }

    @MainActor
    @Test func playerAutoBackendSelectsMetalWhenAvailableAndFallsBackWhenUnsupported() throws {
        let scene = v2RendererScene()
        let player = try LiquidPlayer(scene: scene, now: 10)
        player.seek(progress: 0.5, now: 10)
        #expect(player.renderCGImage(logicalSize: CGSize(width: 80, height: 80), displayScale: 1) != nil)
        let expectedBackend: LiquidResolvedRendererBackend = LiquidMetalRenderer() == nil ? .coreGraphics : .metal
        #expect(player.selectedRendererBackend == expectedBackend)

        let overCapacityScene = v2RendererScene(componentCount: LiquidMetalRenderer.maxComponentsPerTrack + 1)
        let fallbackPlayer = try LiquidPlayer(scene: overCapacityScene, now: 10)
        fallbackPlayer.seek(progress: 0.5, now: 10)
        let forcedMetal = LiquidPlayerRenderStyle(backend: .metal)
        #expect(fallbackPlayer.renderCGImage(logicalSize: CGSize(width: 80, height: 80), displayScale: 1, style: forcedMetal) != nil)
        #expect(fallbackPlayer.selectedRendererBackend == .coreGraphics)
    }
}

private func frame(
    from base: LiquidFrame,
    mode: LiquidRenderMode,
    sourceOpacity: Double = 1,
    targetOpacity: Double = 0,
    poseFrame: LiquidPoseFrame? = nil
) -> LiquidFrame {
    LiquidFrame(
        progress: base.progress,
        phase: base.phase,
        events: base.events,
        renderMode: mode,
        sourceOpacity: sourceOpacity,
        targetOpacity: targetOpacity,
        frame: poseFrame ?? base.frame,
        endpointCommands: base.endpointCommands
    )
}

private func poseFrame(from base: LiquidPoseFrame, targetMix: Double) -> LiquidPoseFrame {
    LiquidPoseFrame(
        anchor: base.anchor,
        leftLeg: base.leftLeg,
        rightLeg: base.rightLeg,
        crossbar: base.crossbar,
        bridge: base.bridge,
        blendRadius: base.blendRadius,
        targetMix: targetMix,
        cornerSharpness: base.cornerSharpness
    )
}

private func v2RendererScene(componentCount: Int = 2) -> LiquidSceneV2 {
    let square: [LiquidPathCommand] = [.move(0, 0), .line(20, 0), .line(20, 20), .line(0, 20), .close]
    let identity = LiquidTransform(translateX: 0, translateY: 0, scaleX: 1, scaleY: 1)
    let components = (0..<componentCount).map { index in
        LiquidComponentDefinition(
            id: index == 0 ? "outer" : "counter-\(index)",
            kind: index == 0 ? .capsule : .ellipse,
            operation: index == 0 ? .union : .subtract,
            groupId: "ink"
        )
    }
    let firstKeyframeComponents = components.enumerated().map { index, definition in
        LiquidComponentState(id: definition.id, primitive: primitiveForTestComponent(index: index, offset: 0))
    }
    let secondKeyframeComponents = components.enumerated().map { index, definition in
        LiquidComponentState(id: definition.id, primitive: primitiveForTestComponent(index: index, offset: 8))
    }
    return LiquidSceneV2(
        schemaVersion: 2,
        id: "v2-renderer-test",
        fixtureVersion: 1,
        durationMs: 800,
        coordinateSpace: LiquidSize(width: 80, height: 80),
        fillRule: .nonzero,
        tracks: [
            LiquidTrack(
                id: "ellipse",
                source: LiquidEndpoint(assetId: "source", shapeId: "ellipse-source", transform: identity, commands: square),
                target: LiquidEndpoint(assetId: "target", shapeId: "ellipse-target", transform: LiquidTransform(translateX: 10, translateY: 10, scaleX: 1, scaleY: 1), commands: square),
                timing: LiquidTrackTiming(start: 0, end: 1),
                components: components,
                keyframes: [
                    LiquidTrackKeyframe(
                        at: 0,
                        easing: .linear,
                        components: firstKeyframeComponents,
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)], "$track": ["targetMix": .number(0), "cornerSharpness": .number(0)]])
                    ),
                    LiquidTrackKeyframe(
                        at: 1,
                        easing: .linear,
                        components: secondKeyframeComponents,
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)], "$track": ["targetMix": .number(0.2), "cornerSharpness": .number(0)]])
                    )
                ]
            ),
            LiquidTrack(
                id: "ribbon",
                source: LiquidEndpoint(assetId: "source", shapeId: "ribbon-source", transform: identity, commands: square),
                target: LiquidEndpoint(assetId: "target", shapeId: "ribbon-target", transform: identity, commands: square),
                timing: LiquidTrackTiming(start: 0, end: 1),
                components: [LiquidComponentDefinition(id: "curve", kind: .ribbon, operation: .union, groupId: "ink")],
                keyframes: [
                    LiquidTrackKeyframe(
                        at: 0,
                        easing: .linear,
                        components: [LiquidComponentState(id: "curve", primitive: .ribbon(LiquidRibbon(p0: LiquidPoint(x: 10, y: 50), p1: LiquidPoint(x: 25, y: 40), p2: LiquidPoint(x: 35, y: 60), p3: LiquidPoint(x: 50, y: 50), startRadius: 2, endRadius: 3)))],
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)]])
                    ),
                    LiquidTrackKeyframe(
                        at: 1,
                        easing: .linear,
                        components: [LiquidComponentState(id: "curve", primitive: .ribbon(LiquidRibbon(p0: LiquidPoint(x: 10, y: 55), p1: LiquidPoint(x: 25, y: 45), p2: LiquidPoint(x: 35, y: 65), p3: LiquidPoint(x: 50, y: 55), startRadius: 3, endRadius: 4)))],
                        material: LiquidKeyframeMaterial(groups: ["ink": ["blendRadius": .number(1)]])
                    )
                ]
            )
        ],
        reducedMotion: LiquidReducedMotion(mode: "crossfade", durationMs: 120, fadeStart: 0.25, fadeEnd: 0.75)
    )
}

private func primitiveForTestComponent(index: Int, offset: Double) -> LiquidPrimitive {
    if index == 0 {
        return .capsule(LiquidCapsule(
            start: LiquidPoint(x: 18 + offset, y: 24),
            end: LiquidPoint(x: 42 + offset, y: 36),
            radius: 8
        ))
    }
    let step = Double(index - 1) * 0.3
    return .ellipse(LiquidEllipse(
        center: LiquidPoint(x: 30 + offset + step, y: 30 + step),
        radiusX: max(1, 4 - step * 0.1),
        radiusY: max(1, 5 - step * 0.1),
        rotation: step * 0.05
    ))
}

private func referenceV2AlphaMask(scene: LiquidSceneV2, frame: LiquidFrameV2, width: Int, height: Int) -> LiquidAlphaMask {
    var pixels = Array(repeating: UInt8(0), count: max(0, width * height))
    guard width > 0, height > 0 else {
        return LiquidAlphaMask(width: width, height: height, pixels: pixels)
    }

    let mapping = ReferenceScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
    let ramp = mapping.sceneUnitsPerPixel
    for track in frame.tracks {
        let trackPixels = referenceTrackAlphaMask(scene: scene, track: track, mapping: mapping, ramp: ramp)
        for index in pixels.indices {
            let existing = Double(pixels[index]) / 255
            let next = Double(trackPixels[index]) / 255
            pixels[index] = UInt8((min(1, existing + next * (1 - existing)) * 255).rounded())
        }
    }
    return LiquidAlphaMask(width: width, height: height, pixels: pixels)
}

private func referenceTrackAlphaMask(
    scene: LiquidSceneV2,
    track: LiquidTrackFrame,
    mapping: ReferenceScenePixelMapping,
    ramp: Double
) -> [UInt8] {
    let pixelCount = max(0, mapping.width * mapping.height)
    var pixels = Array(repeating: UInt8(0), count: pixelCount)
    switch track.renderMode {
    case .sourcePath:
        let distances = referenceEndpointDistances(endpoint: track.source, fillRule: scene.fillRule, mapping: mapping)
        writeReferenceCoverage(distances: distances, ramp: ramp, into: &pixels)
    case .targetPath:
        let distances = referenceEndpointDistances(endpoint: track.target, fillRule: scene.fillRule, mapping: mapping)
        writeReferenceCoverage(distances: distances, ramp: ramp, into: &pixels)
    case .field:
        let targetMix = LiquidSDF.targetMix(track: track)
        let targetDistances = targetMix > 0 ? referenceEndpointDistances(endpoint: track.target, fillRule: scene.fillRule, mapping: mapping) : nil
        for y in 0..<mapping.height {
            for x in 0..<mapping.width {
                let index = y * mapping.width + x
                let point = mapping.scenePoint(pixelX: x, pixelY: y)
                let procedural = referenceTrackFieldDistance(point: point, track: track)
                let distance = targetDistances.map { procedural * (1 - targetMix) + $0[index] * targetMix } ?? procedural
                pixels[index] = UInt8((referenceCoverage(distance: distance, ramp: ramp) * 255).rounded())
            }
        }
    case .crossfade:
        let source = track.sourceOpacity > 0 ? referenceEndpointDistances(endpoint: track.source, fillRule: scene.fillRule, mapping: mapping) : nil
        let target = track.targetOpacity > 0 ? referenceEndpointDistances(endpoint: track.target, fillRule: scene.fillRule, mapping: mapping) : nil
        for index in 0..<pixelCount {
            let sourceAlpha = source.map { referenceCoverage(distance: $0[index], ramp: ramp) * track.sourceOpacity } ?? 0
            let targetAlpha = target.map { referenceCoverage(distance: $0[index], ramp: ramp) * track.targetOpacity } ?? 0
            pixels[index] = UInt8(min(255, max(0, (sourceAlpha + targetAlpha) * 255)).rounded())
        }
    }
    return pixels
}

private func referenceEndpointDistances(endpoint: LiquidEndpoint, fillRule: LiquidFillRule, mapping: ReferenceScenePixelMapping) -> [Double] {
    let preparedPath = LiquidPreparedPath(commands: endpoint.transformedCommands)
    var distances = Array(repeating: Double.infinity, count: mapping.width * mapping.height)
    for y in 0..<mapping.height {
        for x in 0..<mapping.width {
            let point = mapping.scenePoint(pixelX: x, pixelY: y)
            distances[y * mapping.width + x] = LiquidSDF.targetPathDistance(point: point, preparedPath: preparedPath, fillRule: fillRule)
        }
    }
    return distances
}

private func writeReferenceCoverage(distances: [Double], ramp: Double, into pixels: inout [UInt8]) {
    for index in pixels.indices {
        pixels[index] = UInt8((referenceCoverage(distance: distances[index], ramp: ramp) * 255).rounded())
    }
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

private func referenceCoverage(distance: Double, ramp: Double) -> Double {
    let half = max(ramp, 0.000001)
    return min(1, max(0, 0.5 - distance / half))
}

private struct ReferenceScenePixelMapping {
    var sceneSize: LiquidSize
    var width: Int
    var height: Int
    var scale: Double
    var offsetX: Double
    var offsetY: Double
    var sceneUnitsPerPixel: Double

    init(sceneSize: LiquidSize, width: Int, height: Int) {
        self.sceneSize = sceneSize
        self.width = width
        self.height = height
        self.scale = min(Double(width) / sceneSize.width, Double(height) / sceneSize.height)
        self.offsetX = (Double(width) - sceneSize.width * scale) * 0.5
        self.offsetY = (Double(height) - sceneSize.height * scale) * 0.5
        self.sceneUnitsPerPixel = 1 / max(scale, 0.000001)
    }

    func scenePoint(pixelX: Int, pixelY: Int) -> LiquidPoint {
        LiquidPoint(
            x: (Double(pixelX) + 0.5 - offsetX) / scale,
            y: (Double(pixelY) + 0.5 - offsetY) / scale
        )
    }
}

private func loadScene() throws -> LiquidScene {
    try LiquidLoader.loadScene(from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/scenes/capsule-to-a.v1.json"))
}

private func loadV2Scene() throws -> LiquidSceneV2 {
    try LiquidLoader.loadSceneV2(from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/scenes/spinner-to-ad.v2.json"))
}

private func loadFullAddyScene() throws -> LiquidSceneV2 {
    try LiquidLoader.loadSceneV2(from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/scenes/spinner-to-addy.v2.json"))
}

private func loadSampleManifest(sceneId: String) throws -> LiquidSampleManifest {
    try LiquidLoader.loadSampleManifest(
        from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            .appendingPathComponent("shared/golden/capsule-to-a.samples.json"),
        sceneId: sceneId
    )
}

private func loadV2SampleManifest(sceneId: String) throws -> LiquidSampleManifest {
    try LiquidLoader.loadSampleManifest(
        from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            .appendingPathComponent("shared/golden/spinner-to-ad.samples.json"),
        sceneId: sceneId
    )
}

private func loadFullAddySampleManifest(sceneId: String) throws -> LiquidSampleManifest {
    try LiquidLoader.loadSampleManifest(
        from: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            .appendingPathComponent("shared/golden/spinner-to-addy.samples.json"),
        sceneId: sceneId
    )
}

private func loadVisualGolden() throws -> VisualGolden {
    let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/golden/capsule-to-a.visual.json")
    return try JSONDecoder().decode(VisualGolden.self, from: Data(contentsOf: url))
}

private func loadV2VisualGolden() throws -> V2VisualGolden {
    let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/golden/spinner-to-ad.visual.json")
    return try JSONDecoder().decode(V2VisualGolden.self, from: Data(contentsOf: url))
}

private func loadFullAddyVisualGolden() throws -> V2VisualGolden {
    let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("shared/golden/spinner-to-addy.visual.json")
    return try JSONDecoder().decode(V2VisualGolden.self, from: Data(contentsOf: url))
}

private struct VisualGolden: Decodable {
    var sceneId: String
    var fixtureVersion: Int
    var resolution: VisualResolution
    var samples: [VisualSample]
}

private struct V2VisualGolden: Decodable {
    var sceneId: String
    var fixtureVersion: Int
    var resolutions: [VisualResolution]
}

private struct VisualResolution: Decodable {
    var width: Int
    var height: Int
    var samples: [VisualSample]?
}

private struct VisualSample: Decodable {
    var label: String
    var progress: Double
    var trackRenderModes: [String: String]?
    var activeEventIds: [String]?
    var alphaBase64: String

    func alphaPixels(expectedCount: Int) throws -> [UInt8] {
        guard let data = Data(base64Encoded: alphaBase64) else {
            throw VisualGoldenError.invalidBase64(label)
        }
        guard data.count == expectedCount else {
            throw VisualGoldenError.invalidAlphaLength(label: label, actual: data.count, expected: expectedCount)
        }
        return Array(data)
    }
}

private struct VisualTolerance: CustomStringConvertible {
    var maxPixelDelta: Int
    var maxDifferingPixels: Int
    var maxTotalDelta: Int

    var description: String {
        "maxPixelDelta=\(maxPixelDelta), maxDifferingPixels=\(maxDifferingPixels), maxTotalDelta=\(maxTotalDelta)"
    }
}

private enum VisualGoldenError: Error {
    case invalidBase64(String)
    case invalidAlphaLength(label: String, actual: Int, expected: Int)
    case missingImage
    case pixelContextUnavailable
}

private func debugOptionCases() -> [(label: String, options: LiquidDebugOptions)] {
    [
        ("centerlines", LiquidDebugOptions(showsCenterlines: true)),
        ("radii", LiquidDebugOptions(showsRadii: true)),
        ("bounds", LiquidDebugOptions(showsBounds: true)),
        ("thresholds", LiquidDebugOptions(showsThresholds: true))
    ]
}

private func requireImage(_ image: CGImage?) throws -> CGImage {
    guard let image else {
        throw VisualGoldenError.missingImage
    }
    return image
}

private func rgbaPixels(from image: CGImage) throws -> [UInt8] {
    var pixels = Array(repeating: UInt8(0), count: image.width * image.height * 4)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    try pixels.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(
            data: buffer.baseAddress,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw VisualGoldenError.pixelContextUnavailable
        }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    return pixels
}

private func fillPixelCount(_ pixels: [UInt8], red: Double, green: Double, blue: Double) -> Int {
    let expectedRed = UInt8(max(0, min(255, red * 255)).rounded())
    let expectedGreen = UInt8(max(0, min(255, green * 255)).rounded())
    let expectedBlue = UInt8(max(0, min(255, blue * 255)).rounded())
    var count = 0
    for base in stride(from: 0, to: pixels.count, by: 4) {
        guard pixels[base + 3] == 255 else { continue }
        let redDelta = abs(Int(pixels[base]) - Int(expectedRed))
        let greenDelta = abs(Int(pixels[base + 1]) - Int(expectedGreen))
        let blueDelta = abs(Int(pixels[base + 2]) - Int(expectedBlue))
        if redDelta <= 2, greenDelta <= 2, blueDelta <= 2 {
            count += 1
        }
    }
    return count
}

private func compareAlpha(_ actual: [UInt8], _ expected: [UInt8], tolerance: VisualTolerance) -> String? {
    guard actual.count == expected.count else {
        return "pixel count \(actual.count) != \(expected.count)"
    }

    var differingPixels = 0
    var totalDelta = 0
    var maxDelta = 0
    var maxDeltaIndex = 0
    for index in actual.indices {
        let delta = abs(Int(actual[index]) - Int(expected[index]))
        if delta == 0 { continue }
        differingPixels += 1
        totalDelta += delta
        if delta > maxDelta {
            maxDelta = delta
            maxDeltaIndex = index
        }
    }

    if maxDelta > tolerance.maxPixelDelta || differingPixels > tolerance.maxDifferingPixels || totalDelta > tolerance.maxTotalDelta {
        return "differingPixels=\(differingPixels), totalDelta=\(totalDelta), maxDelta=\(maxDelta) at pixel \(maxDeltaIndex)"
    }
    return nil
}

private func nestedSquareCommands() -> [LiquidPathCommand] {
    [
        .move(30, 30),
        .line(170, 30),
        .line(170, 170),
        .line(30, 170),
        .close,
        .move(70, 70),
        .line(130, 70),
        .line(130, 130),
        .line(70, 130),
        .close
    ]
}

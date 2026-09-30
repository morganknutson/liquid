import AddyLogo
import LiquidCore
import LiquidMac
import Testing

@MainActor
struct AddyLogoTests {
    @Test func controllerLoadsTheLogoSceneAndStartsOnTheEmptyPill() throws {
        let controller = try AddyLogoController()
        #expect(controller.player.sceneV2?.id == "spinner-to-addy")
        #expect(controller.player.sceneV2?.coordinateSpace == LiquidSize(width: AddyLogoMetrics.width, height: AddyLogoMetrics.height))
        #expect(controller.player.progress == 0)
        #expect(controller.isComplete == false)
    }

    @Test func playingToTheEndCompletesAndRendersTheWordmarkInsideThePill() async throws {
        let controller = try AddyLogoController()
        let player = controller.player
        let start = LiquidPlayer.currentTime()
        player.setReducedMotionOverride(.disabled, now: start)
        controller.play()
        player.pause(now: start)
        player.play(now: start, startsClock: false)
        player.tick(now: start + player.durationSeconds + 0.01)
        await Task.yield()
        await Task.yield()
        #expect(player.progress == 1)
        #expect(controller.isComplete)

        let backing = LiquidBackingSize(logicalWidth: 297.3, logicalHeight: 156.8, scale: 1, width: 297, height: 157)
        let image = try #require(player.renderCGImage(backingSize: backing, style: LiquidPlayerRenderStyle(backend: .coreGraphics)))
        #expect(image.width == 297 && image.height == 157)
        let mask = player.renderer.renderAlphaMask(scene: try #require(player.sceneV2), frame: try #require(player.frameV2), width: 297, height: 157)
        let covered = mask.pixels.filter { $0 > 200 }.count
        #expect(covered > 297 * 157 / 10)
        // The pill outline passes through the middle of the top edge.
        #expect(mask.pixels[5 * 297 + 148] > 200)
    }

    @Test func droppingTicksNeverRenderAboveThePill() throws {
        let controller = try AddyLogoController()
        let player = controller.player
        let scene = try #require(player.sceneV2)
        // A square output letterboxes the pill, leaving empty rows above it.
        let size = 240
        let pillTop = Int((Double(size) - Double(size) / AddyLogoMetrics.aspectRatio) / 2) - 1
        for progress in [0.02, 0.05, 0.08] {
            player.seek(progress: progress)
            let frame = try #require(player.frameV2)
            let mask = player.renderer.renderAlphaMask(scene: scene, frame: frame, width: size, height: size)
            #expect(mask.pixels[0..<(pillTop * size)].allSatisfy { $0 == 0 }, "progress \(progress)")
            var unclipped = scene
            unclipped.clip = nil
            if progress <= 0.05 {
                let leaking = LiquidCGRenderer().renderAlphaMask(scene: unclipped, frame: frame, width: size, height: size)
                #expect(leaking.pixels[0..<(pillTop * size)].contains { $0 > 0 })
            }
        }
    }

    @Test func waveVariantLoopsItsWaveAfterTheDropIn() throws {
        let controller = try AddyLogoController(variant: .wave)
        let player = controller.player
        let scene = try #require(player.sceneV2)
        let loopStart = try #require(scene.loop).start
        #expect(scene.id == "addy-logo-wave")
        player.setReducedMotionOverride(.disabled)

        let start = LiquidPlayer.currentTime()
        player.seek(progress: 0, now: start)
        player.play(now: start, startsClock: false)
        // Past the end: playback wraps into the wave, never back to the empty pill.
        player.tick(now: start + player.durationSeconds * 1.25)
        #expect(player.isPlaying)
        #expect(player.progress >= loopStart && player.progress < 1)
        #expect(abs(player.progress - (loopStart + 0.25)) < 0.001)
        #expect(controller.isComplete == false)

        // Every wave frame shows pills inside the pill frame.
        let mask = player.renderer.renderAlphaMask(scene: scene, frame: try #require(player.frameV2), width: 297, height: 157)
        #expect(mask.pixels[78 * 297 + 148] == 0 || mask.pixels.filter { $0 > 200 }.count > 1_000)
    }

    @Test func waveThenWordmarkEndsOnTheWordmark() async throws {
        let controller = try AddyLogoController(variant: .waveThenWordmark)
        let player = controller.player
        let scene = try #require(player.sceneV2)
        #expect(scene.id == "addy-logo-wave-wordmark")
        #expect(scene.loop == nil)
        #expect(player.options.loop == false)
        player.setReducedMotionOverride(.disabled)
        let start = LiquidPlayer.currentTime()
        controller.play()
        player.pause(now: start)
        player.play(now: start, startsClock: false)
        player.tick(now: start + player.durationSeconds + 0.01)
        await Task.yield()
        await Task.yield()
        #expect(player.progress == 1)
        #expect(controller.isComplete)
        let frame = try #require(player.frameV2)
        #expect(frame.tracks.filter { $0.target.assetId == "addy-logo-wordmark" }.map(\.target.shapeId).sorted() == ["letter-a", "letter-d1", "letter-d2", "letter-y"])
        #expect(frame.tracks.allSatisfy { $0.renderMode == .targetPath })
    }

    @Test func waveThenWordmarkReplayStartsAtTheTicksAndDropsTheLettersWhenClicked() async throws {
        let controller = try AddyLogoController(variant: .waveThenWordmarkReplay)
        let player = controller.player
        player.setReducedMotionOverride(.disabled)
        let scene = try #require(player.sceneV2)
        let enter = try #require(scene.markers?.first { $0.id == "enter" }?.at)
        #expect(scene.id == "addy-logo-wave-wordmark-replay")
        #expect(controller.replaysOnClick)
        controller.replay()
        #expect(abs(player.progress - enter) < 1e-9)
        // Clicking does nothing until the logo has finished.
        #expect(!controller.dropAndReplay())

        player.pause()
        controller.showWordmark()
        #expect(controller.dropAndReplay())
        #expect(player.progress == 0)
        #expect(player.isPlaying)
        let exits = try #require(player.frameV2).tracks.filter { $0.id.hasPrefix("exit-") }
        #expect(exits.map(\.target.shapeId) == ["letter-y", "letter-d2", "letter-d1", "letter-a"])
        #expect(exits.allSatisfy { $0.renderMode == .targetPath })
    }

    @Test func onlyTheReplayVariantReplaysOnClick() throws {
        let controller = try AddyLogoController(variant: .waveThenWordmark)
        controller.showWordmark()
        #expect(!controller.replaysOnClick)
        #expect(!controller.dropAndReplay())
        #expect(controller.player.progress == 1)
    }

    @Test func reducedMotionHoldsTheWaveInsteadOfLooping() throws {
        let controller = try AddyLogoController(variant: .wave)
        let player = controller.player
        player.setReducedMotionOverride(.enabled)
        let start = LiquidPlayer.currentTime()
        player.seek(progress: 0, now: start)
        player.play(now: start, startsClock: false)
        player.tick(now: start + player.durationSeconds + 0.01)
        #expect(player.progress == 1)
        #expect(player.isPlaying == false)
    }

    @Test func reducedMotionPlaysTheShortCrossfade() throws {
        let controller = try AddyLogoController()
        let player = controller.player
        player.setReducedMotionOverride(.enabled)
        let scene = try #require(player.sceneV2)
        #expect(abs(player.durationSeconds - scene.reducedMotion.durationMs / 1000) < 0.000001)
        player.setReducedMotionOverride(.disabled)
        #expect(abs(player.durationSeconds - scene.durationMs / 1000) < 0.000001)
    }
}

import AppKit
import Foundation
import LiquidCore
import LiquidMac

@main
struct LiquidExampleMac {
    @MainActor
    static func main() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let scene = try LiquidSceneResource.loadSharedScene(named: "capsule-to-a.v1.json", searchFrom: root)
        if CommandLine.arguments.contains("--window") {
            runWindow(scene: scene)
        } else {
            runSmoke(scene: scene)
        }
    }

    @MainActor
    private static func runSmoke(scene: LiquidScene) {
        let player = LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(reducedMotion: .disabled))
        player.seek(progress: 0.6)
        let backingSize = liquidBackingSize(
            logicalSize: CGSize(width: 160, height: 152),
            displayScale: 2,
            options: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 384)
        )
        let image = player.renderCGImage(backingSize: backingSize)
        print("LiquidExampleMac rendered \(scene.id) at t=\(player.frame.progress) into \(image?.width ?? 0)x\(image?.height ?? 0) backing pixels.")
    }

    @MainActor
    private static func runWindow(scene: LiquidScene) {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)

        let player = LiquidPlayer(scene: scene, options: LiquidPlaybackOptions(autoplay: true, loop: true))
        let view = LiquidPlayerView(
            player: player,
            backingOptions: LiquidBackingScaleOptions(maxScale: 2, maxBackingDimension: 512),
            renderStyle: LiquidPlayerRenderStyle(fillRed: 0.92, fillGreen: 0.95, fillBlue: 1)
        )
        view.frame = NSRect(x: 0, y: 0, width: 360, height: 320)

        let window = NSWindow(
            contentRect: view.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "LiquidExampleMac"
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)

        app.activate(ignoringOtherApps: true)
        app.run()
    }
}

import Foundation
import LiquidCore

@main
struct LiquidFixtureDumpCommand {
    static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.contains("--help") || arguments.contains("-h") {
            print("""
            Usage: LiquidFixtureDump [scene.json] [samples.json] [output.json]

            Reads a Liquid v1 or v2 scene and sample manifest, evaluates through LiquidCore, and emits liquid-frame schema JSON.
            Defaults:
              scene:   shared/scenes/capsule-to-a.v1.json
              samples: shared/golden/capsule-to-a.samples.json
              output:  stdout
            """)
            return
        }

        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let sceneURL = URL(fileURLWithPath: arguments.indices.contains(0) ? arguments[0] : "shared/scenes/capsule-to-a.v1.json", relativeTo: cwd)
        let samplesURL = URL(fileURLWithPath: arguments.indices.contains(1) ? arguments[1] : "shared/golden/capsule-to-a.samples.json", relativeTo: cwd)
        let outputURL = arguments.indices.contains(2) ? URL(fileURLWithPath: arguments[2], relativeTo: cwd) : nil

        let scene = try LiquidLoader.loadAnyScene(from: sceneURL)
        let manifest = try LiquidLoader.loadSampleManifest(from: samplesURL, sceneId: scene.id)
        let output = try LiquidEvaluator().makeOutput(scene: scene, manifest: manifest).canonicalJSONString()

        if let outputURL {
            try output.write(to: outputURL, atomically: true, encoding: .utf8)
        } else {
            print(output, terminator: "")
        }
    }
}

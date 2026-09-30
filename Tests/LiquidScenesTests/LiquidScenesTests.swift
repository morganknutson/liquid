import Foundation
import Testing
@testable import LiquidCore
@testable import LiquidScenes

struct LiquidScenesTests {
    @Test func bundledScenesLoadThroughAnySceneAPI() throws {
        let v1 = try LiquidScenes.loadScene(.capsuleToA)
        let adStudy = try LiquidScenes.loadScene(.spinnerToAd)
        let v2 = try LiquidScenes.loadScene(.spinnerToAddy)

        #expect(v1.schemaVersion == 1)
        #expect(v1.id == "capsule-to-a")
        #expect(adStudy.schemaVersion == 2)
        #expect(adStudy.id == "spinner-to-ad")
        #expect(v2.schemaVersion == 2)
        #expect(v2.id == "spinner-to-addy")
    }

    @Test func bundledSampleManifestsMatchTheirScenes() throws {
        for scene in LiquidBundledScene.allCases {
            let loaded = try LiquidScenes.loadScene(scene)
            let manifest = try LiquidScenes.loadSampleManifest(scene)
            #expect(manifest.sceneId == loaded.id)
            #expect(manifest.samples.isEmpty == false)
        }
    }

    @Test func bundledAssetsAndResourceManifestArePresent() throws {
        let assetManifest = try LiquidScenes.assetData(named: "manifest.json")
        let resourceManifest = try JSONDecoder().decode(ResourceManifest.self, from: LiquidScenes.resourceManifestData())

        #expect(assetManifest.count > 100)
        #expect(resourceManifest.resourceVersion == 1)
        #expect(resourceManifest.files.contains { $0.output == "scenes/capsule-to-a.v1.json" })
        #expect(resourceManifest.files.contains { $0.output == "scenes/spinner-to-ad.v2.json" })
        #expect(resourceManifest.files.contains { $0.output == "scenes/spinner-to-addy.v2.json" })
        #expect(resourceManifest.files.contains { $0.output == "samples/spinner-to-addy.samples.json" })
        #expect(try LiquidScenes.assetData(named: "addy-wordmark.svg").count > 100)
    }

    @Test func bundledSceneBytesMatchCanonicalSharedSources() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundled = try LiquidScenes.sceneData(.capsuleToA)
        let shared = try Data(contentsOf: root.appendingPathComponent("shared/scenes/capsule-to-a.v1.json"))
        #expect(bundled == shared)
    }
}

private struct ResourceManifest: Decodable {
    var resourceVersion: Int
    var files: [ResourceFile]
}

private struct ResourceFile: Decodable {
    var output: String
}

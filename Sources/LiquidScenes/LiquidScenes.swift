import Foundation
import LiquidCore

public enum LiquidSceneResourceError: Error, Equatable {
    case missingResource(String)
}

public enum LiquidBundledScene: String, CaseIterable, Sendable {
    case capsuleToA = "capsule-to-a"
    case spinnerToAd = "spinner-to-ad"
    case spinnerToAddy = "spinner-to-addy"
    case addyLogoWave = "addy-logo-wave"
    case addyLogoWaveWordmark = "addy-logo-wave-wordmark"
    case addyLogoWaveWordmarkReplay = "addy-logo-wave-wordmark-replay"

    public var sceneFileName: String {
        switch self {
        case .capsuleToA:
            return "capsule-to-a.v1.json"
        case .spinnerToAd:
            return "spinner-to-ad.v2.json"
        case .spinnerToAddy:
            return "spinner-to-addy.v2.json"
        case .addyLogoWave:
            return "addy-logo-wave.v2.json"
        case .addyLogoWaveWordmark:
            return "addy-logo-wave-wordmark.v2.json"
        case .addyLogoWaveWordmarkReplay:
            return "addy-logo-wave-wordmark-replay.v2.json"
        }
    }

    public var sampleManifestFileName: String {
        switch self {
        case .capsuleToA:
            return "capsule-to-a.samples.json"
        case .spinnerToAd:
            return "spinner-to-ad.samples.json"
        case .spinnerToAddy:
            return "spinner-to-addy.samples.json"
        case .addyLogoWave:
            return "addy-logo-wave.samples.json"
        case .addyLogoWaveWordmark:
            return "addy-logo-wave-wordmark.samples.json"
        case .addyLogoWaveWordmarkReplay:
            return "addy-logo-wave-wordmark-replay.samples.json"
        }
    }
}

public enum LiquidScenes {
    public static func sceneURL(_ scene: LiquidBundledScene) throws -> URL {
        try resourceURL(path: "scenes/\(scene.sceneFileName)")
    }

    public static func sceneData(_ scene: LiquidBundledScene) throws -> Data {
        try Data(contentsOf: sceneURL(scene))
    }

    public static func loadScene(_ scene: LiquidBundledScene) throws -> AnyLiquidScene {
        try LiquidLoader.loadAnyScene(from: sceneData(scene))
    }

    public static func sampleManifestURL(_ scene: LiquidBundledScene) throws -> URL {
        try resourceURL(path: "samples/\(scene.sampleManifestFileName)")
    }

    public static func sampleManifestData(_ scene: LiquidBundledScene) throws -> Data {
        try Data(contentsOf: sampleManifestURL(scene))
    }

    public static func loadSampleManifest(_ scene: LiquidBundledScene) throws -> LiquidSampleManifest {
        let anyScene = try loadScene(scene)
        return try LiquidLoader.loadSampleManifest(from: sampleManifestData(scene), sceneId: anyScene.id)
    }

    public static func assetURL(named fileName: String) throws -> URL {
        try resourceURL(path: "assets/\(fileName)")
    }

    public static func assetData(named fileName: String) throws -> Data {
        try Data(contentsOf: assetURL(named: fileName))
    }

    public static func resourceManifestURL() throws -> URL {
        try resourceURL(path: "resources.manifest.json")
    }

    public static func resourceManifestData() throws -> Data {
        try Data(contentsOf: resourceManifestURL())
    }

    private static func resourceURL(path relativePath: String) throws -> URL {
        guard let root = Bundle.module.resourceURL else {
            throw LiquidSceneResourceError.missingResource(relativePath)
        }
        let url = root.appendingPathComponent(relativePath)
        if FileManager.default.fileExists(atPath: url.path) {
            return url
        }
        let flattened = root.appendingPathComponent(URL(fileURLWithPath: relativePath).lastPathComponent)
        if FileManager.default.fileExists(atPath: flattened.path) {
            return flattened
        }
        throw LiquidSceneResourceError.missingResource(relativePath)
    }
}

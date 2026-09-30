import Foundation
import LiquidCore

public enum LiquidSceneResource {
    public static func loadScene(from url: URL) throws -> LiquidScene {
        try LiquidLoader.loadScene(from: url)
    }

    public static func loadSceneV2(from url: URL) throws -> LiquidSceneV2 {
        try LiquidLoader.loadSceneV2(from: url)
    }

    public static func loadAnyScene(from url: URL) throws -> AnyLiquidScene {
        try LiquidLoader.loadAnyScene(from: url)
    }

    public static func sharedSceneURL(
        named fileName: String,
        searchFrom root: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    ) -> URL {
        root.appendingPathComponent("shared/scenes", isDirectory: true).appendingPathComponent(fileName)
    }

    public static func loadSharedScene(
        named fileName: String,
        searchFrom root: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    ) throws -> LiquidScene {
        try loadScene(from: sharedSceneURL(named: fileName, searchFrom: root))
    }

    public static func loadSharedSceneV2(
        named fileName: String,
        searchFrom root: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    ) throws -> LiquidSceneV2 {
        try loadSceneV2(from: sharedSceneURL(named: fileName, searchFrom: root))
    }

    public static func loadAnySharedScene(
        named fileName: String,
        searchFrom root: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    ) throws -> AnyLiquidScene {
        try loadAnyScene(from: sharedSceneURL(named: fileName, searchFrom: root))
    }
}

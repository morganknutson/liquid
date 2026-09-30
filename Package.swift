// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Liquid",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "LiquidCore", targets: ["LiquidCore"]),
        .library(name: "LiquidMac", targets: ["LiquidMac"]),
        .library(name: "LiquidScenes", targets: ["LiquidScenes"]),
        .library(name: "AddyLogo", targets: ["AddyLogo"]),
        .executable(name: "LiquidLabMac", targets: ["LiquidLabMac"]),
        .executable(name: "LiquidFixtureDump", targets: ["LiquidFixtureDump"]),
        .executable(name: "LiquidExampleMac", targets: ["LiquidExampleMac"]),
        .executable(name: "LiquidBenchmark", targets: ["LiquidBenchmark"])
    ],
    targets: [
        .target(name: "LiquidCore"),
        .target(name: "LiquidMac", dependencies: ["LiquidCore"]),
        .target(name: "LiquidScenes", dependencies: ["LiquidCore"], resources: [.process("Resources")]),
        .target(name: "AddyLogo", dependencies: ["LiquidCore", "LiquidMac", "LiquidScenes"]),
        .executableTarget(name: "LiquidLabMac", dependencies: ["LiquidCore", "LiquidMac"]),
        .executableTarget(name: "LiquidFixtureDump", dependencies: ["LiquidCore"]),
        .executableTarget(name: "LiquidExampleMac", dependencies: ["LiquidCore", "LiquidMac"]),
        .executableTarget(name: "LiquidBenchmark", dependencies: ["LiquidCore", "LiquidMac", "LiquidScenes"]),
        .testTarget(name: "LiquidCoreTests", dependencies: ["LiquidCore"]),
        .testTarget(name: "LiquidMacTests", dependencies: ["LiquidCore", "LiquidMac"]),
        .testTarget(name: "LiquidScenesTests", dependencies: ["LiquidCore", "LiquidScenes"]),
        .testTarget(name: "AddyLogoTests", dependencies: ["AddyLogo", "LiquidCore", "LiquidMac"])
    ]
)

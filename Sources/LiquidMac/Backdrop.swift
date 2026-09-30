import LiquidCore

/// Rasterizes a v2 scene's static backdrop shapes into an 8-bit coverage mask and
/// caches it per scene and output size. Coverage uses the same signed-distance
/// ramp as track endpoints so every backend draws the backdrop identically.
final class LiquidBackdropMaskCache {
    private struct Key: Equatable {
        var sceneId: String
        var fixtureVersion: Int
        var fillRule: LiquidFillRule
        var coordinateSpace: LiquidSize
        var shapes: [[LiquidPathCommand]]
        var width: Int
        var height: Int
    }

    private var key: Key?
    private var pixels: [UInt8] = []

    func clear() {
        key = nil
        pixels.removeAll()
    }

    func mask(scene: LiquidSceneV2, width: Int, height: Int) -> [UInt8]? {
        guard let backdrop = scene.backdrop, backdrop.isEmpty == false, width > 0, height > 0 else { return nil }
        let nextKey = Key(
            sceneId: scene.id,
            fixtureVersion: scene.fixtureVersion,
            fillRule: scene.fillRule,
            coordinateSpace: scene.coordinateSpace,
            shapes: backdrop.map(\.transformedCommands),
            width: width,
            height: height
        )
        if key == nextKey { return pixels }

        let scale = min(Double(width) / scene.coordinateSpace.width, Double(height) / scene.coordinateSpace.height)
        let offsetX = (Double(width) - scene.coordinateSpace.width * scale) * 0.5
        let offsetY = (Double(height) - scene.coordinateSpace.height * scale) * 0.5
        let ramp = max(1 / max(scale, 0.000001), 0.000001)
        var output = Array(repeating: UInt8(0), count: width * height)
        for shape in nextKey.shapes {
            let distances = LiquidSDF.signedDistanceRaster(
                preparedPath: LiquidPreparedPath(commands: shape),
                fillRule: scene.fillRule,
                width: width,
                height: height,
                scale: scale,
                offsetX: offsetX,
                offsetY: offsetY
            )
            for index in output.indices {
                let alpha = UInt8((min(1, max(0, 0.5 - distances[index] / ramp)) * 255).rounded())
                output[index] = liquidSourceOver(bottom: output[index], top: alpha)
            }
        }
        key = nextKey
        pixels = output
        return output
    }
}

func liquidSourceOver(bottom: UInt8, top: UInt8) -> UInt8 {
    let bottomCoverage = Double(bottom) / 255
    let topCoverage = Double(top) / 255
    return UInt8(((topCoverage + bottomCoverage * (1 - topCoverage)) * 255).rounded())
}

func liquidComposite(backdrop: [UInt8]?, into pixels: inout [UInt8]) {
    guard let backdrop, backdrop.count == pixels.count else { return }
    for index in pixels.indices {
        pixels[index] = liquidSourceOver(bottom: pixels[index], top: backdrop[index])
    }
}

/// Coverage (0...1) of a v2 scene's clip shape per pixel, cached per scene and output size.
/// Tracks are multiplied by it before the backdrop is composited.
final class LiquidClipCoverageCache {
    private struct Key: Equatable {
        var sceneId: String
        var fixtureVersion: Int
        var fillRule: LiquidFillRule
        var coordinateSpace: LiquidSize
        var clip: [LiquidPathCommand]
        var width: Int
        var height: Int
    }

    private var key: Key?
    private var coverage: [Double] = []

    func clear() {
        key = nil
        coverage.removeAll()
    }

    func coverage(scene: LiquidSceneV2, width: Int, height: Int) -> [Double]? {
        guard let clip = scene.clip, width > 0, height > 0 else { return nil }
        let nextKey = Key(
            sceneId: scene.id,
            fixtureVersion: scene.fixtureVersion,
            fillRule: scene.fillRule,
            coordinateSpace: scene.coordinateSpace,
            clip: clip.transformedCommands,
            width: width,
            height: height
        )
        if key == nextKey { return coverage }
        let scale = min(Double(width) / scene.coordinateSpace.width, Double(height) / scene.coordinateSpace.height)
        let ramp = max(1 / max(scale, 0.000001), 0.000001)
        let distances = LiquidSDF.signedDistanceRaster(
            preparedPath: LiquidPreparedPath(commands: nextKey.clip),
            fillRule: scene.fillRule,
            width: width,
            height: height,
            scale: scale,
            offsetX: (Double(width) - scene.coordinateSpace.width * scale) * 0.5,
            offsetY: (Double(height) - scene.coordinateSpace.height * scale) * 0.5
        )
        key = nextKey
        coverage = distances.map { min(1, max(0, 0.5 - $0 / ramp)) }
        return coverage
    }
}

func liquidApplyClip(_ coverage: [Double]?, to pixels: inout [UInt8]) {
    guard let coverage, coverage.count == pixels.count else { return }
    for index in pixels.indices {
        pixels[index] = UInt8((Double(pixels[index]) * coverage[index]).rounded())
    }
}

import CoreGraphics
import Foundation
import LiquidCore

public struct LiquidDebugOptions: Equatable, Sendable {
    public var showsCenterlines: Bool
    public var showsRadii: Bool
    public var showsBounds: Bool
    public var showsThresholds: Bool

    public init(showsCenterlines: Bool = false, showsRadii: Bool = false, showsBounds: Bool = false, showsThresholds: Bool = false) {
        self.showsCenterlines = showsCenterlines
        self.showsRadii = showsRadii
        self.showsBounds = showsBounds
        self.showsThresholds = showsThresholds
    }
}

private extension LiquidDebugOptions {
    var isEnabled: Bool {
        showsCenterlines || showsRadii || showsBounds || showsThresholds
    }
}

public struct LiquidRenderOptions: Equatable, Sendable {
    public var width: Int
    public var height: Int
    public var fillRed: Double
    public var fillGreen: Double
    public var fillBlue: Double
    public var debug: LiquidDebugOptions

    public init(
        width: Int,
        height: Int,
        fillRed: Double = 0.92,
        fillGreen: Double = 0.95,
        fillBlue: Double = 1,
        debug: LiquidDebugOptions = LiquidDebugOptions()
    ) {
        self.width = width
        self.height = height
        self.fillRed = fillRed
        self.fillGreen = fillGreen
        self.fillBlue = fillBlue
        self.debug = debug
    }
}

public struct LiquidAlphaMask: Equatable, Sendable {
    public var width: Int
    public var height: Int
    public var pixels: [UInt8]

    public init(width: Int, height: Int, pixels: [UInt8]) {
        self.width = width
        self.height = height
        self.pixels = pixels
    }
}

public final class LiquidCGRenderer {
    private var alphaBuffer: [UInt8] = []
    private var trackAlphaBuffer: [UInt8] = []
    private var rgbaBuffer: [UInt8] = []
    private var sourceDistanceRaster: EndpointDistanceRaster?
    private var targetDistanceRaster: EndpointDistanceRaster?
    private var endpointDistanceRasters: [EndpointDistanceRaster] = []
    private let backdropMasks = LiquidBackdropMaskCache()
    private let clipCoverage = LiquidClipCoverageCache()

    public init() {}

    public func renderAlphaMask(scene: LiquidScene, frame evaluated: LiquidFrame, width: Int, height: Int) -> LiquidAlphaMask {
        let pixelCount = max(0, width * height)
        if alphaBuffer.count != pixelCount {
            alphaBuffer = Array(repeating: 0, count: pixelCount)
        } else {
            alphaBuffer.withUnsafeMutableBufferPointer { buffer in
                buffer.initialize(repeating: 0)
            }
        }

        guard width > 0, height > 0 else {
            return LiquidAlphaMask(width: width, height: height, pixels: alphaBuffer)
        }

        let mapping = ScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
        let ramp = mapping.sceneUnitsPerPixel

        switch evaluated.renderMode {
        case .sourcePath:
            let source = cachedSourceDistanceRaster(scene: scene, mapping: mapping)
            writeCoverageMask(distances: source.distances, ramp: ramp, width: width, height: height)
        case .targetPath:
            let target = cachedTargetDistanceRaster(scene: scene, mapping: mapping)
            writeCoverageMask(distances: target.distances, ramp: ramp, width: width, height: height)
        case .field:
            writeFieldMask(scene: scene, frame: evaluated.frame, mapping: mapping, ramp: ramp, width: width, height: height)
        case .crossfade:
            let source = evaluated.sourceOpacity > 0 ? cachedSourceDistanceRaster(scene: scene, mapping: mapping) : nil
            let target = evaluated.targetOpacity > 0 ? cachedTargetDistanceRaster(scene: scene, mapping: mapping) : nil
            for index in 0..<pixelCount {
                let sourceAlpha = source.map { coverage(distance: $0.distances[index], ramp: ramp) * evaluated.sourceOpacity } ?? 0
                let targetAlpha = target.map { coverage(distance: $0.distances[index], ramp: ramp) * evaluated.targetOpacity } ?? 0
                alphaBuffer[index] = UInt8(min(255, max(0, (sourceAlpha + targetAlpha) * 255)).rounded())
            }
        }

        return LiquidAlphaMask(width: width, height: height, pixels: alphaBuffer)
    }

    private func writeFieldMask(scene: LiquidScene, frame: LiquidPoseFrame, mapping: ScenePixelMapping, ramp: Double, width: Int, height: Int) {
        if frame.targetMix == 1 {
            let target = cachedTargetDistanceRaster(scene: scene, mapping: mapping)
            writeCoverageMask(distances: target.distances, ramp: ramp, width: width, height: height)
            return
        }

        let target = frame.targetMix > 0 ? cachedTargetDistanceRaster(scene: scene, mapping: mapping) : nil
        for y in 0..<height {
            for x in 0..<width {
                let index = y * width + x
                let point = mapping.scenePoint(pixelX: x, pixelY: y)
                let procedural = LiquidSDF.proceduralDistance(point: point, frame: frame)
                let distance: Double
                if let target {
                    distance = procedural * (1 - frame.targetMix) + target.distances[index] * frame.targetMix
                } else {
                    distance = procedural
                }
                alphaBuffer[index] = UInt8((coverage(distance: distance, ramp: ramp) * 255).rounded())
            }
        }
    }

    private func writeCoverageMask(distances: [Double], ramp: Double, width: Int, height: Int) {
        for index in 0..<(width * height) {
            alphaBuffer[index] = UInt8((coverage(distance: distances[index], ramp: ramp) * 255).rounded())
        }
    }

    private func cachedSourceDistanceRaster(scene: LiquidScene, mapping: ScenePixelMapping) -> EndpointDistanceRaster {
        let key = EndpointDistanceRasterKey(scene: scene, endpoint: scene.source, width: mapping.width, height: mapping.height)
        if let sourceDistanceRaster, sourceDistanceRaster.key == key {
            return sourceDistanceRaster
        }
        let raster = makeDistanceRaster(key: key, mapping: mapping)
        sourceDistanceRaster = raster
        return raster
    }

    private func cachedTargetDistanceRaster(scene: LiquidScene, mapping: ScenePixelMapping) -> EndpointDistanceRaster {
        let key = EndpointDistanceRasterKey(scene: scene, endpoint: scene.target, width: mapping.width, height: mapping.height)
        if let targetDistanceRaster, targetDistanceRaster.key == key {
            return targetDistanceRaster
        }
        let raster = makeDistanceRaster(key: key, mapping: mapping)
        targetDistanceRaster = raster
        return raster
    }

    private func makeDistanceRaster(key: EndpointDistanceRasterKey, mapping: ScenePixelMapping) -> EndpointDistanceRaster {
        let distances = LiquidSDF.signedDistanceRaster(
            preparedPath: LiquidPreparedPath(commands: key.transformedCommands),
            fillRule: key.fillRule,
            width: key.width,
            height: key.height,
            scale: mapping.scale,
            offsetX: mapping.offsetX,
            offsetY: mapping.offsetY
        )
        return EndpointDistanceRaster(key: key, distances: distances)
    }

    public func renderCGImage(scene: LiquidScene, frame evaluated: LiquidFrame, options: LiquidRenderOptions) -> CGImage? {
        let width = options.width
        let height = options.height
        guard width > 0, height > 0 else { return nil }
        let byteCount = width * height * 4
        if rgbaBuffer.count != byteCount {
            rgbaBuffer = Array(repeating: 0, count: byteCount)
        } else {
            rgbaBuffer.withUnsafeMutableBufferPointer { buffer in
                buffer.initialize(repeating: 0)
            }
        }

        if evaluated.renderMode == .sourcePath || evaluated.renderMode == .targetPath {
            return renderVectorEndpoint(scene: scene, frame: evaluated, options: options)
        }

        let mask = renderAlphaMask(scene: scene, frame: evaluated, width: width, height: height)
        for index in 0..<(width * height) {
            let base = index * 4
            rgbaBuffer[base] = UInt8(max(0, min(255, options.fillRed * 255)).rounded())
            rgbaBuffer[base + 1] = UInt8(max(0, min(255, options.fillGreen * 255)).rounded())
            rgbaBuffer[base + 2] = UInt8(max(0, min(255, options.fillBlue * 255)).rounded())
            rgbaBuffer[base + 3] = mask.pixels[index]
        }

        guard options.debug.isEnabled else {
            return makeImage(width: width, height: height)
        }
        return makeImage(width: width, height: height) { context in
            let mapping = ScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
            drawDebugOverlays(in: context, scene: scene, frame: evaluated, mapping: mapping, options: options)
        }
    }

    public func renderAlphaMask(scene: LiquidSceneV2, frame evaluated: LiquidFrameV2, width: Int, height: Int) -> LiquidAlphaMask {
        let pixelCount = max(0, width * height)
        if alphaBuffer.count != pixelCount {
            alphaBuffer = Array(repeating: 0, count: pixelCount)
        } else {
            alphaBuffer.withUnsafeMutableBufferPointer { buffer in
                buffer.initialize(repeating: 0)
            }
        }
        if trackAlphaBuffer.count != pixelCount {
            trackAlphaBuffer = Array(repeating: 0, count: pixelCount)
        }

        guard width > 0, height > 0 else {
            return LiquidAlphaMask(width: width, height: height, pixels: alphaBuffer)
        }

        let mapping = ScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
        let ramp = mapping.sceneUnitsPerPixel
        for track in evaluated.tracks {
            writeTrackMask(scene: scene, track: track, mapping: mapping, ramp: ramp, width: width, height: height)
            for index in 0..<pixelCount {
                let existing = Double(alphaBuffer[index]) / 255
                let next = Double(trackAlphaBuffer[index]) / 255
                alphaBuffer[index] = UInt8((min(1, existing + next * (1 - existing)) * 255).rounded())
            }
        }
        liquidApplyClip(clipCoverage.coverage(scene: scene, width: width, height: height), to: &alphaBuffer)
        liquidComposite(backdrop: backdropMasks.mask(scene: scene, width: width, height: height), into: &alphaBuffer)
        return LiquidAlphaMask(width: width, height: height, pixels: alphaBuffer)
    }

    public func renderCGImage(scene: LiquidSceneV2, frame evaluated: LiquidFrameV2, options: LiquidRenderOptions) -> CGImage? {
        let width = options.width
        let height = options.height
        guard width > 0, height > 0 else { return nil }
        let byteCount = width * height * 4
        if rgbaBuffer.count != byteCount {
            rgbaBuffer = Array(repeating: 0, count: byteCount)
        } else {
            rgbaBuffer.withUnsafeMutableBufferPointer { buffer in
                buffer.initialize(repeating: 0)
            }
        }

        let mask = renderAlphaMask(scene: scene, frame: evaluated, width: width, height: height)
        for index in 0..<(width * height) {
            let base = index * 4
            rgbaBuffer[base] = UInt8(max(0, min(255, options.fillRed * 255)).rounded())
            rgbaBuffer[base + 1] = UInt8(max(0, min(255, options.fillGreen * 255)).rounded())
            rgbaBuffer[base + 2] = UInt8(max(0, min(255, options.fillBlue * 255)).rounded())
            rgbaBuffer[base + 3] = mask.pixels[index]
        }

        guard options.debug.isEnabled else {
            return makeImage(width: width, height: height)
        }
        return makeImage(width: width, height: height) { context in
            let mapping = ScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
            drawDebugOverlays(in: context, scene: scene, frame: evaluated, mapping: mapping, options: options)
        }
    }

    public func renderAlphaMask(scene: AnyLiquidScene, frame evaluated: AnyLiquidFrame, width: Int, height: Int) -> LiquidAlphaMask {
        switch (scene, evaluated) {
        case let (.v1(scene), .v1(frame)):
            return renderAlphaMask(scene: scene, frame: frame, width: width, height: height)
        case let (.v2(scene), .v2(frame)):
            return renderAlphaMask(scene: scene, frame: frame, width: width, height: height)
        default:
            return LiquidAlphaMask(width: width, height: height, pixels: Array(repeating: 0, count: max(0, width * height)))
        }
    }

    public func renderCGImage(scene: AnyLiquidScene, frame evaluated: AnyLiquidFrame, options: LiquidRenderOptions) -> CGImage? {
        switch (scene, evaluated) {
        case let (.v1(scene), .v1(frame)):
            return renderCGImage(scene: scene, frame: frame, options: options)
        case let (.v2(scene), .v2(frame)):
            return renderCGImage(scene: scene, frame: frame, options: options)
        default:
            return nil
        }
    }

    public func makeCGPath(commands: [LiquidPathCommand], applying transform: LiquidTransform? = nil) -> CGPath {
        let path = CGMutablePath()
        let pathCommands: [LiquidPathCommand]
        if let transform {
            pathCommands = commands.map { $0.transformed(by: transform) }
        } else {
            pathCommands = commands
        }
        for command in pathCommands {
            switch command {
            case let .move(x, y):
                path.move(to: CGPoint(x: x, y: y))
            case let .line(x, y):
                path.addLine(to: CGPoint(x: x, y: y))
            case let .cubic(x1, y1, x2, y2, x, y):
                path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
            case .close:
                path.closeSubpath()
            }
        }
        return path
    }

    public func transformedEndpointCommands(_ endpoint: LiquidEndpoint) -> [LiquidPathCommand] {
        endpoint.transformedCommands
    }

    private func renderVectorEndpoint(scene: LiquidScene, frame evaluated: LiquidFrame, options: LiquidRenderOptions) -> CGImage? {
        let width = options.width
        let height = options.height
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return rgbaBuffer.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else {
                return nil
            }

            let mapping = ScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
            let endpoint = evaluated.renderMode == .sourcePath ? scene.source : scene.target
            let path = makeCGPath(commands: endpoint.commands, applying: endpoint.transform)
            context.saveGState()
            context.translateBy(x: mapping.offsetX, y: mapping.offsetY)
            context.scaleBy(x: mapping.scale, y: mapping.scale)
            context.addPath(path)
            context.setFillColor(red: options.fillRed, green: options.fillGreen, blue: options.fillBlue, alpha: 1)
            context.drawPath(using: scene.fillRule == .evenodd ? .eoFill : .fill)
            context.restoreGState()
            if options.debug.isEnabled {
                drawDebugOverlays(in: context, scene: scene, frame: evaluated, mapping: mapping, options: options)
            }
            return context.makeImage()
        }
    }

    private func makeImage(width: Int, height: Int, draw: (CGContext) -> Void = { _ in }) -> CGImage? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return rgbaBuffer.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else {
                return nil
            }
            draw(context)
            return context.makeImage()
        }
    }

    private func drawDebugOverlays(
        in context: CGContext,
        scene: LiquidScene,
        frame evaluated: LiquidFrame,
        mapping: ScenePixelMapping,
        options: LiquidRenderOptions
    ) {
        let debug = options.debug
        guard debug.isEnabled else { return }

        context.saveGState()
        context.translateBy(x: mapping.offsetX, y: mapping.offsetY)
        context.scaleBy(x: mapping.scale, y: mapping.scale)
        context.setShouldAntialias(true)
        context.setLineCap(.round)
        context.setLineJoin(.round)

        let pixel = mapping.sceneUnitsPerPixel
        if debug.showsBounds {
            drawBoundsOverlay(in: context, scene: scene, pixel: pixel)
        }
        if debug.showsCenterlines {
            drawCenterlineOverlay(in: context, frame: evaluated.frame, pixel: pixel)
        }
        if debug.showsRadii {
            drawRadiusOverlay(in: context, frame: evaluated.frame, pixel: pixel)
        }
        if debug.showsThresholds {
            drawThresholdOverlay(in: context, scene: scene, progress: evaluated.progress, pixel: pixel)
        }

        context.restoreGState()
    }

    private func writeTrackMask(scene: LiquidSceneV2, track: LiquidTrackFrame, mapping: ScenePixelMapping, ramp: Double, width: Int, height: Int) {
        trackAlphaBuffer.withUnsafeMutableBufferPointer { buffer in
            buffer.initialize(repeating: 0)
        }
        let placement = LiquidSDF.trackPlacement(track: track)
        // Placed tracks read their rasters where each visible pixel came from in the
        // track's own space; their distances scale back up by the placement.
        func distance(_ raster: EndpointDistanceRaster, index: Int, x: Int, y: Int) -> Double {
            guard let placement else { return raster.distances[index] }
            let point = placement.unplace(mapping.scenePoint(pixelX: x, pixelY: y))
            return mapping.sampleBilinear(raster.distances, at: point) * placement.scale
        }
        switch track.renderMode {
        case .sourcePath, .targetPath:
            let isSource = track.renderMode == .sourcePath
            let raster = cachedEndpointDistanceRaster(scene: scene, trackId: track.id, endpointRole: isSource ? "source" : "target", endpoint: isSource ? track.source : track.target, mapping: mapping)
            for y in 0..<height {
                for x in 0..<width {
                    let index = y * width + x
                    trackAlphaBuffer[index] = UInt8((coverage(distance: distance(raster, index: index, x: x, y: y), ramp: ramp) * 255).rounded())
                }
            }
        case .field:
            writeTrackFieldMask(scene: scene, track: track, placement: placement, mapping: mapping, ramp: ramp, width: width, height: height)
        case .crossfade:
            let source = track.sourceOpacity > 0 ? cachedEndpointDistanceRaster(scene: scene, trackId: track.id, endpointRole: "source", endpoint: track.source, mapping: mapping) : nil
            let target = track.targetOpacity > 0 ? cachedEndpointDistanceRaster(scene: scene, trackId: track.id, endpointRole: "target", endpoint: track.target, mapping: mapping) : nil
            for y in 0..<height {
                for x in 0..<width {
                    let index = y * width + x
                    let sourceAlpha = source.map { coverage(distance: distance($0, index: index, x: x, y: y), ramp: ramp) * track.sourceOpacity } ?? 0
                    let targetAlpha = target.map { coverage(distance: distance($0, index: index, x: x, y: y), ramp: ramp) * track.targetOpacity } ?? 0
                    trackAlphaBuffer[index] = UInt8(min(255, max(0, (sourceAlpha + targetAlpha) * 255)).rounded())
                }
            }
        }
    }

    private func writeTrackFieldMask(scene: LiquidSceneV2, track: LiquidTrackFrame, placement: LiquidTrackPlacement?, mapping: ScenePixelMapping, ramp: Double, width: Int, height: Int) {
        let preparedTrack = LiquidSDF.prepareTrackField(track: track)
        let targetMix = preparedTrack.targetMix
        let opacity = preparedTrack.fieldOpacity
        let distanceScale = placement?.scale ?? 1
        let target = targetMix > 0 ? cachedEndpointDistanceRaster(scene: scene, trackId: track.id, endpointRole: "target", endpoint: track.target, mapping: mapping) : nil
        for y in 0..<height {
            for x in 0..<width {
                let index = y * width + x
                let scenePoint = mapping.scenePoint(pixelX: x, pixelY: y)
                let point = placement?.unplace(scenePoint) ?? scenePoint
                let targetDistance = target.map { placement == nil ? $0.distances[index] : mapping.sampleBilinear($0.distances, at: point) }
                let distance: Double
                if let targetDistance, targetMix == 1 {
                    distance = targetDistance
                } else if let targetDistance {
                    distance = LiquidSDF.preparedTrackFieldDistance(point: point, track: preparedTrack) * (1 - targetMix) + targetDistance * targetMix
                } else {
                    distance = LiquidSDF.preparedTrackFieldDistance(point: point, track: preparedTrack)
                }
                trackAlphaBuffer[index] = UInt8((coverage(distance: distance * distanceScale, ramp: ramp) * 255 * opacity).rounded())
            }
        }
    }

    private func writeCoverageMask(distances: [Double], ramp: Double, width: Int, height: Int, into buffer: inout [UInt8]) {
        for index in 0..<(width * height) {
            buffer[index] = UInt8((coverage(distance: distances[index], ramp: ramp) * 255).rounded())
        }
    }

    private func cachedEndpointDistanceRaster(
        scene: LiquidSceneV2,
        trackId: String,
        endpointRole: String,
        endpoint: LiquidEndpoint,
        mapping: ScenePixelMapping
    ) -> EndpointDistanceRaster {
        let key = EndpointDistanceRasterKey(scene: scene, trackId: trackId, endpointRole: endpointRole, endpoint: endpoint, width: mapping.width, height: mapping.height)
        if let raster = endpointDistanceRasters.first(where: { $0.key == key }) {
            return raster
        }
        let raster = makeDistanceRaster(key: key, mapping: mapping)
        endpointDistanceRasters.append(raster)
        if endpointDistanceRasters.count > 32 {
            endpointDistanceRasters.removeFirst(endpointDistanceRasters.count - 32)
        }
        return raster
    }

    private func drawDebugOverlays(
        in context: CGContext,
        scene: LiquidSceneV2,
        frame evaluated: LiquidFrameV2,
        mapping: ScenePixelMapping,
        options: LiquidRenderOptions
    ) {
        let debug = options.debug
        guard debug.isEnabled else { return }

        context.saveGState()
        context.translateBy(x: mapping.offsetX, y: mapping.offsetY)
        context.scaleBy(x: mapping.scale, y: mapping.scale)
        context.setShouldAntialias(true)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        let pixel = mapping.sceneUnitsPerPixel
        if debug.showsBounds {
            context.setStrokeColor(red: 0.1, green: 0.95, blue: 0.55, alpha: 0.9)
            context.setLineWidth(max(pixel * 1.5, 0.000001))
            context.stroke(CGRect(x: 0, y: 0, width: scene.coordinateSpace.width, height: scene.coordinateSpace.height))
        }
        if debug.showsCenterlines {
            context.setStrokeColor(red: 1, green: 0.18, blue: 0.22, alpha: 0.9)
            context.setLineWidth(max(pixel * 1.5, 0.000001))
            for track in evaluated.tracks {
                for component in track.components {
                    drawComponentCenterline(in: context, component: component)
                }
            }
        }
        if debug.showsRadii {
            context.setStrokeColor(red: 0.05, green: 0.72, blue: 1, alpha: 0.85)
            context.setLineWidth(max(pixel, 0.000001))
            for track in evaluated.tracks {
                for component in track.components {
                    drawComponentRadii(in: context, component: component)
                }
            }
        }
        context.restoreGState()
    }

    private func drawComponentCenterline(in context: CGContext, component: LiquidComponentFrame) {
        switch component.primitive {
        case let .capsule(capsule):
            context.move(to: CGPoint(x: capsule.start.x, y: capsule.start.y))
            context.addLine(to: CGPoint(x: capsule.end.x, y: capsule.end.y))
            context.strokePath()
        case let .ribbon(ribbon):
            context.move(to: CGPoint(x: ribbon.p0.x, y: ribbon.p0.y))
            context.addCurve(to: CGPoint(x: ribbon.p3.x, y: ribbon.p3.y), control1: CGPoint(x: ribbon.p1.x, y: ribbon.p1.y), control2: CGPoint(x: ribbon.p2.x, y: ribbon.p2.y))
            context.strokePath()
        case let .ellipse(ellipse):
            context.strokeEllipse(in: CGRect(x: ellipse.center.x - ellipse.radiusX, y: ellipse.center.y - ellipse.radiusY, width: ellipse.radiusX * 2, height: ellipse.radiusY * 2))
        }
    }

    private func drawComponentRadii(in context: CGContext, component: LiquidComponentFrame) {
        switch component.primitive {
        case let .capsule(capsule) where capsule.radius > 0:
            strokeRadiusCircle(in: context, center: capsule.start, radius: capsule.radius)
            strokeRadiusCircle(in: context, center: capsule.end, radius: capsule.radius)
        case let .ribbon(ribbon):
            strokeRadiusCircle(in: context, center: ribbon.p0, radius: ribbon.startRadius)
            strokeRadiusCircle(in: context, center: ribbon.p3, radius: ribbon.endRadius)
        case let .ellipse(ellipse):
            context.strokeEllipse(in: CGRect(x: ellipse.center.x - ellipse.radiusX, y: ellipse.center.y - ellipse.radiusY, width: ellipse.radiusX * 2, height: ellipse.radiusY * 2))
        default:
            break
        }
    }

    private func drawBoundsOverlay(in context: CGContext, scene: LiquidScene, pixel: Double) {
        context.setStrokeColor(red: 0.1, green: 0.95, blue: 0.55, alpha: 0.9)
        context.setLineWidth(max(pixel * 1.5, 0.000001))
        context.stroke(CGRect(x: 0, y: 0, width: scene.coordinateSpace.width, height: scene.coordinateSpace.height))
    }

    private func drawCenterlineOverlay(in context: CGContext, frame: LiquidPoseFrame, pixel: Double) {
        context.setStrokeColor(red: 1, green: 0.18, blue: 0.22, alpha: 0.9)
        context.setLineWidth(max(pixel * 1.5, 0.000001))
        for capsule in debugCapsules(in: frame) {
            context.move(to: CGPoint(x: capsule.start.x, y: capsule.start.y))
            context.addLine(to: CGPoint(x: capsule.end.x, y: capsule.end.y))
            context.strokePath()
        }

        let anchorRadius = max(pixel * 3, 0.000001)
        context.setFillColor(red: 1, green: 0.18, blue: 0.22, alpha: 0.95)
        context.fillEllipse(in: CGRect(
            x: frame.anchor.x - anchorRadius,
            y: frame.anchor.y - anchorRadius,
            width: anchorRadius * 2,
            height: anchorRadius * 2
        ))
    }

    private func drawRadiusOverlay(in context: CGContext, frame: LiquidPoseFrame, pixel: Double) {
        context.setStrokeColor(red: 0.05, green: 0.72, blue: 1, alpha: 0.85)
        context.setLineWidth(max(pixel, 0.000001))
        for capsule in debugCapsules(in: frame) where capsule.radius > 0 {
            strokeRadiusCircle(in: context, center: capsule.start, radius: capsule.radius)
            strokeRadiusCircle(in: context, center: capsule.end, radius: capsule.radius)
        }
    }

    private func drawThresholdOverlay(in context: CGContext, scene: LiquidScene, progress: Double, pixel: Double) {
        let margin = max(pixel * 8, min(scene.coordinateSpace.width, scene.coordinateSpace.height) * 0.025)
        let trackWidth = max(0, scene.coordinateSpace.width - margin * 2)
        let trackHeight = max(pixel * 4, min(scene.coordinateSpace.height * 0.018, pixel * 8))
        let trackY = max(0, scene.coordinateSpace.height - margin - trackHeight)
        let track = CGRect(x: margin, y: trackY, width: trackWidth, height: trackHeight)

        context.setFillColor(red: 0, green: 0, blue: 0, alpha: 0.35)
        context.fill(track)
        context.setFillColor(red: 1, green: 0.84, blue: 0.08, alpha: 0.85)
        context.fill(CGRect(x: track.minX, y: track.minY, width: track.width * min(1, max(0, progress)), height: track.height))

        context.setStrokeColor(red: 1, green: 1, blue: 1, alpha: 0.9)
        context.setLineWidth(max(pixel, 0.000001))
        for threshold in scene.thresholds {
            let x = track.minX + track.width * min(1, max(0, threshold.at))
            context.move(to: CGPoint(x: x, y: track.minY - pixel * 2))
            context.addLine(to: CGPoint(x: x, y: track.maxY + pixel * 2))
            context.strokePath()
        }

        let progressX = track.minX + track.width * min(1, max(0, progress))
        context.setStrokeColor(red: 1, green: 0.2, blue: 0.2, alpha: 0.95)
        context.setLineWidth(max(pixel * 2, 0.000001))
        context.move(to: CGPoint(x: progressX, y: track.minY - pixel * 3))
        context.addLine(to: CGPoint(x: progressX, y: track.maxY + pixel * 3))
        context.strokePath()
    }

    private func debugCapsules(in frame: LiquidPoseFrame) -> [LiquidCapsule] {
        [frame.leftLeg, frame.rightLeg, frame.crossbar, frame.bridge]
    }

    private func strokeRadiusCircle(in context: CGContext, center: LiquidPoint, radius: Double) {
        context.strokeEllipse(in: CGRect(
            x: center.x - radius,
            y: center.y - radius,
            width: radius * 2,
            height: radius * 2
        ))
    }

    private func coverage(distance: Double, ramp: Double) -> Double {
        let half = max(ramp, 0.000001)
        return min(1, max(0, 0.5 - distance / half))
    }
}

private struct ScenePixelMapping {
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

    /// Bilinearly samples a per-pixel raster at an arbitrary scene point. Mirrors
    /// `sampleRasterAtScenePoint` in packages/liquid-web/src/renderer.ts.
    func sampleBilinear(_ values: [Double], at point: LiquidPoint) -> Double {
        let fx = min(Double(width - 1), max(0, point.x * scale + offsetX - 0.5))
        let fy = min(Double(height - 1), max(0, point.y * scale + offsetY - 0.5))
        let x0 = Int(fx.rounded(.down))
        let y0 = Int(fy.rounded(.down))
        let x1 = min(width - 1, x0 + 1)
        let y1 = min(height - 1, y0 + 1)
        let tx = fx - Double(x0)
        let ty = fy - Double(y0)
        let top = values[y0 * width + x0] + (values[y0 * width + x1] - values[y0 * width + x0]) * tx
        let bottom = values[y1 * width + x0] + (values[y1 * width + x1] - values[y1 * width + x0]) * tx
        return top + (bottom - top) * ty
    }
}

private struct EndpointDistanceRasterKey: Equatable {
    var sceneId: String
    var fixtureVersion: Int
    var fillRule: LiquidFillRule
    var coordinateSpace: LiquidSize
    var trackId: String?
    var endpointRole: String?
    var width: Int
    var height: Int
    var transformedCommands: [LiquidPathCommand]

    init(scene: LiquidScene, endpoint: LiquidEndpoint, width: Int, height: Int) {
        self.sceneId = scene.id
        self.fixtureVersion = scene.fixtureVersion
        self.fillRule = scene.fillRule
        self.coordinateSpace = scene.coordinateSpace
        self.trackId = nil
        self.endpointRole = nil
        self.width = width
        self.height = height
        self.transformedCommands = endpoint.transformedCommands
    }

    init(scene: LiquidSceneV2, trackId: String, endpointRole: String, endpoint: LiquidEndpoint, width: Int, height: Int) {
        self.sceneId = scene.id
        self.fixtureVersion = scene.fixtureVersion
        self.fillRule = scene.fillRule
        self.coordinateSpace = scene.coordinateSpace
        self.trackId = trackId
        self.endpointRole = endpointRole
        self.width = width
        self.height = height
        self.transformedCommands = endpoint.transformedCommands
    }
}

private struct EndpointDistanceRaster {
    var key: EndpointDistanceRasterKey
    var distances: [Double]
}

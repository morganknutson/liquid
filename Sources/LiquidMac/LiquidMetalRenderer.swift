import CoreGraphics
import Foundation
import LiquidCore
import Metal

public enum LiquidRendererBackend: String, CaseIterable, Equatable, Sendable {
    case auto
    case coreGraphics
    case metal
}

public enum LiquidResolvedRendererBackend: String, Equatable, Sendable {
    case coreGraphics
    case metal
}

public struct LiquidMetalCapabilities: Equatable, Sendable {
    public var isSupported: Bool
    public var deviceName: String?
    public var maxTracks: Int
    public var maxComponentsPerTrack: Int
    public var maxRibbonSegments: Int
    public var reason: String?

    public init(
        isSupported: Bool,
        deviceName: String?,
        maxTracks: Int = LiquidMetalRenderer.maxTracks,
        maxComponentsPerTrack: Int = LiquidMetalRenderer.maxComponentsPerTrack,
        maxRibbonSegments: Int = LiquidMetalRenderer.maxRibbonSegments,
        reason: String? = nil
    ) {
        self.isSupported = isSupported
        self.deviceName = deviceName
        self.maxTracks = maxTracks
        self.maxComponentsPerTrack = maxComponentsPerTrack
        self.maxRibbonSegments = maxRibbonSegments
        self.reason = reason
    }
}

public final class LiquidMetalRenderer {
    public static let maxTracks = 8
    public static let maxComponentsPerTrack = 16
    public static let maxRibbonSegments = 4096

    public let device: MTLDevice
    public let capabilities: LiquidMetalCapabilities

    private let commandQueue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let rasterStore = MetalRasterStore()
    private let backdropMasks = LiquidBackdropMaskCache()
    private let clipCoverage = LiquidClipCoverageCache()
    private var outputTexture: MTLTexture?
    private var rgbaBuffer: [UInt8] = []

    public static func systemCapabilities() -> LiquidMetalCapabilities {
        guard let device = MTLCreateSystemDefaultDevice() else {
            return LiquidMetalCapabilities(isSupported: false, deviceName: nil, reason: "No system Metal device is available.")
        }
        do {
            _ = try LiquidMetalRenderer(device: device)
            return LiquidMetalCapabilities(isSupported: true, deviceName: device.name)
        } catch {
            return LiquidMetalCapabilities(isSupported: false, deviceName: device.name, reason: String(describing: error))
        }
    }

    public convenience init?() {
        guard let device = MTLCreateSystemDefaultDevice() else { return nil }
        try? self.init(device: device)
    }

    public init(device: MTLDevice) throws {
        self.device = device
        guard let commandQueue = device.makeCommandQueue() else {
            throw LiquidMetalRendererError.commandQueueUnavailable
        }
        let library = try device.makeLibrary(source: LiquidMetalRenderer.shaderSource, options: nil)
        guard let vertex = library.makeFunction(name: "liquidVertex"),
              let fragment = library.makeFunction(name: "liquidFragment") else {
            throw LiquidMetalRendererError.shaderFunctionUnavailable
        }

        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = .r8Unorm
        self.pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        self.commandQueue = commandQueue
        self.capabilities = LiquidMetalCapabilities(isSupported: true, deviceName: device.name)
    }

    deinit {
        clearCaches()
    }

    public func clearCaches() {
        rasterStore.removeAll()
        backdropMasks.clear()
        clipCoverage.clear()
        outputTexture = nil
        rgbaBuffer.removeAll(keepingCapacity: true)
    }

    public func canRender(scene: LiquidSceneV2, frame: LiquidFrameV2, width: Int, height: Int) -> Bool {
        guard width > 0, height > 0 else { return false }
        guard frame.tracks.count <= Self.maxTracks else { return false }
        var ribbonSegments = 0
        for track in frame.tracks {
            guard track.components.count <= Self.maxComponentsPerTrack else { return false }
            for component in track.components {
                if case .ribbon = component.primitive {
                    ribbonSegments += LiquidSDF.ribbonSubdivisions
                }
            }
        }
        guard ribbonSegments <= Self.maxRibbonSegments else { return false }
        _ = scene
        return true
    }

    public func renderAlphaMask(scene: LiquidSceneV2, frame: LiquidFrameV2, width: Int, height: Int) -> LiquidAlphaMask? {
        guard canRender(scene: scene, frame: frame, width: width, height: height) else { return nil }

        let mapping = MetalScenePixelMapping(sceneSize: scene.coordinateSpace, width: width, height: height)
        let prepared = makeRenderBuffers(scene: scene, frame: frame, mapping: mapping)
        guard let uniformBuffer = makeBuffer(prepared.uniforms),
              let trackBuffer = makeBuffer(prepared.tracks),
              let componentBuffer = makeBuffer(prepared.components),
              let segmentBuffer = makeBuffer(prepared.segments),
              let endpointBuffer = makeBuffer(prepared.endpointDistances),
              let commandBuffer = commandQueue.makeCommandBuffer() else {
            return nil
        }

        let texture = reusableOutputTexture(width: width, height: height)
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return nil }
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBuffer(uniformBuffer, offset: 0, index: 0)
        encoder.setFragmentBuffer(trackBuffer, offset: 0, index: 1)
        encoder.setFragmentBuffer(componentBuffer, offset: 0, index: 2)
        encoder.setFragmentBuffer(segmentBuffer, offset: 0, index: 3)
        encoder.setFragmentBuffer(endpointBuffer, offset: 0, index: 4)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        guard commandBuffer.status == .completed else { return nil }

        var pixels = Array(repeating: UInt8(0), count: width * height)
        texture.getBytes(&pixels, bytesPerRow: width, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        liquidApplyClip(clipCoverage.coverage(scene: scene, width: width, height: height), to: &pixels)
        liquidComposite(backdrop: backdropMasks.mask(scene: scene, width: width, height: height), into: &pixels)
        warmTargetRasters(scene: scene, frame: frame, mapping: mapping)
        return LiquidAlphaMask(width: width, height: height, pixels: pixels)
    }

    public func renderCGImage(scene: LiquidSceneV2, frame: LiquidFrameV2, options: LiquidRenderOptions) -> CGImage? {
        guard options.debug.isEnabled == false,
              let mask = renderAlphaMask(scene: scene, frame: frame, width: options.width, height: options.height) else {
            return nil
        }
        let byteCount = options.width * options.height * 4
        if rgbaBuffer.count != byteCount {
            rgbaBuffer = Array(repeating: 0, count: byteCount)
        }

        let red = UInt8(max(0, min(255, options.fillRed * 255)).rounded())
        let green = UInt8(max(0, min(255, options.fillGreen * 255)).rounded())
        let blue = UInt8(max(0, min(255, options.fillBlue * 255)).rounded())
        for index in 0..<(options.width * options.height) {
            let base = index * 4
            rgbaBuffer[base] = red
            rgbaBuffer[base + 1] = green
            rgbaBuffer[base + 2] = blue
            rgbaBuffer[base + 3] = mask.pixels[index]
        }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return rgbaBuffer.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: options.width,
                height: options.height,
                bitsPerComponent: 8,
                bytesPerRow: options.width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else {
                return nil
            }
            return context.makeImage()
        }
    }

    private func makeRenderBuffers(scene: LiquidSceneV2, frame: LiquidFrameV2, mapping: MetalScenePixelMapping) -> MetalRenderBuffers {
        var tracks: [MetalTrackUniform] = []
        var components: [MetalComponentUniform] = []
        var segments: [MetalRibbonSegmentUniform] = []
        var endpointDistances: [Float] = []
        let endpointStride = mapping.width * mapping.height
        var farOffset: Int?

        // Only rasters this frame samples are built and uploaded; every other slot
        // points at one shared block of far distances.
        func endpointOffset(track: LiquidTrackFrame, role: String, endpoint: LiquidEndpoint, targetMix: Double) -> Int {
            if metalEndpointNeeded(track: track, role: role, targetMix: targetMix) {
                let offset = endpointDistances.count
                endpointDistances.append(contentsOf: cachedEndpointDistanceRaster(scene: scene, trackId: track.id, endpointRole: role, endpoint: endpoint, mapping: mapping).distances)
                return offset
            }
            if let farOffset { return farOffset }
            let offset = endpointDistances.count
            endpointDistances.append(contentsOf: repeatElement(metalFarDistance, count: endpointStride))
            farOffset = offset
            return offset
        }

        for track in frame.tracks {
            let componentStart = components.count
            let preparedTrack = LiquidSDF.prepareTrackField(track: track)
            let placement = LiquidSDF.trackPlacement(track: track)
            let sourceOffset = endpointOffset(track: track, role: "source", endpoint: track.source, targetMix: preparedTrack.targetMix)
            let targetOffset = endpointOffset(track: track, role: "target", endpoint: track.target, targetMix: preparedTrack.targetMix)
            for component in preparedTrack.components {
                components.append(metalComponent(component, segmentStart: segments.count))
                if case let .ribbon(ribbon) = component.primitive {
                    segments.append(contentsOf: ribbon.segments.map(MetalRibbonSegmentUniform.init(segment:)))
                }
            }

            tracks.append(MetalTrackUniform(
                componentStart: UInt32(componentStart),
                componentCount: UInt32(preparedTrack.components.count),
                renderMode: UInt32(metalRenderMode(track.renderMode)),
                sourceOffset: UInt32(sourceOffset),
                targetOffset: UInt32(targetOffset),
                sourceOpacity: Float(track.sourceOpacity),
                targetOpacity: Float(track.targetOpacity),
                targetMix: Float(preparedTrack.targetMix),
                fieldOpacity: Float(preparedTrack.fieldOpacity),
                placed: placement == nil ? 0 : 1,
                offsetX: Float(placement?.offsetX ?? 0),
                offsetY: Float(placement?.offsetY ?? 0),
                placementScale: Float(placement?.scale ?? 1),
                originX: Float(placement?.originX ?? 0),
                originY: Float(placement?.originY ?? 0)
            ))
        }

        let uniforms = MetalUniforms(
            width: UInt32(mapping.width),
            height: UInt32(mapping.height),
            trackCount: UInt32(tracks.count),
            endpointStride: UInt32(endpointStride),
            scale: Float(mapping.scale),
            offsetX: Float(mapping.offsetX),
            offsetY: Float(mapping.offsetY),
            sceneUnitsPerPixel: Float(mapping.sceneUnitsPerPixel)
        )
        return MetalRenderBuffers(uniforms: [uniforms], tracks: tracks, components: components, segments: segments, endpointDistances: endpointDistances)
    }

    private func metalComponent(_ component: LiquidPreparedTrackComponent, segmentStart: Int) -> MetalComponentUniform {
        switch component.primitive {
        case let .capsule(capsule):
            return MetalComponentUniform(
                primitiveKind: 0,
                operation: component.operation == .subtract ? 1 : 0,
                blendRadius: Float(component.blendRadius),
                segmentStart: UInt32(segmentStart),
                segmentCount: 0,
                data0: Float(capsule.start.x),
                data1: Float(capsule.start.y),
                data2: Float(capsule.end.x),
                data3: Float(capsule.end.y),
                data4: Float(capsule.radius),
                data5: 0,
                data6: 0,
                data7: 0
            )
        case let .ellipse(ellipse):
            return MetalComponentUniform(
                primitiveKind: 2,
                operation: component.operation == .subtract ? 1 : 0,
                blendRadius: Float(component.blendRadius),
                segmentStart: UInt32(segmentStart),
                segmentCount: 0,
                data0: Float(ellipse.center.x),
                data1: Float(ellipse.center.y),
                data2: Float(ellipse.radiusX),
                data3: Float(ellipse.radiusY),
                data4: Float(ellipse.rotation ?? 0),
                data5: 0,
                data6: 0,
                data7: 0
            )
        case let .ribbon(ribbon):
            return MetalComponentUniform(
                primitiveKind: 1,
                operation: component.operation == .subtract ? 1 : 0,
                blendRadius: Float(component.blendRadius),
                segmentStart: UInt32(segmentStart),
                segmentCount: UInt32(ribbon.segments.count),
                data0: Float(ribbon.startRadius),
                data1: Float(ribbon.endRadius),
                data2: 0,
                data3: 0,
                data4: 0,
                data5: 0,
                data6: 0,
                data7: 0
            )
        }
    }

    private func cachedEndpointDistanceRaster(
        scene: LiquidSceneV2,
        trackId: String,
        endpointRole: String,
        endpoint: LiquidEndpoint,
        mapping: MetalScenePixelMapping
    ) -> MetalEndpointDistanceRaster {
        let key = MetalEndpointDistanceRasterKey(scene: scene, trackId: trackId, endpointRole: endpointRole, endpoint: endpoint, width: mapping.width, height: mapping.height)
        if let raster = rasterStore.raster(for: key) {
            return raster
        }
        let raster = MetalRasterStore.compute(key: key, mapping: mapping)
        rasterStore.insert(raster)
        return raster
    }

    // Builds target rasters on a background queue for field tracks that have not
    // started blending toward their target, so they are ready before targetMix rises.
    private func warmTargetRasters(scene: LiquidSceneV2, frame: LiquidFrameV2, mapping: MetalScenePixelMapping) {
        for track in frame.tracks where track.renderMode == .field && LiquidSDF.prepareTrackField(track: track).targetMix == 0 {
            let key = MetalEndpointDistanceRasterKey(scene: scene, trackId: track.id, endpointRole: "target", endpoint: track.target, width: mapping.width, height: mapping.height)
            guard rasterStore.beginWarming(key) else { continue }
            let store = rasterStore
            DispatchQueue.global(qos: .utility).async {
                store.insert(MetalRasterStore.compute(key: key, mapping: mapping))
            }
        }
    }

    private func reusableOutputTexture(width: Int, height: Int) -> MTLTexture {
        if let outputTexture, outputTexture.width == width, outputTexture.height == height {
            return outputTexture
        }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: width, height: height, mipmapped: false)
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .shared
        let texture = device.makeTexture(descriptor: descriptor)!
        outputTexture = texture
        return texture
    }

    private func makeBuffer<T>(_ values: [T]) -> MTLBuffer? {
        guard values.isEmpty == false else {
            return device.makeBuffer(length: 16, options: .storageModeShared)
        }
        return values.withUnsafeBytes { bytes in
            device.makeBuffer(bytes: bytes.baseAddress!, length: bytes.count, options: .storageModeShared)
        }
    }

    private func metalRenderMode(_ mode: LiquidRenderMode) -> Int {
        switch mode {
        case .sourcePath: return 0
        case .targetPath: return 1
        case .field: return 2
        case .crossfade: return 3
        }
    }
}

private enum LiquidMetalRendererError: Error, CustomStringConvertible {
    case commandQueueUnavailable
    case shaderFunctionUnavailable

    var description: String {
        switch self {
        case .commandQueueUnavailable:
            return "Metal command queue unavailable."
        case .shaderFunctionUnavailable:
            return "Metal shader functions unavailable."
        }
    }
}

private struct MetalScenePixelMapping {
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

private struct MetalEndpointDistanceRasterKey: Equatable {
    var sceneId: String
    var fixtureVersion: Int
    var fillRule: LiquidFillRule
    var coordinateSpace: LiquidSize
    var trackId: String
    var endpointRole: String
    var width: Int
    var height: Int
    var transformedCommands: [LiquidPathCommand]

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

private struct MetalEndpointDistanceRaster {
    var key: MetalEndpointDistanceRasterKey
    var distances: [Float]
}

private let metalFarDistance: Float = 1_000_000

private func metalEndpointNeeded(track: LiquidTrackFrame, role: String, targetMix: Double) -> Bool {
    switch track.renderMode {
    case .crossfade:
        return true
    case .sourcePath:
        return role == "source"
    case .targetPath:
        return role == "target"
    case .field:
        return role == "target" && targetMix > 0
    }
}

/// Endpoint distance rasters shared between the render thread and background warming.
private final class MetalRasterStore: @unchecked Sendable {
    private let lock = NSLock()
    private var rasters: [MetalEndpointDistanceRaster] = []
    private var warming: [MetalEndpointDistanceRasterKey] = []

    func raster(for key: MetalEndpointDistanceRasterKey) -> MetalEndpointDistanceRaster? {
        lock.withLock { rasters.first { $0.key == key } }
    }

    func insert(_ raster: MetalEndpointDistanceRaster) {
        lock.withLock {
            warming.removeAll { $0 == raster.key }
            rasters.removeAll { $0.key == raster.key }
            rasters.append(raster)
            if rasters.count > 32 {
                rasters.removeFirst(rasters.count - 32)
            }
        }
    }

    func beginWarming(_ key: MetalEndpointDistanceRasterKey) -> Bool {
        lock.withLock {
            if rasters.contains(where: { $0.key == key }) || warming.contains(key) { return false }
            warming.append(key)
            return true
        }
    }

    func removeAll() {
        lock.withLock {
            rasters.removeAll()
            warming.removeAll()
        }
    }

    /// Paths entirely outside the raster only ever contribute zero coverage, so they skip the distance transform.
    static func compute(key: MetalEndpointDistanceRasterKey, mapping: MetalScenePixelMapping) -> MetalEndpointDistanceRaster {
        let points = key.transformedCommands.flatMap { command -> [LiquidPoint] in
            switch command {
            case let .move(x, y), let .line(x, y):
                return [LiquidPoint(x: x, y: y)]
            case let .cubic(x1, y1, x2, y2, x, y):
                return [LiquidPoint(x: x1, y: y1), LiquidPoint(x: x2, y: y2), LiquidPoint(x: x, y: y)]
            case .close:
                return []
            }
        }
        let margin = 2 / mapping.scale
        let visible = points.isEmpty == false
            && (points.map(\.x).max() ?? 0) >= -mapping.offsetX / mapping.scale - margin
            && (points.map(\.x).min() ?? 0) <= (Double(mapping.width) - mapping.offsetX) / mapping.scale + margin
            && (points.map(\.y).max() ?? 0) >= -mapping.offsetY / mapping.scale - margin
            && (points.map(\.y).min() ?? 0) <= (Double(mapping.height) - mapping.offsetY) / mapping.scale + margin
        guard visible else {
            return MetalEndpointDistanceRaster(key: key, distances: Array(repeating: metalFarDistance, count: key.width * key.height))
        }
        let distances = LiquidSDF.signedDistanceRaster(
            preparedPath: LiquidPreparedPath(commands: key.transformedCommands),
            fillRule: key.fillRule,
            width: key.width,
            height: key.height,
            scale: mapping.scale,
            offsetX: mapping.offsetX,
            offsetY: mapping.offsetY
        ).map(Float.init)
        return MetalEndpointDistanceRaster(key: key, distances: distances)
    }
}

private struct MetalRenderBuffers {
    var uniforms: [MetalUniforms]
    var tracks: [MetalTrackUniform]
    var components: [MetalComponentUniform]
    var segments: [MetalRibbonSegmentUniform]
    var endpointDistances: [Float]
}

private struct MetalUniforms {
    var width: UInt32
    var height: UInt32
    var trackCount: UInt32
    var endpointStride: UInt32
    var scale: Float
    var offsetX: Float
    var offsetY: Float
    var sceneUnitsPerPixel: Float
}

private struct MetalTrackUniform {
    var componentStart: UInt32
    var componentCount: UInt32
    var renderMode: UInt32
    var sourceOffset: UInt32
    var targetOffset: UInt32
    var sourceOpacity: Float
    var targetOpacity: Float
    var targetMix: Float
    var fieldOpacity: Float
    var placed: Float
    var offsetX: Float
    var offsetY: Float
    var placementScale: Float
    var originX: Float
    var originY: Float
}

private struct MetalComponentUniform {
    var primitiveKind: UInt32
    var operation: UInt32
    var blendRadius: Float
    var segmentStart: UInt32
    var segmentCount: UInt32
    var data0: Float
    var data1: Float
    var data2: Float
    var data3: Float
    var data4: Float
    var data5: Float
    var data6: Float
    var data7: Float
}

private struct MetalRibbonSegmentUniform {
    var ax: Float
    var ay: Float
    var bx: Float
    var by: Float
    var startT: Float
    var endT: Float

    init(segment: LiquidPreparedRibbonSegment) {
        self.ax = Float(segment.a.x)
        self.ay = Float(segment.a.y)
        self.bx = Float(segment.b.x)
        self.by = Float(segment.b.y)
        self.startT = Float(segment.startT)
        self.endT = Float(segment.endT)
    }
}

private extension LiquidDebugOptions {
    var isEnabled: Bool {
        showsCenterlines || showsRadii || showsBounds || showsThresholds
    }
}

private extension LiquidMetalRenderer {
    static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct VertexOut {
        float4 position [[position]];
    };

    struct Uniforms {
        uint width;
        uint height;
        uint trackCount;
        uint endpointStride;
        float scale;
        float offsetX;
        float offsetY;
        float sceneUnitsPerPixel;
    };

    struct Track {
        uint componentStart;
        uint componentCount;
        uint renderMode;
        uint sourceOffset;
        uint targetOffset;
        float sourceOpacity;
        float targetOpacity;
        float targetMix;
        float fieldOpacity;
        float placed;
        float offsetX;
        float offsetY;
        float placementScale;
        float originX;
        float originY;
    };

    // Bilinear lookup of a per-pixel endpoint raster at a scene point, for placed
    // tracks whose samples fall between pixel centers.
    float endpointDistanceAt(device const float *endpointDistances, uint base, float2 point, constant Uniforms *uniforms) {
        float2 maxPixel = float2(float(uniforms->width - 1), float(uniforms->height - 1));
        float2 f = clamp(float2(point.x * uniforms->scale + uniforms->offsetX - 0.5, point.y * uniforms->scale + uniforms->offsetY - 0.5), float2(0.0), maxPixel);
        uint2 p0 = uint2(floor(f));
        uint2 p1 = min(p0 + 1, uint2(maxPixel));
        float2 t = f - float2(p0);
        float a = endpointDistances[base + p0.y * uniforms->width + p0.x];
        float b = endpointDistances[base + p0.y * uniforms->width + p1.x];
        float c = endpointDistances[base + p1.y * uniforms->width + p0.x];
        float d = endpointDistances[base + p1.y * uniforms->width + p1.x];
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
    }

    struct Component {
        uint primitiveKind;
        uint operation;
        float blendRadius;
        uint segmentStart;
        uint segmentCount;
        float data0;
        float data1;
        float data2;
        float data3;
        float data4;
        float data5;
        float data6;
        float data7;
    };

    struct RibbonSegment {
        float ax;
        float ay;
        float bx;
        float by;
        float startT;
        float endT;
    };

    vertex VertexOut liquidVertex(uint vertexID [[vertex_id]]) {
        float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
        VertexOut out;
        out.position = float4(positions[vertexID], 0.0, 1.0);
        return out;
    }

    static float coverage(float distance, float ramp) {
        float halfRamp = max(ramp, 0.000001);
        return clamp(0.5 - distance / halfRamp, 0.0, 1.0);
    }

    static float smoothUnionDistance(float a, float b, float k) {
        if (k <= 0.0) {
            return min(a, b);
        }
        float h = max(k - abs(a - b), 0.0) / k;
        return min(a, b) - h * h * h * k / 6.0;
    }

    static float capsuleDistance(float2 point, Component component) {
        float2 start = float2(component.data0, component.data1);
        float2 end = float2(component.data2, component.data3);
        float radius = component.data4;
        float2 pa = point - start;
        float2 ba = end - start;
        float denominator = dot(ba, ba);
        if (denominator == 0.0) {
            return length(pa) - radius;
        }
        float h = clamp(dot(pa, ba) / denominator, 0.0, 1.0);
        return length(pa - ba * h) - radius;
    }

    static float ellipseDistance(float2 point, Component component) {
        float2 center = float2(component.data0, component.data1);
        float radiusX = component.data2;
        float radiusY = component.data3;
        float rotation = -component.data4;
        float2 delta = point - center;
        if (radiusX == 0.0 || radiusY == 0.0) {
            return length(delta);
        }
        float cosValue = cos(rotation);
        float sinValue = sin(rotation);
        float x = abs(delta.x * cosValue - delta.y * sinValue);
        float y = abs(delta.x * sinValue + delta.y * cosValue);
        float normalized = sqrt((x / radiusX) * (x / radiusX) + (y / radiusY) * (y / radiusY));
        return (normalized - 1.0) * min(radiusX, radiusY);
    }

    static float ribbonDistance(float2 point, Component component, device const RibbonSegment *segments) {
        float distance = INFINITY;
        float radiusDelta = component.data1 - component.data0;
        for (uint index = 0; index < component.segmentCount; index++) {
            RibbonSegment segment = segments[component.segmentStart + index];
            float2 a = float2(segment.ax, segment.ay);
            float2 b = float2(segment.bx, segment.by);
            float2 delta = b - a;
            float denominator = dot(delta, delta);
            float t = denominator == 0.0 ? 0.0 : clamp(dot(point - a, delta) / denominator, 0.0, 1.0);
            float curveT = segment.startT + (segment.endT - segment.startT) * t;
            float radius = component.data0 + radiusDelta * curveT;
            distance = min(distance, length(point - (a + delta * t)) - radius);
        }
        return distance;
    }

    static float componentDistance(float2 point, Component component, device const RibbonSegment *segments) {
        if (component.primitiveKind == 0) {
            return capsuleDistance(point, component);
        }
        if (component.primitiveKind == 1) {
            return ribbonDistance(point, component, segments);
        }
        return ellipseDistance(point, component);
    }

    fragment float4 liquidFragment(
        VertexOut in [[stage_in]],
        constant Uniforms *uniforms [[buffer(0)]],
        device const Track *tracks [[buffer(1)]],
        device const Component *components [[buffer(2)]],
        device const RibbonSegment *segments [[buffer(3)]],
        device const float *endpointDistances [[buffer(4)]]
    ) {
        uint x = min(uint(floor(in.position.x)), uniforms->width - 1);
        uint y = min(uint(floor(in.position.y)), uniforms->height - 1);
        uint pixelIndex = y * uniforms->width + x;
        float2 point = float2(
            (float(x) + 0.5 - uniforms->offsetX) / uniforms->scale,
            (float(y) + 0.5 - uniforms->offsetY) / uniforms->scale
        );

        float alpha = 0.0;
        for (uint trackIndex = 0; trackIndex < uniforms->trackCount; trackIndex++) {
            Track track = tracks[trackIndex];
            bool placed = track.placed > 0.5;
            float2 origin = float2(track.originX, track.originY);
            float2 trackPoint = placed ? origin + (point - origin - float2(track.offsetX, track.offsetY)) / track.placementScale : point;
            float distanceScale = placed ? track.placementScale : 1.0;
            float sourceDistance = (placed ? endpointDistanceAt(endpointDistances, track.sourceOffset, trackPoint, uniforms) : endpointDistances[track.sourceOffset + pixelIndex]) * distanceScale;
            float targetDistance = (placed ? endpointDistanceAt(endpointDistances, track.targetOffset, trackPoint, uniforms) : endpointDistances[track.targetOffset + pixelIndex]) * distanceScale;
            float trackAlpha = 0.0;
            if (track.renderMode == 0) {
                trackAlpha = coverage(sourceDistance, uniforms->sceneUnitsPerPixel);
            } else if (track.renderMode == 1) {
                trackAlpha = coverage(targetDistance, uniforms->sceneUnitsPerPixel);
            } else if (track.renderMode == 3) {
                float sourceAlpha = coverage(sourceDistance, uniforms->sceneUnitsPerPixel) * track.sourceOpacity;
                float targetAlpha = coverage(targetDistance, uniforms->sceneUnitsPerPixel) * track.targetOpacity;
                trackAlpha = clamp(sourceAlpha + targetAlpha, 0.0, 1.0);
            } else {
                float distance = INFINITY;
                for (uint componentIndex = 0; componentIndex < track.componentCount; componentIndex++) {
                    Component component = components[track.componentStart + componentIndex];
                    float next = componentDistance(trackPoint, component, segments);
                    if (isinf(distance)) {
                        distance = component.operation == 1 ? -next : next;
                    } else if (component.operation == 1) {
                        distance = max(distance, -next);
                    } else {
                        distance = smoothUnionDistance(distance, next, component.blendRadius);
                    }
                }
                distance *= distanceScale;
                if (track.targetMix > 0.0) {
                    distance = distance * (1.0 - track.targetMix) + targetDistance * track.targetMix;
                }
                trackAlpha = coverage(distance, uniforms->sceneUnitsPerPixel) * track.fieldOpacity;
            }
            alpha = min(1.0, alpha + trackAlpha * (1.0 - alpha));
        }
        return float4(alpha, 0.0, 0.0, 1.0);
    }
    """
}

import Foundation

public struct LiquidPreparedPath: Equatable, Sendable {
    fileprivate struct Segment: Equatable, Sendable {
        var a: LiquidPoint
        var b: LiquidPoint
        var delta: LiquidVector
        var denominator: Double

        init(a: LiquidPoint, b: LiquidPoint) {
            let delta = LiquidVector(x: b.x - a.x, y: b.y - a.y)
            self.a = a
            self.b = b
            self.delta = delta
            self.denominator = delta.dot(delta)
        }
    }

    fileprivate var segments: [Segment]

    public init(commands: [LiquidPathCommand], cubicSubdivisions: Int = 32) {
        self.init(contours: LiquidSDF.flatten(commands: commands, cubicSubdivisions: cubicSubdivisions))
    }

    public init(contours: [[LiquidPoint]]) {
        self.segments = contours.filter { $0.count >= 2 }.flatMap { contour in
            (0..<(contour.count - 1)).map { index in
                Segment(a: contour[index], b: contour[index + 1])
            }
        }
    }

    public var isEmpty: Bool {
        segments.isEmpty
    }
}

public struct LiquidPreparedRibbonSegment: Equatable, Sendable {
    public var a: LiquidPoint
    public var b: LiquidPoint
    public var startT: Double
    public var endT: Double
    fileprivate var delta: LiquidVector
    fileprivate var denominator: Double

    fileprivate init(a: LiquidPoint, b: LiquidPoint, startT: Double, endT: Double) {
        let delta = LiquidVector(x: b.x - a.x, y: b.y - a.y)
        self.a = a
        self.b = b
        self.startT = startT
        self.endT = endT
        self.delta = delta
        self.denominator = delta.dot(delta)
    }
}

public struct LiquidPreparedRibbon: Equatable, Sendable {
    public var segments: [LiquidPreparedRibbonSegment]
    public var startRadius: Double
    public var endRadius: Double

    public init(segments: [LiquidPreparedRibbonSegment], startRadius: Double, endRadius: Double) {
        self.segments = segments
        self.startRadius = startRadius
        self.endRadius = endRadius
    }

    public init(ribbon: LiquidRibbon, subdivisions: Int = LiquidSDF.ribbonSubdivisions) {
        self = LiquidSDF.prepareRibbon(ribbon, subdivisions: subdivisions)
    }
}

public enum LiquidPreparedPrimitive: Equatable, Sendable {
    case capsule(LiquidCapsule)
    case ribbon(LiquidPreparedRibbon)
    case ellipse(LiquidEllipse)
}

public struct LiquidPreparedTrackComponent: Equatable, Sendable {
    public var id: String
    public var kind: LiquidComponentKind
    public var operation: LiquidCompositionOperation
    public var groupId: String?
    public var primitive: LiquidPreparedPrimitive
    public var blendRadius: Double

    public init(
        id: String,
        kind: LiquidComponentKind,
        operation: LiquidCompositionOperation,
        groupId: String? = nil,
        primitive: LiquidPreparedPrimitive,
        blendRadius: Double
    ) {
        self.id = id
        self.kind = kind
        self.operation = operation
        self.groupId = groupId
        self.primitive = primitive
        self.blendRadius = blendRadius
    }
}

public struct LiquidPreparedTrackField: Equatable, Sendable {
    public var id: String
    public var components: [LiquidPreparedTrackComponent]
    public var targetMix: Double
    /// `$track.opacity` (default 1): fades a track while it is drawn as a field.
    public var fieldOpacity: Double

    public init(track: LiquidTrackFrame) {
        self = LiquidSDF.prepareTrackField(track: track)
    }

    public init(id: String, components: [LiquidPreparedTrackComponent], targetMix: Double, fieldOpacity: Double = 1) {
        self.id = id
        self.components = components
        self.targetMix = targetMix
        self.fieldOpacity = fieldOpacity
    }
}

public enum LiquidSDF {
    public static let ribbonSubdivisions = 32

    public static func capsuleDistance(point: LiquidPoint, capsule: LiquidCapsule) -> Double {
        let pa = LiquidVector(x: point.x - capsule.start.x, y: point.y - capsule.start.y)
        let ba = LiquidVector(x: capsule.end.x - capsule.start.x, y: capsule.end.y - capsule.start.y)
        let denominator = ba.dot(ba)
        if denominator == 0 {
            return pa.length - capsule.radius
        }
        let h = min(1, max(0, pa.dot(ba) / denominator))
        let nearest = LiquidVector(x: ba.x * h, y: ba.y * h)
        return LiquidVector(x: pa.x - nearest.x, y: pa.y - nearest.y).length - capsule.radius
    }

    public static func smoothUnion(_ a: Double, _ b: Double, blendRadius k: Double) -> Double {
        guard k > 0 else { return min(a, b) }
        let h = max(k - abs(a - b), 0) / k
        return min(a, b) - h * h * h * k / 6
    }

    public static func ribbonDistance(point: LiquidPoint, ribbon: LiquidRibbon, subdivisions: Int = ribbonSubdivisions) -> Double {
        preparedRibbonDistance(point: point, ribbon: prepareRibbon(ribbon, subdivisions: subdivisions))
    }

    public static func prepareRibbon(_ ribbon: LiquidRibbon, subdivisions: Int = ribbonSubdivisions) -> LiquidPreparedRibbon {
        var segments: [LiquidPreparedRibbonSegment] = []
        segments.reserveCapacity(max(1, subdivisions))
        var previous = ribbon.p0
        let steps = max(1, subdivisions)
        for step in 1...steps {
            let startT = Double(step - 1) / Double(steps)
            let endT = Double(step) / Double(steps)
            let next = cubicPoint(start: ribbon.p0, c1: ribbon.p1, c2: ribbon.p2, end: ribbon.p3, t: endT)
            segments.append(LiquidPreparedRibbonSegment(a: previous, b: next, startT: startT, endT: endT))
            previous = next
        }
        return LiquidPreparedRibbon(segments: segments, startRadius: ribbon.startRadius, endRadius: ribbon.endRadius)
    }

    public static func preparedRibbonDistance(point: LiquidPoint, ribbon: LiquidPreparedRibbon) -> Double {
        var distance = Double.infinity
        let radiusDelta = ribbon.endRadius - ribbon.startRadius
        for segment in ribbon.segments {
            let segmentResult = segmentDistance(point: point, segment: segment)
            let curveT = segment.startT + (segment.endT - segment.startT) * segmentResult.t
            let radius = ribbon.startRadius + radiusDelta * curveT
            distance = min(distance, segmentResult.distance - radius)
        }
        return distance
    }

    public static func preparedPrimitiveDistance(point: LiquidPoint, primitive: LiquidPreparedPrimitive) -> Double {
        switch primitive {
        case let .capsule(capsule):
            return capsuleDistance(point: point, capsule: capsule)
        case let .ribbon(ribbon):
            return preparedRibbonDistance(point: point, ribbon: ribbon)
        case let .ellipse(ellipse):
            return ellipseDistance(point: point, ellipse: ellipse)
        }
    }

    public static func preparePrimitive(_ primitive: LiquidPrimitive) -> LiquidPreparedPrimitive {
        switch primitive {
        case let .capsule(capsule):
            return .capsule(capsule)
        case let .ribbon(ribbon):
            return .ribbon(prepareRibbon(ribbon))
        case let .ellipse(ellipse):
            return .ellipse(ellipse)
        }
    }

    public static func prepareTrackField(track: LiquidTrackFrame) -> LiquidPreparedTrackField {
        LiquidPreparedTrackField(
            id: track.id,
            components: track.components.map { component in
                LiquidPreparedTrackComponent(
                    id: component.id,
                    kind: component.kind,
                    operation: component.operation,
                    groupId: component.groupId,
                    primitive: preparePrimitive(component.primitive),
                    blendRadius: effectiveBlendRadius(component: component, track: track)
                )
            },
            targetMix: targetMix(track: track),
            fieldOpacity: fieldOpacity(track: track)
        )
    }

    public static func preparedTrackFieldDistance(point: LiquidPoint, track: LiquidPreparedTrackField) -> Double {
        var distance = Double.infinity
        for component in track.components {
            let next = preparedPrimitiveDistance(point: point, primitive: component.primitive)
            if distance.isInfinite {
                distance = component.operation == .subtract ? -next : next
                continue
            }
            if component.operation == .subtract {
                distance = max(distance, -next)
            } else {
                distance = smoothUnion(distance, next, blendRadius: component.blendRadius)
            }
        }
        return distance
    }

    public static func ellipseDistance(point: LiquidPoint, ellipse: LiquidEllipse) -> Double {
        let rotation = -(ellipse.rotation ?? 0)
        let cosValue = cos(rotation)
        let sinValue = sin(rotation)
        let dx = point.x - ellipse.center.x
        let dy = point.y - ellipse.center.y
        let x = abs(dx * cosValue - dy * sinValue)
        let y = abs(dx * sinValue + dy * cosValue)
        let minRadius = min(ellipse.radiusX, ellipse.radiusY)
        if ellipse.radiusX == 0 || ellipse.radiusY == 0 {
            return LiquidVector(x: dx, y: dy).length
        }
        let normalized = sqrt((x / ellipse.radiusX) * (x / ellipse.radiusX) + (y / ellipse.radiusY) * (y / ellipse.radiusY))
        return (normalized - 1) * minRadius
    }

    public static func primitiveDistance(point: LiquidPoint, primitive: LiquidPrimitive) -> Double {
        preparedPrimitiveDistance(point: point, primitive: preparePrimitive(primitive))
    }

    public static func componentDistance(point: LiquidPoint, component: LiquidComponentFrame) -> Double {
        primitiveDistance(point: point, primitive: component.primitive)
    }

    public static func trackFieldDistance(point: LiquidPoint, track: LiquidTrackFrame) -> Double {
        preparedTrackFieldDistance(point: point, track: prepareTrackField(track: track))
    }

    /// Rigid move and uniform scale of a whole track, read from the numeric `$track`
    /// materials `offsetX`, `offsetY`, `scale`, `originX`, and `originY`; nil when the
    /// track is drawn in place. Mirrors `trackPlacement` in packages/liquid-core/src/sdf.ts.
    public static func trackPlacement(track: LiquidTrackFrame) -> LiquidTrackPlacement? {
        let values = track.material.groups["$track"]
        func number(_ key: String, _ fallback: Double) -> Double {
            guard let value = values?[key]?.numberValue, value.isFinite else { return fallback }
            return value
        }
        let placement = LiquidTrackPlacement(
            offsetX: number("offsetX", 0),
            offsetY: number("offsetY", 0),
            scale: max(0.000001, number("scale", 1)),
            originX: number("originX", 0),
            originY: number("originY", 0)
        )
        return placement.offsetX == 0 && placement.offsetY == 0 && placement.scale == 1 ? nil : placement
    }

    public static func fieldOpacity(track: LiquidTrackFrame) -> Double {
        LiquidMath.clamp01(track.material.groups["$track"]?["opacity"]?.numberValue ?? 1)
    }

    public static func targetMix(track: LiquidTrackFrame) -> Double {
        LiquidMath.clamp01(materialNumber(track: track, key: "targetMix"))
    }

    public static func proceduralDistance(point: LiquidPoint, frame: LiquidPoseFrame) -> Double {
        let capsules = [frame.leftLeg, frame.rightLeg, frame.crossbar, frame.bridge]
        let blendRadius = frame.blendRadius * (1 - frame.cornerSharpness)
        var distance = Double.infinity
        for capsule in capsules where capsule.radius > 0 {
            let capsuleDistance = capsuleDistance(point: point, capsule: capsule)
            if distance.isInfinite {
                distance = capsuleDistance
            } else {
                distance = smoothUnion(distance, capsuleDistance, blendRadius: blendRadius)
            }
        }
        return distance
    }

    public static func targetPathDistance(
        point: LiquidPoint,
        commands: [LiquidPathCommand],
        fillRule: LiquidFillRule,
        cubicSubdivisions: Int = 32
    ) -> Double {
        targetPathDistance(
            point: point,
            preparedPath: LiquidPreparedPath(commands: commands, cubicSubdivisions: cubicSubdivisions),
            fillRule: fillRule
        )
    }

    public static func targetPathDistance(
        point: LiquidPoint,
        preparedPath: LiquidPreparedPath,
        fillRule: LiquidFillRule
    ) -> Double {
        guard preparedPath.isEmpty == false else { return Double.infinity }

        var minimumDistance = Double.infinity
        var winding = 0
        var crossingCount = 0

        for segment in preparedPath.segments {
            minimumDistance = min(minimumDistance, distanceToSegment(point: point, segment: segment))
            if rayCrosses(point: point, a: segment.a, b: segment.b) {
                crossingCount += 1
            }
            winding += windingContribution(point: point, a: segment.a, b: segment.b)
        }

        let inside: Bool
        switch fillRule {
        case .evenodd:
            inside = crossingCount % 2 == 1
        case .nonzero:
            inside = winding != 0
        }
        return inside ? -minimumDistance : minimumDistance
    }

    /// Signed distance from every pixel center to a prepared path. Pixel (x, y) samples
    /// scene point ((x + 0.5 - offsetX) / scale, (y + 0.5 - offsetY) / scale).
    ///
    /// Pixels within a small seed band of a segment get exact distances; two raster sweeps
    /// then propagate each pixel's nearest segment to its neighbours and re-measure the exact
    /// distance to every candidate. The sign comes from one scanline winding pass using the
    /// same crossing rules as `targetPathDistance`. Mirrors `signedDistanceRaster` in
    /// packages/liquid-core/src/path.ts.
    public static func signedDistanceRaster(
        preparedPath: LiquidPreparedPath,
        fillRule: LiquidFillRule,
        width: Int,
        height: Int,
        scale: Double,
        offsetX: Double,
        offsetY: Double
    ) -> [Double] {
        guard width > 0, height > 0 else { return [] }
        let count = width * height
        var distances = Array(repeating: Double.infinity, count: count)
        var nearest = Array(repeating: -1, count: count)
        let inverseScale = 1 / scale
        let segments = preparedPath.segments
        let sceneX = (0..<width).map { (Double($0) + 0.5 - offsetX) * inverseScale }
        let sceneY = (0..<height).map { (Double($0) + 0.5 - offsetY) * inverseScale }
        func toPixel(_ value: Double, _ offset: Double) -> Double { value * scale + offset - 0.5 }

        distances.withUnsafeMutableBufferPointer { distance in
            nearest.withUnsafeMutableBufferPointer { nearest in
                func measure(_ index: Int, _ px: Double, _ py: Double, _ segmentIndex: Int) {
                    let segment = segments[segmentIndex]
                    let wx = px - segment.a.x
                    let wy = py - segment.a.y
                    let vx = segment.delta.x
                    let vy = segment.delta.y
                    var t = segment.denominator == 0 ? 0 : (wx * vx + wy * vy) / segment.denominator
                    t = t < 0 ? 0 : (t > 1 ? 1 : t)
                    let dx = wx - vx * t
                    let dy = wy - vy * t
                    let value = (dx * dx + dy * dy).squareRoot()
                    if value < distance[index] {
                        distance[index] = value
                        nearest[index] = segmentIndex
                    }
                }
                func propagate(_ index: Int, _ px: Double, _ py: Double, _ neighbour: Int) {
                    let candidate = nearest[neighbour]
                    if candidate >= 0 && candidate != nearest[index] { measure(index, px, py, candidate) }
                }

                let seed = 1.5 * inverseScale
                var seeded = false
                for segmentIndex in segments.indices {
                    let a = segments[segmentIndex].a
                    let b = segments[segmentIndex].b
                    let x0 = max(0, Int(toPixel(min(a.x, b.x) - seed, offsetX).rounded(.down)))
                    let x1 = min(width - 1, Int(toPixel(max(a.x, b.x) + seed, offsetX).rounded(.up)))
                    let y0 = max(0, Int(toPixel(min(a.y, b.y) - seed, offsetY).rounded(.down)))
                    let y1 = min(height - 1, Int(toPixel(max(a.y, b.y) + seed, offsetY).rounded(.up)))
                    if x0 > x1 || y0 > y1 { continue }
                    for y in y0...y1 {
                        for x in x0...x1 {
                            measure(y * width + x, sceneX[x], sceneY[y], segmentIndex)
                            seeded = true
                        }
                    }
                }
                if !seeded && !segments.isEmpty {
                    // The path lies entirely off the raster: seed the border from every segment.
                    func seedPixel(_ x: Int, _ y: Int) {
                        for segmentIndex in segments.indices { measure(y * width + x, sceneX[x], sceneY[y], segmentIndex) }
                    }
                    for x in 0..<width {
                        seedPixel(x, 0)
                        seedPixel(x, height - 1)
                    }
                    if height > 2 {
                        for y in 1..<(height - 1) {
                            seedPixel(0, y)
                            seedPixel(width - 1, y)
                        }
                    }
                }

                for y in 0..<height {
                    let row = y * width
                    let py = sceneY[y]
                    for x in 0..<width {
                        let index = row + x
                        let px = sceneX[x]
                        if x > 0 { propagate(index, px, py, index - 1) }
                        if y > 0 {
                            if x > 0 { propagate(index, px, py, index - width - 1) }
                            propagate(index, px, py, index - width)
                            if x < width - 1 { propagate(index, px, py, index - width + 1) }
                        }
                    }
                    if width > 1 {
                        for x in stride(from: width - 2, through: 0, by: -1) { propagate(row + x, sceneX[x], py, row + x + 1) }
                    }
                }
                for y in stride(from: height - 1, through: 0, by: -1) {
                    let row = y * width
                    let py = sceneY[y]
                    for x in stride(from: width - 1, through: 0, by: -1) {
                        let index = row + x
                        let px = sceneX[x]
                        if x < width - 1 { propagate(index, px, py, index + 1) }
                        if y < height - 1 {
                            if x < width - 1 { propagate(index, px, py, index + width + 1) }
                            propagate(index, px, py, index + width)
                            if x > 0 { propagate(index, px, py, index + width - 1) }
                        }
                    }
                    if width > 1 {
                        for x in 1..<width { propagate(row + x, sceneX[x], py, row + x - 1) }
                    }
                }
            }
        }

        distances.withUnsafeMutableBufferPointer { buffer in
            var crossings: [(x: Double, direction: Int)] = []
            for y in 0..<height {
                let py = (Double(y) + 0.5 - offsetY) * inverseScale
                crossings.removeAll(keepingCapacity: true)
                for segment in preparedPath.segments {
                    let a = segment.a
                    let b = segment.b
                    let direction = a.y <= py && b.y > py ? 1 : (b.y <= py && a.y > py ? -1 : 0)
                    if direction == 0 { continue }
                    crossings.append((a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y), direction))
                }
                if crossings.isEmpty { continue }
                crossings.sort { $0.x < $1.x }
                var winding = crossings.reduce(0) { $0 + $1.direction }
                var remaining = crossings.count
                var next = 0
                let row = y * width
                for x in 0..<width {
                    let px = (Double(x) + 0.5 - offsetX) * inverseScale
                    while next < crossings.count && crossings[next].x <= px {
                        winding -= crossings[next].direction
                        remaining -= 1
                        next += 1
                    }
                    let inside = fillRule == .evenodd ? remaining % 2 == 1 : winding != 0
                    if inside { buffer[row + x] = -buffer[row + x] }
                }
            }
        }
        return distances
    }

    public static func blendedDistance(
        point: LiquidPoint,
        frame: LiquidPoseFrame,
        targetCommands: [LiquidPathCommand],
        fillRule: LiquidFillRule,
        cubicSubdivisions: Int = 32
    ) -> Double {
        blendedDistance(
            point: point,
            frame: frame,
            targetPath: LiquidPreparedPath(commands: targetCommands, cubicSubdivisions: cubicSubdivisions),
            fillRule: fillRule
        )
    }

    public static func blendedDistance(
        point: LiquidPoint,
        frame: LiquidPoseFrame,
        targetPath: LiquidPreparedPath,
        fillRule: LiquidFillRule
    ) -> Double {
        let procedural = proceduralDistance(point: point, frame: frame)
        let target = targetPathDistance(point: point, preparedPath: targetPath, fillRule: fillRule)
        return procedural * (1 - frame.targetMix) + target * frame.targetMix
    }

    public static func flatten(commands: [LiquidPathCommand], cubicSubdivisions: Int = 32) -> [[LiquidPoint]] {
        var contours: [[LiquidPoint]] = []
        var current: [LiquidPoint] = []
        var cursor: LiquidPoint?
        var contourStart: LiquidPoint?
        let subdivisions = max(1, cubicSubdivisions)

        func finishContour() {
            if current.count >= 2 {
                contours.append(current)
            }
            current.removeAll(keepingCapacity: true)
            cursor = nil
            contourStart = nil
        }

        for command in commands {
            switch command {
            case let .move(x, y):
                finishContour()
                let point = LiquidPoint(x: x, y: y)
                current.append(point)
                cursor = point
                contourStart = point
            case let .line(x, y):
                let point = LiquidPoint(x: x, y: y)
                if cursor == nil {
                    current.append(point)
                    contourStart = point
                } else {
                    current.append(point)
                }
                cursor = point
            case let .cubic(x1, y1, x2, y2, x, y):
                guard let start = cursor else { continue }
                let c1 = LiquidPoint(x: x1, y: y1)
                let c2 = LiquidPoint(x: x2, y: y2)
                let end = LiquidPoint(x: x, y: y)
                for step in 1...subdivisions {
                    let t = Double(step) / Double(subdivisions)
                    current.append(cubicPoint(start: start, c1: c1, c2: c2, end: end, t: t))
                }
                cursor = end
            case .close:
                if let contourStart, let cursor, cursor != contourStart {
                    current.append(contourStart)
                }
                finishContour()
            }
        }
        finishContour()
        return contours
    }

    private static func cubicPoint(start: LiquidPoint, c1: LiquidPoint, c2: LiquidPoint, end: LiquidPoint, t: Double) -> LiquidPoint {
        let mt = 1 - t
        let mt2 = mt * mt
        let t2 = t * t
        return LiquidPoint(
            x: mt2 * mt * start.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * end.x,
            y: mt2 * mt * start.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * end.y
        )
    }

    private static func segmentDistance(point: LiquidPoint, a: LiquidPoint, b: LiquidPoint) -> (distance: Double, t: Double) {
        let vx = b.x - a.x
        let vy = b.y - a.y
        let wx = point.x - a.x
        let wy = point.y - a.y
        let length = vx * vx + vy * vy
        let t = length == 0 ? 0 : min(1, max(0, (wx * vx + wy * vy) / length))
        let x = a.x + vx * t
        let y = a.y + vy * t
        return (LiquidVector(x: point.x - x, y: point.y - y).length, t)
    }

    private static func segmentDistance(point: LiquidPoint, segment: LiquidPreparedRibbonSegment) -> (distance: Double, t: Double) {
        let wx = point.x - segment.a.x
        let wy = point.y - segment.a.y
        let t = segment.denominator == 0 ? 0 : min(1, max(0, (wx * segment.delta.x + wy * segment.delta.y) / segment.denominator))
        let x = segment.a.x + segment.delta.x * t
        let y = segment.a.y + segment.delta.y * t
        return (LiquidVector(x: point.x - x, y: point.y - y).length, t)
    }

    private static func distanceToSegment(point: LiquidPoint, a: LiquidPoint, b: LiquidPoint) -> Double {
        let pa = LiquidVector(x: point.x - a.x, y: point.y - a.y)
        let ba = LiquidVector(x: b.x - a.x, y: b.y - a.y)
        let denominator = ba.dot(ba)
        if denominator == 0 {
            return pa.length
        }
        let h = min(1, max(0, pa.dot(ba) / denominator))
        let nearest = LiquidPoint(x: a.x + ba.x * h, y: a.y + ba.y * h)
        return LiquidVector(x: point.x - nearest.x, y: point.y - nearest.y).length
    }

    private static func distanceToSegment(point: LiquidPoint, segment: LiquidPreparedPath.Segment) -> Double {
        let pa = LiquidVector(x: point.x - segment.a.x, y: point.y - segment.a.y)
        if segment.denominator == 0 {
            return pa.length
        }
        let h = min(1, max(0, pa.dot(segment.delta) / segment.denominator))
        let nearest = LiquidPoint(x: segment.a.x + segment.delta.x * h, y: segment.a.y + segment.delta.y * h)
        return LiquidVector(x: point.x - nearest.x, y: point.y - nearest.y).length
    }

    private static func rayCrosses(point: LiquidPoint, a: LiquidPoint, b: LiquidPoint) -> Bool {
        ((a.y > point.y) != (b.y > point.y))
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
    }

    private static func windingContribution(point: LiquidPoint, a: LiquidPoint, b: LiquidPoint) -> Int {
        if a.y <= point.y {
            if b.y > point.y && isLeft(a: a, b: b, point: point) > 0 {
                return 1
            }
        } else if b.y <= point.y && isLeft(a: a, b: b, point: point) < 0 {
            return -1
        }
        return 0
    }

    private static func isLeft(a: LiquidPoint, b: LiquidPoint, point: LiquidPoint) -> Double {
        (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    }

    private static func effectiveBlendRadius(component: LiquidComponentFrame, track: LiquidTrackFrame) -> Double {
        let blendRadius = materialNumber(component: component, track: track, key: "blendRadius")
        let cornerSharpness = materialNumber(track: track, key: "cornerSharpness")
        return blendRadius * (1 - LiquidMath.clamp01(cornerSharpness))
    }

    private static func materialNumber(component: LiquidComponentFrame, track: LiquidTrackFrame, key: String) -> Double {
        if let value = component.material[key]?.numberValue {
            return value
        }
        if let groupId = component.groupId, let value = track.material.groups[groupId]?[key]?.numberValue {
            return value
        }
        return 0
    }

    private static func materialNumber(track: LiquidTrackFrame, key: String) -> Double {
        // V2 has no dedicated track-level scalar today. The reserved "$track" material group carries renderer-only
        // relaxation controls such as targetMix and cornerSharpness without changing the runtime scene contract.
        track.material.groups["$track"]?[key]?.numberValue ?? 0
    }
}

public struct LiquidVector: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public var length: Double {
        sqrt(x * x + y * y)
    }

    public func dot(_ other: LiquidVector) -> Double {
        x * other.x + y * other.y
    }
}

/// A rigid move and uniform scale applied to a whole track when it is drawn: its shapes,
/// including exact endpoints, are scaled about the origin and then moved by the offset.
public struct LiquidTrackPlacement: Equatable, Sendable {
    public var offsetX: Double
    public var offsetY: Double
    public var scale: Double
    public var originX: Double
    public var originY: Double

    public init(offsetX: Double, offsetY: Double, scale: Double, originX: Double, originY: Double) {
        self.offsetX = offsetX
        self.offsetY = offsetY
        self.scale = scale
        self.originX = originX
        self.originY = originY
    }

    /// The point in the track's own space that lands on scene point `point` once placed.
    public func unplace(_ point: LiquidPoint) -> LiquidPoint {
        LiquidPoint(
            x: originX + (point.x - originX - offsetX) / scale,
            y: originY + (point.y - originY - offsetY) / scale
        )
    }
}

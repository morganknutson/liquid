import Foundation

// Monotone cubic Hermite interpolation (PCHIP) across a track's keyframes.
// Values pass through every keyframe without overshoot, velocity is continuous
// at interior keyframes, and the first and last keyframes are reached at rest.
// Mirrors packages/liquid-core/src/spline.ts operation for operation.

struct LiquidSplineSegment {
    let index: Int
    let u: Double

    init(keyframes: [LiquidTrackKeyframe], progress: Double) {
        for index in 1..<keyframes.count {
            let previous = keyframes[index - 1]
            let next = keyframes[index]
            if progress <= next.at {
                let span = next.at - previous.at
                self.index = index
                self.u = span <= 0 ? 1 : (progress - previous.at) / span
                return
            }
        }
        self.index = keyframes.count - 1
        self.u = 1
    }
}

enum LiquidSpline {
    private static func tangent(_ keyframes: [LiquidTrackKeyframe], _ channel: (Int) -> Double?, _ index: Int) -> Double {
        if index <= 0 || index >= keyframes.count - 1 { return 0 }
        guard let previous = channel(index - 1), let current = channel(index), let next = channel(index + 1) else { return 0 }
        let h0 = keyframes[index].at - keyframes[index - 1].at
        let h1 = keyframes[index + 1].at - keyframes[index].at
        let d0 = (current - previous) / h0
        let d1 = (next - current) / h1
        if d0 * d1 <= 0 { return 0 }
        let w0 = 2 * h1 + h0
        let w1 = h1 + 2 * h0
        return (w0 + w1) / (w0 / d0 + w1 / d1)
    }

    private static func hermite(_ keyframes: [LiquidTrackKeyframe], _ channel: (Int) -> Double?, _ segment: LiquidSplineSegment, _ y0: Double, _ y1: Double) -> Double {
        let index = segment.index
        let u = segment.u
        let h = keyframes[index].at - keyframes[index - 1].at
        let m0 = tangent(keyframes, channel, index - 1)
        let m1 = tangent(keyframes, channel, index)
        let u2 = u * u
        let u3 = u2 * u
        return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1
    }

    private static func values(_ primitive: LiquidPrimitive) -> [Double] {
        switch primitive {
        case let .capsule(capsule):
            return [capsule.start.x, capsule.start.y, capsule.end.x, capsule.end.y, capsule.radius]
        case let .ribbon(ribbon):
            return [
                ribbon.p0.x, ribbon.p0.y, ribbon.p1.x, ribbon.p1.y,
                ribbon.p2.x, ribbon.p2.y, ribbon.p3.x, ribbon.p3.y,
                ribbon.startRadius, ribbon.endRadius,
            ]
        case let .ellipse(ellipse):
            return [ellipse.center.x, ellipse.center.y, ellipse.radiusX, ellipse.radiusY, ellipse.rotation ?? 0]
        }
    }

    private static func primitive(like template: LiquidPrimitive, values v: [Double]) -> LiquidPrimitive {
        switch template {
        case .capsule:
            return .capsule(LiquidCapsule(start: LiquidPoint(x: v[0], y: v[1]), end: LiquidPoint(x: v[2], y: v[3]), radius: v[4]))
        case .ribbon:
            return .ribbon(LiquidRibbon(
                p0: LiquidPoint(x: v[0], y: v[1]),
                p1: LiquidPoint(x: v[2], y: v[3]),
                p2: LiquidPoint(x: v[4], y: v[5]),
                p3: LiquidPoint(x: v[6], y: v[7]),
                startRadius: v[8],
                endRadius: v[9]
            ))
        case .ellipse:
            return .ellipse(LiquidEllipse(center: LiquidPoint(x: v[0], y: v[1]), radiusX: v[2], radiusY: v[3], rotation: v[4]))
        }
    }

    static func primitive(_ keyframes: [LiquidTrackKeyframe], componentId: String, segment: LiquidSplineSegment) -> LiquidPrimitive {
        let states = keyframes.map { keyframe in keyframe.components.first { $0.id == componentId }!.primitive }
        let channels = states.map(values)
        let output = channels[segment.index].indices.map { channelIndex in
            hermite(keyframes, { channels[$0][channelIndex] }, segment, channels[segment.index - 1][channelIndex], channels[segment.index][channelIndex])
        }
        return primitive(like: states[segment.index], values: output)
    }

    static func materialSection(
        _ keyframes: [LiquidTrackKeyframe],
        section: KeyPath<LiquidKeyframeMaterial, [String: LiquidMaterialValues]?>,
        segment: LiquidSplineSegment
    ) -> [String: LiquidMaterialValues] {
        let previous = keyframes[segment.index - 1].material?[keyPath: section] ?? [:]
        let next = keyframes[segment.index].material?[keyPath: section] ?? [:]
        var output: [String: LiquidMaterialValues] = [:]
        for id in Set(previous.keys).union(next.keys).sorted() {
            let a = previous[id] ?? [:]
            let b = next[id] ?? [:]
            var values: LiquidMaterialValues = [:]
            for key in Set(a.keys).union(b.keys).sorted() {
                if case let .number(y0) = a[key], case let .number(y1) = b[key] {
                    let channel: (Int) -> Double? = { keyframeIndex in
                        if case let .number(value) = keyframes[keyframeIndex].material?[keyPath: section]?[id]?[key] { return value }
                        return nil
                    }
                    values[key] = .number(hermite(keyframes, channel, segment, y0, y1))
                } else if b[key] == nil {
                    values[key] = a[key] ?? .number(0)
                } else if a[key] == nil {
                    values[key] = b[key]!
                } else {
                    values[key] = segment.u < 1 ? a[key]! : b[key]!
                }
            }
            output[id] = values
        }
        return output
    }
}

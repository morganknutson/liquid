import CoreGraphics
import Foundation

public struct LiquidBackingScaleOptions: Equatable, Sendable {
    public var maxScale: Double
    public var maxBackingDimension: Int?

    public init(maxScale: Double = 3, maxBackingDimension: Int? = 512) {
        self.maxScale = maxScale
        self.maxBackingDimension = maxBackingDimension
    }
}

public struct LiquidBackingSize: Equatable, Sendable {
    public var logicalWidth: Double
    public var logicalHeight: Double
    public var scale: Double
    public var width: Int
    public var height: Int

    public init(logicalWidth: Double, logicalHeight: Double, scale: Double, width: Int, height: Int) {
        self.logicalWidth = logicalWidth
        self.logicalHeight = logicalHeight
        self.scale = scale
        self.width = width
        self.height = height
    }
}

public func liquidBackingSize(
    logicalSize: CGSize,
    displayScale: Double,
    options: LiquidBackingScaleOptions = LiquidBackingScaleOptions()
) -> LiquidBackingSize {
    let logicalWidth = sanitizedPositive(logicalSize.width)
    let logicalHeight = sanitizedPositive(logicalSize.height)
    guard logicalWidth > 0, logicalHeight > 0 else {
        return LiquidBackingSize(logicalWidth: logicalWidth, logicalHeight: logicalHeight, scale: 1, width: 0, height: 0)
    }

    var scale = sanitizedScale(displayScale)
    if options.maxScale.isFinite, options.maxScale > 0 {
        scale = min(scale, options.maxScale)
    }

    if let maxBackingDimension = options.maxBackingDimension, maxBackingDimension > 0 {
        let longestLogicalDimension = max(logicalWidth, logicalHeight)
        scale = min(scale, Double(maxBackingDimension) / longestLogicalDimension)
    }
    scale = max(scale, 0.000001)

    var width = max(1, Int((logicalWidth * scale).rounded()))
    var height = max(1, Int((logicalHeight * scale).rounded()))
    if let maxBackingDimension = options.maxBackingDimension, maxBackingDimension > 0 {
        width = min(width, maxBackingDimension)
        height = min(height, maxBackingDimension)
    }

    return LiquidBackingSize(logicalWidth: logicalWidth, logicalHeight: logicalHeight, scale: scale, width: width, height: height)
}

private func sanitizedPositive(_ value: CGFloat) -> Double {
    let doubleValue = Double(value)
    guard doubleValue.isFinite, doubleValue > 0 else { return 0 }
    return doubleValue
}

private func sanitizedScale(_ value: Double) -> Double {
    guard value.isFinite, value > 0 else { return 1 }
    return value
}

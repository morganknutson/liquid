import Foundation

public enum LiquidCanonicalJSON {
    public static func canonicalNumber(_ value: Double) -> Double {
        precondition(value.isFinite, "Canonical JSON only supports finite numbers")
        let rounded = (value * 1_000_000).rounded() / 1_000_000
        return rounded == 0 ? 0 : rounded
    }

    public static func string(for value: Double) -> String {
        let rounded = canonicalNumber(value)
        if rounded == 0 { return "0" }
        var text = String(format: "%.6f", rounded)
        while text.last == "0" {
            text.removeLast()
        }
        if text.last == "." {
            text.removeLast()
        }
        return text
    }
}

public enum LiquidJSONValue: Sendable {
    case object([(String, LiquidJSONValue)])
    case array([LiquidJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public func rendered(indentation: Int = 0) -> String {
        switch self {
        case let .object(entries):
            guard entries.isEmpty == false else { return "{}" }
            let childIndent = String(repeating: " ", count: indentation + 2)
            let closingIndent = String(repeating: " ", count: indentation)
            let body = entries.map { key, value in
                "\(childIndent)\"\(escape(key))\": \(value.rendered(indentation: indentation + 2))"
            }.joined(separator: ",\n")
            return "{\n\(body)\n\(closingIndent)}"
        case let .array(values):
            guard values.isEmpty == false else { return "[]" }
            let childIndent = String(repeating: " ", count: indentation + 2)
            let closingIndent = String(repeating: " ", count: indentation)
            let body = values.map { value in
                "\(childIndent)\(value.rendered(indentation: indentation + 2))"
            }.joined(separator: ",\n")
            return "[\n\(body)\n\(closingIndent)]"
        case let .string(value):
            return "\"\(escape(value))\""
        case let .number(value):
            return LiquidCanonicalJSON.string(for: value)
        case let .bool(value):
            return value ? "true" : "false"
        case .null:
            return "null"
        }
    }

    private func escape(_ value: String) -> String {
        var output = ""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": output += "\\\""
            case "\\": output += "\\\\"
            case "\n": output += "\\n"
            case "\r": output += "\\r"
            case "\t": output += "\\t"
            default: output.unicodeScalars.append(scalar)
            }
        }
        return output
    }
}

extension LiquidFrameOutput {
    public func canonicalJSONString() -> String {
        jsonValue.rendered() + "\n"
    }

    public var jsonValue: LiquidJSONValue {
        .object([
            ("schemaVersion", .number(Double(schemaVersion))),
            ("sceneId", .string(sceneId)),
            ("fixtureVersion", .number(Double(fixtureVersion))),
            ("samples", .array(samples.map(\.jsonValue)))
        ])
    }
}

extension LiquidFrameSample {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("label", .string(label)),
            ("progress", .number(frame.progress)),
            ("phase", .string(frame.phase)),
            ("events", .array(frame.events.map { .string($0) })),
            ("renderMode", .string(frame.renderMode.rawValue)),
            ("sourceOpacity", .number(frame.sourceOpacity)),
            ("targetOpacity", .number(frame.targetOpacity)),
            ("anchor", frame.frame.anchor.jsonValue),
            ("leftLeg", frame.frame.leftLeg.jsonValue),
            ("rightLeg", frame.frame.rightLeg.jsonValue),
            ("crossbar", frame.frame.crossbar.jsonValue),
            ("bridge", frame.frame.bridge.jsonValue),
            ("blendRadius", .number(frame.frame.blendRadius)),
            ("targetMix", .number(frame.frame.targetMix)),
            ("cornerSharpness", .number(frame.frame.cornerSharpness)),
            ("endpointCommands", frame.endpointCommands.map { .array($0.map(\.jsonValue)) } ?? .null)
        ])
    }
}

extension LiquidPoint {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("x", .number(x)),
            ("y", .number(y))
        ])
    }
}

extension LiquidCapsule {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("start", start.jsonValue),
            ("end", end.jsonValue),
            ("radius", .number(radius))
        ])
    }
}

extension LiquidPathCommand {
    public var jsonValue: LiquidJSONValue {
        if let values {
            return .object([
                ("type", .string(type)),
                ("values", .array(values.map { .number($0) }))
            ])
        }
        return .object([
            ("type", .string(type))
        ])
    }
}

extension LiquidFrameOutputV2 {
    public func canonicalJSONString() -> String {
        jsonValue.rendered() + "\n"
    }

    public var jsonValue: LiquidJSONValue {
        .object([
            ("schemaVersion", .number(Double(schemaVersion))),
            ("sceneId", .string(sceneId)),
            ("fixtureVersion", .number(Double(fixtureVersion))),
            ("samples", .array(samples.map(\.jsonValue)))
        ])
    }
}

extension LiquidFrameSampleV2 {
    public var jsonValue: LiquidJSONValue {
        frame.jsonValue(label: label)
    }
}

extension LiquidFrameV2 {
    public func jsonValue(label: String? = nil) -> LiquidJSONValue {
        .object([
            ("label", .string(label ?? self.label)),
            ("progress", .number(progress)),
            ("events", .array(events.map(\.jsonValue))),
            ("tracks", .array(tracks.map(\.jsonValue)))
        ])
    }
}

extension LiquidActiveSemanticEvent {
    public var jsonValue: LiquidJSONValue {
        var entries: [(String, LiquidJSONValue)] = [
            ("id", .string(id)),
            ("kind", .string(kind.rawValue)),
            ("trackId", .string(trackId)),
            ("at", .number(at))
        ]
        if let end {
            entries.append(("end", .number(end)))
        }
        if let componentId {
            entries.append(("componentId", .string(componentId)))
        }
        if let payload {
            entries.append(("payload", payload.jsonValue))
        }
        return .object(entries)
    }
}

extension LiquidTrackFrame {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("id", .string(id)),
            ("progress", .number(progress)),
            ("localProgress", .number(localProgress)),
            ("renderMode", .string(renderMode.rawValue)),
            ("sourceOpacity", .number(sourceOpacity)),
            ("targetOpacity", .number(targetOpacity)),
            ("source", source.jsonValue),
            ("target", target.jsonValue),
            ("endpointCommands", endpointCommands.map { .array($0.map(\.jsonValue)) } ?? .null),
            ("components", .array(components.map(\.jsonValue))),
            ("material", material.jsonValue)
        ])
    }
}

extension LiquidEndpoint {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("assetId", .string(assetId)),
            ("shapeId", .string(shapeId)),
            ("transform", transform.jsonValue),
            ("commands", .array(commands.map(\.jsonValue)))
        ])
    }
}

extension LiquidTransform {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("translateX", .number(translateX)),
            ("translateY", .number(translateY)),
            ("scaleX", .number(scaleX)),
            ("scaleY", .number(scaleY))
        ])
    }
}

extension LiquidComponentFrame {
    public var jsonValue: LiquidJSONValue {
        var entries: [(String, LiquidJSONValue)] = [
            ("id", .string(id)),
            ("kind", .string(kind.rawValue)),
            ("operation", .string(operation.rawValue))
        ]
        if let groupId {
            entries.append(("groupId", .string(groupId)))
        }
        entries.append(("primitive", primitive.jsonValue))
        entries.append(("material", material.jsonValue))
        return .object(entries)
    }
}

extension LiquidPrimitive {
    public var jsonValue: LiquidJSONValue {
        switch self {
        case let .capsule(capsule):
            return .object([
                ("kind", .string("capsule")),
                ("start", capsule.start.jsonValue),
                ("end", capsule.end.jsonValue),
                ("radius", .number(capsule.radius))
            ])
        case let .ribbon(ribbon):
            return .object([
                ("kind", .string("ribbon")),
                ("p0", ribbon.p0.jsonValue),
                ("p1", ribbon.p1.jsonValue),
                ("p2", ribbon.p2.jsonValue),
                ("p3", ribbon.p3.jsonValue),
                ("startRadius", .number(ribbon.startRadius)),
                ("endRadius", .number(ribbon.endRadius))
            ])
        case let .ellipse(ellipse):
            var entries: [(String, LiquidJSONValue)] = [
                ("kind", .string("ellipse")),
                ("center", ellipse.center.jsonValue),
                ("radiusX", .number(ellipse.radiusX)),
                ("radiusY", .number(ellipse.radiusY))
            ]
            if let rotation = ellipse.rotation {
                entries.append(("rotation", .number(rotation)))
            }
            return .object(entries)
        }
    }
}

extension LiquidTrackFrameMaterial {
    public var jsonValue: LiquidJSONValue {
        .object([
            ("components", components.jsonValue),
            ("groups", groups.jsonValue)
        ])
    }
}

extension Dictionary where Key == String, Value == LiquidMaterialValues {
    public var jsonValue: LiquidJSONValue {
        .object(keys.sorted().map { key in
            (key, self[key]?.jsonValue ?? .object([]))
        })
    }
}

extension Dictionary where Key == String, Value == LiquidMaterialScalar {
    public var jsonValue: LiquidJSONValue {
        .object(keys.sorted().map { key in
            (key, self[key]?.jsonValue ?? .null)
        })
    }
}

extension LiquidMaterialScalar {
    public var jsonValue: LiquidJSONValue {
        switch self {
        case let .number(value):
            return .number(value)
        case let .string(value):
            return .string(value)
        case let .bool(value):
            return .bool(value)
        }
    }
}

extension AnyLiquidFrameOutput {
    public func canonicalJSONString() -> String {
        switch self {
        case let .v1(output):
            return output.canonicalJSONString()
        case let .v2(output):
            return output.canonicalJSONString()
        }
    }
}

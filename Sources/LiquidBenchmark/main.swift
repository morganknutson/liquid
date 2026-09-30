import Foundation
import LiquidCore
import LiquidMac
import LiquidScenes

private let defaultIterations = 3
private let defaultWarmup = 1
private let defaultScales = [1.0, 2.0, 3.0]
private let defaultBudgets: [String: [String: Double]] = [
    "capsule-to-a": ["1": 35, "2": 110, "3": 240],
    "spinner-to-ad": ["1": 220, "2": 850, "3": 2100],
    "spinner-to-addy": ["1": 900, "2": 3600, "3": 8400]
]

private struct Options {
    var iterations = defaultIterations
    var warmup = defaultWarmup
    var scales = defaultScales
    var sampleLabels: Set<String>?
    var scenes: Set<LiquidBundledScene>?
    var backend = LiquidRendererBackend.coreGraphics
    var enforceBudgets = false
    var budgetMs: Double?
}

private struct BenchmarkOutput: Encodable {
    var schemaVersion: Int
    var runner: String
    var measuredUnit: String
    var budgetPolicy: BudgetPolicy
    var options: OutputOptions
    var results: [BenchmarkResult]
    var failures: [String]
}

private struct BudgetPolicy: Encodable {
    var enforced: Bool
    var metric: String
    var defaults: [String: [String: Double]]
    var note: String
}

private struct OutputOptions: Encodable {
    var iterations: Int
    var warmup: Int
    var scales: [Double]
    var sampleLabels: [String]?
    var scenes: [String]?
    var backend: String
    var budgetMs: Double?
}

private struct BenchmarkResult: Encodable {
    var sceneId: String
    var schemaVersion: Int
    var requestedBackend: String
    var resolvedBackend: String
    var mode: String
    var scale: Double
    var width: Int
    var height: Int
    var samples: Int
    var iterations: Int
    var medianMs: Double
    var p95Ms: Double
    var minMs: Double
    var maxMs: Double
}

private func parseOptions(_ arguments: [String]) throws -> Options {
    var options = Options()
    for argument in arguments {
        if argument == "--enforce-budgets" {
            options.enforceBudgets = true
        } else if argument == "--json" {
            continue
        } else if argument.hasPrefix("--iterations=") {
            options.iterations = try positiveInteger(argument, prefix: "--iterations=")
        } else if argument.hasPrefix("--warmup=") {
            options.warmup = try nonNegativeInteger(argument, prefix: "--warmup=")
        } else if argument.hasPrefix("--scales=") {
            options.scales = try argument.dropFirst("--scales=".count).split(separator: ",").map { value in
                guard let scale = Double(value), scale > 0 else {
                    throw BenchmarkError.invalidOption("--scales must contain positive numbers")
                }
                return scale
            }
        } else if argument.hasPrefix("--samples=") {
            options.sampleLabels = Set(argument.dropFirst("--samples=".count).split(separator: ",").map(String.init))
        } else if argument.hasPrefix("--scenes=") {
            options.scenes = try parseScenes(String(argument.dropFirst("--scenes=".count)))
        } else if argument.hasPrefix("--backend=") {
            options.backend = try parseBackend(String(argument.dropFirst("--backend=".count)))
        } else if argument.hasPrefix("--budget-ms=") {
            guard let value = Double(argument.dropFirst("--budget-ms=".count)), value > 0 else {
                throw BenchmarkError.invalidOption("--budget-ms must be a positive number")
            }
            options.budgetMs = value
        } else {
            throw BenchmarkError.invalidOption("Unknown benchmark option \(argument)")
        }
    }
    return options
}

private func parseScenes(_ value: String) throws -> Set<LiquidBundledScene> {
    let scenes = try value.split(separator: ",").map { rawValue -> LiquidBundledScene in
        guard let scene = LiquidBundledScene(rawValue: String(rawValue)) else {
            throw BenchmarkError.invalidOption("--scenes entries must be one of \(LiquidBundledScene.allCases.map(\.rawValue).joined(separator: ","))")
        }
        return scene
    }
    guard scenes.isEmpty == false else {
        throw BenchmarkError.invalidOption("--scenes must include at least one scene id")
    }
    return Set(scenes)
}

private func parseBackend(_ value: String) throws -> LiquidRendererBackend {
    switch value {
    case "cpu":
        return .coreGraphics
    case "coreGraphics", "metal", "auto":
        return LiquidRendererBackend(rawValue: value)!
    default:
        throw BenchmarkError.invalidOption("--backend must be auto, coreGraphics, metal, or cpu")
    }
}

private func positiveInteger(_ argument: String, prefix: String) throws -> Int {
    guard let value = Int(argument.dropFirst(prefix.count)), value > 0 else {
        throw BenchmarkError.invalidOption("\(prefix.dropLast()) must be a positive integer")
    }
    return value
}

private func nonNegativeInteger(_ argument: String, prefix: String) throws -> Int {
    guard let value = Int(argument.dropFirst(prefix.count)), value >= 0 else {
        throw BenchmarkError.invalidOption("\(prefix.dropLast()) must be a non-negative integer")
    }
    return value
}

private enum BenchmarkError: Error, CustomStringConvertible {
    case invalidOption(String)
    case noSamples(String)

    var description: String {
        switch self {
        case let .invalidOption(message), let .noSamples(message):
            return message
        }
    }
}

private func dimensions(scene: AnyLiquidScene, scale: Double) -> (width: Int, height: Int) {
    (
        max(1, Int((scene.coordinateSpace.width * scale).rounded())),
        max(1, Int((scene.coordinateSpace.height * scale).rounded()))
    )
}

private func filteredSamples(_ manifest: LiquidSampleManifest, labels: Set<String>?) throws -> [LiquidSampleRequest] {
    guard let labels else { return manifest.samples }
    let samples = manifest.samples.filter { labels.contains($0.label) }
    guard samples.isEmpty == false else {
        throw BenchmarkError.noSamples("No samples matched \(labels.sorted().joined(separator: ","))")
    }
    return samples
}

private func measure(
    scene: AnyLiquidScene,
    samples: [LiquidSampleRequest],
    width: Int,
    height: Int,
    backend: LiquidRendererBackend,
    renderer: LiquidCGRenderer,
    metalRenderer: LiquidMetalRenderer?
) throws -> (durations: [Double], resolvedBackend: LiquidResolvedRendererBackend) {
    let evaluator = LiquidEvaluator()
    var resolvedBackend = LiquidResolvedRendererBackend.coreGraphics
    let durations = try samples.map { sample in
        let started = DispatchTime.now().uptimeNanoseconds
        switch scene {
        case let .v1(scene):
            let frame = evaluator.evaluate(scene: scene, progress: sample.progress)
            _ = renderer.renderAlphaMask(scene: scene, frame: frame, width: width, height: height)
        case let .v2(scene):
            let frame = try evaluator.evaluateChecked(scene: scene, progress: sample.progress)
            if backend != .coreGraphics,
               let metalRenderer,
               metalRenderer.canRender(scene: scene, frame: frame, width: width, height: height),
               metalRenderer.renderAlphaMask(scene: scene, frame: frame, width: width, height: height) != nil {
                resolvedBackend = .metal
            } else {
                _ = renderer.renderAlphaMask(scene: scene, frame: frame, width: width, height: height)
                resolvedBackend = .coreGraphics
            }
        }
        let ended = DispatchTime.now().uptimeNanoseconds
        return Double(ended - started) / 1_000_000
    }
    return (durations, resolvedBackend)
}

private func summary(_ durations: [Double]) -> (median: Double, p95: Double, min: Double, max: Double) {
    let sorted = durations.sorted()
    guard let first = sorted.first, let last = sorted.last else {
        return (0, 0, 0, 0)
    }
    let median = sorted[(sorted.count - 1) / 2]
    let p95 = sorted[min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)]
    return (round3(median), round3(p95), round3(first), round3(last))
}

private func round3(_ value: Double) -> Double {
    (value * 1000).rounded() / 1000
}

private func runBenchmark(options: Options) throws -> BenchmarkOutput {
    let renderer = LiquidCGRenderer()
    let metalRenderer = options.backend == .coreGraphics ? nil : LiquidMetalRenderer()
    var results: [BenchmarkResult] = []

    let sceneIds = LiquidBundledScene.allCases.filter { options.scenes?.contains($0) ?? true }
    for sceneId in sceneIds {
        let scene = try LiquidScenes.loadScene(sceneId)
        let manifest = try LiquidScenes.loadSampleManifest(sceneId)
        let samples = try filteredSamples(manifest, labels: options.sampleLabels)
        for scale in options.scales {
            let size = dimensions(scene: scene, scale: scale)
            let cold = try measure(scene: scene, samples: samples, width: size.width, height: size.height, backend: options.backend, renderer: LiquidCGRenderer(), metalRenderer: options.backend == .coreGraphics ? nil : LiquidMetalRenderer())
            let coldStats = summary(cold.durations)
            results.append(BenchmarkResult(
                sceneId: scene.id,
                schemaVersion: scene.schemaVersion,
                requestedBackend: options.backend.rawValue,
                resolvedBackend: cold.resolvedBackend.rawValue,
                mode: "cold",
                scale: scale,
                width: size.width,
                height: size.height,
                samples: samples.count,
                iterations: 1,
                medianMs: coldStats.median,
                p95Ms: coldStats.p95,
                minMs: coldStats.min,
                maxMs: coldStats.max
            ))
            for _ in 0..<options.warmup {
                _ = try measure(scene: scene, samples: samples, width: size.width, height: size.height, backend: options.backend, renderer: renderer, metalRenderer: metalRenderer)
            }
            var durations: [Double] = []
            var resolvedBackend = LiquidResolvedRendererBackend.coreGraphics
            for _ in 0..<options.iterations {
                let measured = try measure(scene: scene, samples: samples, width: size.width, height: size.height, backend: options.backend, renderer: renderer, metalRenderer: metalRenderer)
                durations.append(contentsOf: measured.durations)
                resolvedBackend = measured.resolvedBackend
            }
            let stats = summary(durations)
            results.append(BenchmarkResult(
                sceneId: scene.id,
                schemaVersion: scene.schemaVersion,
                requestedBackend: options.backend.rawValue,
                resolvedBackend: resolvedBackend.rawValue,
                mode: "warm",
                scale: scale,
                width: size.width,
                height: size.height,
                samples: samples.count,
                iterations: options.iterations,
                medianMs: stats.median,
                p95Ms: stats.p95,
                minMs: stats.min,
                maxMs: stats.max
            ))
        }
    }

    let failures = options.enforceBudgets ? results.compactMap { result -> String? in
        let budget = options.budgetMs ?? defaultBudgets[result.sceneId]?[String(Int(result.scale))]
        guard let budget, result.mode == "warm", result.p95Ms > budget else {
            return nil
        }
        return "\(result.sceneId) \(result.scale)x p95 \(result.p95Ms)ms exceeded budget \(budget)ms"
    } : []

    return BenchmarkOutput(
        schemaVersion: 1,
        runner: "liquid-swift-render-alpha-mask",
        measuredUnit: "milliseconds per rasterized frame",
        budgetPolicy: BudgetPolicy(
            enforced: options.enforceBudgets,
            metric: "p95Ms",
            defaults: defaultBudgets,
            note: "Budgets are conservative production guardrails and are enforced only with --enforce-budgets."
        ),
        options: OutputOptions(
            iterations: options.iterations,
            warmup: options.warmup,
            scales: options.scales,
            sampleLabels: options.sampleLabels.map { $0.sorted() },
            scenes: options.scenes.map { $0.map(\.rawValue).sorted() },
            backend: options.backend.rawValue,
            budgetMs: options.budgetMs
        ),
        results: results,
        failures: failures
    )
}

do {
    let output = try runBenchmark(options: parseOptions(Array(CommandLine.arguments.dropFirst())))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(output))
    FileHandle.standardOutput.write(Data("\n".utf8))
    if output.failures.isEmpty == false {
        exit(1)
    }
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}

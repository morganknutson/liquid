import { AuthoringDocument, canonicalSerialize, insertKeyframe, insertPose, patchKeyframe, patchPose, patchTrack, patchTrackEvent } from "@liquid/author";
import {
  evaluateFrame,
  transformPath,
  validateScene,
  type AnyLiquidFrameSample,
  type AnyLiquidScene,
  type Capsule,
  type ComponentDefinition,
  type ComponentFrame,
  type ComponentState,
  type EasingName,
  type LiquidFrameSample,
  type LiquidFrameSampleV2,
  type LiquidScene,
  type LiquidSceneV2,
  type LiquidTrack,
  type MaterialValues,
  type PathCommand,
  type Point,
  type Pose,
  type PoseFrame,
  type Primitive,
  type SemanticEvent,
  type TrackFrame,
  type TrackKeyframe,
} from "@liquid/core";
import { LiquidCanvasRenderer, LiquidWebGLRenderer, viewportFor, type LiquidRendererBackend } from "@liquid/web";
import sceneV1Data from "../../../shared/scenes/capsule-to-a.v1.json" with { type: "json" };
import sceneAdStudyData from "../../../shared/scenes/spinner-to-ad.v2.json" with { type: "json" };
import sceneV2Data from "../../../shared/scenes/spinner-to-addy.v2.json" with { type: "json" };
import "./style.css";

type SceneChoice = "v1" | "v2" | "ad-study";

const sceneChoices = {
  v1: {
    label: "Capsule to A",
    document: new AuthoringDocument(sceneV1Data as LiquidScene),
    fixtureSnapshot: canonicalSerialize(sceneV1Data),
  },
  v2: {
    label: "Spinner to Addy",
    document: new AuthoringDocument(sceneV2Data as LiquidSceneV2),
    fixtureSnapshot: canonicalSerialize(sceneV2Data),
  },
  "ad-study": {
    label: "Spinner to A+d study",
    document: new AuthoringDocument(sceneAdStudyData as LiquidSceneV2),
    fixtureSnapshot: canonicalSerialize(sceneAdStudyData),
  },
} satisfies Record<SceneChoice, { readonly label: string; readonly document: AuthoringDocument; readonly fixtureSnapshot: string }>;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required lab element ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>("#liquid-canvas");
const sceneSelect = requiredElement<HTMLSelectElement>("#scene-select");
const playButton = requiredElement<HTMLButtonElement>("#play");
const restartButton = requiredElement<HTMLButtonElement>("#restart");
const scrubber = requiredElement<HTMLInputElement>("#scrub");
const speedInput = requiredElement<HTMLInputElement>("#speed");
const resetTuningButton = requiredElement<HTMLButtonElement>("#reset-tuning");
const insertCurrentButton = requiredElement<HTMLButtonElement>("#insert-current");
const commitSceneButton = requiredElement<HTMLButtonElement>("#commit-scene");
const resetCommittedButton = requiredElement<HTMLButtonElement>("#reset-committed");
const snapshotNameInput = requiredElement<HTMLInputElement>("#snapshot-name");
const saveSnapshotButton = requiredElement<HTMLButtonElement>("#save-snapshot");
const exportJsonButton = requiredElement<HTMLButtonElement>("#export-json");
const copyJsonButton = requiredElement<HTMLButtonElement>("#copy-json");
const legSeparationInput = requiredElement<HTMLInputElement>("#leg-separation");
const gooStrengthInput = requiredElement<HTMLInputElement>("#goo-strength");
const bridgeThicknessInput = requiredElement<HTMLInputElement>("#bridge-thickness");
const crossbarThicknessInput = requiredElement<HTMLInputElement>("#crossbar-thickness");
const targetBiasInput = requiredElement<HTMLInputElement>("#target-bias");
const v1Controls = requiredElement<HTMLElement>("#v1-authoring-controls");
const v2Controls = requiredElement<HTMLElement>("#v2-authoring-controls");
const v2TrackSelect = requiredElement<HTMLSelectElement>("#v2-track");
const v2ComponentSelect = requiredElement<HTMLSelectElement>("#v2-component");
const v2KeyframeSelect = requiredElement<HTMLSelectElement>("#v2-keyframe");
const v2UpsertKeyframeButton = requiredElement<HTMLButtonElement>("#v2-upsert-keyframe");
const v2PrimitiveFields = requiredElement<HTMLElement>("#v2-primitive-fields");
const v2KeyframeAtInput = requiredElement<HTMLInputElement>("#v2-keyframe-at");
const v2KeyframeEasingSelect = requiredElement<HTMLSelectElement>("#v2-keyframe-easing");
const v2ComponentKindInput = requiredElement<HTMLInputElement>("#v2-component-kind");
const v2ComponentOperationSelect = requiredElement<HTMLSelectElement>("#v2-component-operation");
const v2ComponentGroupInput = requiredElement<HTMLInputElement>("#v2-component-group");
const v2MaterialScopeSelect = requiredElement<HTMLSelectElement>("#v2-material-scope");
const v2MaterialBlendRadiusInput = requiredElement<HTMLInputElement>("#v2-material-blend-radius");
const v2MaterialTargetMixInput = requiredElement<HTMLInputElement>("#v2-material-target-mix");
const v2MaterialCornerSharpnessInput = requiredElement<HTMLInputElement>("#v2-material-corner-sharpness");
const v2TrackStartInput = requiredElement<HTMLInputElement>("#v2-track-start");
const v2TrackEndInput = requiredElement<HTMLInputElement>("#v2-track-end");
const v2EventSelect = requiredElement<HTMLSelectElement>("#v2-event");
const v2EventAtInput = requiredElement<HTMLInputElement>("#v2-event-at");
const v2EventEndInput = requiredElement<HTMLInputElement>("#v2-event-end");
const v2EventEndLabel = requiredElement<HTMLElement>("#v2-event-end-label");
const v2SceneDurationInput = requiredElement<HTMLInputElement>("#v2-scene-duration");
const v2ReducedDurationInput = requiredElement<HTMLInputElement>("#v2-reduced-duration");
const v2ReducedFadeStartInput = requiredElement<HTMLInputElement>("#v2-reduced-fade-start");
const v2ReducedFadeEndInput = requiredElement<HTMLInputElement>("#v2-reduced-fade-end");
const v2SoloTrackInput = requiredElement<HTMLInputElement>("#v2-solo-track");
const v2TargetOverlayInput = requiredElement<HTMLInputElement>("#v2-target-overlay");
const v2EditError = requiredElement<HTMLElement>("#v2-edit-error");
const v2TrackContext = requiredElement<HTMLElement>("#v2-track-context");
const v2ComponentContext = requiredElement<HTMLElement>("#v2-component-context");
const v2KeyframeContext = requiredElement<HTMLElement>("#v2-keyframe-context");
const debugInput = requiredElement<HTMLInputElement>("#debug");
const reducedInput = requiredElement<HTMLInputElement>("#reduced");
const phaseText = requiredElement<HTMLElement>("#phase");
const timeText = requiredElement<HTMLElement>("#time");
const eventsText = requiredElement<HTMLElement>("#events");
const mixText = requiredElement<HTMLElement>("#mix");
const bridgeText = requiredElement<HTMLElement>("#bridge");
const dirtyText = requiredElement<HTMLElement>("#dirty");
const diffText = requiredElement<HTMLElement>("#diff");
const snapshotsText = requiredElement<HTMLElement>("#snapshots");
const exportOutput = requiredElement<HTMLTextAreaElement>("#export-output");
const legSeparationValue = requiredElement<HTMLOutputElement>("#leg-separation-value");
const gooStrengthValue = requiredElement<HTMLOutputElement>("#goo-strength-value");
const bridgeThicknessValue = requiredElement<HTMLOutputElement>("#bridge-thickness-value");
const crossbarThicknessValue = requiredElement<HTMLOutputElement>("#crossbar-thickness-value");
const targetBiasValue = requiredElement<HTMLOutputElement>("#target-bias-value");

interface LabTuning {
  readonly legSeparation: number;
  readonly gooStrength: number;
  readonly bridgeThickness: number;
  readonly crossbarThickness: number;
  readonly targetBias: number;
}

const tuningDefaults: LabTuning = {
  legSeparation: 0,
  gooStrength: 1,
  bridgeThickness: 1,
  crossbarThickness: 1,
  targetBias: 0,
};

const tuningInputs = {
  legSeparation: legSeparationInput,
  gooStrength: gooStrengthInput,
  bridgeThickness: bridgeThicknessInput,
  crossbarThickness: crossbarThicknessInput,
  targetBias: targetBiasInput,
} satisfies Record<keyof LabTuning, HTMLInputElement>;

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const cpuRenderer = new LiquidCanvasRenderer(canvas);
let webglRenderer: LiquidWebGLRenderer | null = null;

const v1CpuMaxBackingDimension = 384;
const v2CpuMaxBackingDimension = 512;
const v2ExactCpuMaxBackingDimension = 2048;
const v2WebGLFieldMaxBackingDimension = 512;
const v2ViewportPadding = 24;
const maxBackingScale = 2;
let progress = 0;
let playing = true;
let lastTimestamp = performance.now();
let selectedScene: SceneChoice = "v1";
let selectedTrackId = "";
let selectedComponentId = "";
let selectedKeyframeAt = 0;
let selectedMaterialScope = "group:$track";
let selectedEventId = "";
let v2PendingNumericInput: HTMLInputElement | null = null;
reducedInput.checked = prefersReduced.matches;

function activeDocument(): AuthoringDocument {
  return sceneChoices[selectedScene].document;
}

function workingScene(): AnyLiquidScene {
  return activeDocument().scene;
}

function committedScene(): AnyLiquidScene {
  return activeDocument().committedScene;
}

function workingSceneV1(): LiquidScene {
  const scene = workingScene();
  if (scene.schemaVersion !== 1) throw new Error("Expected the v1 capsule scene");
  return scene;
}

function committedSceneV1(): LiquidScene {
  const scene = committedScene();
  if (scene.schemaVersion !== 1) throw new Error("Expected the committed v1 capsule scene");
  return scene;
}

function workingSceneV2(): LiquidSceneV2 {
  const scene = workingScene();
  if (scene.schemaVersion !== 2) throw new Error("Expected the v2 spinner scene");
  return scene;
}

function isSceneChoice(value: string): value is SceneChoice {
  return value in sceneChoices;
}

interface RendererSelection {
  readonly renderer: LiquidCanvasRenderer;
  readonly backend: LiquidRendererBackend;
  readonly reason: string;
  readonly maxBackingDimension: number;
  readonly webglSupported: boolean;
  readonly webglSceneSupported: boolean;
}

function ensureWebGLRenderer(): LiquidWebGLRenderer | null {
  if (webglRenderer) return webglRenderer;
  const renderer = new LiquidWebGLRenderer(canvas);
  if (!renderer.capabilities.supported) {
    renderer.destroy();
    return null;
  }
  webglRenderer = renderer;
  return webglRenderer;
}

function exactEndpointForV2(frame: LiquidFrameSampleV2): string {
  if (frame.tracks.every((track) => track.renderMode === "sourcePath")) return "source";
  if (frame.tracks.every((track) => track.renderMode === "targetPath")) return "target";
  return "none";
}

function usesExactCpuPath(frame: LiquidFrameSampleV2): boolean {
  const [firstTrack, ...restTracks] = frame.tracks;
  if (!firstTrack) return false;
  return (
    (firstTrack.renderMode === "sourcePath" || firstTrack.renderMode === "targetPath" || firstTrack.renderMode === "crossfade") &&
    restTracks.every((track) => track.renderMode === firstTrack.renderMode)
  );
}

function selectRendererFor(scene: AnyLiquidScene, frame: AnyLiquidFrameSample): RendererSelection {
  if (scene.schemaVersion !== 2) {
    return {
      renderer: cpuRenderer,
      backend: "cpu",
      reason: "schema-v1",
      maxBackingDimension: v1CpuMaxBackingDimension,
      webglSupported: false,
      webglSceneSupported: false,
    };
  }

  const webglSceneSupported = LiquidWebGLRenderer.supportsScene(scene);
  const webgl = webglSceneSupported ? ensureWebGLRenderer() : null;
  const webglSupported = webgl?.capabilities.supported ?? false;
  const frameV2 = frame as LiquidFrameSampleV2;

  if (debugInput.checked) {
    return {
      renderer: cpuRenderer,
      backend: "cpu",
      reason: "debug",
      maxBackingDimension: v2CpuMaxBackingDimension,
      webglSupported,
      webglSceneSupported,
    };
  }

  if (v2TargetOverlayInput.checked) {
    return {
      renderer: cpuRenderer,
      backend: "cpu",
      reason: "target-overlay",
      maxBackingDimension: v2CpuMaxBackingDimension,
      webglSupported,
      webglSceneSupported,
    };
  }

  if (usesExactCpuPath(frameV2)) {
    return {
      renderer: cpuRenderer,
      backend: "cpu",
      reason: "exact-endpoint",
      maxBackingDimension: v2ExactCpuMaxBackingDimension,
      webglSupported,
      webglSceneSupported,
    };
  }

  if (!webglSceneSupported || !webgl) {
    return {
      renderer: cpuRenderer,
      backend: "cpu",
      reason: webglSceneSupported ? "webgl-unavailable" : "unsupported-scene",
      maxBackingDimension: v2CpuMaxBackingDimension,
      webglSupported,
      webglSceneSupported,
    };
  }

  return {
    renderer: webgl,
    backend: "webgl2",
    reason: "field",
    maxBackingDimension: v2WebGLFieldMaxBackingDimension,
    webglSupported,
    webglSceneSupported,
  };
}

function syncCanvasAspectRatio(scene: AnyLiquidScene, viewportPadding: number): void {
  const aspectRatio = scene.schemaVersion === 2
    ? `${scene.coordinateSpace.width + viewportPadding * 2} / ${scene.coordinateSpace.height + viewportPadding * 2}`
    : "4 / 3";
  if (canvas.style.getPropertyValue("--liquid-canvas-aspect-ratio") !== aspectRatio) {
    canvas.style.setProperty("--liquid-canvas-aspect-ratio", aspectRatio);
  }
}

function resizeCanvas(maxBackingDimension: number): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const requestedScale = Math.min(Math.max(1, dpr), maxBackingScale);
  const dimensionScale = maxBackingDimension / Math.max(cssWidth, cssHeight);
  const backingScale = Math.min(requestedScale, dimensionScale);
  const backingWidth = Math.max(1, Math.round(cssWidth * backingScale));
  const backingHeight = Math.max(1, Math.round(cssHeight * backingScale));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  canvas.dataset.backingWidth = String(canvas.width);
  canvas.dataset.backingHeight = String(canvas.height);
  canvas.dataset.backingScale = Math.min(canvas.width / cssWidth, canvas.height / cssHeight).toFixed(6);
  canvas.dataset.maxBackingDimension = String(maxBackingDimension);
  canvas.dataset.devicePixelRatio = dpr.toFixed(6);
}

function numericValue(input: HTMLInputElement): number {
  return Number(input.value);
}

function currentTuning(): LabTuning {
  return {
    legSeparation: numericValue(legSeparationInput),
    gooStrength: numericValue(gooStrengthInput),
    bridgeThickness: numericValue(bridgeThicknessInput),
    crossbarThickness: numericValue(crossbarThicknessInput),
    targetBias: numericValue(targetBiasInput),
  };
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function updateTuningValues(tuning: LabTuning): void {
  legSeparationValue.value = signed(tuning.legSeparation, 1);
  gooStrengthValue.value = `${tuning.gooStrength.toFixed(2)}x`;
  bridgeThicknessValue.value = `${tuning.bridgeThickness.toFixed(2)}x`;
  crossbarThicknessValue.value = `${tuning.crossbarThickness.toFixed(2)}x`;
  targetBiasValue.value = signed(tuning.targetBias, 2);
}

function cloneCapsule(capsule: Capsule): Capsule {
  return {
    start: { ...capsule.start },
    end: { ...capsule.end },
    radius: capsule.radius,
  };
}

function moveCapsuleX(capsule: Capsule, offset: number): Capsule {
  return {
    start: { x: capsule.start.x + offset, y: capsule.start.y },
    end: { x: capsule.end.x + offset, y: capsule.end.y },
    radius: capsule.radius,
  };
}

function scaleCapsuleRadius(capsule: Capsule, factor: number): Capsule {
  return {
    start: { ...capsule.start },
    end: { ...capsule.end },
    radius: Math.max(0, capsule.radius * factor),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function tunedFrame(frame: LiquidFrameSample, tuning: LabTuning): LiquidFrameSample {
  const cloned: LiquidFrameSample = {
    ...frame,
    anchor: { ...frame.anchor },
    leftLeg: cloneCapsule(frame.leftLeg),
    rightLeg: cloneCapsule(frame.rightLeg),
    crossbar: cloneCapsule(frame.crossbar),
    bridge: cloneCapsule(frame.bridge),
  };

  if (cloned.renderMode !== "field") return cloned;

  return {
    ...cloned,
    leftLeg: moveCapsuleX(cloned.leftLeg, -tuning.legSeparation),
    rightLeg: moveCapsuleX(cloned.rightLeg, tuning.legSeparation),
    crossbar: scaleCapsuleRadius(cloned.crossbar, tuning.crossbarThickness),
    bridge: scaleCapsuleRadius(cloned.bridge, tuning.bridgeThickness),
    blendRadius: Math.max(0, cloned.blendRadius * tuning.gooStrength),
    targetMix: clamp01(cloned.targetMix + tuning.targetBias),
    cornerSharpness: clamp01(cloned.cornerSharpness + tuning.targetBias),
  };
}

function poseFromFrame(frame: PoseFrame, at: number): Pose {
  return {
    at,
    easing: "smoothStep",
    frame: {
      anchor: { ...frame.anchor },
      leftLeg: cloneCapsule(frame.leftLeg),
      rightLeg: cloneCapsule(frame.rightLeg),
      crossbar: cloneCapsule(frame.crossbar),
      bridge: cloneCapsule(frame.bridge),
      blendRadius: frame.blendRadius,
      targetMix: frame.targetMix,
      cornerSharpness: frame.cornerSharpness,
    },
  };
}

function resetTuningInputs(): void {
  for (const [key, input] of Object.entries(tuningInputs) as [keyof LabTuning, HTMLInputElement][]) {
    input.value = String(tuningDefaults[key]);
  }
}

function editWorkingPoseAtProgress(): void {
  if (selectedScene !== "v1") return;
  const at = Number(progress.toFixed(6));
  const baseFrame = evaluateFrame(committedSceneV1(), at, { reducedMotion: false });
  if (baseFrame.renderMode !== "field") return;
  const nextPose = poseFromFrame(tunedFrame(baseFrame, currentTuning()), at);
  const scene = workingSceneV1();
  const nextScene = scene.poses.some((pose) => pose.at === at)
    ? patchPose(scene, at, nextPose)
    : insertPose(scene, nextPose);
  activeDocument().replaceWorking(nextScene);
}

function exportCanonicalScene(): string {
  const serialized = canonicalSerialize(workingScene());
  exportOutput.value = serialized;
  return serialized;
}

function updateDocumentStatus(): void {
  const document = activeDocument();
  const diff = document.diff();
  const changedPaths = diff.changedPaths.slice(0, 4);
  dirtyText.textContent = document.dirty ? "dirty" : "clean";
  diffText.textContent = changedPaths.length > 0 ? changedPaths.join(", ") : "none";
  snapshotsText.textContent = document.snapshots().map((snapshot) => snapshot.name).join(", ") || "none";
  exportOutput.dataset.changed = String(diff.changed);
  exportOutput.dataset.hash = diff.afterHash;
}

function ensureV2Selection(scene: LiquidSceneV2): void {
  const track = scene.tracks.find((candidate) => candidate.id === selectedTrackId) ?? scene.tracks[0];
  if (!track) throw new Error("v2 scene has no tracks");
  selectedTrackId = track.id;
  const component = track.components.find((candidate) => candidate.id === selectedComponentId) ?? track.components[0];
  if (!component) throw new Error(`v2 track ${track.id} has no components`);
  selectedComponentId = component.id;
  const keyframe = track.keyframes.find((candidate) => candidate.at === selectedKeyframeAt) ?? track.keyframes[0];
  if (!keyframe) throw new Error(`v2 track ${track.id} has no keyframes`);
  selectedKeyframeAt = keyframe.at;
  selectedEventId = track.events?.some((event) => event.id === selectedEventId) ? selectedEventId : (track.events?.[0]?.id ?? "");
}

function selectedTrack(scene = workingSceneV2()): LiquidSceneV2["tracks"][number] {
  ensureV2Selection(scene);
  const track = scene.tracks.find((candidate) => candidate.id === selectedTrackId);
  if (!track) throw new Error(`Missing selected track ${selectedTrackId}`);
  return track;
}

function selectedKeyframe(track = selectedTrack()): TrackKeyframe {
  const keyframe = track.keyframes.find((candidate) => candidate.at === selectedKeyframeAt);
  if (!keyframe) throw new Error(`Missing keyframe ${selectedKeyframeAt}`);
  return keyframe;
}

function selectedComponentState(keyframe = selectedKeyframe()): ComponentState {
  const component = keyframe.components.find((candidate) => candidate.id === selectedComponentId);
  if (!component) throw new Error(`Missing selected component ${selectedComponentId}`);
  return component;
}

function replaceOptions(select: HTMLSelectElement, values: readonly { value: string; label: string }[], selectedValue: string): void {
  const nextSignature = JSON.stringify(values);
  if (select.dataset.optionsSignature !== nextSignature) {
    select.replaceChildren(...values.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    select.dataset.optionsSignature = nextSignature;
  }
  select.value = selectedValue;
}

const easingNames: readonly EasingName[] = ["linear", "smoothStep", "smootherStep", "easeInCubic", "easeOutCubic"];
const materialKeys = ["blendRadius", "targetMix", "cornerSharpness"] as const;

type MaterialKey = typeof materialKeys[number];
type MaterialScope =
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "component"; readonly id: string };

interface PrimitiveField {
  readonly path: string;
  readonly label: string;
  readonly value: number;
  readonly min?: number;
}

function pauseForEdit(): void {
  playing = false;
}

function markV2DraftInput(input: HTMLInputElement): void {
  if (input.type !== "number") return;
  v2PendingNumericInput = input;
  pauseForEdit();
}

function clearV2DraftInput(input?: HTMLInputElement): void {
  if (!input || v2PendingNumericInput === input) v2PendingNumericInput = null;
}

function clearAllV2Drafts(): void {
  v2PendingNumericInput = null;
}

function setV2Error(message: string | null): void {
  v2EditError.hidden = message === null;
  v2EditError.textContent = message ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFinite(input: HTMLInputElement, label: string): number {
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function readAtLeast(input: HTMLInputElement, label: string, min: number): number {
  const value = readFinite(input, label);
  if (value < min) throw new Error(`${label} must be >= ${min}`);
  return value;
}

function readGreaterThan(input: HTMLInputElement, label: string, min: number): number {
  const value = readFinite(input, label);
  if (value <= min) throw new Error(`${label} must be > ${min}`);
  return value;
}

function readUnitInterval(input: HTMLInputElement, label: string): number {
  const value = readFinite(input, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be in 0...1`);
  return value;
}

function formattedNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function setNumberInput(input: HTMLInputElement, value: number): void {
  if (v2PendingNumericInput === input) return;
  input.value = formattedNumber(value);
}

function selectedComponentDefinition(track = selectedTrack()): ComponentDefinition {
  const component = track.components.find((candidate) => candidate.id === selectedComponentId);
  if (!component) throw new Error(`Missing selected component definition ${selectedComponentId}`);
  return component;
}

function selectedEvent(track = selectedTrack()): SemanticEvent | null {
  if (!track.events || track.events.length === 0) return null;
  const event = track.events.find((candidate) => candidate.id === selectedEventId) ?? track.events[0] ?? null;
  selectedEventId = event?.id ?? "";
  return event;
}

function primitiveFields(primitive: Primitive): readonly PrimitiveField[] {
  if (primitive.kind === "capsule") {
    return [
      { path: "start.x", label: "start.x", value: primitive.start.x },
      { path: "start.y", label: "start.y", value: primitive.start.y },
      { path: "end.x", label: "end.x", value: primitive.end.x },
      { path: "end.y", label: "end.y", value: primitive.end.y },
      { path: "radius", label: "radius", value: primitive.radius, min: 0 },
    ];
  }
  if (primitive.kind === "ellipse") {
    return [
      { path: "center.x", label: "center.x", value: primitive.center.x },
      { path: "center.y", label: "center.y", value: primitive.center.y },
      { path: "radiusX", label: "radiusX", value: primitive.radiusX, min: 0 },
      { path: "radiusY", label: "radiusY", value: primitive.radiusY, min: 0 },
      { path: "rotation", label: "rotation", value: primitive.rotation ?? 0 },
    ];
  }
  return [
    { path: "p0.x", label: "p0.x", value: primitive.p0.x },
    { path: "p0.y", label: "p0.y", value: primitive.p0.y },
    { path: "p1.x", label: "p1.x", value: primitive.p1.x },
    { path: "p1.y", label: "p1.y", value: primitive.p1.y },
    { path: "p2.x", label: "p2.x", value: primitive.p2.x },
    { path: "p2.y", label: "p2.y", value: primitive.p2.y },
    { path: "p3.x", label: "p3.x", value: primitive.p3.x },
    { path: "p3.y", label: "p3.y", value: primitive.p3.y },
    { path: "startRadius", label: "startRadius", value: primitive.startRadius, min: 0 },
    { path: "endRadius", label: "endRadius", value: primitive.endRadius, min: 0 },
  ];
}

function primitiveWithField(primitive: Primitive, path: string, value: number): Primitive {
  if (primitive.kind === "capsule") {
    switch (path) {
      case "start.x": return { ...primitive, start: { ...primitive.start, x: value } };
      case "start.y": return { ...primitive, start: { ...primitive.start, y: value } };
      case "end.x": return { ...primitive, end: { ...primitive.end, x: value } };
      case "end.y": return { ...primitive, end: { ...primitive.end, y: value } };
      case "radius": return { ...primitive, radius: value };
    }
  }
  if (primitive.kind === "ellipse") {
    switch (path) {
      case "center.x": return { ...primitive, center: { ...primitive.center, x: value } };
      case "center.y": return { ...primitive, center: { ...primitive.center, y: value } };
      case "radiusX": return { ...primitive, radiusX: value };
      case "radiusY": return { ...primitive, radiusY: value };
      case "rotation": return { ...primitive, rotation: value };
    }
  }
  if (primitive.kind === "ribbon") {
    switch (path) {
      case "p0.x": return { ...primitive, p0: { ...primitive.p0, x: value } };
      case "p0.y": return { ...primitive, p0: { ...primitive.p0, y: value } };
      case "p1.x": return { ...primitive, p1: { ...primitive.p1, x: value } };
      case "p1.y": return { ...primitive, p1: { ...primitive.p1, y: value } };
      case "p2.x": return { ...primitive, p2: { ...primitive.p2, x: value } };
      case "p2.y": return { ...primitive, p2: { ...primitive.p2, y: value } };
      case "p3.x": return { ...primitive, p3: { ...primitive.p3, x: value } };
      case "p3.y": return { ...primitive, p3: { ...primitive.p3, y: value } };
      case "startRadius": return { ...primitive, startRadius: value };
      case "endRadius": return { ...primitive, endRadius: value };
    }
  }
  throw new Error(`Unsupported primitive field ${path}`);
}

function keyframeWithComponent(keyframe: TrackKeyframe, componentId: string, primitive: Primitive): TrackKeyframe {
  return {
    ...keyframe,
    components: keyframe.components.map((component) => component.id === componentId ? { ...component, primitive } : component),
  };
}

function parseMaterialScope(value: string): MaterialScope {
  if (value.startsWith("component:")) return { kind: "component", id: value.slice("component:".length) };
  return { kind: "group", id: value.slice("group:".length) };
}

function materialScopeValue(scope: MaterialScope): string {
  return `${scope.kind}:${scope.id}`;
}

function isTrackMaterialScope(scope: MaterialScope): boolean {
  return scope.kind === "group" && scope.id === "$track";
}

function materialScopeOptions(track: LiquidTrack, keyframe: TrackKeyframe): readonly { value: string; label: string }[] {
  const groups = new Set<string>(["$track"]);
  for (const component of track.components) {
    if (component.groupId) groups.add(component.groupId);
  }
  for (const groupId of Object.keys(keyframe.material?.groups ?? {})) groups.add(groupId);
  return [
    ...[...groups].sort((a, b) => a.localeCompare(b)).map((id) => ({ value: materialScopeValue({ kind: "group", id }), label: `group ${id}` })),
    ...track.components.map((component) => ({ value: materialScopeValue({ kind: "component", id: component.id }), label: `component ${component.id}` })),
  ];
}

function materialForScope(keyframe: TrackKeyframe, scope: MaterialScope): MaterialValues {
  return scope.kind === "group"
    ? (keyframe.material?.groups?.[scope.id] ?? {})
    : (keyframe.material?.components?.[scope.id] ?? {});
}

function keyframeWithMaterialValue(keyframe: TrackKeyframe, scope: MaterialScope, key: MaterialKey, value: number): TrackKeyframe {
  const groups = { ...(keyframe.material?.groups ?? {}) };
  const components = { ...(keyframe.material?.components ?? {}) };
  if (scope.kind === "group") {
    groups[scope.id] = { ...(groups[scope.id] ?? {}), [key]: value };
  } else {
    components[scope.id] = { ...(components[scope.id] ?? {}), [key]: value };
  }
  const material: TrackKeyframe["material"] = Object.keys(components).length === 0 ? { groups } : { groups, components };
  return {
    ...keyframe,
    material,
  };
}

function patchSelectedKeyframe(nextKeyframe: TrackKeyframe, committedInput?: HTMLInputElement): void {
  applyV2Scene(() => patchKeyframe(workingSceneV2(), selectedTrackId, selectedKeyframeAt, nextKeyframe), () => {
    selectedKeyframeAt = nextKeyframe.at;
  }, committedInput);
}

function applyV2Scene(buildScene: () => LiquidSceneV2, onSuccess?: () => void, committedInput?: HTMLInputElement): void {
  pauseForEdit();
  try {
    const nextScene = buildScene();
    validateScene(nextScene);
    activeDocument().replaceWorking(nextScene);
    onSuccess?.();
    clearV2DraftInput(committedInput);
    setV2Error(null);
  } catch (error) {
    setV2Error(errorMessage(error));
  }
  render();
}

function handleV2InputEdit(input: HTMLInputElement, edit: () => void): void {
  markV2DraftInput(input);
  try {
    edit();
  } catch (error) {
    setV2Error(errorMessage(error));
    render();
  }
}

function replaceSelectedTrack(updater: (track: LiquidTrack) => LiquidTrack, committedInput?: HTMLInputElement): void {
  applyV2Scene(() => {
    const scene = workingSceneV2();
    const track = scene.tracks.find((candidate) => candidate.id === selectedTrackId);
    if (!track) throw new Error(`No track exists with id ${selectedTrackId}`);
    return patchTrack(scene, selectedTrackId, updater(track));
  }, undefined, committedInput);
}

function patchSceneTiming(patch: Partial<Pick<LiquidSceneV2, "durationMs" | "reducedMotion">>, committedInput?: HTMLInputElement): void {
  applyV2Scene(() => ({ ...workingSceneV2(), ...patch }), undefined, committedInput);
}

function patchSelectedEvent(patch: Partial<SemanticEvent>, committedInput?: HTMLInputElement): void {
  applyV2Scene(() => patchTrackEvent(workingSceneV2(), selectedTrackId, selectedEventId, patch), undefined, committedInput);
}

function patchSelectedComponentDefinition(patch: Partial<Omit<ComponentDefinition, "groupId">> & { readonly groupId?: string | null }): void {
  replaceSelectedTrack((track) => {
    let found = false;
    const components = track.components.map((component) => {
      if (component.id !== selectedComponentId) return component;
      found = true;
      const { groupId, ...rest } = patch;
      const next = { ...component, ...rest, kind: component.kind };
      if (groupId === null) {
        const { groupId: _removed, ...withoutGroup } = next;
        return withoutGroup;
      }
      return groupId === undefined ? next : { ...next, groupId };
    });
    if (!found) throw new Error(`No component exists with id ${selectedComponentId} on track ${track.id}`);
    return { ...track, components };
  });
}

function upsertCurrentV2Keyframe(): void {
  const scene = workingSceneV2();
  const frame = evaluateFrame(scene, progress, { reducedMotion: false });
  const trackFrame = frame.tracks.find((track) => track.id === selectedTrackId) ?? frame.tracks[0];
  if (!trackFrame) return;
  const at = Number(trackFrame.localProgress.toFixed(6));
  const nextKeyframe: TrackKeyframe = {
    at,
    easing: "smoothStep",
    components: trackFrame.components.map((component) => ({ id: component.id, primitive: component.primitive })),
    material: trackFrame.material,
  };
  const track = scene.tracks.find((candidate) => candidate.id === trackFrame.id);
  if (!track) return;
  const nextScene = track.keyframes.some((keyframe) => keyframe.at === at)
    ? patchKeyframe(scene, trackFrame.id, at, nextKeyframe)
    : insertKeyframe(scene, trackFrame.id, nextKeyframe);
  activeDocument().replaceWorking(nextScene);
  selectedTrackId = trackFrame.id;
  selectedComponentId = trackFrame.components[0]?.id ?? selectedComponentId;
  selectedKeyframeAt = at;
  render();
}

function updateV2Controls(frame?: LiquidFrameSampleV2): void {
  const scene = workingSceneV2();
  ensureV2Selection(scene);
  const track = selectedTrack(scene);
  const keyframe = selectedKeyframe(track);
  const component = selectedComponentState(keyframe);
  const componentDefinition = selectedComponentDefinition(track);
  const event = selectedEvent(track);
  const trackFrame = frame?.tracks.find((candidate) => candidate.id === track.id);

  replaceOptions(v2TrackSelect, scene.tracks.map((candidate) => ({ value: candidate.id, label: candidate.id })), selectedTrackId);
  replaceOptions(v2ComponentSelect, track.components.map((candidate) => ({ value: candidate.id, label: `${candidate.id} (${candidate.kind})` })), selectedComponentId);
  replaceOptions(v2KeyframeSelect, track.keyframes.map((candidate) => ({ value: String(candidate.at), label: candidate.at.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") })), String(selectedKeyframeAt));

  const fields = primitiveFields(component.primitive);
  const fieldSignature = `${component.primitive.kind}:${fields.map((field) => field.path).join(",")}`;
  if (v2PrimitiveFields.dataset.signature !== fieldSignature) {
    v2PrimitiveFields.replaceChildren(...fields.map((field) => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = field.label;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.25";
      input.inputMode = "decimal";
      input.dataset.primitivePath = field.path;
      input.id = `v2-primitive-${field.path.replaceAll(".", "-")}`;
      if (field.min !== undefined) input.min = String(field.min);
      input.addEventListener("change", () => {
        handleV2InputEdit(input, () => {
          const path = input.dataset.primitivePath;
          if (!path) return;
          const value = field.min === undefined ? readFinite(input, path) : readAtLeast(input, path, field.min);
          const selected = selectedComponentState();
          patchSelectedKeyframe(keyframeWithComponent(selectedKeyframe(), selected.id, primitiveWithField(selected.primitive, path, value)), input);
        });
      });
      label.append(span, input);
      return label;
    }));
    v2PrimitiveFields.dataset.signature = fieldSignature;
  }
  for (const field of fields) {
    const input = v2PrimitiveFields.querySelector<HTMLInputElement>(`input[data-primitive-path="${field.path}"]`);
    if (input) setNumberInput(input, field.value);
  }

  replaceOptions(v2KeyframeEasingSelect, easingNames.map((value) => ({ value, label: value })), keyframe.easing);
  v2KeyframeEasingSelect.title = track.interpolation === "monotoneCubic" ? "Unused: this track interpolates keyframes with a monotone cubic spline" : "";
  setNumberInput(v2KeyframeAtInput, keyframe.at);
  v2ComponentKindInput.value = componentDefinition.kind;
  v2ComponentOperationSelect.value = componentDefinition.operation;
  v2ComponentGroupInput.value = componentDefinition.groupId ?? "";

  const materialOptions = materialScopeOptions(track, keyframe);
  if (!materialOptions.some((option) => option.value === selectedMaterialScope)) selectedMaterialScope = "group:$track";
  replaceOptions(v2MaterialScopeSelect, materialOptions, selectedMaterialScope);
  const materialScope = parseMaterialScope(selectedMaterialScope);
  const material = materialForScope(keyframe, materialScope);
  const targetFieldsEnabled = isTrackMaterialScope(materialScope);
  setNumberInput(v2MaterialBlendRadiusInput, Number(material.blendRadius ?? 0));
  setNumberInput(v2MaterialTargetMixInput, Number(material.targetMix ?? 0));
  setNumberInput(v2MaterialCornerSharpnessInput, Number(material.cornerSharpness ?? 0));
  v2MaterialTargetMixInput.disabled = !targetFieldsEnabled;
  v2MaterialCornerSharpnessInput.disabled = !targetFieldsEnabled;
  v2MaterialTargetMixInput.title = targetFieldsEnabled ? "" : "Target is only honored on group $track";
  v2MaterialCornerSharpnessInput.title = targetFieldsEnabled ? "" : "Corners are only honored on group $track";

  setNumberInput(v2TrackStartInput, track.timing.start);
  setNumberInput(v2TrackEndInput, track.timing.end);

  replaceOptions(v2EventSelect, (track.events ?? []).map((candidate) => ({ value: candidate.id, label: `${candidate.id} (${candidate.kind})` })), selectedEventId);
  const hasEvent = event !== null;
  v2EventSelect.disabled = !hasEvent;
  v2EventAtInput.disabled = !hasEvent;
  v2EventEndInput.disabled = !hasEvent || event?.kind !== "release";
  v2EventEndLabel.hidden = !hasEvent || event?.kind !== "release";
  setNumberInput(v2EventAtInput, event?.at ?? 0);
  setNumberInput(v2EventEndInput, event?.end ?? 0);

  setNumberInput(v2SceneDurationInput, scene.durationMs);
  setNumberInput(v2ReducedDurationInput, scene.reducedMotion.durationMs);
  setNumberInput(v2ReducedFadeStartInput, scene.reducedMotion.fadeStart);
  setNumberInput(v2ReducedFadeEndInput, scene.reducedMotion.fadeEnd);

  v2TrackContext.textContent = `${track.id} local ${trackFrame?.localProgress.toFixed(3) ?? "0.000"} ${trackFrame?.renderMode ?? ""}`.trim();
  v2ComponentContext.textContent = `${component.id} ${componentDefinition.kind} ${componentDefinition.operation} ${componentDefinition.groupId ?? "ungrouped"}`;
  v2KeyframeContext.textContent = `local ${selectedKeyframeAt.toFixed(6)} ${keyframe.easing}`;
}

function frameTrackSummary(track: TrackFrame): string {
  const targetMix = Number(track.material.groups.$track?.targetMix ?? 0);
  return `${track.id}:${track.renderMode}:${track.localProgress.toFixed(3)}:${targetMix.toFixed(3)}`;
}

function eventSummary(frame: AnyLiquidFrameSample): string {
  if ("tracks" in frame) {
    return frame.events.length > 0 ? frame.events.map((event) => `${event.trackId}:${event.id}`).join(", ") : "none";
  }
  return frame.events.length > 0 ? frame.events.join(", ") : "none";
}

function renderV1(renderer: LiquidCanvasRenderer, scene: LiquidScene, frame: LiquidFrameSample, playbackDuration: number): void {
  const baseFrame = evaluateFrame(committedSceneV1(), progress, { reducedMotion: reducedInput.checked });
  renderer.render(scene, frame, { debug: debugInput.checked, fillStyle: "#f8fafc", sourceStyle: "#64748b", targetStyle: "#f8fafc" });
  canvas.dataset.renderMode = frame.renderMode;
  canvas.dataset.exactEndpoint = frame.renderMode === "sourcePath" ? "source" : frame.renderMode === "targetPath" ? "target" : "none";
  canvas.dataset.trackCount = "1";
  canvas.dataset.trackRenderModes = frame.renderMode;
  canvas.dataset.baseTargetMix = baseFrame.targetMix.toFixed(6);
  canvas.dataset.tunedTargetMix = frame.targetMix.toFixed(6);
  phaseText.textContent = frame.phase;
  eventsText.textContent = eventSummary(frame);
  mixText.textContent = frame.targetMix.toFixed(6);
  bridgeText.textContent = frame.bridge.radius.toFixed(6);
  updateTuningValues(currentTuning());
  void playbackDuration;
}

function drawPathCommands(context: CanvasRenderingContext2D, commands: readonly PathCommand[], scale: number, offsetX: number, offsetY: number): void {
  context.beginPath();
  for (const command of commands) {
    if (command.type === "M") context.moveTo(command.values[0] * scale + offsetX, command.values[1] * scale + offsetY);
    else if (command.type === "L") context.lineTo(command.values[0] * scale + offsetX, command.values[1] * scale + offsetY);
    else if (command.type === "C") {
      context.bezierCurveTo(
        command.values[0] * scale + offsetX,
        command.values[1] * scale + offsetY,
        command.values[2] * scale + offsetX,
        command.values[3] * scale + offsetY,
        command.values[4] * scale + offsetX,
        command.values[5] * scale + offsetY,
      );
    } else {
      context.closePath();
    }
  }
}

function drawExactTargetOverlay(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, viewportPadding: number): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const viewport = viewportFor(scene, canvas.width, canvas.height, viewportPadding);
  context.save();
  context.strokeStyle = "rgba(45, 212, 191, 0.86)";
  context.lineWidth = Math.max(1, viewport.scale * 1.15);
  context.setLineDash([Math.max(3, viewport.scale * 3), Math.max(2, viewport.scale * 2)]);
  for (const track of frame.tracks) {
    drawPathCommands(context, transformPath(track.target.commands, track.target.transform), viewport.scale, viewport.offsetX, viewport.offsetY);
    context.stroke();
  }
  context.restore();
}

function renderV2(renderer: LiquidCanvasRenderer, scene: LiquidSceneV2, frame: LiquidFrameSampleV2, viewportPadding: number): void {
  const selectedFrame = frame.tracks.find((track) => track.id === selectedTrackId) ?? frame.tracks[0];
  const previewFrame = v2SoloTrackInput.checked && selectedFrame ? { ...frame, tracks: [selectedFrame] } : frame;
  const previewScene = v2SoloTrackInput.checked
    ? { ...scene, tracks: scene.tracks.filter((track) => track.id === selectedFrame?.id) }
    : scene;
  renderer.render(previewScene, previewFrame, {
    debug: debugInput.checked,
    fillStyle: "#f8fafc",
    sourceStyle: "#64748b",
    targetStyle: "#f8fafc",
    viewportPadding,
  });
  if (v2TargetOverlayInput.checked) drawExactTargetOverlay(previewScene, previewFrame, viewportPadding);
  const targetMix = Number(selectedFrame?.material.groups.$track?.targetMix ?? 0);
  const blendRadius = Number(selectedFrame?.material.groups.$track?.blendRadius ?? 0);
  canvas.dataset.renderMode = selectedFrame?.renderMode ?? "none";
  canvas.dataset.exactEndpoint = exactEndpointForV2(frame);
  canvas.dataset.trackCount = String(frame.tracks.length);
  canvas.dataset.trackRenderModes = frame.tracks.map((track) => track.renderMode).join(",");
  canvas.dataset.previewSoloTrack = String(v2SoloTrackInput.checked);
  canvas.dataset.previewTargetOverlay = String(v2TargetOverlayInput.checked);
  canvas.dataset.selectedTrackId = selectedFrame?.id ?? "";
  canvas.dataset.selectedComponentId = selectedComponentId;
  canvas.dataset.selectedKeyframeAt = String(selectedKeyframeAt);
  canvas.dataset.baseTargetMix = targetMix.toFixed(6);
  canvas.dataset.tunedTargetMix = targetMix.toFixed(6);
  phaseText.textContent = frame.tracks.map(frameTrackSummary).join(" | ");
  eventsText.textContent = eventSummary(frame);
  mixText.textContent = targetMix.toFixed(6);
  bridgeText.textContent = blendRadius.toFixed(6);
  updateV2Controls(frame);
}

function render(): void {
  const scene = workingScene();
  const reducedMotion = reducedInput.checked;
  const playbackDuration = reducedMotion ? scene.reducedMotion.durationMs : scene.durationMs;
  const frame: AnyLiquidFrameSample = scene.schemaVersion === 1
    ? evaluateFrame(scene, progress, { reducedMotion })
    : evaluateFrame(scene, progress, { reducedMotion });
  const rendererSelection = selectRendererFor(scene, frame);
  const viewportPadding = scene.schemaVersion === 2 ? v2ViewportPadding : 0;
  syncCanvasAspectRatio(scene, viewportPadding);
  resizeCanvas(rendererSelection.maxBackingDimension);

  scrubber.value = String(progress);
  playButton.textContent = playing ? "Pause" : "Play";
  canvas.dataset.schemaVersion = String(scene.schemaVersion);
  canvas.dataset.sceneId = scene.id;
  canvas.dataset.fixtureStable = String(canonicalSerialize(scene) === sceneChoices[selectedScene].fixtureSnapshot);
  canvas.dataset.committedFixtureStable = String(canonicalSerialize(committedScene()) === sceneChoices[selectedScene].fixtureSnapshot);
  canvas.dataset.playbackDuration = String(playbackDuration);
  canvas.dataset.backend = rendererSelection.backend;
  canvas.dataset.backendReason = rendererSelection.reason;
  canvas.dataset.webglSupported = String(rendererSelection.webglSupported);
  canvas.dataset.webglSceneSupported = String(rendererSelection.webglSceneSupported);
  canvas.dataset.viewportPadding = String(viewportPadding);
  timeText.textContent = `${Math.round(progress * playbackDuration)} ms`;
  sceneSelect.value = selectedScene;
  v1Controls.hidden = scene.schemaVersion !== 1;
  v2Controls.hidden = scene.schemaVersion !== 2;
  for (const input of Object.values(tuningInputs)) input.disabled = selectedScene !== "v1";
  resetTuningButton.disabled = selectedScene !== "v1";
  insertCurrentButton.textContent = selectedScene === "v1" ? "Insert" : "Upsert";

  if (scene.schemaVersion === 1) {
    renderV1(rendererSelection.renderer, scene, frame as LiquidFrameSample, playbackDuration);
  } else {
    renderV2(rendererSelection.renderer, scene, frame as LiquidFrameSampleV2, viewportPadding);
  }
  updateDocumentStatus();
}

function tick(timestamp: number): void {
  const delta = Math.max(0, timestamp - lastTimestamp);
  lastTimestamp = timestamp;
  if (playing) {
    const scene = workingScene();
    const playbackDuration = reducedInput.checked ? scene.reducedMotion.durationMs : scene.durationMs;
    progress = (progress + (delta / playbackDuration) * Number(speedInput.value)) % 1;
    render();
  }
  requestAnimationFrame(tick);
}

sceneSelect.addEventListener("change", () => {
  selectedScene = isSceneChoice(sceneSelect.value) ? sceneSelect.value : "v1";
  progress = 0;
  playing = false;
  selectedTrackId = "";
  selectedComponentId = "";
  selectedKeyframeAt = 0;
  selectedMaterialScope = "group:$track";
  selectedEventId = "";
  v2PrimitiveFields.dataset.signature = "";
  clearAllV2Drafts();
  setV2Error(null);
  if (workingScene().schemaVersion === 2) ensureV2Selection(workingSceneV2());
  exportCanonicalScene();
  render();
});

playButton.addEventListener("click", () => {
  playing = !playing;
  render();
});

restartButton.addEventListener("click", () => {
  progress = 0;
  playing = true;
  render();
});

resetTuningButton.addEventListener("click", () => {
  resetTuningInputs();
  render();
});

insertCurrentButton.addEventListener("click", () => {
  playing = false;
  if (selectedScene === "v1") editWorkingPoseAtProgress();
  else upsertCurrentV2Keyframe();
  exportCanonicalScene();
  render();
});

v2UpsertKeyframeButton.addEventListener("click", () => {
  playing = false;
  upsertCurrentV2Keyframe();
  exportCanonicalScene();
});

commitSceneButton.addEventListener("click", () => {
  activeDocument().commit("committed");
  exportCanonicalScene();
  render();
});

resetCommittedButton.addEventListener("click", () => {
  activeDocument().resetToCommitted();
  resetTuningInputs();
  clearAllV2Drafts();
  setV2Error(null);
  if (workingScene().schemaVersion === 2) ensureV2Selection(workingSceneV2());
  exportCanonicalScene();
  render();
});

saveSnapshotButton.addEventListener("click", () => {
  const document = activeDocument();
  const name = snapshotNameInput.value.trim() || `snapshot-${document.snapshots().length + 1}`;
  document.snapshot(name);
  render();
});

exportJsonButton.addEventListener("click", () => {
  exportCanonicalScene();
  render();
});

copyJsonButton.addEventListener("click", () => {
  const serialized = exportCanonicalScene();
  void navigator.clipboard?.writeText(serialized).then(() => {
    copyJsonButton.dataset.copyStatus = "copied";
  }).catch(() => {
    exportOutput.select();
    document.execCommand("copy");
    copyJsonButton.dataset.copyStatus = "fallback";
  });
  render();
});

scrubber.addEventListener("input", () => {
  progress = Number(scrubber.value);
  playing = false;
  render();
});

v2Controls.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLInputElement) markV2DraftInput(event.target);
});

v2Controls.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement) markV2DraftInput(event.target);
});

v2TrackSelect.addEventListener("change", () => {
  selectedTrackId = v2TrackSelect.value;
  selectedComponentId = "";
  selectedKeyframeAt = 0;
  selectedMaterialScope = "group:$track";
  selectedEventId = "";
  v2PrimitiveFields.dataset.signature = "";
  clearAllV2Drafts();
  setV2Error(null);
  ensureV2Selection(workingSceneV2());
  render();
});

v2ComponentSelect.addEventListener("change", () => {
  selectedComponentId = v2ComponentSelect.value;
  v2PrimitiveFields.dataset.signature = "";
  clearAllV2Drafts();
  setV2Error(null);
  ensureV2Selection(workingSceneV2());
  render();
});

v2KeyframeSelect.addEventListener("change", () => {
  selectedKeyframeAt = Number(v2KeyframeSelect.value);
  clearAllV2Drafts();
  setV2Error(null);
  ensureV2Selection(workingSceneV2());
  render();
});

v2KeyframeAtInput.addEventListener("change", () => {
  handleV2InputEdit(v2KeyframeAtInput, () => {
    patchSelectedKeyframe({ ...selectedKeyframe(), at: readUnitInterval(v2KeyframeAtInput, "keyframe at") }, v2KeyframeAtInput);
  });
});

v2KeyframeEasingSelect.addEventListener("change", () => {
  patchSelectedKeyframe({ ...selectedKeyframe(), easing: v2KeyframeEasingSelect.value as EasingName });
});

v2ComponentOperationSelect.addEventListener("change", () => {
  patchSelectedComponentDefinition({ operation: v2ComponentOperationSelect.value as ComponentDefinition["operation"] });
});

v2ComponentGroupInput.addEventListener("change", () => {
  const groupId = v2ComponentGroupInput.value.trim();
  patchSelectedComponentDefinition(groupId === "" ? { groupId: null } : { groupId });
});

v2MaterialScopeSelect.addEventListener("change", () => {
  selectedMaterialScope = v2MaterialScopeSelect.value;
  clearAllV2Drafts();
  setV2Error(null);
  render();
});

function readMaterialValue(key: MaterialKey, input: HTMLInputElement): number {
  if (key === "blendRadius") return readAtLeast(input, "blend radius", 0);
  return readUnitInterval(input, key === "targetMix" ? "target mix" : "corner sharpness");
}

function patchSelectedMaterial(key: MaterialKey, input: HTMLInputElement): void {
  handleV2InputEdit(input, () => {
    const scope = parseMaterialScope(selectedMaterialScope);
    if (key !== "blendRadius" && !isTrackMaterialScope(scope)) throw new Error(`${key} is only honored on group $track`);
    patchSelectedKeyframe(keyframeWithMaterialValue(selectedKeyframe(), scope, key, readMaterialValue(key, input)), input);
  });
}

v2MaterialBlendRadiusInput.addEventListener("change", () => {
  patchSelectedMaterial("blendRadius", v2MaterialBlendRadiusInput);
});

v2MaterialTargetMixInput.addEventListener("change", () => {
  patchSelectedMaterial("targetMix", v2MaterialTargetMixInput);
});

v2MaterialCornerSharpnessInput.addEventListener("change", () => {
  patchSelectedMaterial("cornerSharpness", v2MaterialCornerSharpnessInput);
});

v2TrackStartInput.addEventListener("change", () => {
  handleV2InputEdit(v2TrackStartInput, () => {
    const start = readUnitInterval(v2TrackStartInput, "track start");
    replaceSelectedTrack((track) => {
      if (start >= track.timing.end) throw new Error("track timing must satisfy 0 <= start < end <= 1");
      return { ...track, timing: { ...track.timing, start } };
    }, v2TrackStartInput);
  });
});

v2TrackEndInput.addEventListener("change", () => {
  handleV2InputEdit(v2TrackEndInput, () => {
    const end = readUnitInterval(v2TrackEndInput, "track end");
    replaceSelectedTrack((track) => {
      if (end <= track.timing.start) throw new Error("track timing must satisfy 0 <= start < end <= 1");
      return { ...track, timing: { ...track.timing, end } };
    }, v2TrackEndInput);
  });
});

v2EventSelect.addEventListener("change", () => {
  selectedEventId = v2EventSelect.value;
  clearAllV2Drafts();
  setV2Error(null);
  render();
});

v2EventAtInput.addEventListener("change", () => {
  handleV2InputEdit(v2EventAtInput, () => {
    const at = readUnitInterval(v2EventAtInput, "event at");
    const event = selectedEvent();
    if (event?.kind === "release" && event.end !== undefined && at >= event.end) throw new Error("release event at must be less than end");
    patchSelectedEvent({ at }, v2EventAtInput);
  });
});

v2EventEndInput.addEventListener("change", () => {
  handleV2InputEdit(v2EventEndInput, () => {
    const end = readUnitInterval(v2EventEndInput, "event end");
    const event = selectedEvent();
    if (event?.kind !== "release") throw new Error("event end is only valid for release events");
    if (end <= event.at) throw new Error("release event end must be greater than at and <= 1");
    patchSelectedEvent({ end }, v2EventEndInput);
  });
});

v2SceneDurationInput.addEventListener("change", () => {
  handleV2InputEdit(v2SceneDurationInput, () => {
    patchSceneTiming({ durationMs: readGreaterThan(v2SceneDurationInput, "scene duration", 0) }, v2SceneDurationInput);
  });
});

v2ReducedDurationInput.addEventListener("change", () => {
  handleV2InputEdit(v2ReducedDurationInput, () => {
    const scene = workingSceneV2();
    patchSceneTiming({ reducedMotion: { ...scene.reducedMotion, durationMs: readGreaterThan(v2ReducedDurationInput, "reduced duration", 0) } }, v2ReducedDurationInput);
  });
});

v2ReducedFadeStartInput.addEventListener("change", () => {
  handleV2InputEdit(v2ReducedFadeStartInput, () => {
    const scene = workingSceneV2();
    const fadeStart = readUnitInterval(v2ReducedFadeStartInput, "reduced fadeStart");
    if (fadeStart >= scene.reducedMotion.fadeEnd) throw new Error("reduced fadeStart must be less than fadeEnd");
    patchSceneTiming({ reducedMotion: { ...scene.reducedMotion, fadeStart } }, v2ReducedFadeStartInput);
  });
});

v2ReducedFadeEndInput.addEventListener("change", () => {
  handleV2InputEdit(v2ReducedFadeEndInput, () => {
    const scene = workingSceneV2();
    const fadeEnd = readUnitInterval(v2ReducedFadeEndInput, "reduced fadeEnd");
    if (fadeEnd <= scene.reducedMotion.fadeStart) throw new Error("reduced fadeEnd must be greater than fadeStart");
    patchSceneTiming({ reducedMotion: { ...scene.reducedMotion, fadeEnd } }, v2ReducedFadeEndInput);
  });
});

v2SoloTrackInput.addEventListener("input", () => {
  pauseForEdit();
  render();
});

v2TargetOverlayInput.addEventListener("input", () => {
  pauseForEdit();
  render();
});

debugInput.addEventListener("input", render);
reducedInput.addEventListener("input", render);
for (const input of Object.values(tuningInputs)) {
  input.addEventListener("input", () => {
    playing = false;
    editWorkingPoseAtProgress();
    render();
  });
}
prefersReduced.addEventListener("change", (event) => {
  reducedInput.checked = event.matches;
  render();
});
window.addEventListener("resize", () => {
  render();
});

ensureV2Selection(sceneChoices.v2.document.scene as LiquidSceneV2);
exportCanonicalScene();
requestAnimationFrame(tick);

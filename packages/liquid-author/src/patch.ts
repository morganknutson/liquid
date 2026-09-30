import { validateScene, type AnyLiquidScene, type LiquidScene, type LiquidSceneV2, type LiquidTrack, type Pose, type SemanticEvent, type TrackKeyframe } from "@liquid/core";
import { canonicalize, deepClone } from "./utils.js";

function orderedInsert<T extends { readonly at: number }>(items: readonly T[], item: T): T[] {
  const next = [...items.filter((candidate) => candidate.at !== item.at), item].sort((a, b) => a.at - b.at);
  return next;
}

export function insertPose(scene: LiquidScene, pose: Pose): LiquidScene {
  const next = canonicalize({ ...deepClone(scene), poses: orderedInsert(scene.poses, deepClone(pose)) });
  validateScene(next);
  return next;
}

export function patchPose(scene: LiquidScene, at: number, patch: Partial<Pose>): LiquidScene {
  const poses = scene.poses.map((pose) => pose.at === at ? canonicalize({ ...deepClone(pose), ...deepClone(patch), at: patch.at ?? pose.at }) : deepClone(pose));
  if (poses.every((pose) => pose.at !== (patch.at ?? at))) throw new Error(`No pose exists at ${at}`);
  const next = canonicalize({ ...deepClone(scene), poses: poses.sort((a, b) => a.at - b.at) });
  validateScene(next);
  return next;
}

export function removePose(scene: LiquidScene, at: number): LiquidScene {
  const poses = scene.poses.filter((pose) => pose.at !== at).map((pose) => deepClone(pose));
  if (poses.length === scene.poses.length) throw new Error(`No pose exists at ${at}`);
  const next = canonicalize({ ...deepClone(scene), poses });
  validateScene(next);
  return next;
}

function replaceTrack(scene: LiquidSceneV2, trackId: string, updater: (track: LiquidTrack) => LiquidTrack): LiquidSceneV2 {
  let found = false;
  const tracks = scene.tracks.map((track) => {
    if (track.id !== trackId) return deepClone(track);
    found = true;
    return updater(track);
  });
  if (!found) throw new Error(`No track exists with id ${trackId}`);
  const next = canonicalize({ ...deepClone(scene), tracks });
  validateScene(next);
  return next;
}

function sortedKeyframes(keyframes: readonly TrackKeyframe[]): TrackKeyframe[] {
  return [...keyframes].sort((a, b) => a.at - b.at);
}

function sortedEvents(events: readonly SemanticEvent[]): SemanticEvent[] {
  return [...events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function patchTrack(scene: LiquidSceneV2, trackId: string, patch: Partial<LiquidTrack>): LiquidSceneV2 {
  return replaceTrack(scene, trackId, (track) => {
    const next = { ...deepClone(track), ...deepClone(patch) };
    if (next.keyframes !== undefined) next.keyframes = sortedKeyframes(next.keyframes);
    if (next.events !== undefined) next.events = sortedEvents(next.events);
    return canonicalize(next);
  });
}

export function patchTrackEvent(scene: LiquidSceneV2, trackId: string, eventId: string, patch: Partial<SemanticEvent>): LiquidSceneV2 {
  return replaceTrack(scene, trackId, (track) => {
    let found = false;
    const events = (track.events ?? []).map((event) => {
      if (event.id !== eventId) return deepClone(event);
      found = true;
      return canonicalize({ ...deepClone(event), ...deepClone(patch), id: patch.id ?? event.id });
    });
    if (!found) throw new Error(`No event exists with id ${eventId} on track ${trackId}`);
    return canonicalize({ ...deepClone(track), events: sortedEvents(events) });
  });
}

export function insertKeyframe(scene: LiquidSceneV2, trackId: string, keyframe: TrackKeyframe): LiquidSceneV2 {
  return replaceTrack(scene, trackId, (track) => canonicalize({ ...deepClone(track), keyframes: orderedInsert(track.keyframes, deepClone(keyframe)) }));
}

export function patchKeyframe(scene: LiquidSceneV2, trackId: string, at: number, patch: Partial<TrackKeyframe>): LiquidSceneV2 {
  return replaceTrack(scene, trackId, (track) => {
    let found = false;
    const keyframes = track.keyframes.map((keyframe) => {
      if (keyframe.at !== at) return deepClone(keyframe);
      found = true;
      return canonicalize({ ...deepClone(keyframe), ...deepClone(patch), at: patch.at ?? keyframe.at });
    }).sort((a, b) => a.at - b.at);
    if (!found) throw new Error(`No keyframe exists at ${at} on track ${trackId}`);
    return canonicalize({ ...deepClone(track), keyframes });
  });
}

export function removeKeyframe(scene: LiquidSceneV2, trackId: string, at: number): LiquidSceneV2 {
  return replaceTrack(scene, trackId, (track) => {
    const keyframes = track.keyframes.filter((keyframe) => keyframe.at !== at).map((keyframe) => deepClone(keyframe));
    if (keyframes.length === track.keyframes.length) throw new Error(`No keyframe exists at ${at} on track ${trackId}`);
    return canonicalize({ ...deepClone(track), keyframes });
  });
}

export type ScenePatch =
  | { readonly op: "insertPose"; readonly pose: Pose }
  | { readonly op: "patchPose"; readonly at: number; readonly patch: Partial<Pose> }
  | { readonly op: "removePose"; readonly at: number }
  | { readonly op: "patchTrack"; readonly trackId: string; readonly patch: Partial<LiquidTrack> }
  | { readonly op: "patchTrackEvent"; readonly trackId: string; readonly eventId: string; readonly patch: Partial<SemanticEvent> }
  | { readonly op: "insertKeyframe"; readonly trackId: string; readonly keyframe: TrackKeyframe }
  | { readonly op: "patchKeyframe"; readonly trackId: string; readonly at: number; readonly patch: Partial<TrackKeyframe> }
  | { readonly op: "removeKeyframe"; readonly trackId: string; readonly at: number };

export function applyScenePatch(scene: AnyLiquidScene, patch: ScenePatch): AnyLiquidScene {
  switch (patch.op) {
    case "insertPose":
      if (scene.schemaVersion !== 1) throw new Error("insertPose requires a v1 scene");
      return insertPose(scene, patch.pose);
    case "patchPose":
      if (scene.schemaVersion !== 1) throw new Error("patchPose requires a v1 scene");
      return patchPose(scene, patch.at, patch.patch);
    case "removePose":
      if (scene.schemaVersion !== 1) throw new Error("removePose requires a v1 scene");
      return removePose(scene, patch.at);
    case "patchTrack":
      if (scene.schemaVersion !== 2) throw new Error("patchTrack requires a v2 scene");
      return patchTrack(scene, patch.trackId, patch.patch);
    case "patchTrackEvent":
      if (scene.schemaVersion !== 2) throw new Error("patchTrackEvent requires a v2 scene");
      return patchTrackEvent(scene, patch.trackId, patch.eventId, patch.patch);
    case "insertKeyframe":
      if (scene.schemaVersion !== 2) throw new Error("insertKeyframe requires a v2 scene");
      return insertKeyframe(scene, patch.trackId, patch.keyframe);
    case "patchKeyframe":
      if (scene.schemaVersion !== 2) throw new Error("patchKeyframe requires a v2 scene");
      return patchKeyframe(scene, patch.trackId, patch.at, patch.patch);
    case "removeKeyframe":
      if (scene.schemaVersion !== 2) throw new Error("removeKeyframe requires a v2 scene");
      return removeKeyframe(scene, patch.trackId, patch.at);
  }
}

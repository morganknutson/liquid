export { compileAuthoringDocument } from "./compiler.js";
export { runAuthorCli } from "./cli.js";
export { AuthoringDocument, diffScenes } from "./document.js";
export {
  applyScenePatch,
  insertKeyframe,
  insertPose,
  patchKeyframe,
  patchPose,
  patchTrack,
  patchTrackEvent,
  removeKeyframe,
  removePose,
} from "./patch.js";
export {
  canonicalSerialize,
  cloneScene,
  loadScene,
  normalizeScene,
  validateAuthoringScene,
  validateAuthoringSceneV1,
  validateAuthoringSceneV2,
} from "./scene.js";
export type { AuthoringComponent, AuthoringDocumentInput, AuthoringTrack, Constraint } from "./compiler.js";
export type { CliHost } from "./cli.js";
export type { ScenePatch } from "./patch.js";
export type { AuthoringSnapshot, SceneDiff } from "./diff.js";

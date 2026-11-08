// Sculpted robot meshes: target height (m), yaw correction so the face looks +Z, and vertex-rig landmarks (m),
// measured from the inspector views (review/tools/viewer.html): legs end at hipY, arms start beyond shoulderX.
export const ROBOT_MODELS = {
  base: { file: 'robot-base.glb', height: 1.2, yaw: 0, hipY: 0.27, shoulderX: 0.52 },
  shield: { file: 'robot-shield.glb', height: 1.3, yaw: 0, hipY: 0.3, shoulderX: 0.56 },
  jumper: { file: 'robot-jumper.glb', height: 1.15, yaw: 0, hipY: 0.34, shoulderX: 0.48 },
};

// Bay Crossing's pipeline hooks (Harbor Engine contract, docs/ENGINE.md in harbor-engine): the engine's
// generic pipelines call these for the parts that depend on this map's datasets. Node only.
//   collectBuildings( kit )       building footprints + heights → kit.finish() per building (pipelines/buildings.mjs)
//   prepareLandmarks( ctx )       cached OSM → Blender inputs for pipelines/landmarks/build.py
export { collectBuildings } from './pipelines/buildings.mjs';
export { prepareLandmarks } from './pipelines/landmarks/prepare.mjs';

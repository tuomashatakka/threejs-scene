// modules/all/index.ts
// Every built-in module, in one import.
//
// Two audiences. A consumer who wants the whole shelf without learning eight
// subpaths, and — more to the point — anything that needs the module REGISTRY
// populated: a descriptor registers when its module is imported, so a catalogue
// built without importing the modules is an empty catalogue. `scripts/gen-llm-assets.ts`
// imports this barrel for exactly that reason.
//
// It is the one place in the package where importing costs you everything, so
// a scene that only needs lighting should still import `threejs-scene/modules/lighting`.
// `physics` is deliberately absent: it needs the optional `cannon-es` peer, and
// importing this barrel must not fail for someone who never installed it.

export { standardLighting, LightingRig } from '../lighting/index.js'
export type { LightingOptions, LightingRigApi, LightingEnvOptions, LightingSunOptions, LightingHemiOptions } from '../lighting/index.js'

export { orbitControls, Orbit } from '../orbit/index.js'
export type { OrbitOptions, OrbitApi } from '../orbit/index.js'

export { cameraRig, CameraRigKind } from '../camera/index.js'
export type { CameraRigOptions, CameraRigModuleApi, CameraRigFollowApi, FollowTarget } from '../camera/index.js'

export { pointerInput } from '../input/index.js'
export type { PointerInputOptions, PointerStateSlice } from '../input/index.js'

export { qualityGovernor, DEFAULT_TIERS } from '../quality/index.js'
export type { QualityGovernorOptions, QualitySlice } from '../quality/index.js'

export { diagnostics, Diagnostics } from '../diagnostics/index.js'
export type { DiagnosticsOptions, DiagnosticsApi, DiagnosticsSample } from '../diagnostics/index.js'

export { persistence } from '../persistence/index.js'
export type { PersistenceOptions } from '../persistence/index.js'

export { assetCatalog } from '../assets/module.js'
export type { AssetCatalogOptions } from '../assets/module.js'

export { postProcessing } from '../post/index.js'
export type { PostProcessingOptions } from '../post/index.js'

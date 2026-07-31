import * as THREE from 'three'

import type { FrameContext } from '../../lib/index.js'


const VERTEX_SHADER = /* glsl */`
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main () {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */`
  uniform float uTime;
  uniform vec3 uBaseColor;
  uniform float uFresnelStrength;
  uniform float uScanlineDensity;
  uniform float uOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  float hash3 (vec3 point) {
    return fract(sin(dot(point, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main () {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(vWorldNormal, viewDirection), 0.0), uFresnelStrength);
    float scan = sin(vWorldPosition.y * uScanlineDensity + uTime * 2.0) * 0.5 + 0.5;
    float noise = hash3(floor(vWorldPosition * 12.0) + floor(uTime * 6.0));
    vec3 color = uBaseColor * (scan * 0.5 + 0.5);
    color += uBaseColor * fresnel * 2.0;
    color *= 0.85 + noise * 0.15;
    float alpha = clamp(fresnel * 0.8 + scan * 0.2, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`

export interface HolographicMaterialOptions {
  baseColor?:       THREE.ColorRepresentation
  fresnelStrength?: number
  scanlineDensity?: number
  opacity?:         number
}

export interface TickableMaterial extends THREE.ShaderMaterial {
  userData: { tick: (context: FrameContext) => void }
}

/** Fresnel hologram with animated scanlines and an explicit frame hook. */
export function createHolographicMaterial ({
  baseColor = '#79f7ff',
  fresnelStrength = 2,
  scanlineDensity = 40,
  opacity = 1,
}: HolographicMaterialOptions = {}): TickableMaterial {
  const uniforms = {
    uTime:            { value: 0 },
    uBaseColor:       { value: new THREE.Color(baseColor) },
    uFresnelStrength: { value: Math.max(0, fresnelStrength) },
    uScanlineDensity: { value: Math.max(0, scanlineDensity) },
    uOpacity:         { value: THREE.MathUtils.clamp(opacity, 0, 1) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent:    true,
    depthWrite:     false,
    side:           THREE.DoubleSide,
    blending:       THREE.AdditiveBlending,
  }) as TickableMaterial
  material.userData.tick = ({ elapsed }: FrameContext) => {
    uniforms.uTime.value = elapsed
  }
  return material
}

// perf: medium shader, one time-uniform write per frame. Share per palette.

import * as THREE from 'three'


export interface TriplanarMaterialOptions {
  palette?:     [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation]
  tileScale?:   number
  fogDistance?: number
  side?:        THREE.Side
}

/** Analytic world-space triplanar grid material for unwrapped geometry. */
export function createTriplanarMaterial ({
  palette = [ '#2c3244', '#3c4a66', '#79f7ff' ],
  tileScale = 0.4,
  fogDistance = 40,
  side = THREE.DoubleSide,
}: TriplanarMaterialOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side,
    uniforms: {
      uA:         { value: new THREE.Color(palette[0]) },
      uB:         { value: new THREE.Color(palette[1]) },
      uC:         { value: new THREE.Color(palette[2]) },
      uTileScale: { value: Math.max(1e-4, tileScale) },
      uFogDist:   { value: Math.max(1e-4, fogDistance) },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main () {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      uniform float uTileScale;
      uniform float uFogDist;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float grid (vec2 uv, float width) {
        vec2 cell = abs(fract(uv) - 0.5);
        float distanceToLine = min(cell.x, cell.y);
        return smoothstep(width, width - 0.02, distanceToLine);
      }

      void main () {
        vec3 normal = normalize(vWorldNormal);
        vec2 uv = mix(vWorldPosition.xz, vWorldPosition.xy, abs(normal.z));
        uv = mix(uv, vWorldPosition.zy, abs(normal.x));
        uv *= uTileScale;
        float line = grid(uv, 0.04);
        vec3 base = mix(uA, uB, 0.5 + 0.5 * sin(uv.x * 0.3 + uv.y * 0.2));
        base = mix(base, uC, line);
        float light = 0.45 + 0.55 * clamp(dot(normal, normalize(vec3(0.4, 1.0, 0.3))), 0.0, 1.0);
        vec3 color = base * light;
        float fog = smoothstep(0.0, uFogDist, length(vWorldPosition.xz));
        color = mix(color, uC * 0.7, fog * 0.2);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
}

// perf: cheap analytic shader with no texture samples. Share per palette.

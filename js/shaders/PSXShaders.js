import * as THREE from 'three';

// PSX Vertex Shader с ручной поддержкой clipping planes
export const PSX_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;

uniform float time;
uniform float vertexJitter;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    // World position для освещения
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    
    // PSX vertex snapping
    if (vertexJitter > 0.0) {
        float snap = 150.0;
        gl_Position.xy = floor(gl_Position.xy * snap + 0.5) / snap;
    }
}
`;

// PSX Fragment Shader с ручным clipping и динамическим освещением
export const PSX_FRAGMENT_SHADER = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;

uniform sampler2D map;
uniform vec3 diffuse;
uniform float opacity;

// Динамическое освещение
uniform vec3 lightPosition;
uniform vec3 lightColor;
uniform float lightIntensity;

// Clipping plane
uniform vec4 clippingPlane;
uniform bool enableClipping;

void main() {
    // Проверяем clipping в мировых координатах
    if (enableClipping) {
        float clipDistance = dot(vWorldPosition, clippingPlane.xyz) + clippingPlane.w;
        if (clipDistance < 0.0) {
            discard;
        }
    }
    
    vec4 texColor = texture2D(map, vUv);
    vec3 baseColor = texColor.rgb * diffuse;
    
    // Базовое освещение (стандартная интенсивность)
    vec3 normal = normalize(vNormal);
    float baseLight = 1.0 + 0.4 * max(dot(normal, vec3(0.5, 0.7, 0.5)), 0.0);
    
    // Динамическое освещение от курсора
    vec3 lightDir = normalize(lightPosition - vWorldPosition);
    float distance = length(lightPosition - vWorldPosition);
    float attenuation = 0.05 / (1.0 + 0.1 * distance + 0.01 * distance * distance);
    float dynamicLight = max(dot(normal, lightDir), 0.0) * lightIntensity * attenuation;
    
    // Объединяем освещение
    float totalLight = baseLight + dynamicLight;
    vec3 finalColor = baseColor * totalLight;
    
    // PSX квантизация
    finalColor = floor(finalColor * 48.0 + 0.5) / 48.0;
    
    gl_FragColor = vec4(finalColor, texColor.a * opacity);
}
`;

// Параметры PSX эффекта по умолчанию
export const PSX_DEFAULTS = {
    vertexJitter: 0.02,  // Минимальный jitter
    colorQuantization: 48.0,  // Мягкая квантизация
    enableLighting: true,
    diffuse: new THREE.Color(0xffffff),
    opacity: 1.0
};

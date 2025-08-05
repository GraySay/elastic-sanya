import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';

export class LightingService {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.isDiscoMode = false;
        this.isAnimatingLight = false;
        this.currentColor = new THREE.Color();
        this.targetColor = new THREE.Color(0xffffff);
        this.currentIntensity = 0;
        this.targetIntensity = 0;
        this.mouse = new THREE.Vector2();
        
        // Cache colors to avoid constant shader recompilation
        this.colorCache = new Map();
        this.lastHue = -1;

        this.setupLights();

        EventBus.on('discoModeToggle', (isActive) => this.isDiscoMode = isActive);
        EventBus.on('uiHover', this.handleUIHover.bind(this));
        EventBus.on('mouseMove', this.handleMouseMove.bind(this));
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, CONFIG.AMBIENT_LIGHT_INTENSITY);
        this.scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, CONFIG.MAIN_LIGHT_INTENSITY);
        mainLight.position.set(CONFIG.MAIN_LIGHT_POSITION, CONFIG.MAIN_LIGHT_POSITION, CONFIG.MAIN_LIGHT_POSITION);
        mainLight.castShadow = true;
        this.scene.add(mainLight);

        this.dynamicLight = new THREE.SpotLight(
            0xffffff, 
            0, 
            CONFIG.SPOTLIGHT_DISTANCE, 
            CONFIG.SPOTLIGHT_ANGLE, 
            CONFIG.SPOTLIGHT_PENUMBRA, 
            CONFIG.SPOTLIGHT_DECAY
        );
        this.dynamicLight.castShadow = true;
        this.dynamicLight.shadow.mapSize.width = CONFIG.SHADOW_MAP_SIZE;
        this.dynamicLight.shadow.mapSize.height = CONFIG.SHADOW_MAP_SIZE;
        this.dynamicLight.target = new THREE.Object3D();
        this.scene.add(this.dynamicLight.target);
        this.scene.add(this.dynamicLight);
    }

    handleUIHover({ element }) {
        if (this.isDiscoMode) return;

        // Only trigger lighting effects for letters S, A, C, H
        if (element && element.classList.contains('letter')) {
            const letter = element.dataset.letter;
            if (['S', 'A', 'C', 'H'].includes(letter)) {
                this.updateModelLights(new THREE.Color(0xffffff), CONFIG.DYNAMIC_LIGHT_INTENSITY);
            } else {
                this.resetModelLights();
            }
        } else {
            this.resetModelLights();
        }
    }
    
    handleMouseMove({ mouse }) {
        this.mouse.copy(mouse);
    }

    updateModelLights(color, intensity) {
        this.targetColor.copy(color);
        this.targetIntensity = intensity;
        this.isAnimatingLight = true;
    }

    resetModelLights() {
        this.targetIntensity = 0;
    }

    animate(time) {
        if (!this.dynamicLight) return;

        if (this.isDiscoMode) {
            this.targetIntensity = CONFIG.DISCO_LIGHT_INTENSITY;
            const hue = (time * CONFIG.DISCO_LIGHT_HUE_SPEED) % 1;
            
            // Cache colors to avoid shader recompilation
            // Round to nearest degree
            const hueKey = Math.round(hue * CONFIG.COLOR_CACHE_MAX);
            if (hueKey !== this.lastHue) {
                if (!this.colorCache.has(hueKey)) {
                    const cachedColor = new THREE.Color();
                    cachedColor.setHSL(hue, CONFIG.LIGHT_SATURATION, CONFIG.LIGHT_BRIGHTNESS);
                    this.colorCache.set(hueKey, cachedColor);
                }
                this.targetColor.copy(this.colorCache.get(hueKey));
                this.lastHue = hueKey;
            }

            const t = time * CONFIG.DISCO_LIGHT_MOVE_SPEED;
            const radius = CONFIG.DISCO_LIGHT_RADIUS;
            this.dynamicLight.position.x = Math.sin(t) * radius;
            this.dynamicLight.position.y = Math.cos(t) * radius;
            this.dynamicLight.position.z = CONFIG.LIGHT_Z_POSITION + Math.sin(t * 2) * CONFIG.LIGHT_Z_ANIMATION;
            this.dynamicLight.target.position.set(0, 0, CONFIG.TARGET_Z_POSITION);
            this.isAnimatingLight = true;
            
        }

        this.currentIntensity += (this.targetIntensity - this.currentIntensity) * CONFIG.LIGHT_LERP_FACTOR;
        this.dynamicLight.intensity = this.currentIntensity;

        if (this.currentIntensity < CONFIG.LIGHT_INTENSITY_THRESHOLD && !this.isDiscoMode) {
            this.isAnimatingLight = false;
            return;
        }

        if (!this.isDiscoMode && this.isAnimatingLight) {
            this.targetColor.set(0xffffff);
            this.dynamicLight.position.x = this.mouse.x * CONFIG.MOUSE_LIGHT_MULTIPLIER;
            this.dynamicLight.position.y = this.mouse.y * CONFIG.MOUSE_LIGHT_MULTIPLIER;
            this.dynamicLight.position.z = CONFIG.LIGHT_Z_POSITION;
            this.dynamicLight.target.position.set(0, 0, CONFIG.TARGET_Z_POSITION);
        }

        this.currentColor.lerp(this.targetColor, CONFIG.LIGHT_LERP_FACTOR);
        this.dynamicLight.color.copy(this.currentColor);
    }
}

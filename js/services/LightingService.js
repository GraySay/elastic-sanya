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

        this.setupLights();

        EventBus.on('discoModeToggle', (isActive) => this.isDiscoMode = isActive);
        EventBus.on('uiHover', this.handleUIHover.bind(this));
        EventBus.on('mouseMove', this.handleMouseMove.bind(this));
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, CONFIG.AMBIENT_LIGHT_INTENSITY);
        this.scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, CONFIG.MAIN_LIGHT_INTENSITY);
        mainLight.position.set(5, 5, 5);
        mainLight.castShadow = true;
        this.scene.add(mainLight);

        this.dynamicLight = new THREE.SpotLight(0xffffff, 0, 20, Math.PI / 4, 0.1, 1.5);
        this.dynamicLight.castShadow = true;
        this.dynamicLight.shadow.mapSize.width = 1024;
        this.dynamicLight.shadow.mapSize.height = 1024;
        this.dynamicLight.target = new THREE.Object3D();
        this.scene.add(this.dynamicLight.target);
        this.scene.add(this.dynamicLight);
    }

    handleUIHover({ element }) {
        if (this.isDiscoMode) return;

        // Only trigger lighting effects for letters I, L, U, K
        if (element && element.classList.contains('letter')) {
            const letter = element.dataset.letter;
            if (['I', 'L', 'U', 'K'].includes(letter)) {
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
            this.targetColor.setHSL(hue, 1.0, 0.5);

            const t = time * CONFIG.DISCO_LIGHT_MOVE_SPEED;
            const radius = 5;
            this.dynamicLight.position.x = Math.sin(t) * radius;
            this.dynamicLight.position.y = Math.cos(t) * radius;
            this.dynamicLight.position.z = 4 + Math.sin(t * 2) * 1.5;
            this.dynamicLight.target.position.set(0, 0, 1);
            this.isAnimatingLight = true;
        }

        this.currentIntensity += (this.targetIntensity - this.currentIntensity) * 0.1;
        this.dynamicLight.intensity = this.currentIntensity;

        if (this.currentIntensity < 0.01 && !this.isDiscoMode) {
            this.isAnimatingLight = false;
            return;
        }

        if (!this.isDiscoMode && this.isAnimatingLight) {
            this.targetColor.set(0xffffff);
            this.dynamicLight.position.x = this.mouse.x * 5;
            this.dynamicLight.position.y = this.mouse.y * 5;
            this.dynamicLight.position.z = 4;
            this.dynamicLight.target.position.set(0, 0, 1);
        }

        this.currentColor.lerp(this.targetColor, 0.1);
        this.dynamicLight.color.copy(this.currentColor);
    }
}

import * as THREE from 'three';
import EventBus from './utils/EventBus.js';
import { SceneManager } from './services/SceneManager.js';
import { SoundService } from './services/SoundService.js';
import { LightingService } from './services/LightingService.js';
import { ModelService } from './services/ModelService.js';
import { ElasticDeformationService } from './services/ElasticDeformationService.js';
import { UIManager } from './services/UIManager.js';
import { CONFIG } from './config/config.js';

class ElasticSanyaApp {
    constructor() {
        this.canvas = document.querySelector('canvas');
        this.sceneManager = new SceneManager(this.canvas);
        this.soundService = new SoundService(this.sceneManager.getCamera());
        this.lightingService = new LightingService(this.sceneManager.getScene(), this.sceneManager.getCamera());
        this.modelService = new ModelService(this.sceneManager.getScene());
        this.elasticDeformationService = new ElasticDeformationService(this.sceneManager.getCamera());
        this.uiManager = new UIManager();

        this.mouse = new THREE.Vector2();
        this.isMouseDownForDeformation = false;
        this.startMouse = { x: 0, y: 0 };
        this.lastTrigger = { x: 0, y: 0 };
        this.stretchTriggered = false;

        this.setupEventListeners();
        this.modelService.loadModel();
        this.animate();
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.sceneManager.onWindowResize();
            this.modelService.onWindowResize();
        }, { passive: true });

        EventBus.on('mouseMove', ({ mouse }) => {
            this.mouse.copy(mouse);
            if (this.isMouseDownForDeformation) {
                const px = (mouse.x + 1) / 2 * window.innerWidth;
                const py = (-mouse.y + 1) / 2 * window.innerHeight;
                if (!this.stretchTriggered) {
                    // initial stretch when moved threshold distance
                    const dx = px - this.startMouse.x;
                    const dy = py - this.startMouse.y;
                    if (Math.hypot(dx, dy) >= CONFIG.STRETCH_INITIAL_THRESHOLD) {
                        this.soundService.startStretch();
                        this.stretchTriggered = true;
                        this.lastTrigger.x = px;
                        this.lastTrigger.y = py;
                    }
                } else {
                    // subsequent stretch when moved additional distance
                    const dx = px - this.lastTrigger.x;
                    const dy = py - this.lastTrigger.y;
                    if (Math.hypot(dx, dy) >= CONFIG.STRETCH_SUBSEQUENT_THRESHOLD) {
                        this.soundService.startStretch();
                        this.lastTrigger.x = px;
                        this.lastTrigger.y = py;
                    }
                }
            }
        });

        EventBus.on('deformationStart', () => {
            this.isMouseDownForDeformation = true;
            this.stretchTriggered = false;
            // Record initial mouse position in pixels
            this.startMouse.x = (this.mouse.x + 1) / 2 * window.innerWidth;
            this.startMouse.y = (-this.mouse.y + 1) / 2 * window.innerHeight;
            this.lastTrigger.x = this.startMouse.x;
            this.lastTrigger.y = this.startMouse.y;
            document.body.style.cursor = 'grabbing';
        });
        EventBus.on('deformationEnd', () => {
            if (this.stretchTriggered) {
                // Calculate screen position of mouse
                const px = (this.mouse.x + 1) / 2 * window.innerWidth;
                const py = (-this.mouse.y + 1) / 2 * window.innerHeight;
                // Center of model assumed at canvas center
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const dist = Math.hypot(px - cx, py - cy);
                if (dist >= CONFIG.RELEASE_DISTANCE_THRESHOLD) {
                    // play release
                    this.soundService.stopStretch();
                } else {
                    // just stop stretch without release sound
                    this.soundService.stopStretchWithoutRelease();
                }
            }
            this.isMouseDownForDeformation = false;
            document.body.style.cursor = 'grab';
            // reset trigger state
            this.stretchTriggered = false;
        });
    }

    animate(time) {
        requestAnimationFrame(this.animate.bind(this));
        
        this.lightingService.animate(time);
        this.uiManager.animate(time);
        this.modelService.animate(this.mouse, this.isMouseDownForDeformation);

        this.sceneManager.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ElasticSanyaApp();
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';

export class ModelService {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.elasticMeshes = [];
        this.originalVertices = new Map();
    }

    loadModel() {
        const loader = new GLTFLoader();
        loader.load(
            CONFIG.MODEL_PATH,
            (gltf) => {
                this.model = gltf.scene;
                this.scene.add(this.model);

                const box = new THREE.Box3().setFromObject(this.model);
                const center = box.getCenter(new THREE.Vector3());
                this.model.position.sub(center);

                this.onWindowResize(); // Set initial scale and position

                this.model.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                            this.elasticMeshes.push(child);

                            const positions = child.geometry.attributes.position;
                            const originalPositions = new Float32Array(positions.array);
                            this.originalVertices.set(child, originalPositions);

                            child.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
                            child.geometry.computeBoundingBox();
                            child.frustumCulled = false;
                        }

                        const material = child.material;
                        material.metalness = 0;
                        material.roughness = 0.35;
                        material.envMapIntensity = 2;
                        material.lightMap = null;
                        material.aoMapIntensity = 1.0;
                        material.transparent = true;
                        material.opacity = 1;
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                EventBus.emit('modelLoaded', { 
                    model: this.model, 
                    elasticMeshes: this.elasticMeshes,
                    originalVertices: this.originalVertices
                });
            },
            (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
            (error) => console.error('Error loading model:', error)
        );
    }

    onWindowResize() {
        if (!this.model) return;
        const scale = window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE;
        this.model.scale.set(scale, scale, scale);
        this.model.position.z = window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_Z : CONFIG.DESKTOP_Z;
    }

    animate(mouse, isMouseDown) {
        if (this.model && !isMouseDown) {
            const targetX = mouse.x * CONFIG.MOUSE_ROTATION_Y_FACTOR;
            const targetY = -mouse.y * CONFIG.MOUSE_ROTATION_X_FACTOR;

            this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, targetX, CONFIG.LERP_FACTOR);
            this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, targetY, CONFIG.LERP_FACTOR);
        }
    }
}

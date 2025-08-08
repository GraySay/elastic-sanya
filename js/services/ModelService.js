import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';
import { PSX_VERTEX_SHADER, PSX_FRAGMENT_SHADER, PSX_DEFAULTS } from '../shaders/PSXShaders.js';

export class ModelService {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.model = null;
        this.elasticMeshes = [];
        this.originalVertices = new Map();
        this.currentModelPath = CONFIG.MODEL_PATH;
        
        // Clipping planes for swipe animation
        this.clippingPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -2);
        this.clippingPlaneInv = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 2);
        this.isTransitioning = false;
        this.transitionModels = []; // Модели участвующие в переходе
        
        // Listen for model switch events
        EventBus.on('modelSwitch', this.switchModel.bind(this));
    }

    loadModel() {
        const loader = new GLTFLoader();
        loader.load(
            this.currentModelPath,
            (gltf) => {
                this.model = gltf.scene;
                this.scene.add(this.model);

                const box = new THREE.Box3().setFromObject(this.model);
                const center = box.getCenter(new THREE.Vector3());
                this.model.position.sub(center);

                this.onWindowResize();
                this.setupElasticDeformation(this.model);

                EventBus.emit('modelLoaded', { 
                    model: this.model, 
                    elasticMeshes: this.elasticMeshes,
                    originalVertices: this.originalVertices
                });
            },
            undefined,
            (error) => console.error('Error loading model:', error)
        );
    }

    switchModel() {
        if (this.isTransitioning) return;
        
        this.isTransitioning = true;
    EventBus.emit('modelSwitchStart');
        
    // Toggle between models
        const isGoingToHighRes = this.currentModelPath === CONFIG.ALT_MODEL_PATH;
        this.currentModelPath = this.currentModelPath === CONFIG.MODEL_PATH ? CONFIG.ALT_MODEL_PATH : CONFIG.MODEL_PATH;
        
        const oldModel = this.model;
        
        const loader = new GLTFLoader();
        loader.load(
            this.currentModelPath,
            (gltf) => {
                const newModel = gltf.scene;
                
                // Center and transform new model
                const box = new THREE.Box3().setFromObject(newModel);
                const center = box.getCenter(new THREE.Vector3());
                newModel.position.sub(center);
                this.setModelTransform(newModel);
                
                // Apply PSX shader only for ALT model
                if (this.currentModelPath === CONFIG.ALT_MODEL_PATH) {
                    this.applyPSXShader(newModel);
                }
                
                // Save original vertices before any deformation
                this.saveOriginalVertices(newModel);
                
                // Copy rotation for a smooth transition
                if (oldModel) {
                    newModel.rotation.copy(oldModel.rotation);
                }
                
                // Initialize clipping for new model before adding to scene
                this.clippingPlaneInv.constant = -2; // hidden
                this.clippingPlaneInv.normal.set(-1, 0, 0);
                this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                
                // Add to scene after clipping is set
                this.scene.add(newModel);
                
                if (oldModel) {
                    this.clippingPlane.constant = 2; // visible
                    this.setupModelClipping(oldModel, [this.clippingPlane]);
                }
                
                // Track models involved in transition
                this.transitionModels = [oldModel, newModel].filter(Boolean);
                
                // Update main reference
                this.model = newModel;
                
                // Rebuild elastic data for both models
                this.updateTransitionElasticData();
                
                // Start animation immediately
                this.animateSwipe(oldModel, newModel, isGoingToHighRes);
            },
            undefined,
            (error) => {
                console.error('Error loading model:', error);
                this.isTransitioning = false;
                EventBus.emit('modelSwitchError');
            }
        );
    }

    setupModelMaterials(model, clippingPlanes) {
        model.traverse((child) => {
            if (child.isMesh) {
                if (!child.userData.originalMaterial) {
                    child.userData.originalMaterial = {
                        metalness: child.material.metalness,
                        roughness: child.material.roughness,
                        envMapIntensity: child.material.envMapIntensity,
                        aoMapIntensity: child.material.aoMapIntensity,
                        dithering: child.material.dithering,
                        transparent: child.material.transparent,
                        opacity: child.material.opacity
                    };
                }
                
                const material = child.material.clone();
                const original = child.userData.originalMaterial;
                
                // Restore original PBR properties
                material.metalness = original.metalness;
                material.roughness = original.roughness;
                material.envMapIntensity = original.envMapIntensity;
                material.aoMapIntensity = original.aoMapIntensity;
                material.dithering = original.dithering;
                
                // Apply clipping
                if (clippingPlanes && clippingPlanes.length > 0) {
                    material.clippingPlanes = clippingPlanes;
                    material.clipShadows = true;
                } else {
                    material.clippingPlanes = [];
                    material.clipShadows = false;
                    material.transparent = original.transparent;
                    material.opacity = original.opacity;
                }
                
                material.needsUpdate = true;
                child.material = material;
            }
        });
    }

    setModelTransform(model) {
        const scale = window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE;
        model.scale.set(scale, scale, scale);
        model.position.z = window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_Z : CONFIG.DESKTOP_Z;
    }

    animateSwipe(oldModel, newModel, isGoingToHighRes) {
    // Initialize clipping state just before animation
        this.clippingPlane.constant = 2;
        this.clippingPlaneInv.constant = -2;
        this.setupModelClipping(oldModel, [this.clippingPlane]);
        this.setupModelClipping(newModel, [this.clippingPlaneInv]);

    // Duration/steps per mode
        const duration = isGoingToHighRes ? 1 : 3;
        const steps = isGoingToHighRes ? 64 : 64;
        
        EventBus.emit('swipeAnimationStart', { isGoingToHighRes, duration });
    // Enable global clipping during animation
        this.renderer.localClippingEnabled = true;
        
        if (window.gsap) {
            if (isGoingToHighRes) {
        // 1s: both models clipped
                const timeline = window.gsap.timeline({
                    onStart: () => {
            // Enable renderer clipping when standard materials exist
                        const hasStandardMaterials = oldModel && oldModel.traverse(child => {
                            if (child.isMesh && !child.material.isShaderMaterial) return true;
                        });
                        if (hasStandardMaterials) {
                            this.renderer.localClippingEnabled = true;
                        }
            // Ensure shader materials get initial uniforms
                        if (oldModel) this.setupModelClipping(oldModel, [this.clippingPlane]);
                        if (newModel) this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                    },
                    onComplete: () => {
                        this.renderer.localClippingEnabled = false;
                        EventBus.emit('swipeAnimationComplete');
                        this.completeSwipe(oldModel, newModel);
                    }
                });
                
        // Animate both planes in sync
                timeline.fromTo(
                    this.clippingPlane,
                    { constant: 2 },
                    { 
                        constant: -2, 
                        duration: duration, 
                        ease: `steps(${steps}, end)`, 
                        immediateRender: false,
                        onUpdate: () => {
                // Mirror plane
                            this.clippingPlaneInv.constant = -this.clippingPlane.constant;
                // Update materials
                            if (oldModel) this.setupModelClipping(oldModel, [this.clippingPlane]);
                            if (newModel) this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                        }
                    }
                );
            } else {
        // 3s: old falls + new appears
                this.animateFallAndReplace(oldModel, newModel, duration);
            }
        } else {
            EventBus.emit('swipeAnimationComplete');
            this.completeSwipe(oldModel, newModel);
        }
    }

    animateFallAndReplace(oldModel, newModel, duration) {
    // Disable clipping on the new model (no effect during 3s path)
        this.setupModelClipping(newModel, []);
        
    // Hide new model until the fall is done
        newModel.visible = false;
        
        if (window.gsap) {
            const timeline = window.gsap.timeline({
                onComplete: () => {
                    this.renderer.localClippingEnabled = false;
                    this.completeSwipe(oldModel, newModel);
                }
            });

        // Phase 1: old model falls (2.7s)
            timeline.to(oldModel.position, {
        y: -10,
                duration: 2.7,
                ease: "bounce.out",
                onComplete: () => {
            // Signal UI to finish text animation after phase 1
                    EventBus.emit('swipeAnimationComplete');
                }
            })
        // Phase 2: new model scales in (0.5s)
            .call(() => {
                newModel.visible = true;
        newModel.scale.set(0, 0, 0);
            })
            .to(newModel.scale, {
                x: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                y: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                z: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                duration: 0.5,
                ease: "back.out(1.7)"
            })
        // Phase 3: fade out old model (0.5s)
            .to({ opacity: 1 }, {
                opacity: 0,
                duration: 0.5,
                onUpdate: function() {
            // Apply opacity to all old model materials
                    const currentOpacity = this.targets()[0].opacity;
                    if (oldModel) {
                        oldModel.traverse((child) => {
                            if (child.isMesh && child.material) {
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(mat => {
                                        mat.transparent = true;
                                        mat.opacity = currentOpacity;
                                    });
                                } else {
                                    child.material.transparent = true;
                                    child.material.opacity = currentOpacity;
                                }
                            }
                        });
                    }
                }
        }, "-=0.5");
        }
    }

    completeSwipe() {
        this.isTransitioning = false;
        this.renderer.localClippingEnabled = false;
        
    // Remove old model and clean up materials
        if (this.transitionModels[0]) {
            this.scene.remove(this.transitionModels[0]);
            this.transitionModels[0].traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.dispose();
                }
            });
        }
        
    // Reset clipping on the new model
        if (this.transitionModels[1]) {
            this.setupModelClipping(this.transitionModels[1], []);
        }
        
        this.transitionModels = [];
        this.updateTransitionElasticData();
        
        EventBus.emit('modelSwitchComplete');
    }

    applyPSXShader(model) {
        if (!CONFIG.PSX_EFFECT_ENABLED) return;

        model.traverse((child) => {
            if (child.isMesh && child.material) {
                const oldMaterial = child.material;
                
                const uniforms = {
                    map: { value: oldMaterial.map },
                    diffuse: { value: oldMaterial.color },
                    opacity: { value: oldMaterial.opacity },
                    time: { value: 0.0 },
                    vertexJitter: { value: CONFIG.PSX_VERTEX_JITTER },
                    colorQuantization: { value: CONFIG.PSX_COLOR_QUANTIZATION },
                    
                    // Clipping uniforms (disabled by default)
                    clippingPlane: { value: new THREE.Vector4(1, 0, 0, 0) },
                    enableClipping: { value: false },
                    
                    // Dynamic lighting
                    lightPosition: { value: new THREE.Vector3(0, 5, 5) },
                    lightColor: { value: new THREE.Color(0xffffff) },
                    lightIntensity: { value: 0.0 }
                };

                const newMaterial = new THREE.ShaderMaterial({
                    uniforms: uniforms,
                    vertexShader: PSX_VERTEX_SHADER,
                    fragmentShader: PSX_FRAGMENT_SHADER,
                    transparent: true,
                    clipping: false // We handle clipping manually
                });
                
                // Keep original for potential restore
                child.userData.originalMaterial = oldMaterial;
                child.material = newMaterial;
            }
        });
    }

    update(deltaTime, lightPosition, lightIntensity) {
        // Update PSX shader uniforms
        if (this.model && CONFIG.PSX_EFFECT_ENABLED && this.currentModelPath === CONFIG.ALT_MODEL_PATH) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material && child.material.isShaderMaterial) {
                    const uniforms = child.material.uniforms;
                    uniforms.time.value += deltaTime;
                    uniforms.lightPosition.value.copy(lightPosition);
                    uniforms.lightIntensity.value = lightIntensity;
                }
            });
        }
    }

    setupModelClipping(model, planes) {
        if (!model) return;
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                if (child.material.isShaderMaterial) {
                    // Use shader uniforms for clipping; disable Three.js clipping
                    child.material.clippingPlanes = [];
                    child.material.clipShadows = false;
                    child.material.uniforms.enableClipping.value = planes && planes.length > 0;
                    if (planes && planes.length > 0) {
                        const plane = planes[0];
                        child.material.uniforms.clippingPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
                        child.material.uniformsNeedUpdate = true;
                        child.material.needsUpdate = true;
                    } else {
                        // No clipping
                    }
                } else {
                    // Standard materials: Three.js clipping
                    child.material.clippingPlanes = planes || [];
                    child.material.clipIntersection = false; 
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    setupElasticDeformation(model) {
        this.elasticMeshes = [];
    // Keep existing originalVertices
        
        model.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                    this.elasticMeshes.push(child);
                    
            // Create originalVertices if missing
                    if (!this.originalVertices.has(child)) {
                        const positions = child.geometry.attributes.position;
                        const originalPositions = new Float32Array(positions.array);
                        this.originalVertices.set(child, originalPositions);
                    }
                    
                    child.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
                    child.geometry.computeBoundingBox();
                    child.frustumCulled = false;
                }

                const material = child.material;
                if (!child.userData.originalMaterial) {
                    child.userData.originalMaterial = {
                        metalness: material.metalness || 0.1,
                        roughness: material.roughness || 0.4, 
                        envMapIntensity: material.envMapIntensity || 1.2,
                        aoMapIntensity: material.aoMapIntensity || 1.0,
                        dithering: material.dithering !== undefined ? material.dithering : true,
                        transparent: material.transparent || false,
                        opacity: material.opacity || 1.0
                    };
                }
                
                const original = child.userData.originalMaterial;
                material.metalness = original.metalness;
                material.roughness = original.roughness;
                material.envMapIntensity = original.envMapIntensity;
                material.aoMapIntensity = original.aoMapIntensity;
                material.dithering = original.dithering;
                material.transparent = original.transparent;
                material.opacity = original.opacity;
                material.needsUpdate = true;
                
                child.castShadow = false;
                child.receiveShadow = false;
                
                if (child.geometry) {
                    child.geometry.computeBoundingBox();
                    child.geometry.computeBoundingSphere();
                }
            }
        });
    }

    disposeModel(model) {
        model.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }

    

    onWindowResize() {
    // During transition, resize all involved models
        if (this.isTransitioning && this.transitionModels.length > 0) {
            this.transitionModels.forEach(model => {
                if (model) {
                    this.setModelTransform(model);
                }
            });
        }
    // Otherwise, resize the active model
        else if (this.model) {
            this.setModelTransform(this.model);
        }
    }

    animate(mouse, isMouseDown) {
    // During transition, animate all models together
        if (this.isTransitioning && this.transitionModels.length > 0) {
            if (!isMouseDown) {
                const targetX = mouse.x * CONFIG.MOUSE_ROTATION_Y_FACTOR;
                const targetY = -mouse.y * CONFIG.MOUSE_ROTATION_X_FACTOR;

        // Apply rotation to each
                this.transitionModels.forEach(model => {
                    if (model) {
                        model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, targetX, CONFIG.LERP_FACTOR);
                        model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, targetY, CONFIG.LERP_FACTOR);
                    }
                });
            }
        } 
    // Default path: animate active model only
        else if (this.model && !isMouseDown) {
            const targetX = mouse.x * CONFIG.MOUSE_ROTATION_Y_FACTOR;
            const targetY = -mouse.y * CONFIG.MOUSE_ROTATION_X_FACTOR;

            this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, targetX, CONFIG.LERP_FACTOR);
            this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, targetY, CONFIG.LERP_FACTOR);
        }
    }

    saveOriginalVertices(model) {
    // Save original vertices for deformation system
        model.traverse((child) => {
            if (child.isMesh && child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                if (!this.originalVertices.has(child)) {
                    const positions = child.geometry.attributes.position;
                    const originalPositions = new Float32Array(positions.array);
                    this.originalVertices.set(child, originalPositions);
                    child.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
                    child.frustumCulled = false;
                }
            }
        });
    }

    updateTransitionElasticData() {
    // During transition, aggregate elastic data from all models
        if (this.isTransitioning && this.transitionModels.length > 0) {
            const combinedElasticMeshes = [];
            const combinedOriginalVertices = new Map();
            
            this.transitionModels.forEach(model => {
                if (model) {
                    model.traverse((child) => {
                        if (child.isMesh && child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                            combinedElasticMeshes.push(child);
                            
                // Reuse existing originalVertices
                            if (this.originalVertices.has(child)) {
                                combinedOriginalVertices.set(child, this.originalVertices.get(child));
                            }
                        }
                    });
                }
            });
            
        // Publish combined data
            EventBus.emit('modelLoaded', { 
                model: this.model, 
                elasticMeshes: combinedElasticMeshes,
                originalVertices: combinedOriginalVertices
            });
        }
    }
}

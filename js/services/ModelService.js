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
            (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
            (error) => console.error('Error loading model:', error)
        );
    }

    switchModel() {
        if (this.isTransitioning) return;
        
        this.isTransitioning = true;
        EventBus.emit('modelSwitchStart'); // Уведомляем UIManager о начале переключения
        
        // Switch between models
        const isGoingToHighRes = this.currentModelPath === CONFIG.MODEL_PATH_1K;
        this.currentModelPath = this.currentModelPath === CONFIG.MODEL_PATH ? CONFIG.MODEL_PATH_1K : CONFIG.MODEL_PATH;
        
        const oldModel = this.model;
        
        const loader = new GLTFLoader();
        loader.load(
            this.currentModelPath,
            (gltf) => {
                const newModel = gltf.scene;
                
                // Setup new model
                const box = new THREE.Box3().setFromObject(newModel);
                const center = box.getCenter(new THREE.Vector3());
                newModel.position.sub(center);
                this.setModelTransform(newModel);
                
                // Сохраняем исходные vertices для новой модели ДО любых деформаций
                this.saveOriginalVertices(newModel);
                
                // Copy current rotation for smooth transition
                if (oldModel) {
                    newModel.rotation.copy(oldModel.rotation);
                }
                
                // Setup clipping planes
                this.clippingPlaneInv.constant = -2; // New model hidden
                this.setupModelMaterials(newModel, [this.clippingPlaneInv]);
                this.scene.add(newModel);
                
                if (oldModel) {
                    this.clippingPlane.constant = 2; // Old model visible
                    this.setupModelMaterials(oldModel, [this.clippingPlane]);
                }
                
                // Настраиваем модели для синхронной анимации
                this.transitionModels = [oldModel, newModel].filter(Boolean);
                
                // Обновляем основную модель для отслеживания курсора
                this.model = newModel;
                
                // Собираем все mesh'ы и originalVertices для обеих моделей
                this.updateTransitionElasticData();
                
                // Start animation with different duration based on direction
                setTimeout(() => {
                    this.animateSwipe(oldModel, newModel, isGoingToHighRes);
                }, 16);
            },
            undefined,
            (error) => {
                console.error('Error loading model:', error);
                this.isTransitioning = false;
                EventBus.emit('modelSwitchError'); // Уведомляем об ошибке
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
                
                // Restore original material properties
                material.metalness = original.metalness;
                material.roughness = original.roughness;
                material.envMapIntensity = original.envMapIntensity;
                material.aoMapIntensity = original.aoMapIntensity;
                material.dithering = original.dithering;
                
                // Setup clipping
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
        this.clippingPlane.constant = 2;
        this.clippingPlaneInv.constant = -2;
        
        // Определяем скорость анимации: быстрее для возврата к высокому разрешению
        const duration = isGoingToHighRes ? 1 : 3; // 1 сек для возврата к высокому разрешению, 3 сек для перехода к низкому
        const steps = isGoingToHighRes ? 16 : 48;
        
        // Уведомляем о начале swipe-анимации с информацией о направлении и длительности
        EventBus.emit('swipeAnimationStart', { isGoingToHighRes, duration });
        
        if (window.gsap) {
            const timeline = window.gsap.timeline({
                onComplete: () => {
                    EventBus.emit('swipeAnimationComplete');
                    this.completeSwipe(oldModel, newModel);
                }
            });
            
            timeline.to(this.clippingPlane, {
                constant: -2,
                duration: duration,
                ease: `steps(${steps})`,
                onUpdate: () => {
                    this.clippingPlaneInv.constant = -this.clippingPlane.constant;
                }
            });
            
        } else {
            EventBus.emit('swipeAnimationComplete');
            this.completeSwipe(oldModel, newModel);
        }
    }

    completeSwipe(oldModel, newModel) {
        if (oldModel) {
            this.scene.remove(oldModel);
            this.disposeModel(oldModel);
        }
        
        // Очищаем переменные анимации
        this.transitionModels = [];
        this.setupModelMaterials(newModel, null);
        this.setupElasticDeformation(newModel);
        this.isTransitioning = false;
        
        EventBus.emit('modelSwitchComplete'); // Уведомляем UIManager о завершении
        
        EventBus.emit('modelLoaded', { 
            model: this.model, 
            elasticMeshes: this.elasticMeshes,
            originalVertices: this.originalVertices
        });
    }

    setupElasticDeformation(model) {
        this.elasticMeshes = [];
        // НЕ очищаем originalVertices! Сохраняем уже существующие
        
        model.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                    this.elasticMeshes.push(child);
                    
                    // Создаем originalVertices только если их еще нет
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
        // Во время перехода изменяем размер всех переходных моделей
        if (this.isTransitioning && this.transitionModels.length > 0) {
            this.transitionModels.forEach(model => {
                if (model) {
                    this.setModelTransform(model);
                }
            });
        }
        // Обычное изменение размера для одной модели
        else if (this.model) {
            this.setModelTransform(this.model);
        }
    }

    animate(mouse, isMouseDown) {
        // Во время перехода анимируем все переходные модели синхронно
        if (this.isTransitioning && this.transitionModels.length > 0) {
            if (!isMouseDown) {
                const targetX = mouse.x * CONFIG.MOUSE_ROTATION_Y_FACTOR;
                const targetY = -mouse.y * CONFIG.MOUSE_ROTATION_X_FACTOR;

                // Анимируем все модели в переходе синхронно
                this.transitionModels.forEach(model => {
                    if (model) {
                        model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, targetX, CONFIG.LERP_FACTOR);
                        model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, targetY, CONFIG.LERP_FACTOR);
                    }
                });
            }
        } 
        // Обычная анимация для одной модели
        else if (this.model && !isMouseDown) {
            const targetX = mouse.x * CONFIG.MOUSE_ROTATION_Y_FACTOR;
            const targetY = -mouse.y * CONFIG.MOUSE_ROTATION_X_FACTOR;

            this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, targetX, CONFIG.LERP_FACTOR);
            this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, targetY, CONFIG.LERP_FACTOR);
        }
    }

    saveOriginalVertices(model) {
        // Сохраняем исходные vertices до любых деформаций
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
        // Во время перехода собираем elastic данные со всех моделей
        if (this.isTransitioning && this.transitionModels.length > 0) {
            const combinedElasticMeshes = [];
            const combinedOriginalVertices = new Map();
            
            this.transitionModels.forEach(model => {
                if (model) {
                    model.traverse((child) => {
                        if (child.isMesh && child.geometry.isBufferGeometry && child.geometry.attributes.position) {
                            combinedElasticMeshes.push(child);
                            
                            // Используем уже сохраненные originalVertices
                            if (this.originalVertices.has(child)) {
                                combinedOriginalVertices.set(child, this.originalVertices.get(child));
                            }
                        }
                    });
                }
            });
            
            // Отправляем объединенные данные в ElasticDeformationService
            EventBus.emit('modelLoaded', { 
                model: this.model, 
                elasticMeshes: combinedElasticMeshes,
                originalVertices: combinedOriginalVertices
            });
        }
    }
}

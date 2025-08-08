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
            (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
            (error) => console.error('Error loading model:', error)
        );
    }

    switchModel() {
        if (this.isTransitioning) return;
        
        this.isTransitioning = true;
        EventBus.emit('modelSwitchStart'); // Уведомляем UIManager о начале переключения
        
        // Switch between models
        const isGoingToHighRes = this.currentModelPath === CONFIG.ALT_MODEL_PATH;
        this.currentModelPath = this.currentModelPath === CONFIG.MODEL_PATH ? CONFIG.ALT_MODEL_PATH : CONFIG.MODEL_PATH;
        
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
                
                // Применяем PSX шейдер, если это ALT_MODEL
                if (this.currentModelPath === CONFIG.ALT_MODEL_PATH) {
                    this.applyPSXShader(newModel);
                }
                
                // Сохраняем исходные vertices для новой модели ДО любых деформаций
                this.saveOriginalVertices(newModel);
                
                // Copy current rotation for smooth transition
                if (oldModel) {
                    newModel.rotation.copy(oldModel.rotation);
                }
                
                // Setup clipping planes ПЕРЕД добавлением в сцену
                this.clippingPlaneInv.constant = -2; // New model hidden
                this.clippingPlaneInv.normal.set(-1, 0, 0); // Убедимся, что нормаль правильная
                this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                
                // Только теперь добавляем в сцену
                this.scene.add(newModel);
                
                if (oldModel) {
                    this.clippingPlane.constant = 2; // Old model visible
                    this.setupModelClipping(oldModel, [this.clippingPlane]);
                }
                
                // Настраиваем модели для синхронной анимации
                this.transitionModels = [oldModel, newModel].filter(Boolean);
                
                // Обновляем основную модель для отслеживания курсора
                this.model = newModel;
                
                // Собираем все mesh'ы и originalVertices для обеих моделей
                this.updateTransitionElasticData();
                
                // Start animation immediately to avoid initial flash
                this.animateSwipe(oldModel, newModel, isGoingToHighRes);
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
        // Устанавливаем начальное состояние непосредственно перед анимацией
        this.clippingPlane.constant = 2;
        this.clippingPlaneInv.constant = -2;
        this.setupModelClipping(oldModel, [this.clippingPlane]);
        this.setupModelClipping(newModel, [this.clippingPlaneInv]);

        // Определяем скорость анимации
        const duration = isGoingToHighRes ? 1 : 3;
        const steps = isGoingToHighRes ? 64 : 64;
        
        EventBus.emit('swipeAnimationStart', { isGoingToHighRes, duration });
        // Включаем глобальное clipping сразу перед анимацией
        this.renderer.localClippingEnabled = true;
        
        if (window.gsap) {
            if (isGoingToHighRes) {
                // 1-секундная анимация: clipping обеих моделей как раньше
                const timeline = window.gsap.timeline({
                    onStart: () => {
                        // Включаем clipping только если есть стандартные материалы
                        const hasStandardMaterials = oldModel && oldModel.traverse(child => {
                            if (child.isMesh && !child.material.isShaderMaterial) return true;
                        });
                        if (hasStandardMaterials) {
                            this.renderer.localClippingEnabled = true;
                        }
                        // Принудительно инициализируем clipping для шейдерных материалов
                        if (oldModel) this.setupModelClipping(oldModel, [this.clippingPlane]);
                        if (newModel) this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                    },
                    onComplete: () => {
                        this.renderer.localClippingEnabled = false;
                        EventBus.emit('swipeAnimationComplete');
                        this.completeSwipe(oldModel, newModel);
                    }
                });
                
                // Анимируем обе плоскости синхронно
                timeline.fromTo(
                    this.clippingPlane,
                    { constant: 2 },
                    { 
                        constant: -2, 
                        duration: duration, 
                        ease: `steps(${steps}, end)`, 
                        immediateRender: false,
                        onUpdate: () => {
                            // Синхронизируем инвертированную плоскость
                            this.clippingPlaneInv.constant = -this.clippingPlane.constant;
                            // Обновляем clipping для обеих моделей
                            if (oldModel) this.setupModelClipping(oldModel, [this.clippingPlane]);
                            if (newModel) this.setupModelClipping(newModel, [this.clippingPlaneInv]);
                        }
                    }
                );
            } else {
                // 3-секундная анимация: падение старой модели + появление новой
                this.animateFallAndReplace(oldModel, newModel, duration);
            }
        } else {
            EventBus.emit('swipeAnimationComplete');
            this.completeSwipe(oldModel, newModel);
        }
    }

    animateFallAndReplace(oldModel, newModel, duration) {
        // Отключаем clipping для новой модели - она появится без эффекта
        this.setupModelClipping(newModel, []);
        
        // Скрываем новую модель до окончания падения
        newModel.visible = false;
        
        if (window.gsap) {
            const timeline = window.gsap.timeline({
                onComplete: () => {
                    this.renderer.localClippingEnabled = false;
                    this.completeSwipe(oldModel, newModel);
                }
            });

            // Фаза 1: Падение старой модели (2.5 сек)
            timeline.to(oldModel.position, {
                y: -10, // падает вниз
                duration: 2.7,
                ease: "bounce.out",
                onComplete: () => {
                    // Уведомляем об окончании первой фазы - для завершения текстовой анимации
                    EventBus.emit('swipeAnimationComplete');
                }
            })
            // Фаза 2: Появление новой модели (0.5 сек)
            .call(() => {
                newModel.visible = true;
                newModel.scale.set(0, 0, 0); // начинаем с нулевого размера
            })
            .to(newModel.scale, {
                x: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                y: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                z: window.innerWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.MOBILE_SCALE : CONFIG.DESKTOP_SCALE,
                duration: 0.5,
                ease: "back.out(1.7)"
            })
            // Фаза 3: Плавное исчезновение старой модели
            .to({ opacity: 1 }, {
                opacity: 0,
                duration: 0.5,
                onUpdate: function() {
                    // Применяем opacity ко всем материалам старой модели
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
            }, "-=0.5"); // начинаем одновременно с появлением новой модели
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
                    opacity: { value: oldMaterial.opacity }, // возвращаем нормальную opacity
                    time: { value: 0.0 },
                    vertexJitter: { value: CONFIG.PSX_VERTEX_JITTER },
                    colorQuantization: { value: CONFIG.PSX_COLOR_QUANTIZATION },
                    
                    // Clipping planes - инициализируем с отключенным clipping
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
                
                // Store original material for later
                child.userData.originalMaterial = oldMaterial;
                child.material = newMaterial;
            }
        });
    }

    update(deltaTime, lightPosition, lightIntensity) {
        // Update PSX shader time uniform for all meshes in the model
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
                    // PSX shader handles clipping via uniforms - disable Three.js clipping
                    child.material.clippingPlanes = [];
                    child.material.clipShadows = false;
                    child.material.uniforms.enableClipping.value = planes && planes.length > 0;
                    if (planes && planes.length > 0) {
                        const plane = planes[0];
                        child.material.uniforms.clippingPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
                        // Принудительно обновляем шейдер
                        child.material.uniformsNeedUpdate = true;
                        child.material.needsUpdate = true;
                        console.log('Shader clipping updated for newModel:', {
                            normal: [plane.normal.x, plane.normal.y, plane.normal.z],
                            constant: plane.constant,
                            enableClipping: true,
                            modelVisible: plane.normal.x * 0 + plane.normal.y * 0 + plane.normal.z * 0 + plane.constant > 0 ? 'YES' : 'NO'
                        });
                    } else {
                        console.log('Shader clipping disabled');
                    }
                } else {
                    // Standard materials use Three.js clipping
                    child.material.clippingPlanes = planes || [];
                    child.material.clipIntersection = false; 
                    child.material.needsUpdate = true;
                }
            }
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

    update(deltaTime, lightPosition, lightIntensity) {
        if (this.model && this.currentModelPath === CONFIG.ALT_MODEL_PATH) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material.isShaderMaterial) {
                    const uniforms = child.material.uniforms;
                    uniforms.time.value += deltaTime;
                    uniforms.lightPosition.value.copy(lightPosition);
                    uniforms.lightIntensity.value = lightIntensity;
                    
                    // Обновляем clipping plane
                    if (this.scene.clippingPlanes && this.scene.clippingPlanes.length > 0) {
                        uniforms.enableClipping.value = true;
                        uniforms.clippingPlane.value.copy(this.scene.clippingPlanes[0]);
                    } else {
                        uniforms.enableClipping.value = false;
                    }
                }
            });
        }
    }

    // ... (keep existing methods like onWindowResize, animate, etc.)
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

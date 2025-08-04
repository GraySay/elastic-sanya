import * as THREE from 'three';

export class SceneManager {
    constructor(canvas) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            premultipliedAlpha: false
        });

        this.setupRenderer();
        this.setupCamera();

        window.addEventListener('resize', this.onWindowResize.bind(this), { passive: true });
    }

    setupRenderer() {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.4;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(0x000000, 0);
        
        this.optimized = false;
    }

    setupCamera() {
        this.camera.position.z = 3;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }

    getRenderer() {
        return this.renderer;
    }

    render() {
        // Force WebGL state optimization after initial frames
        if (!this.optimized && performance.now() > 5000) {
            this.renderer.compile(this.scene, this.camera);
            this.optimized = true;
        }
        this.renderer.render(this.scene, this.camera);
    }
}

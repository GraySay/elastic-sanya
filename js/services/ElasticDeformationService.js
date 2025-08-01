import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';

export class ElasticDeformationService {
    constructor(camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.isMouseDown = false;
        this.grabbedPoint = null;
        this.lastDeformTime = 0;
        this.elasticMeshes = [];
        this.originalVertices = new Map();

        this.tempVectors = {
            vertex: new THREE.Vector3(),
            world: new THREE.Vector3(),
            displacement: new THREE.Vector3(),
            newWorld: new THREE.Vector3(),
            newLocal: new THREE.Vector3(),
            currentPos: new THREE.Vector3(),
        };

        EventBus.on('modelLoaded', this.onModelLoaded.bind(this));
        EventBus.on('mouseDown', this.handleMouseDown.bind(this));
        EventBus.on('mouseUp', this.handleMouseUp.bind(this));
        EventBus.on('mouseMove', this.handleMouseMove.bind(this));
    }

    onModelLoaded({ elasticMeshes, originalVertices }) {
        this.elasticMeshes = elasticMeshes;
        this.originalVertices = originalVertices;
    }

    handleMouseDown({ event, mouse }) {
        if (this.elasticMeshes.length > 0) {
            this.raycaster.setFromCamera(mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.elasticMeshes, true);
            if (intersects.length > 0) {
                this.isMouseDown = true;
                this.grabbedPoint = intersects[0].point.clone();
                EventBus.emit('deformationStart');
                this.performElasticDeformation(mouse);
            }
        }
    }

    handleMouseUp() {
        if (this.isMouseDown) {
            this.isMouseDown = false;
            this.grabbedPoint = null;
            this.animateElasticReturn();
            EventBus.emit('deformationEnd');
        }
    }

    handleMouseMove({ mouse }) {
        if (this.isMouseDown && this.elasticMeshes.length > 0) {
            const now = Date.now();
            if ((now - this.lastDeformTime) > CONFIG.DEFORM_THROTTLE) {
                this.performElasticDeformation(mouse);
                this.lastDeformTime = now;
            }
        }
    }

    performElasticDeformation(mouse) {
        if (!this.grabbedPoint) return;

        this.raycaster.setFromCamera(mouse, this.camera);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            this.camera.getWorldDirection(new THREE.Vector3()),
            this.grabbedPoint
        );

        const intersection = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(plane, intersection)) return;

        const pullDirection = new THREE.Vector3().subVectors(intersection, this.grabbedPoint);

        this.elasticMeshes.forEach(mesh => {
            const geometry = mesh.geometry;
            const positions = geometry.attributes.position;
            const originalPos = this.originalVertices.get(mesh);
            if (!originalPos) return;

            const worldMatrix = mesh.matrixWorld;
            const invWorldMatrix = worldMatrix.clone().invert();

            const deformRadiusSquared = CONFIG.DEFORM_RADIUS * CONFIG.DEFORM_RADIUS;

            const { vertex, world, displacement, newWorld, newLocal, currentPos } = this.tempVectors;

            for (let i = 0; i < positions.count; i++) {
                vertex.fromArray(originalPos, i * 3);
                world.copy(vertex).applyMatrix4(worldMatrix);

                const dx = world.x - this.grabbedPoint.x;
                const dy = world.y - this.grabbedPoint.y;
                const dz = world.z - this.grabbedPoint.z;
                const distanceSquared = dx * dx + dy * dy + dz * dz;

                if (distanceSquared > deformRadiusSquared) {
                    currentPos.fromArray(positions.array, i * 3);
                    currentPos.lerp(vertex, CONFIG.RETURN_LERP_FACTOR);
                    positions.setXYZ(i, currentPos.x, currentPos.y, currentPos.z);
                    continue;
                }

                const distance = Math.sqrt(distanceSquared);
                const normalizedDistance = distance / CONFIG.DEFORM_RADIUS;
                const influence = (1 - normalizedDistance) * (1 - normalizedDistance);

                displacement.copy(pullDirection).multiplyScalar(influence * CONFIG.DEFORM_STRENGTH);
                newWorld.copy(world).add(displacement);

                newLocal.copy(newWorld).applyMatrix4(invWorldMatrix);
                currentPos.fromArray(positions.array, i * 3);
                currentPos.lerp(newLocal, CONFIG.GRAB_LERP_FACTOR);
                positions.setXYZ(i, currentPos.x, currentPos.y, currentPos.z);
            }
            positions.needsUpdate = true;
        });
    }

    animateElasticReturn() {
        this.elasticMeshes.forEach(mesh => {
            if (!mesh.geometry.isBufferGeometry) return;

            const geometry = mesh.geometry;
            const positions = geometry.attributes.position;
            const originalPos = this.originalVertices.get(mesh);
            if (!originalPos) return;

            if (!mesh.vertexVelocities) {
                mesh.vertexVelocities = new Float32Array(positions.count * 3);
            }

            const returnAnimation = () => {
                let hasChanges = false;
                const velocityThreshold = 0.001;

                const { currentPos: currentVec, vertex: targetVec } = this.tempVectors;

                for (let i = 0; i < positions.count; i++) {
                    currentVec.fromArray(positions.array, i * 3);
                    targetVec.fromArray(originalPos, i * 3);

                    const springForceX = (targetVec.x - currentVec.x) * CONFIG.RETURN_SPRING;
                    const springForceY = (targetVec.y - currentVec.y) * CONFIG.RETURN_SPRING;
                    const springForceZ = (targetVec.z - currentVec.z) * CONFIG.RETURN_SPRING;

                    const vIdx = i * 3;
                    mesh.vertexVelocities[vIdx] = (mesh.vertexVelocities[vIdx] + springForceX) * CONFIG.RETURN_DAMPING;
                    mesh.vertexVelocities[vIdx + 1] = (mesh.vertexVelocities[vIdx + 1] + springForceY) * CONFIG.RETURN_DAMPING;
                    mesh.vertexVelocities[vIdx + 2] = (mesh.vertexVelocities[vIdx + 2] + springForceZ) * CONFIG.RETURN_DAMPING;

                    currentVec.x += mesh.vertexVelocities[vIdx];
                    currentVec.y += mesh.vertexVelocities[vIdx + 1];
                    currentVec.z += mesh.vertexVelocities[vIdx + 2];

                    const velocityMagnitude = Math.abs(mesh.vertexVelocities[vIdx]) + Math.abs(mesh.vertexVelocities[vIdx + 1]) + Math.abs(mesh.vertexVelocities[vIdx + 2]);
                    const distanceToTarget = Math.abs(currentVec.x - targetVec.x) + Math.abs(currentVec.y - targetVec.y) + Math.abs(currentVec.z - targetVec.z);

                    if (velocityMagnitude > velocityThreshold || distanceToTarget > 0.001) {
                        hasChanges = true;
                    }

                    positions.setXYZ(i, currentVec.x, currentVec.y, currentVec.z);
                }

                positions.needsUpdate = true;

                if (hasChanges) {
                    requestAnimationFrame(returnAnimation);
                } else {
                    positions.copyArray(originalPos);
                    positions.needsUpdate = true;
                    mesh.vertexVelocities.fill(0);
                }
            };

            returnAnimation();
        });
    }
}

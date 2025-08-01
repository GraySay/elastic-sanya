import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';

export class SoundService {
    constructor(camera) {
        // Existing sound logic
        this.burpSound = this.createSound(CONFIG.SOUNDS.BURP);
        this.gagSound = this.createSound(CONFIG.SOUNDS.GAG);
        this.clickCount = 0;
        this.lastClickTime = 0;
        EventBus.on('soundButtonClick', this.handleSoundButtonClick.bind(this));

        // New interaction sound logic
        this.camera = camera;
        if (this.camera) {
            this.listener = new THREE.AudioListener();
            this.camera.add(this.listener);
            this.audioLoader = new THREE.AudioLoader();

            this.stretchSounds = [];
            this.releaseSound = null;
            this.currentStretchSound = null;

            // Track last stretch sound index to avoid repeats
            this.lastStretchIndex = -1;

            this.audioInitialized = false;
            this.loadInteractionSounds();
            // HTML Audio for release sound for reliable playback
            this.releaseSoundHtml = this.createSound('assets/release.mp3');
            // Disco background sound
            this.discoSound = this.createSound('assets/disco.mp3');
            this.discoSound.loop = true;
            // Unlock HTMLAudio on first user interaction to avoid NotAllowedError
            this.audioUnlocked = false;
            const unlockAudio = () => {
                this.discoSound.play().then(() => {
                    this.discoSound.pause();
                }).catch(() => {}).finally(() => {
                    this.audioUnlocked = true;
                });
            };
            document.addEventListener('click', unlockAudio, { once: true, passive: false });
            document.addEventListener('touchstart', unlockAudio, { once: true, passive: false });
            // Listen for disco mode toggle
            EventBus.on('discoModeToggle', this.handleDiscoMode.bind(this));
        }
    }

    loadInteractionSounds() {
        // Load stretch sounds
        for (let i = 1; i <= 5; i++) {
            this.audioLoader.load(`assets/stretch${i}.mp3`, (buffer) => {
                const sound = new THREE.Audio(this.listener);
                sound.setBuffer(buffer);
                sound.setLoop(false);
                sound.setVolume(0.5);
                this.stretchSounds.push(sound);
            });
        }
    }

    startStretch() {
        if (!this.listener) return;
        if (!this.audioInitialized) {
            this.listener.context.resume();
            this.audioInitialized = true;
        }
        // Stop any currently playing stretch sound before playing a new one
        if (this.currentStretchSound && this.currentStretchSound.isPlaying) {
            this.currentStretchSound.stop();
        }
        if (this.stretchSounds.length > 0) {
            let randomIndex;
            if (this.stretchSounds.length === 1) {
                randomIndex = 0;
            } else {
                do {
                    randomIndex = Math.floor(Math.random() * this.stretchSounds.length);
                } while (randomIndex === this.lastStretchIndex);
            }
            this.lastStretchIndex = randomIndex;
            const sound = this.stretchSounds[randomIndex];
            sound.play();
            this.currentStretchSound = sound;
        }
    }

    stopStretch() {
        if (this.currentStretchSound && this.currentStretchSound.isPlaying) {
            this.currentStretchSound.stop();
            this.currentStretchSound = null;
        }
        if (this.releaseSoundHtml) {
            this.releaseSoundHtml.pause();
            this.releaseSoundHtml.currentTime = 0;
            this.releaseSoundHtml.play().catch(e => console.error('Release sound failed:', e));
        }
    }

    // Stop stretch sound without playing release sound
    stopStretchWithoutRelease() {
        if (this.currentStretchSound && this.currentStretchSound.isPlaying) {
            this.currentStretchSound.stop();
            this.currentStretchSound = null;
        }
    }

    // Removed panning logic; stretching sounds play globally

    createSound(src) {
        const sound = new Audio(src);
        sound.preload = 'auto';
        sound.addEventListener('ended', () => {
            sound.isPlaying = false;
        });
        return sound;
    }

    playSound(sound) {
        if (this.burpSound.isPlaying) this.burpSound.pause();
        if (this.gagSound.isPlaying) this.gagSound.pause();
        this.burpSound.currentTime = 0;
        this.gagSound.currentTime = 0;

        sound.play().catch(e => console.error("Sound play failed:", e));
        sound.isPlaying = true;
    }

    handleSoundButtonClick() {
        const currentTime = Date.now();

        if (currentTime - this.lastClickTime < CONFIG.CLICK_THRESHOLD) {
            this.clickCount++;
            if (this.clickCount >= CONFIG.CLICKS_FOR_GAG) {
                this.playSound(this.gagSound);
                this.clickCount = 0;
            }
        } else {
            this.clickCount = 1;
            this.playSound(this.burpSound);
        }

        this.lastClickTime = currentTime;
    }
    
    // Handle disco mode toggle: play or stop disco background sound
    handleDiscoMode(isActive) {
        if (!this.discoSound) return;
        if (isActive) {
            this.discoSound.play().catch(e => console.error('Disco sound failed:', e));
        } else {
            this.discoSound.pause();
            this.discoSound.currentTime = 0;
        }
    }
}

import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import EventBus from '../utils/EventBus.js';

export class SoundService {
    constructor(camera) {
        // Existing sound logic
        this.burpSound = this.createSound(CONFIG.SOUNDS.BURP);
        this.gagSound = this.createSound(CONFIG.SOUNDS.GAG);
        this.psxSound = this.createSound(CONFIG.SOUNDS.PSX);
        this.clickCount = 0;
        this.lastClickTime = 0;
        EventBus.on('soundButtonClick', this.handleSoundButtonClick.bind(this));
        EventBus.on('playPsxSound', this.playPsxSound.bind(this));
    EventBus.on('stopPsxSound', this.stopPsxSound.bind(this));
    // Central audio unlock state
    this.audioUnlocked = false;
    this._unlockInProgress = false;

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

            // Load interaction sounds
            this.loadInteractionSounds();
            // HTML Audio for release sound for reliable playback
            this.releaseSoundHtml = this.createSound('assets/release.mp3');
            // Disco background sound
            this.discoSound = this.createSound('assets/disco.mp3');
            this.discoSound.loop = true;
            // Attach one-shot, non-intrusive first-gesture listeners on document
            this._attachFirstGestureListeners();
            // Listen for disco mode toggle
            EventBus.on('discoModeToggle', this.handleDiscoMode.bind(this));
            // Optional external unlock hook removed for simplicity
        }
    }

    // Public: attempts to unlock/resume the WebAudio context using a silent buffer
    tryUnlockAudio() {
        if (this.audioUnlocked || this._unlockInProgress) return;
        const ctx = this.listener && this.listener.context;
        if (!ctx) return;
        this._unlockInProgress = true;
        // Do NOT touch HTMLAudio before resume; keep gesture for WebAudio resume
        try {
            // Create and play a 1-frame silent buffer to ensure audio graph starts
            const sr = ctx.sampleRate || 44100;
            const buffer = ctx.createBuffer(1, 1, sr);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
        } catch (_) {}
        const finish = (ok) => {
            this.audioUnlocked = !!ok;
            this._unlockInProgress = false;
            if (ok) {
                this._detachFirstGestureListeners();
            } else {
                // Re-arm listeners to try again on the next gesture
                this._detachFirstGestureListeners();
                this._attachFirstGestureListeners();
            }
        };
        // Resume inside the same gesture stack if possible
        try {
            ctx.resume().then(() => {
                // Prime HTMLAudio elements after a successful resume
                this._primeHtmlAudioOnceSync();
                this._primeHtmlAudioOnce();
                finish(true);
            }).catch(() => finish(false));
        } catch (_) {
            finish(false);
        }
    }

    _primeHtmlAudioOnceSync() {
        if (this._htmlPrimedSync) return;
        this._htmlPrimedSync = true;
        try {
            [this.discoSound, this.releaseSoundHtml, this.burpSound, this.gagSound, this.psxSound]
                .filter(Boolean)
                .forEach(a => {
                    const wasMuted = a.muted;
                    a.muted = true;
                    try { a.play().catch(() => {}); } catch (_) {}
                    // Immediately pause and reset; the important part is the user-initiated play call
                    try { a.pause(); } catch (_) {}
                    try { a.currentTime = 0; } catch (_) {}
                    a.muted = wasMuted;
                });
        } catch (_) {}
    }

    _primeHtmlAudioOnce() {
        try {
            [this.discoSound, this.releaseSoundHtml, this.burpSound, this.gagSound, this.psxSound]
                .filter(Boolean)
                .forEach(a => {
                    a.play().then(() => a.pause()).catch(() => {});
                });
        } catch (_) {}
    }

    _attachFirstGestureListeners() {
        if (this._firstGestureAttached) return;
        this._firstGestureAttached = true;
        this._firstGestureHandler = () => this.tryUnlockAudio();
        // Use bubble phase and once:true so we attach to the actual activation
        const add = (type, opts) => document.addEventListener(type, this._firstGestureHandler, opts);
        add('mousedown', { once: true });
        add('pointerdown', { once: true });
        add('touchstart', { once: true, passive: true });
        add('click', { once: true });
        add('keydown', { once: true });
    }

    _detachFirstGestureListeners() {
        if (!this._firstGestureAttached) return;
        ['mousedown','pointerdown','touchstart','click','keydown'].forEach(type => {
            document.removeEventListener(type, this._firstGestureHandler);
        });
        this._firstGestureAttached = false;
    }

    loadInteractionSounds() {
        // Load stretch sounds
        for (let i = 1; i <= CONFIG.STRETCH_SOUND_COUNT; i++) {
            this.audioLoader.load(`assets/stretch${i}.mp3`, (buffer) => {
                const sound = new THREE.Audio(this.listener);
                sound.setBuffer(buffer);
                sound.setLoop(false);
                sound.setVolume(CONFIG.STRETCH_SOUND_VOLUME);
                this.stretchSounds.push(sound);
            });
        }
    }

    startStretch() {
        if (!this.listener) return;
        // Attempt unlock right before any WebAudio playback (idempotent)
        this.tryUnlockAudio();
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
            this.releaseSoundHtml.play().catch(() => {});
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

    _playHtmlAudioAfterUnlock(audioEl) {
        if (!audioEl) return;
        this.tryUnlockAudio();
        const playIt = () => {
            try { audioEl.pause(); } catch(_) {}
            try { audioEl.currentTime = 0; } catch(_) {}
            audioEl.play().catch(() => {});
            audioEl.isPlaying = true;
        };
        if (!this.audioUnlocked) {
            setTimeout(playIt, CONFIG.AUDIO_UNLOCK_DELAY);
        } else {
            playIt();
        }
    }

    playSound(sound) {
        // Ensure unlock (runs in capture on first gesture)
        this.tryUnlockAudio();
        if (this.burpSound && this.burpSound !== sound && this.burpSound.isPlaying) this.burpSound.pause();
        if (this.gagSound && this.gagSound !== sound && this.gagSound.isPlaying) this.gagSound.pause();
        try { sound.pause(); } catch(_) {}
        try { sound.currentTime = 0; } catch(_) {}
        sound.play().catch(() => {});
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
            // Attempt unlock; should already be unlocked via capture listener
            this.tryUnlockAudio();
            this.discoSound.currentTime = 0;
            this.discoSound.play().catch(() => {});
        } else {
            this.discoSound.pause();
            this.discoSound.currentTime = 0;
        }
    }

    // Play PSX sound when model switch button becomes active
    playPsxSound() {
        if (this.psxSound) {
            this.tryUnlockAudio();
            try { this.psxSound.pause(); } catch(_) {}
            try { this.psxSound.currentTime = 0; } catch(_) {}
            this.psxSound.play().catch(() => {});
        }
    }

    // Stop PSX sound when model switch button becomes inactive
    stopPsxSound() {
        if (this.psxSound) {
            this.psxSound.pause();
            this.psxSound.currentTime = 0;
        }
    }
}

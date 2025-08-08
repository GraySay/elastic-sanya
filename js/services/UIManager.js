import EventBus from '../utils/EventBus.js';
import { CONFIG } from '../config/config.js';
import * as THREE from 'three';

export class UIManager {
    constructor() {
        this.soundButton = document.querySelector('.sound-button');
        this.discoButton = document.querySelector('.disco-button');
        this.modelSwitchButton = document.querySelector('.model-switch-button');
        this.letters = document.querySelectorAll('.letter');
        this.hoveredUIElement = null;
        this.isDiscoMode = false;
        this.isModelSwitchActive = false;
        this.isModelSwitching = false;
        this.isSwipeAnimating = false; // Track swipe animation state
        this.mouse = new THREE.Vector2();


        // Disco mode optimization
        this.lastLetterUpdate = 0;
        this.wasDiscoMode = false;

        // Pre-cache HSL colors to avoid expensive calculations
        this.colorCache = [];
        this.initColorCache();

        this.addEventListeners();
        this.addModelSwitchListeners();
        this.addSwipeAnimationListeners();
    }

    initColorCache() {
    // Preload colors every N degrees for smoothness
        for (let i = 0; i < CONFIG.COLOR_CACHE_MAX; i += CONFIG.COLOR_CACHE_STEP) {
            this.colorCache[i] = `hsl(${i}, ${CONFIG.COLOR_SATURATION}%, ${CONFIG.COLOR_LIGHTNESS}%)`;
        }
        
    // Fill missing entries for safety
        for (let i = 0; i < CONFIG.COLOR_CACHE_MAX; i++) {
            if (!this.colorCache[i]) {
                this.colorCache[i] = this.colorCache[Math.floor(i / CONFIG.COLOR_CACHE_STEP) * CONFIG.COLOR_CACHE_STEP];
            }
        }
    }

    addModelSwitchListeners() {
        // Listen to model switch events to prevent multiple clicks during loading
        EventBus.on('modelSwitchStart', () => {
            this.isModelSwitching = true;
        });
        
        EventBus.on('modelSwitchComplete', () => {
            this.isModelSwitching = false;
        });
        
        EventBus.on('modelSwitchError', () => {
            this.isModelSwitching = false;
        });
    }

    addSwipeAnimationListeners() {
        EventBus.on('swipeAnimationStart', ({ isGoingToHighRes, duration }) => {
            this.isSwipeAnimating = true;
            this.startSwipeAnimation(isGoingToHighRes, duration);
        });
        
        EventBus.on('swipeAnimationComplete', () => {
            this.isSwipeAnimating = false;
            this.stopSwipeAnimation();
        });
    }

    addEventListeners() {
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    window.addEventListener('touchstart', (e) => this.onMouseDown(e), { passive: true });
    window.addEventListener('touchmove', (e) => this.onMouseMove(e), { passive: true });
    window.addEventListener('touchend', this.onMouseUp.bind(this));
    }

    onMouseMove(event) {
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    // Emit a generic user gesture event to unlock audio in the same call stack
    EventBus.emit('userGesture');
        EventBus.emit('mouseMove', { mouse: this.mouse });

        this.checkUIInteraction(clientX, clientY);
    }

    onMouseDown(event) {
    // Signal a user gesture immediately on press (counts for mobile unlock)
        EventBus.emit('userGesture');
    // Update mouse position here too (order of events isn't guaranteed)
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;

        this.checkUIInteraction(clientX, clientY);

        if (this.hoveredUIElement === this.soundButton) {
            EventBus.emit('soundButtonClick');
            this.soundButton.classList.add('active-imitation');
        } else if (this.hoveredUIElement === this.discoButton && !event.touches) {
            
            this.toggleDiscoMode();
        } else if (this.hoveredUIElement === this.modelSwitchButton && !event.touches) {
            if (this.isModelSwitching) return; // Prevent multiple clicks during model loading
            this.toggleModelSwitchMode();
        } else {
            EventBus.emit('mouseDown', { event, mouse: this.mouse });
        }
    }

    onMouseUp() {
        EventBus.emit('userGesture');
        this.soundButton.classList.remove('active-imitation');
    // Clear hover on touch end to reset state
        if (this.hoveredUIElement && this.hoveredUIElement.classList.contains('letter')) {
            this.handleMouseLeave(this.hoveredUIElement);
            this.hoveredUIElement = null;
        }
        EventBus.emit('mouseUp');
    }

    toggleDiscoMode() {
        this.isDiscoMode = !this.isDiscoMode;
        this.discoButton.classList.toggle('active', this.isDiscoMode);
        EventBus.emit('discoModeToggle', this.isDiscoMode);

        if (!this.isDiscoMode) {
            this.letters.forEach(letter => {
                letter.style.color = '';
                letter.style.textShadow = '';
                letter.style.filter = '';
            });
        }
    }

    toggleModelSwitchMode() {
        this.isModelSwitchActive = !this.isModelSwitchActive;
        this.modelSwitchButton.classList.toggle('active', this.isModelSwitchActive);
        
        if (this.isModelSwitchActive) {
            // Play PSX sound when becoming active
            EventBus.emit('playPsxSound');
        } else {
            // Stop PSX sound when becoming inactive
            EventBus.emit('stopPsxSound');
        }
        
    // Always trigger model switch
        EventBus.emit('modelSwitch');
    }

    checkUIInteraction(x, y) {
        let newHoveredElement = null;
        let cursorStyle = 'grab';

        const buttonRect = this.soundButton.getBoundingClientRect();
        if (this.isInside(x, y, buttonRect)) {
            newHoveredElement = this.soundButton;
            cursorStyle = 'pointer';
        }

        const discoButtonRect = this.discoButton.getBoundingClientRect();
        if (this.isInside(x, y, discoButtonRect)) {
            newHoveredElement = this.discoButton;
            cursorStyle = 'pointer';
        }

        const modelSwitchButtonRect = this.modelSwitchButton.getBoundingClientRect();
        if (this.isInside(x, y, modelSwitchButtonRect)) {
            newHoveredElement = this.modelSwitchButton;
            cursorStyle = 'pointer';
        }

        if (!newHoveredElement) {
            // Letters are non-interactive in disco mode
            if (!this.isDiscoMode) {
                // Find the letter whose center is closest to the cursor
                const letterCandidates = [];
                this.letters.forEach(letter => {
                    const rect = letter.getBoundingClientRect();
                    if (this.isInside(x, y, rect)) {
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                        letterCandidates.push({ letter, rect, distance });
                    }
                });
                if (letterCandidates.length > 0) {
                    // Pick the letter closest to the cursor
                    letterCandidates.sort((a, b) => a.distance - b.distance);
                    newHoveredElement = letterCandidates[0].letter;
                    cursorStyle = 'pointer';
                }
            }
        }

        if (newHoveredElement !== this.hoveredUIElement) {
            if (this.hoveredUIElement) {
                this.handleMouseLeave(this.hoveredUIElement);
            }
            this.hoveredUIElement = newHoveredElement;
            if (this.hoveredUIElement) {
                this.handleMouseEnter(this.hoveredUIElement);
            }
            EventBus.emit('uiHover', { element: this.hoveredUIElement });
        }

        if (document.body.style.cursor !== 'grabbing') {
            document.body.style.cursor = cursorStyle;
        }
    }

    handleMouseEnter(element) {
        if (element === this.soundButton) {
            element.querySelector('.image-container').classList.add('hover-imitation');
        } else if (element === this.modelSwitchButton) {
            // CSS handles hover effects
        } else if (element.classList.contains('letter')) {
            // Letters are non-interactive in disco mode
            if (this.isDiscoMode) return;
            
            // Only letters S, A, C, H have hover effects
            const letter = element.dataset.letter;
            if (['S', 'A', 'C', 'H'].includes(letter)) {
                element.classList.add('hovered');
            }
        }
    }

    handleMouseLeave(element) {
        if (element === this.soundButton) {
            element.querySelector('.image-container').classList.remove('hover-imitation');
        } else if (element === this.modelSwitchButton) {
            // CSS handles hover effects
        } else if (element.classList.contains('letter')) {
            // Letters are non-interactive in disco mode
            if (this.isDiscoMode) return;
            
            element.classList.remove('hovered');
        }
    }

    isInside(x, y, rect) {
        return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
    }

    animate(time) {
        if (this.isDiscoMode) {
            // Disco mode overrides other effects
            if (!this.lastLetterUpdate || time - this.lastLetterUpdate > CONFIG.DISCO_ANIMATION_THROTTLE) {
                this.letters.forEach((letter, index) => {
                    // Use a complex phase for a better effect
                    const randomOffset = (index * 0.17 + Math.sin(index * 2.3)) * Math.PI;
                    const hue = (time * CONFIG.DISCO_LETTER_HUE_SPEED + randomOffset) % 1;
                    
                    // More colors for smoothness
                    const colorIndex = Math.round(hue * (CONFIG.COLOR_CACHE_MAX / CONFIG.COLOR_CACHE_STEP)) * CONFIG.COLOR_CACHE_STEP;
                    
                    const color = this.colorCache[colorIndex] || this.colorCache[0];
                    
                    // Update only on color change
                    if (letter.currentColor !== colorIndex) {
                        letter.style.color = color;
                        // Clear sunset effect when disco starts
                        letter.style.background = '';
                        letter.style.webkitBackgroundClip = '';
                        letter.style.backgroundClip = '';
                        letter.style.webkitTextFillColor = '';
                        // Glow via drop-shadow (faster than textShadow)
                        letter.style.filter = `brightness(1.5) drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color})`;
                        letter.currentColor = colorIndex;
                    }
                });
                this.lastLetterUpdate = time;
            }
        } else {
            // Reset styles on exit from disco mode
            if (this.wasDiscoMode) {
                this.letters.forEach(letter => {
                    if (letter !== this.hoveredUIElement) {
                        letter.style.color = '';
                        letter.style.textShadow = '';
                        letter.style.filter = '';
                        letter.currentColor = null;
                        // Keep sunset effect if swipe animation is active
                        if (!this.isSwipeAnimating) {
                            letter.style.background = '';
                            letter.style.webkitBackgroundClip = '';
                            letter.style.backgroundClip = '';
                            letter.style.webkitTextFillColor = '';
                        }
                    }
                });
                this.wasDiscoMode = false;
            }
        }
        
        // Track disco mode state
        if (this.isDiscoMode && !this.wasDiscoMode) {
            this.wasDiscoMode = true;
        }
    }

    startSwipeAnimation(isGoingToHighRes, duration) {
        const targetBgColor = isGoingToHighRes ? '#000000' : '#C5C5C5';
        const currentBgColor = isGoingToHighRes ? '#C5C5C5' : '#000000';
        
    // Animate background color
        if (window.gsap) {
            const tempBg = { r: parseInt(currentBgColor.slice(1, 3), 16), g: parseInt(currentBgColor.slice(3, 5), 16), b: parseInt(currentBgColor.slice(5, 7), 16) };
            const targetBg = { r: parseInt(targetBgColor.slice(1, 3), 16), g: parseInt(targetBgColor.slice(3, 5), 16), b: parseInt(targetBgColor.slice(5, 7), 16) };
            
            window.gsap.to(tempBg, {
                r: targetBg.r,
                g: targetBg.g,
                b: targetBg.b,
                duration: duration,
                ease: 'none',
                onUpdate: () => {
                    const r = Math.round(tempBg.r).toString(16).padStart(2, '0');
                    const g = Math.round(tempBg.g).toString(16).padStart(2, '0');
                    const b = Math.round(tempBg.b).toString(16).padStart(2, '0');
                    document.body.style.backgroundColor = `#${r}${g}${b}`;
                }
            });
        }
        
        if (!this.isDiscoMode && !isGoingToHighRes) {
            this.startSunsetMoodAnimation();
        }
    }

    stopSwipeAnimation() {
        
        if (!this.isDiscoMode) {
            this.stopSunsetMoodAnimation();
        }
    }

    startSunsetMoodAnimation() {
    this.letters.forEach((letter, index) => {
            if (window.gsap) {
                
                const delay = index * 0.1; 
                
                window.gsap.to(letter, {
                    duration: 0.5,
                    delay: delay,
                    ease: 'power2.out',
                    onUpdate: () => {
                        if (!this.isDiscoMode) {
                            const progress = window.gsap.getProperty(letter, 'progress') || 0;
                            const hue1 = 30; // orange
                            const hue2 = 60; // yellow
                            
                            letter.style.background = `radial-gradient(circle, hsl(${hue1}, 80%, 60%), hsl(${hue2}, 90%, 70%))`;
                            letter.style.webkitBackgroundClip = 'text';
                            letter.style.backgroundClip = 'text';
                            letter.style.webkitTextFillColor = 'transparent';
                            letter.style.color = 'transparent';
                            letter.style.textShadow = `0 0 10px hsla(${hue1}, 80%, 60%, 0.8)`;
                        }
                    }
                });
            }
        });
    }

    stopSunsetMoodAnimation() {
        this.letters.forEach(letter => {
            if (window.gsap) {
                window.gsap.to(letter, {
                    duration: 0.5,
                    ease: 'power2.out',
                    onUpdate: () => {
                        if (!this.isDiscoMode) {
                            letter.style.background = '';
                            letter.style.webkitBackgroundClip = '';
                            letter.style.backgroundClip = '';
                            letter.style.webkitTextFillColor = '';
                            letter.style.color = '';
                            letter.style.textShadow = '';
                        }
                    }
                });
            }
        });
    }

}
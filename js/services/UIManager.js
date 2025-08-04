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
        this.mouse = new THREE.Vector2();
        
        // Pre-cache HSL colors to avoid expensive calculations
        this.colorCache = [];
        this.initColorCache();

        this.addEventListeners();
        this.addModelSwitchListeners();
    }

    initColorCache() {
        // Pre-calculate 360 HSL colors to avoid runtime calculations
        for (let i = 0; i < 360; i++) {
            const hue = i / 360;
            this.colorCache.push(`hsl(${i}, 100%, 50%)`);
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
        EventBus.emit('mouseMove', { mouse: this.mouse });

        this.checkUIInteraction(clientX, clientY);
    }

    onMouseDown(event) {
        // onMouseMove is not guaranteed to fire before onMouseDown, so we update the mouse position here too.
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
        this.soundButton.classList.remove('active-imitation');
        // Clear hovered element on touch end to reset hover states
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
        
        // Always emit model switch event
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
            // Find the letter whose center is closest to cursor position
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
                // Pick the letter with the smallest distance to cursor
                letterCandidates.sort((a, b) => a.distance - b.distance);
                newHoveredElement = letterCandidates[0].letter;
                cursorStyle = 'pointer';
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
            // CSS handles hover effects, no JavaScript needed
        } else if (element.classList.contains('letter')) {
            // Only apply hover effect to letters I, L, U, K
            const letter = element.dataset.letter;
            if (['I', 'L', 'U', 'K'].includes(letter)) {
                element.classList.add('hovered');
            }
        }
    }

    handleMouseLeave(element) {
        if (element === this.soundButton) {
            element.querySelector('.image-container').classList.remove('hover-imitation');
        } else if (element === this.modelSwitchButton) {
            // CSS handles hover effects, no JavaScript needed
        } else if (element.classList.contains('letter')) {
            element.classList.remove('hovered');
        }
    }

    isInside(x, y, rect) {
        return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
    }

    animate(time) {
        if (this.isDiscoMode) {
            this.letters.forEach((letter, index) => {
                const hue = (time * CONFIG.DISCO_LETTER_HUE_SPEED + index * 0.1) % 1;
                const colorIndex = Math.round(hue * 359); // Use pre-cached colors
                const color = this.colorCache[colorIndex];
                letter.style.color = color;
                letter.style.textShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
                letter.style.filter = 'brightness(1.5)';
            });
        } else {
            this.letters.forEach(letter => {
                if (letter !== this.hoveredUIElement) {
                    letter.style.color = '';
                    letter.style.textShadow = '';
                    letter.style.filter = '';
                }
            });
        }
    }

}
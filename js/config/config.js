export const CONFIG = {
    // Model paths
    MODEL_PATH: 'assets/10k.glb',
    MODEL_PATH_1K: 'assets/500.glb',
    
    // Audio files
    SOUNDS: {
        BURP: 'assets/otryijka.mp3',
        GAG: 'assets/rvotnyiy-pozyiv.mp3',
        PSX: 'assets/psx.mp3'
    },
    
    // Sound system
    CLICK_THRESHOLD: 500,
    CLICKS_FOR_GAG: 3,
    AUDIO_UNLOCK_DELAY: 100,            
    STRETCH_SOUND_COUNT: 5,             // number of stretch sound files
    STRETCH_SOUND_VOLUME: 0.5,          // volume for stretch sounds
    
    // Elastic deformation
    DEFORM_THROTTLE: 16.67, // ~60fps
    DEFORM_RADIUS: 3.0,
    DEFORM_STRENGTH: 0.8,
    RETURN_DAMPING: 0.75,
    RETURN_SPRING: 0.2,
    RETURN_LERP_FACTOR: 0.2,
    GRAB_LERP_FACTOR: 0.6,
    VELOCITY_THRESHOLD: 0.001,          // threshold for animation completion
    DISTANCE_THRESHOLD: 0.001,          // distance threshold for target reach
    
    // Interaction thresholds
    STRETCH_INITIAL_THRESHOLD: 50,      // pixels to trigger initial stretch
    STRETCH_SUBSEQUENT_THRESHOLD: 100,  // pixels for subsequent stretches  
    RELEASE_DISTANCE_THRESHOLD: 300,    // pixels from center for release sound
    
    // Animation performance
    DISCO_ANIMATION_THROTTLE: 33,       // ms between letter color updates (~30 FPS)
    COLOR_CACHE_STEP: 15,               // degrees between cached colors
    COLOR_CACHE_MAX: 360,               // total degrees in color wheel
    COLOR_SATURATION: 100,              // HSL saturation percentage
    COLOR_LIGHTNESS: 60,                // HSL lightness percentage
    
    // Responsive design
    MOBILE_BREAKPOINT: 768,
    MOBILE_SCALE: 1.4,
    DESKTOP_SCALE: 2.0,
    MOBILE_Z: 0.7,
    DESKTOP_Z: 1.0,
    
    // Lighting system
    AMBIENT_LIGHT_INTENSITY: 1.2,
    MAIN_LIGHT_INTENSITY: 1.6,
    DYNAMIC_LIGHT_INTENSITY: 100,
    DISCO_LIGHT_INTENSITY: 100,
    DISCO_LIGHT_HUE_SPEED: 0.0003,
    DISCO_LIGHT_MOVE_SPEED: 0.001,
    DISCO_LETTER_HUE_SPEED: 0.0002,
    
    // Lighting lerp and thresholds
    LIGHT_LERP_FACTOR: 0.1,             // smoothing factor for light transitions
    LIGHT_INTENSITY_THRESHOLD: 0.01,    // minimum intensity before turning off
    LIGHT_SATURATION: 1.0,              // HSL saturation for disco lights
    LIGHT_BRIGHTNESS: 0.5,              // HSL lightness for disco lights
    
    // SpotLight configuration
    SPOTLIGHT_DISTANCE: 20,              // distance of spotlight
    SPOTLIGHT_ANGLE: Math.PI / 4,        // angle of spotlight cone
    SPOTLIGHT_PENUMBRA: 0.1,             // softness of spotlight edge
    SPOTLIGHT_DECAY: 1.5,                // light decay factor
    SHADOW_MAP_SIZE: 1024,               // shadow map resolution
    
    // Light positioning
    MAIN_LIGHT_POSITION: 5,              // main directional light position 
    DISCO_LIGHT_RADIUS: 5,               // radius for disco light movement
    MOUSE_LIGHT_MULTIPLIER: 5,           // mouse position multiplier for light
    LIGHT_Z_POSITION: 4,                 // Z position for lights
    LIGHT_Z_ANIMATION: 1.5,              // Z animation amplitude
    TARGET_Z_POSITION: 1,                // target Z position for lights
    
    // Mouse interaction
    MOUSE_ROTATION_X_FACTOR: 0.3,
    MOUSE_ROTATION_Y_FACTOR: 0.5,
    LERP_FACTOR: 0.05
};

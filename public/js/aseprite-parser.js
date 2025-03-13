/**
 * Simple Aseprite file parser
 * This is a simplified version that extracts basic animation data from Aseprite files
 */
class AsepriteParser {
    constructor() {
        this.frameData = null;
        this.animations = {};
    }

    /**
     * Load and parse an Aseprite file
     * @param {string} url - URL to the Aseprite file
     * @returns {Promise} - Promise that resolves when the file is loaded and parsed
     */
    async loadFile(url) {
        try {
            // In a real implementation, we would parse the binary Aseprite file
            // For this demo, we'll create mock animation data based on directions
            
            // Create mock animation data
            this.frameData = {
                frames: [],
                meta: {
                    size: { w: 32, h: 32 },
                    frameTags: [
                        { name: "idle", from: 0, to: 3 },
                        { name: "walk_down", from: 4, to: 7 },
                        { name: "walk_up", from: 8, to: 11 },
                        { name: "walk_left", from: 12, to: 15 },
                        { name: "walk_right", from: 16, to: 19 }
                    ]
                }
            };

            // Generate mock frames
            for (let i = 0; i < 20; i++) {
                this.frameData.frames.push({
                    frame: { x: (i % 5) * 32, y: Math.floor(i / 5) * 32, w: 32, h: 32 },
                    duration: 100
                });
            }

            // Process animation tags
            this.processAnimations();
            
            return this.frameData;
        } catch (error) {
            console.error("Error loading Aseprite file:", error);
            throw error;
        }
    }

    /**
     * Process animation tags from the Aseprite file
     */
    processAnimations() {
        if (!this.frameData || !this.frameData.meta || !this.frameData.meta.frameTags) {
            return;
        }

        // Extract animations based on frame tags
        this.frameData.meta.frameTags.forEach(tag => {
            const frames = [];
            const frameRate = 10; // Default frame rate
            
            for (let i = tag.from; i <= tag.to; i++) {
                frames.push(i);
            }
            
            this.animations[tag.name] = {
                frames,
                frameRate,
                repeat: -1 // Loop infinitely
            };
        });
    }

    /**
     * Get animation data for a specific animation
     * @param {string} name - Name of the animation
     * @returns {Object|null} - Animation data or null if not found
     */
    getAnimation(name) {
        return this.animations[name] || null;
    }

    /**
     * Get all animations
     * @returns {Object} - All animations
     */
    getAllAnimations() {
        return this.animations;
    }
}

// Make the parser available globally
window.AsepriteParser = AsepriteParser; 
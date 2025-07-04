// genius-lyrics.js
(function GeniusLyrics() {
    if (!Spicetify || !Spicetify.Player || !Spicetify.URI) {
        setTimeout(GeniusLyrics, 300);
        return;
    }

    // Default configuration
    const defaultConfig = {
        fontSize: 14,
        boldAnnotations: true,
        autoOpen: true // New option for automatic opening
    };

    // Load configuration
    let config = {...defaultConfig};
    try {
        const savedConfig = JSON.parse(localStorage.getItem('geniusLyricsConfig'));
        if (savedConfig) config = {...defaultConfig, ...savedConfig};
    } catch (e) {
        console.error('Error loading configuration:', e);
    }

    // Track current track
    let currentTrackUri = null;
    let lyricsModalOpen = false;

    // Listen for track change
    function setupPlayerListener() {
        Spicetify.Player.addEventListener("songchange", () => {
            const track = Spicetify.Player.data.item;
            if (!track) return;
            
            // If the track changed and the modal is open
            if (track.uri !== currentTrackUri && lyricsModalOpen) {
                closeLyricsModal();
                
                // If auto open is enabled
                if (config.autoOpen) {
                    setTimeout(fetchLyrics, 500); // Small delay for smoothness
                }
            }
            
            currentTrackUri = track.uri;
        });
    }

    function createSlug(text) {
        return text
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    async function fetchLyrics() {
        const track = Spicetify.Player.data.item;
        if (!track) {
            Spicetify.showNotification("No song currently playing!");
            return;
        }

        // Save current track URI
        currentTrackUri = track.uri;

        const artist = createSlug(track.artists[0].name);
        const title = createSlug(track.name);
        const geniusUrl = `https://genius.com/${artist}-${title}-lyrics`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(geniusUrl)}`;

        showLoadingModal();

        try {
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error("Lyrics not found!");

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Collect all lyrics containers
            let lyricsContainers = doc.querySelectorAll('[data-lyrics-container="true"]');
            
            // If not found, try alternative selectors
            if (lyricsContainers.length === 0) {
                lyricsContainers = doc.querySelectorAll('.Lyrics__Container-sc-1ynbvzw-6');
            }
            if (lyricsContainers.length === 0) {
                lyricsContainers = doc.querySelectorAll('.lyrics');
            }

            if (lyricsContainers.length === 0) throw new Error("Invalid page structure!");

            processLyrics(lyricsContainers, geniusUrl);

        } catch (error) {
            Spicetify.showNotification(`Error: ${error.message}`);
            console.error("Error details:", error);
            closeLyricsModal();
        }
    }

    function processLyrics(containers, url) {
        let fullLyrics = '';

        containers.forEach(container => {
            // Clone container to avoid modifying original
            const clone = container.cloneNode(true);
            clone.querySelectorAll('a, button, script, iframe').forEach(el => el.remove());

            let lyrics = clone.innerHTML
                .replace(/<br\s*\/?>/g, '\n')
                .replace(/<\/?[^>]+(>|$)/g, '')
                .trim();

            // Add double new lines between containers
            fullLyrics += lyrics + '\n\n';
        });

        fullLyrics = fullLyrics.trim();

        // Bold annotations (if enabled in config)
        if (config.boldAnnotations) {
            fullLyrics = fullLyrics.replace(/\[(.*?)\]/g, '<strong>[$1]</strong>');
        }

        showLyrics(fullLyrics, url);
    }

    function showLoadingModal() {
        closeLyricsModal();
        lyricsModalOpen = true;

        const modal = `
            <div id="genius-lyrics-modal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                backdrop-filter: blur(4px);
            ">
                <div style="
                    background: #1e1e1e;
                    color: #fff;
                    padding: 40px;
                    border-radius: 12px;
                    font-size: 16px;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
                    animation: fadeInScale 0.3s ease-out;
                ">
                    ⏳ Fetching lyrics...
                </div>
                <style>
                    @keyframes fadeInScale {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                </style>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modal);
    }

    function showLyrics(lyrics, url) {
        closeLyricsModal();
        lyricsModalOpen = true;

        const modal = `
            <div id="genius-lyrics-modal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                backdrop-filter: blur(4px);
            ">
                <div style="
                    background: #121212;
                    color: #fff;
                    padding: 24px;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 750px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
                    animation: fadeInScale 0.3s ease-out;
                    overflow-y: auto;
                ">
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 16px;
                    ">
                        <h2 style="margin: 0; font-size: 1.4em;">Lyrics</h2>
                        <div>
                            <button id="settings-button" style="
                                background: transparent;
                                border: none;
                                color: #ccc;
                                font-size: 1.2em;
                                cursor: pointer;
                                margin-right: 15px;
                                transition: color 0.2s ease;
                            " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#ccc'">⚙️</button>
                            <button id="close-lyrics" style="
                                background: transparent;
                                border: none;
                                color: #ccc;
                                font-size: 1.5em;
                                cursor: pointer;
                                transition: color 0.2s ease;
                            " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#ccc'">×</button>
                        </div>
                    </div>
                    
                    <div id="lyrics-container" style="
                        white-space: pre-wrap;
                        font-size: ${config.fontSize}px;
                        line-height: 1.6;
                        overflow-y: auto;
                        flex-grow: 1;
                        padding-right: 10px;
                        scrollbar-width: thin;
                        scrollbar-color: #666 #222;
                    ">
                        ${lyrics}
                    </div>
                    
                    <div id="settings-panel" style="
                        display: none;
                        margin-top: 20px;
                        padding-top: 15px;
                        border-top: 1px solid #333;
                    ">
                        <div style="display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">
                            <div>
                                <label style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" id="bold-setting" ${config.boldAnnotations ? 'checked' : ''}>
                                    Bold annotations
                                </label>
                            </div>
                            
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <label>Font size:</label>
                                <input type="range" id="font-size-setting" min="12" max="24" value="${config.fontSize}" style="width: 120px;">
                                <span id="font-size-value">${config.fontSize}px</span>
                            </div>
                            
                            <div>
                                <label style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" id="auto-open-setting" ${config.autoOpen ? 'checked' : ''}>
                                    Auto open
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <a href="${url}" target="_blank" style="
                        margin-top: 12px;
                        text-align: right;
                        font-size: 13px;
                        color: #1db954;
                        text-decoration: none;
                    ">Source: Genius</a>
                </div>
                <style>
                    @keyframes fadeInScale {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                    #lyrics-container::-webkit-scrollbar {
                        width: 6px;
                    }
                    #lyrics-container::-webkit-scrollbar-thumb {
                        background-color: #666;
                        border-radius: 3px;
                    }
                    #lyrics-container::-webkit-scrollbar-track {
                        background: #222;
                    }
                </style>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modal);
        
        // Button handlers
        document.getElementById("close-lyrics").onclick = () => {
            lyricsModalOpen = false;
            closeLyricsModal();
        };
        
        // Settings button handler
        document.getElementById("settings-button").addEventListener("click", function() {
            const settingsPanel = document.getElementById("settings-panel");
            settingsPanel.style.display = settingsPanel.style.display === "block" ? "none" : "block";
        });
        
        // Settings change handlers
        document.getElementById("bold-setting").addEventListener("change", function() {
            config.boldAnnotations = this.checked;
            saveConfig();
            // Refetch lyrics with new settings
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });
        
        // New setting - auto open
        document.getElementById("auto-open-setting").addEventListener("change", function() {
            config.autoOpen = this.checked;
            saveConfig();
        });
        
        const fontSizeSlider = document.getElementById("font-size-setting");
        const fontSizeValue = document.getElementById("font-size-value");
        
        fontSizeSlider.addEventListener("input", function() {
            const size = this.value;
            fontSizeValue.textContent = size + "px";
            document.getElementById("lyrics-container").style.fontSize = size + "px";
            config.fontSize = parseInt(size);
            saveConfig();
        });
    }

    function saveConfig() {
        localStorage.setItem('geniusLyricsConfig', JSON.stringify(config));
    }

    function closeLyricsModal() {
        const modal = document.getElementById("genius-lyrics-modal");
        if (modal) modal.remove();
    }

    function addButton() {
        new Spicetify.Topbar.Button(
            "Lyrics",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
            fetchLyrics
        );
    }

    // Initialization
    addButton();
    setupPlayerListener();
    
    // If auto open is enabled, show lyrics immediately
    if (config.autoOpen) {
        setTimeout(fetchLyrics, 1000);
    }
})();

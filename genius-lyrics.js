(function GeniusLyrics() {
    if (!Spicetify || !Spicetify.Player || !Spicetify.URI) {
        setTimeout(GeniusLyrics, 300);
        return;
    }

    const defaultConfig = {
        fontSize: 14,
        boldAnnotations: true,
        autoOpen: true,
        theme: 'dark',
        showTimestamps: false,
        highlightCurrent: true,
        cacheLyrics: true,
        textAlign: 'left',
        autoScroll: true,
        backgroundOpacity: 0.85,
        customTheme: false,
        customBgColor: '#121212',
        customTextColor: '#ffffff',
        customHighlightColor: '#1db954',
        windowBlur: 4,
        roundedCorners: 12,
        lineSpacing: 1.6,
        // New customization options
        textGlowEnabled: false,
        textGlowColor: '#1db954', // Default glow color
        textGlowRadius: 0,
        textShadowEnabled: false,
        textShadowColor: '#000000',
        textShadowOffsetX: 0,
        textShadowOffsetY: 0,
        textShadowBlurRadius: 0,
        letterSpacing: 0,
        textTransform: 'none',
        highlightTransition: 'smooth', // 'smooth', 'instant', 'fade'
        // No background image options for this version, keep it simple
        // No border options for this version, keep it simple
        fontFamily: 'Arial, sans-serif' // Default font family
    };

    // Load configuration
    let config = {...defaultConfig};
    try {
        const savedConfig = JSON.parse(localStorage.getItem('geniusLyricsConfig'));
        if (savedConfig) config = {...defaultConfig, ...savedConfig};
    } catch (e) {
        console.error('Error loading configuration:', e);
    }

    let currentTrackUri = null;
    let lyricsModalOpen = false;
    let lyricsData = null;
    let currentLineIndex = -1;
    let scrollInterval = null;
    const lyricsCache = new Map();

    function setupPlayerListener() {
        Spicetify.Player.addEventListener("songchange", () => {
            const track = Spicetify.Player.data.item;
            if (!track) return;
            currentLineIndex = -1;
            
            if (track.uri !== currentTrackUri && lyricsModalOpen) {
                closeLyricsModal();
                if (config.autoOpen) {
                    setTimeout(fetchLyrics, 500);
                }
            }
            
            currentTrackUri = track.uri;
        });
        Spicetify.Player.addEventListener("onprogress", handleProgressUpdate);
    }

    function handleProgressUpdate(event) {
        if (!lyricsModalOpen || !lyricsData || !lyricsData.synced || !config.highlightCurrent) return;
        
        const progress = event.detail;
        const currentTime = progress.position;
        const newIndex = findCurrentLineIndex(currentTime);
        if (newIndex !== currentLineIndex) {
            currentLineIndex = newIndex;
            highlightCurrentLine();
            if (config.autoScroll && currentLineIndex >= 0) {
                scrollToCurrentLine();
            }
        }
    }

    function findCurrentLineIndex(currentTime) {
        if (!lyricsData?.lines) return -1;
        for (let i = lyricsData.lines.length - 1; i >= 0; i--) {
            if (currentTime >= lyricsData.lines[i].startTimeMs) {
                return i;
            }
        }
        return -1;
    }

    function highlightCurrentLine() {
        const container = document.getElementById('lyrics-container');
        if (!container) return;
        container.querySelectorAll('.current-line').forEach(el => {
            if (config.highlightTransition === 'fade') {
                el.style.transition = 'background-color 0.5s ease, color 0.5s ease';
                el.style.backgroundColor = 'transparent';
                el.style.color = 'var(--text-color)';
            }
            el.classList.remove('current-line');
        });
        
        if (currentLineIndex >= 0) {
            const lineElement = container.querySelector(`.line-${currentLineIndex}`);
            if (lineElement) {
                if (config.highlightTransition === 'instant') {
                    lineElement.style.transition = 'none';
                } else if (config.highlightTransition === 'smooth') {
                    lineElement.style.transition = 'all 0.3s ease';
                } else if (config.highlightTransition === 'fade') {
                     lineElement.style.transition = 'background-color 0.5s ease, color 0.5s ease';
                }
                lineElement.classList.add('current-line');
            }
        }
    }

    function scrollToCurrentLine() {
        const container = document.getElementById('lyrics-container');
        if (!container) return;
        
        const lineElement = container.querySelector(`.line-${currentLineIndex}`);
        if (lineElement) {
            const containerTop = container.getBoundingClientRect().top;
            const lineTop = lineElement.getBoundingClientRect().top;
            const offset = lineTop - containerTop - 100;
            
            container.scrollTo({
                top: offset,
                behavior: 'smooth'
            });
        }
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

        currentTrackUri = track.uri;

        if (config.cacheLyrics && lyricsCache.has(track.uri)) {
            const cached = lyricsCache.get(track.uri);
            lyricsData = { synced: cached.synced, lines: cached.lines }; // Restore full lyricsData
            showLyrics(cached.lyrics, cached.url, cached.synced);
            return;
        }

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
            const scriptTag = doc.querySelector('script[data-lyrics-data]');
            if (scriptTag) {
                try {
                    const lyricsJson = JSON.parse(scriptTag.textContent);
                    processSyncedLyrics(lyricsJson, geniusUrl);
                    return;
                } catch (e) {
                    console.log("Couldn't parse synced lyrics, falling back to HTML");
                }
            }

            let lyricsContainers = doc.querySelectorAll('[data-lyrics-container="true"]');
            
            if (lyricsContainers.length === 0) {
                lyricsContainers = doc.querySelectorAll('.Lyrics__Container-sc-1ynbvzw-6');
            }
            if (lyricsContainers.length === 0) {
                lyricsContainers = doc.querySelectorAll('.lyrics');
            }

            if (lyricsContainers.length === 0) throw new Error("Invalid page structure!");

            processLyrics(lyricsContainers, geniusUrl);

        } catch (error) {
            try {
                await fetchLyricsFallback(track);
            } catch (fallbackError) {
                Spicetify.showNotification(`Error: ${fallbackError.message}`);
                console.error("Fallback error details:", fallbackError);
                closeLyricsModal();
            }
        }
    }

    async function fetchLyricsFallback(track) {
        const artist = encodeURIComponent(track.artists[0].name);
        const title = encodeURIComponent(track.name);
        const searchUrl = `https://genius.com/api/search/multi?per_page=5&q=${artist} ${title}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(searchUrl)}`;
        
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error("Fallback search failed");
        
        const data = await response.json();
        const songResults = data.response.sections.find(section => section.type === 'song')?.hits || [];
        
        if (songResults.length === 0) throw new Error("No results found");
        
        const bestMatch = songResults.find(hit => 
            hit.result.title.toLowerCase() === track.name.toLowerCase()
        ) || songResults[0];
        
        const geniusUrl = bestMatch.result.url;
        const fallbackProxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(geniusUrl)}`;
        
        const pageResponse = await fetch(fallbackProxy);
        if (!pageResponse.ok) throw new Error("Couldn't load lyrics page");
        
        const html = await pageResponse.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        
        const scriptTag = doc.querySelector('script[data-lyrics-data]');
        if (scriptTag) {
            try {
                const lyricsJson = JSON.parse(scriptTag.textContent);
                processSyncedLyrics(lyricsJson, geniusUrl);
                return;
            } catch (e) {
                console.log("Couldn't parse synced lyrics in fallback");
            }
        }
        
        let lyricsContainers = doc.querySelectorAll('[data-lyrics-container="true"]');
        if (lyricsContainers.length === 0) {
            lyricsContainers = doc.querySelectorAll('.Lyrics__Container-sc-1ynbvzw-6');
        }
        if (lyricsContainers.length === 0) {
            lyricsContainers = doc.querySelectorAll('.lyrics');
        }
        
        if (lyricsContainers.length === 0) throw new Error("Fallback page has invalid structure");
        
        processLyrics(lyricsContainers, geniusUrl);
    }

    function processSyncedLyrics(json, url) {
        lyricsData = {
            lines: [],
            synced: true,
            url: url
        };
        
        let previousWasSection = false;
        
        json.lyrics_data.body.children.forEach(child => {
            if (child.tag === 'p') {
                child.children.forEach(line => {
                    if (line.tag === 'div' && line.attrs && line.attrs['data-timestamp']) {
                        const timeParts = line.attrs['data-timestamp'].split(':').map(Number);
                        const startTimeMs = (timeParts[0] * 60 + timeParts[1]) * 1000;
                        
                        let lineText = '';
                        if (line.children && line.children[0] && line.children[0].children) {
                            line.children[0].children.forEach(textNode => {
                                if (textNode.text) lineText += textNode.text;
                            });
                        }
                        
                        lineText = lineText.trim();
                        lineText = lineText.replace(/^.*?(lyrics|Lyrics)\s*[\n-]*\s*/i, '');
                        lineText = lineText.replace(/^\[.*?\]\s*lyrics\s*[\n-]*\s*/i, '');
                        
                        const isSection = /^\[.+\]$/.test(lineText);
                        
                        if (lineText) {
                            if (isSection && !previousWasSection) {
                                lyricsData.lines.push({
                                    text: '',
                                    startTimeMs: startTimeMs - 100 // Small buffer for section breaks
                                });
                            }
                            
                            lyricsData.lines.push({
                                text: lineText,
                                startTimeMs: startTimeMs
                            });
                            
                            previousWasSection = isSection;
                        }
                    }
                });
            }
        });
        
        let formattedLyrics = '';
        let previousLineWasSection = false;
        
        lyricsData.lines.forEach((line, index) => {
            const isSection = /^\[.+\]$/.test(line.text);
            const timestamp = config.showTimestamps 
                ? `<span class="timestamp">${formatTime(line.startTimeMs)}</span> `
                : '';
                
            if (isSection && !previousLineWasSection) {
                formattedLyrics += `<div class="lyrics-line line-${index} section-spacer"></div>`;
            }
            
            formattedLyrics += `<div class="lyrics-line line-${index} ${isSection ? 'section-marker' : ''}">${timestamp}${line.text}</div>`;
            previousLineWasSection = isSection;
        });
        
        if (config.cacheLyrics) {
            lyricsCache.set(currentTrackUri, {
                lyrics: formattedLyrics,
                url: url,
                synced: true,
                lines: lyricsData.lines // Cache lines data for synced lyrics
            });
        }
        
        showLyrics(formattedLyrics, url, true);
    }

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    }

    function processLyrics(containers, url) {
        let fullLyrics = '';
        let hasAnnotations = false;

        containers.forEach(container => {
            const clone = container.cloneNode(true);
            clone.querySelectorAll('a, button, script, iframe').forEach(el => el.remove());

            let lyrics = clone.innerHTML
                .replace(/<br\s*\/?>/g, '\n')
                .replace(/<\/?[^>]+(>|$)/g, '')
                .trim();

            lyrics = lyrics.replace(/^.*?(lyrics|Lyrics)\s*[\n-]*\s*/i, '');
            lyrics = lyrics.replace(/^\[.*?\]\s*lyrics\s*[\n-]*\s*/i, '');
            lyrics = lyrics.replace(/(\n|^)\[([^\]]+)\]/g, '\n\n[$2]');

            fullLyrics += lyrics + '\n\n';
            
            if (lyrics.includes('[') && lyrics.includes(']')) {
                hasAnnotations = true;
            }
        });

        fullLyrics = fullLyrics.trim();
        fullLyrics = fullLyrics.replace(/\n{3,}/g, '\n\n');

        if (config.boldAnnotations && hasAnnotations) {
            fullLyrics = fullLyrics.replace(/\[(.*?)\]/g, '<strong>[$1]</strong>');
        }

        if (config.cacheLyrics) {
            lyricsCache.set(currentTrackUri, {
                lyrics: fullLyrics,
                url: url,
                synced: false
            });
        }

        lyricsData = { synced: false, lines: [] }; // Reset lyricsData for non-synced
        showLyrics(fullLyrics, url, false);
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
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                ">
                    <div class="spinner" style="
                        width: 50px;
                        height: 50px;
                        border: 5px solid rgba(255,255,255,0.3);
                        border-radius: 50%;
                        border-top-color: #1db954;
                        animation: spin 1s ease-in-out infinite;
                        margin-bottom: 20px;
                    "></div>
                    <div>Fetching lyrics...</div>
                    <style>
                        @keyframes spin {
                            to { transform: rotate(360deg); }
                        }
                    </style>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modal);
    }

    function showLyrics(lyrics, url, isSynced) {
        closeLyricsModal();
        lyricsModalOpen = true;
        
        currentLineIndex = -1; // Reset current line index

        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }

        if (isSynced && config.autoScroll) {
            scrollInterval = setInterval(() => {
                if (currentLineIndex >= 0) {
                    scrollToCurrentLine();
                }
            }, 2000);
        }

        const track = Spicetify.Player.data.item;
        const trackName = track ? track.name : '';
        const artistName = track && track.artists.length > 0 ? track.artists[0].name : '';

        function adjustColor(hex, percent) {
            const num = parseInt(hex.slice(1), 16);
            const amt = Math.round(2.55 * percent);
            const R = (num >> 16) + amt;
            const G = (num >> 8 & 0x00FF) + amt;
            const B = (num & 0x0000FF) + amt;
            return `#${(
                0x1000000 +
                (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
                (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
                (B < 255 ? (B < 1 ? 0 : B) : 255)
            ).toString(16).slice(1)}`;
        }

        function hexToRgba(hex, opacity) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }

        let themeStyles;
        if (config.customTheme) {
            themeStyles = `
                background: ${config.customBgColor};
                color: ${config.customTextColor};
                --text-color: ${config.customTextColor};
                --border-color: ${adjustColor(config.customBgColor, 20)};
                --hover-color: ${adjustColor(config.customBgColor, 10)};
            `;
        } else {
            themeStyles = config.theme === 'light' ? `
                background: #f8f8f8;
                color: #121212;
                --text-color: #121212;
                --border-color: #ddd;
                --hover-color: #f0f0f0;
            ` : `
                background: #121212;
                color: #fff;
                --text-color: #fff;
                --border-color: #333;
                --hover-color: #2a2a2a;
            `;
        }

        let textShadowStyle = '';
        if (config.textShadowEnabled) {
            textShadowStyle = `${config.textShadowOffsetX}px ${config.textShadowOffsetY}px ${config.textShadowBlurRadius}px ${config.textShadowColor}`;
        }
        
        if (config.textGlowEnabled) {
            const glowColor = config.textGlowColor;
            const glowRadius = config.textGlowRadius;
            const glowShadow = `0 0 ${glowRadius}px ${glowColor}, 0 0 ${glowRadius * 0.5}px ${glowColor}`; // Subtle double glow
            textShadowStyle = textShadowStyle ? `${textShadowStyle}, ${glowShadow}` : glowShadow;
        }


        let formattedLyrics = lyrics;
        if (isSynced) {
            // Remove timestamps from the displayed lyrics in the modal if timestamps are disabled
            if (!config.showTimestamps) {
                formattedLyrics = formattedLyrics.replace(/<span class="timestamp">.*?<\/span>/g, '');
            }
        }
        
        formattedLyrics = formattedLyrics.replace(/^\s+/gm, ''); // Trim leading whitespace from each line

        const modal = `
            <div id="genius-lyrics-modal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, ${config.backgroundOpacity});
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                backdrop-filter: blur(${config.windowBlur}px);
            ">
                <div style="
                    ${themeStyles}
                    padding: 24px;
                    border-radius: ${config.roundedCorners}px;
                    width: 90%;
                    max-width: 750px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
                    animation: fadeInScale 0.3s ease-out;
                    overflow: hidden;
                ">
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 16px;
                        padding-bottom: 12px;
                        border-bottom: 1px solid var(--border-color);
                    ">
                        <div>
                            <h2 style="margin: 0; font-size: 1.2em; color: var(--text-color);">${trackName}</h2>
                            <div style="font-size: 0.9em; color: #888; margin-top: 4px;">${artistName}</div>
                        </div>
                        <div>
                            <button id="settings-button" style="
                                background: transparent;
                                border: none;
                                color: var(--text-color);
                                opacity: 0.7;
                                font-size: 1.2em;
                                cursor: pointer;
                                margin-right: 15px;
                                transition: all 0.2s ease;
                                padding: 5px;
                                border-radius: 50%;
                            " onmouseover="this.style.opacity='1'; this.style.background='var(--hover-color)'" 
                            onmouseout="this.style.opacity='0.7'; this.style.background='transparent'">⚙️</button>
                            <button id="close-lyrics" style="
                                background: transparent;
                                border: none;
                                color: var(--text-color);
                                opacity: 0.7;
                                font-size: 1.5em;
                                cursor: pointer;
                                transition: all 0.2s ease;
                                padding: 0 8px 5px;
                                border-radius: 50%;
                            " onmouseover="this.style.opacity='1'; this.style.background='var(--hover-color)'" 
                            onmouseout="this.style.opacity='0.7'; this.style.background='transparent'">×</button>
                        </div>
                    </div>
                    
                    <div id="lyrics-container" style="
                        white-space: pre-wrap;
                        font-size: ${config.fontSize}px;
                        line-height: ${config.lineSpacing};
                        overflow-y: auto;
                        flex-grow: 1;
                        padding: 10px 5px;
                        scrollbar-width: thin;
                        scrollbar-color: #666 #222;
                        text-align: ${config.textAlign};
                        max-height: 65vh;
                        font-family: ${config.fontFamily};
                        letter-spacing: ${config.letterSpacing}px;
                        text-transform: ${config.textTransform};
                        ${textShadowStyle ? `text-shadow: ${textShadowStyle};` : ''}
                    ">
                        ${formattedLyrics}
                    </div>
                    
                    <div id="settings-panel" style="
                        display: none;
                        margin-top: 20px;
                        padding-top: 15px;
                        border-top: 1px solid var(--border-color);
                        max-height: 50vh;
                        overflow-y: auto;
                        scrollbar-width: thin;
                    ">
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Font size</label>
                                <input type="range" id="font-size-setting" min="10" max="24" value="${config.fontSize}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">Small</span>
                                    <span id="font-size-value" style="color: var(--text-color);">${config.fontSize}px</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Large</span>
                                </div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Theme</label>
                                <select id="theme-setting" style="width: 100%; padding: 8px; border-radius: 4px; background: var(--hover-color); color: var(--text-color); border: 1px solid var(--border-color);">
                                    <option value="dark" ${config.theme === 'dark' ? 'selected' : ''}>Dark</option>
                                    <option value="light" ${config.theme === 'light' ? 'selected' : ''}>Light</option>
                                    <option value="custom" ${config.customTheme ? 'selected' : ''}>Custom</option>
                                </select>
                            </div>
                            
                            <div id="custom-color-settings" style="display: ${config.customTheme ? 'grid' : 'none'}; grid-column: span 2; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px;">
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Background Color</label>
                                    <input type="color" id="custom-bg-setting" value="${config.customBgColor}" style="width: 100%; height: 40px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Text Color</label>
                                    <input type="color" id="custom-text-setting" value="${config.customTextColor}" style="width: 100%; height: 40px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Highlight Color</label>
                                    <input type="color" id="custom-highlight-setting" value="${config.customHighlightColor}" style="width: 100%; height: 40px;">
                                </div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Text Alignment</label>
                                <select id="text-align-setting" style="width: 100%; padding: 8px; border-radius: 4px; background: var(--hover-color); color: var(--text-color); border: 1px solid var(--border-color);">
                                    <option value="left" ${config.textAlign === 'left' ? 'selected' : ''}>Left</option>
                                    <option value="center" ${config.textAlign === 'center' ? 'selected' : ''}>Center</option>
                                    <option value="right" ${config.textAlign === 'right' ? 'selected' : ''}>Right</option>
                                </select>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Background Opacity</label>
                                <input type="range" id="opacity-setting" min="50" max="100" value="${config.backgroundOpacity * 100}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">Faded</span>
                                    <span id="opacity-value" style="color: var(--text-color);">${Math.round(config.backgroundOpacity * 100)}%</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Solid</span>
                                </div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Window Blur</label>
                                <input type="range" id="blur-setting" min="0" max="20" value="${config.windowBlur}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">None</span>
                                    <span id="blur-value" style="color: var(--text-color);">${config.windowBlur}px</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Max</span>
                                </div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Corner Radius</label>
                                <input type="range" id="corner-setting" min="0" max="30" value="${config.roundedCorners}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">Sharp</span>
                                    <span id="corner-value" style="color: var(--text-color);">${config.roundedCorners}px</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Rounded</span>
                                </div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Line Spacing</label>
                                <input type="range" id="spacing-setting" min="1" max="3" step="0.1" value="${config.lineSpacing}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">Tight</span>
                                    <span id="spacing-value" style="color: var(--text-color);">${config.lineSpacing}</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Loose</span>
                                </div>
                            </div>

                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Letter Spacing</label>
                                <input type="range" id="letter-spacing-setting" min="-2" max="5" step="0.5" value="${config.letterSpacing}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                                    <span style="font-size: 10px; color: var(--text-color);">Tight</span>
                                    <span id="letter-spacing-value" style="color: var(--text-color);">${config.letterSpacing}px</span>
                                    <span style="font-size: 14px; color: var(--text-color);">Loose</span>
                                </div>
                            </div>

                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Text Transform</label>
                                <select id="text-transform-setting" style="width: 100%; padding: 8px; border-radius: 4px; background: var(--hover-color); color: var(--text-color); border: 1px solid var(--border-color);">
                                    <option value="none" ${config.textTransform === 'none' ? 'selected' : ''}>None</option>
                                    <option value="uppercase" ${config.textTransform === 'uppercase' ? 'selected' : ''}>Uppercase</option>
                                    <option value="lowercase" ${config.textTransform === 'lowercase' ? 'selected' : ''}>Lowercase</option>
                                    <option value="capitalize" ${config.textTransform === 'capitalize' ? 'selected' : ''}>Capitalize</option>
                                </select>
                            </div>

                            <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Font Family</label>
                                <select id="font-family-setting" style="width: 100%; padding: 8px; border-radius: 4px; background: var(--hover-color); color: var(--text-color); border: 1px solid var(--border-color);">
                                    <option value="Arial, sans-serif" ${config.fontFamily === 'Arial, sans-serif' ? 'selected' : ''}>Arial</option>
                                    <option value="Verdana, sans-serif" ${config.fontFamily === 'Verdana, sans-serif' ? 'selected' : ''}>Verdana</option>
                                    <option value="Helvetica, sans-serif" ${config.fontFamily === 'Helvetica, sans-serif' ? 'selected' : ''}>Helvetica</option>
                                    <option value="Georgia, serif" ${config.fontFamily === 'Georgia, serif' ? 'selected' : ''}>Georgia</option>
                                    <option value="Times New Roman, serif" ${config.fontFamily === 'Times New Roman, serif' ? 'selected' : ''}>Times New Roman</option>
                                    <option value="Courier New, monospace" ${config.fontFamily === 'Courier New, monospace' ? 'selected' : ''}>Courier New</option>
                                    <option value="Lucida Console, monospace" ${config.fontFamily === 'Lucida Console, monospace' ? 'selected' : ''}>Lucida Console</option>
                                    <option value="Trebuchet MS, sans-serif" ${config.fontFamily === 'Trebuchet MS, sans-serif' ? 'selected' : ''}>Trebuchet MS</option>
                                </select>
                            </div>

                             <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-color);">Highlight Transition</label>
                                <select id="highlight-transition-setting" style="width: 100%; padding: 8px; border-radius: 4px; background: var(--hover-color); color: var(--text-color); border: 1px solid var(--border-color);" ${isSynced ? '' : 'disabled'}>
                                    <option value="smooth" ${config.highlightTransition === 'smooth' ? 'selected' : ''}>Smooth</option>
                                    <option value="instant" ${config.highlightTransition === 'instant' ? 'selected' : ''}>Instant</option>
                                    <option value="fade" ${config.highlightTransition === 'fade' ? 'selected' : ''}>Fade</option>
                                </select>
                            </div>

                            <div style="grid-column: span 2; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 10px;">
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color); margin-bottom: 10px;">
                                    <input type="checkbox" id="text-glow-setting" ${config.textGlowEnabled ? 'checked' : ''}>
                                    Enable Text Glow
                                </label>
                                <div id="text-glow-options" style="display: ${config.textGlowEnabled ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 10px; margin-left: 25px;">
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Glow Color</label>
                                        <input type="color" id="text-glow-color-setting" value="${config.textGlowColor}" style="width: 100%; height: 30px;">
                                    </div>
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Glow Radius</label>
                                        <input type="range" id="text-glow-radius-setting" min="0" max="10" value="${config.textGlowRadius}" style="width: 100%;">
                                        <span id="text-glow-radius-value" style="font-size: 10px; color: var(--text-color);">${config.textGlowRadius}px</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="grid-column: span 2;">
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color); margin-bottom: 10px;">
                                    <input type="checkbox" id="text-shadow-setting" ${config.textShadowEnabled ? 'checked' : ''}>
                                    Enable Text Shadow
                                </label>
                                <div id="text-shadow-options" style="display: ${config.textShadowEnabled ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 10px; margin-left: 25px;">
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Shadow Color</label>
                                        <input type="color" id="text-shadow-color-setting" value="${config.textShadowColor}" style="width: 100%; height: 30px;">
                                    </div>
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Offset X</label>
                                        <input type="range" id="text-shadow-offset-x-setting" min="-5" max="5" value="${config.textShadowOffsetX}" style="width: 100%;">
                                        <span id="text-shadow-offset-x-value" style="font-size: 10px; color: var(--text-color);">${config.textShadowOffsetX}px</span>
                                    </div>
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Offset Y</label>
                                        <input type="range" id="text-shadow-offset-y-setting" min="-5" max="5" value="${config.textShadowOffsetY}" style="width: 100%;">
                                        <span id="text-shadow-offset-y-value" style="font-size: 10px; color: var(--text-color);">${config.textShadowOffsetY}px</span>
                                    </div>
                                    <div>
                                        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-color);">Shadow Blur</label>
                                        <input type="range" id="text-shadow-blur-setting" min="0" max="10" value="${config.textShadowBlurRadius}" style="width: 100%;">
                                        <span id="text-shadow-blur-value" style="font-size: 10px; color: var(--text-color);">${config.textShadowBlurRadius}px</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="grid-column: span 2; display: flex; flex-wrap: wrap; gap: 15px; margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="bold-setting" ${config.boldAnnotations ? 'checked' : ''}>
                                    Bold annotations
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="auto-open-setting" ${config.autoOpen ? 'checked' : ''}>
                                    Auto open
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="highlight-setting" ${config.highlightCurrent ? 'checked' : ''} ${isSynced ? '' : 'disabled'}>
                                    Highlight current line
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="auto-scroll-setting" ${config.autoScroll ? 'checked' : ''} ${isSynced ? '' : 'disabled'}>
                                    Auto-scroll
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="cache-setting" ${config.cacheLyrics ? 'checked' : ''}>
                                    Cache lyrics
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="timestamps-setting" ${config.showTimestamps ? 'checked' : ''} ${isSynced ? '' : 'disabled'}>
                                    Show timestamps
                                </label>
                                
                                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-color);">
                                    <input type="checkbox" id="custom-theme-setting" ${config.customTheme ? 'checked' : ''}>
                                    Use custom colors
                                </label>
                            </div>
                        </div>
                        
                        <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; padding-right: 10px;">
                            <button id="reset-settings" style="
                                padding: 8px 16px;
                                background: transparent;
                                border: 1px solid var(--border-color);
                                border-radius: 20px;
                                color: var(--text-color);
                                cursor: pointer;
                            ">Reset to Defaults</button>
                        </div>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 12px;
                        padding-top: 12px;
                        border-top: 1px solid var(--border-color);
                    ">
                        <div style="font-size: 13px; color: ${config.customTheme ? config.customHighlightColor : (config.theme === 'light' ? '#1db954' : '#1ed760')};">
                            ${isSynced ? 'Synced lyrics available' : 'Standard lyrics'}
                        </div>
                        <a href="${url}" target="_blank" style="
                            font-size: 13px;
                            color: ${config.customTheme ? config.customHighlightColor : (config.theme === 'light' ? '#1db954' : '#1ed760')};
                            text-decoration: none;
                        ">Source: Genius</a>
                    </div>
                </div>
                <style>
                    #settings-panel::-webkit-scrollbar {
                        width: 6px;
                    }
                        
                    #settings-panel::-webkit-scrollbar-thumb {
                        background-color: #666;
                        border-radius: 3px;
                    }
                        
                    #settings-panel::-webkit-scrollbar-track {
                        background: transparent;
                    }    
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
                        background: transparent;
                    }
                    
                    .current-line {
                        color: ${config.customTheme ? config.customHighlightColor : '#1db954'} !important;
                        font-weight: bold;
                    }
                    
                    .lyrics-line {
                        margin: 8px 0;
                        padding: 4px 8px;
                        border-radius: 4px;
                    }
                    
                    .current-line {
                        background: ${config.customTheme ? 
                            hexToRgba(config.customHighlightColor, 0.15) : 
                            (config.theme === 'light' ? 'rgba(29, 185, 84, 0.1)' : 'rgba(29, 185, 84, 0.15)')};
                    }
                    
                    .timestamp {
                        display: inline-block;
                        width: 40px;
                        color: #888;
                        font-size: 0.8em;
                        margin-right: 8px;
                    }
                    
                    .section-spacer {
                        height: 1.5em;
                    }
                    
                    .section-marker {
                        margin-top: 1em;
                        font-weight: bold;
                        color: ${config.customTheme ? 
                            adjustColor(config.customTextColor, -30) : 
                            (config.theme === 'light' ? '#555' : '#aaa')};
                    }
                    
                    ${config.customTheme ? `
                    #genius-lyrics-modal > div {
                        background: ${config.customBgColor} !important;
                        color: ${config.customTextColor} !important;
                    }
                    ` : ''}
                </style>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modal);
        
        document.getElementById("close-lyrics").onclick = () => {
            lyricsModalOpen = false;
            closeLyricsModal();
            if (scrollInterval) {
                clearInterval(scrollInterval);
                scrollInterval = null;
            }
        };
        
        document.getElementById("settings-button").addEventListener("click", function() {
            const settingsPanel = document.getElementById("settings-panel");
            settingsPanel.style.display = settingsPanel.style.display === "block" ? "none" : "block";
        });
        
        document.getElementById("bold-setting").addEventListener("change", function() {
            config.boldAnnotations = this.checked;
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics(); // Re-fetch to apply bolding
        });
        
        document.getElementById("auto-open-setting").addEventListener("change", function() {
            config.autoOpen = this.checked;
            saveConfig();
        });
        
        document.getElementById("highlight-setting").addEventListener("change", function() {
            config.highlightCurrent = this.checked;
            saveConfig();
            if (this.checked && lyricsData?.synced) {
                handleProgressUpdate({ detail: Spicetify.Player.getProgress() });
            } else {
                highlightCurrentLine(); // Remove highlight if unchecked
            }
        });
        
        document.getElementById("auto-scroll-setting").addEventListener("change", function() {
            config.autoScroll = this.checked;
            saveConfig();
            if (this.checked && lyricsData?.synced && config.highlightCurrent) {
                scrollToCurrentLine();
            } else if (!this.checked && scrollInterval) {
                clearInterval(scrollInterval);
                scrollInterval = null;
            }
        });
        
        document.getElementById("cache-setting").addEventListener("change", function() {
            config.cacheLyrics = this.checked;
            saveConfig();
            if (!this.checked) {
                lyricsCache.clear();
            }
        });
        
        document.getElementById("timestamps-setting").addEventListener("change", function() {
            config.showTimestamps = this.checked;
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics(); // Re-fetch to apply timestamp visibility
        });
        
        document.getElementById("custom-theme-setting").addEventListener("change", function() {
            config.customTheme = this.checked;
            document.getElementById("custom-color-settings").style.display = this.checked ? 'grid' : 'none';
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics(); // Re-fetch to apply theme
        });

        document.getElementById("theme-setting").addEventListener("change", function() {
            config.theme = this.value;
            config.customTheme = (this.value === 'custom');
            document.getElementById("custom-color-settings").style.display = config.customTheme ? 'grid' : 'none';
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics(); // Re-fetch to apply theme
        });

        document.getElementById("custom-bg-setting").addEventListener("change", function() {
            config.customBgColor = this.value;
            saveConfig();
            document.querySelector("#genius-lyrics-modal > div").style.background = this.value;
            document.querySelector("#genius-lyrics-modal > div").style.setProperty('--border-color', adjustColor(this.value, 20));
            document.querySelector("#genius-lyrics-modal > div").style.setProperty('--hover-color', adjustColor(this.value, 10));
        });

        document.getElementById("custom-text-setting").addEventListener("change", function() {
            config.customTextColor = this.value;
            saveConfig();
            document.querySelector("#genius-lyrics-modal > div").style.color = this.value;
            document.querySelector("#genius-lyrics-modal > div").style.setProperty('--text-color', this.value);
            document.getElementById("custom-text-setting").style.color = this.value; // Update text color of the color picker label
        });

        document.getElementById("custom-highlight-setting").addEventListener("change", function() {
            config.customHighlightColor = this.value;
            saveConfig();
            // Reapply highlight color directly
            const currentLineElement = document.querySelector('#lyrics-container .current-line');
            if (currentLineElement) {
                currentLineElement.style.color = this.value;
                currentLineElement.style.background = hexToRgba(this.value, 0.15);
            }
            document.querySelector('#genius-lyrics-modal .source-link').style.color = this.value; // Update source link color
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
        
        const opacitySlider = document.getElementById("opacity-setting");
        const opacityValue = document.getElementById("opacity-value");
        
        opacitySlider.addEventListener("input", function() {
            const opacity = this.value / 100;
            opacityValue.textContent = this.value + "%";
            document.getElementById("genius-lyrics-modal").style.background = `rgba(0, 0, 0, ${opacity})`;
            config.backgroundOpacity = opacity;
            saveConfig();
        });
        
        const blurSlider = document.getElementById("blur-setting");
        const blurValue = document.getElementById("blur-value");
        
        blurSlider.addEventListener("input", function() {
            const blur = this.value;
            blurValue.textContent = blur + "px";
            document.getElementById("genius-lyrics-modal").style.backdropFilter = `blur(${blur}px)`;
            config.windowBlur = parseInt(blur);
            saveConfig();
        });

        const cornerSlider = document.getElementById("corner-setting");
        const cornerValue = document.getElementById("corner-value");
        
        cornerSlider.addEventListener("input", function() {
            const corner = this.value;
            cornerValue.textContent = corner + "px";
            document.querySelector("#genius-lyrics-modal > div").style.borderRadius = corner + "px";
            config.roundedCorners = parseInt(corner);
            saveConfig();
        });

        const spacingSlider = document.getElementById("spacing-setting");
        const spacingValue = document.getElementById("spacing-value");
        
        spacingSlider.addEventListener("input", function() {
            const spacing = this.value;
            spacingValue.textContent = spacing;
            document.getElementById("lyrics-container").style.lineHeight = spacing;
            config.lineSpacing = parseFloat(spacing);
            saveConfig();
        });

        document.getElementById("text-align-setting").addEventListener("change", function() {
            config.textAlign = this.value;
            saveConfig();
            document.getElementById("lyrics-container").style.textAlign = this.value;
        });

        document.getElementById("letter-spacing-setting").addEventListener("input", function() {
            const spacing = this.value;
            document.getElementById("letter-spacing-value").textContent = spacing + "px";
            document.getElementById("lyrics-container").style.letterSpacing = spacing + "px";
            config.letterSpacing = parseFloat(spacing);
            saveConfig();
        });

        document.getElementById("text-transform-setting").addEventListener("change", function() {
            config.textTransform = this.value;
            saveConfig();
            document.getElementById("lyrics-container").style.textTransform = this.value;
        });

        document.getElementById("font-family-setting").addEventListener("change", function() {
            config.fontFamily = this.value;
            saveConfig();
            document.getElementById("lyrics-container").style.fontFamily = this.value;
        });

        document.getElementById("highlight-transition-setting").addEventListener("change", function() {
            config.highlightTransition = this.value;
            saveConfig();
            // No direct visual update here, effect is seen on next line highlight
        });

        const textGlowCheckbox = document.getElementById("text-glow-setting");
        const textGlowOptions = document.getElementById("text-glow-options");
        const textGlowColorInput = document.getElementById("text-glow-color-setting");
        const textGlowRadiusSlider = document.getElementById("text-glow-radius-setting");
        const textGlowRadiusValue = document.getElementById("text-glow-radius-value");

        textGlowCheckbox.addEventListener("change", function() {
            config.textGlowEnabled = this.checked;
            textGlowOptions.style.display = this.checked ? 'grid' : 'none';
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics(); // Re-fetch to apply text glow
        });

        textGlowColorInput.addEventListener("change", function() {
            config.textGlowColor = this.value;
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        textGlowRadiusSlider.addEventListener("input", function() {
            config.textGlowRadius = parseInt(this.value);
            textGlowRadiusValue.textContent = this.value + "px";
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        const textShadowCheckbox = document.getElementById("text-shadow-setting");
        const textShadowOptions = document.getElementById("text-shadow-options");
        const textShadowColorInput = document.getElementById("text-shadow-color-setting");
        const textShadowOffsetXSlider = document.getElementById("text-shadow-offset-x-setting");
        const textShadowOffsetXValue = document.getElementById("text-shadow-offset-x-value");
        const textShadowOffsetYSlider = document.getElementById("text-shadow-offset-y-setting");
        const textShadowOffsetYValue = document.getElementById("text-shadow-offset-y-value");
        const textShadowBlurSlider = document.getElementById("text-shadow-blur-setting");
        const textShadowBlurValue = document.getElementById("text-shadow-blur-value");

        textShadowCheckbox.addEventListener("change", function() {
            config.textShadowEnabled = this.checked;
            textShadowOptions.style.display = this.checked ? 'grid' : 'none';
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        textShadowColorInput.addEventListener("change", function() {
            config.textShadowColor = this.value;
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        textShadowOffsetXSlider.addEventListener("input", function() {
            config.textShadowOffsetX = parseInt(this.value);
            textShadowOffsetXValue.textContent = this.value + "px";
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        textShadowOffsetYSlider.addEventListener("input", function() {
            config.textShadowOffsetY = parseInt(this.value);
            textShadowOffsetYValue.textContent = this.value + "px";
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });

        textShadowBlurSlider.addEventListener("input", function() {
            config.textShadowBlurRadius = parseInt(this.value);
            textShadowBlurValue.textContent = this.value + "px";
            saveConfig();
            const track = Spicetify.Player.data.item;
            if (track) fetchLyrics();
        });
        
        document.getElementById("reset-settings").addEventListener("click", function() {
            if (confirm("Reset all settings to default values?")) {
                config = {...defaultConfig};
                saveConfig();
                lyricsCache.clear();
                const track = Spicetify.Player.data.item;
                if (track) fetchLyrics(); // Re-fetch to apply all defaults
            }
        });
        
        if (isSynced && config.highlightCurrent) {
            setTimeout(() => {
                handleProgressUpdate({ detail: Spicetify.Player.getProgress() });
            }, 100);
        }
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

    addButton();
    setupPlayerListener();
    
    if (config.autoOpen) {
        setTimeout(fetchLyrics, 1000);
    }
})();

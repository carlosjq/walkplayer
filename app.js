// --- IndexedDB Setup ---
const DB_NAME = 'WalkPlayerDB';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve();
        };

        request.onerror = (event) => reject(event.target.error);
    });
}

function saveFileToDB(file) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add({
            name: file.name,
            type: file.type,
            data: file
        });
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAllFilesFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function clearDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// --- App State & DOM Elements ---
const audioPlayer = document.getElementById('audio-player');
const playPauseBtn = document.getElementById('btn-play-pause');
const prevBtn = document.getElementById('btn-prev');
const nextBtn = document.getElementById('btn-next');
const rewindBtn = document.getElementById('btn-rewind');
const forwardBtn = document.getElementById('btn-forward');
const speedSelect = document.getElementById('speed-select');
const fileInput = document.getElementById('file-input');
const playlistEl = document.getElementById('playlist');
const trackTitleEl = document.getElementById('track-title');
const currentTimeEl = document.getElementById('current-time');
const durationTimeEl = document.getElementById('duration-time');
const progressBar = document.getElementById('progress-bar');
const artworkEl = document.querySelector('.artwork');
const clearDbBtn = document.getElementById('btn-clear-db');

let tracks = [];
let currentTrackIndex = -1;
let isPlaying = false;
let currentObjectURL = null;

// --- Audio Visualizer Variables ---
let audioCtx;
let analyser;
let dataArray;
let animationId;
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas ? canvas.getContext('2d') : null;
let sourceNode = null;

// --- Helper Functions ---
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// --- Player Logic ---
function loadTrack(index, startTime = 0) {
    if (index < 0 || index >= tracks.length) return;
    
    currentTrackIndex = index;
    const track = tracks[index];
    
    // Cleanup previous object url to prevent memory leaks
    if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
    }
    
    currentObjectURL = URL.createObjectURL(track.data);
    audioPlayer.src = currentObjectURL;
    audioPlayer.currentTime = startTime;
    audioPlayer.playbackRate = parseFloat(speedSelect.value);
    
    trackTitleEl.textContent = track.name.replace(/\.[^/.]+$/, ""); // Remove extension
    
    // Update playlist UI
    document.querySelectorAll('.playlist-item').forEach((item, i) => {
        if (i === index) item.classList.add('active');
        else item.classList.remove('active');
    });

    // Save state
    localStorage.setItem('walkplayer_lastTrackId', track.id);
    localStorage.setItem('walkplayer_lastTime', startTime);
}

function togglePlay() {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        loadTrack(0);
    }
    
    if (currentTrackIndex === -1) return;

    if (audioPlayer.paused) {
        initVisualizer(); // Initialize or resume AudioContext
        audioPlayer.play();
        isPlaying = true;
        playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        artworkEl.classList.add('playing');
        drawVisualizer(); // Start animation loop
    } else {
        audioPlayer.pause();
        isPlaying = false;
        playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        artworkEl.classList.remove('playing');
        cancelAnimationFrame(animationId); // Stop animation loop
        
        // Save current time explicitly on pause
        localStorage.setItem('walkplayer_lastTime', audioPlayer.currentTime);
    }
}

// --- Visualizer Logic ---
function initVisualizer() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        
        // Connect the audio element to the analyser
        // Handle CORS if needed, though for local blobs it's fine
        sourceNode = audioCtx.createMediaElementSource(audioPlayer);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        // Configure analyser
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function drawVisualizer() {
    if (!isPlaying || !canvasCtx) return;
    
    animationId = requestAnimationFrame(drawVisualizer);
    
    analyser.getByteFrequencyData(dataArray);
    
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 105; // Slightly larger than artwork (200/2 = 100)
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, width, height);
    
    const barsCounter = 60; 
    const step = Math.floor(analyser.frequencyBinCount / barsCounter);
    
    for (let i = 0; i < barsCounter; i++) {
        const dataIndex = i * step;
        const barHeight = (dataArray[dataIndex] / 255) * 40; // Max extension
        
        const rads = (Math.PI * 2) * (i / barsCounter);
        const x_start = centerX + Math.cos(rads) * radius;
        const y_start = centerY + Math.sin(rads) * radius;
        
        const x_end = centerX + Math.cos(rads) * (radius + barHeight);
        const y_end = centerY + Math.sin(rads) * (radius + barHeight);
        
        canvasCtx.beginPath();
        canvasCtx.moveTo(x_start, y_start);
        canvasCtx.lineTo(x_end, y_end);
        canvasCtx.lineWidth = 3;
        
        // Smooth gradient for visualizer bars
        const hue = (i * (360 / barsCounter) + (Date.now() / 20)) % 360;
        canvasCtx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
        canvasCtx.lineCap = 'round';
        canvasCtx.stroke();
    }
}

function playNext() {
    if (tracks.length === 0) return;
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= tracks.length) nextIndex = 0; // Loop back to start
    loadTrack(nextIndex);
    if (isPlaying) audioPlayer.play();
}

function playPrev() {
    if (tracks.length === 0) return;
    
    // If we are more than 3 seconds in, just restart current track
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        return;
    }
    
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = tracks.length - 1;
    loadTrack(prevIndex);
    if (isPlaying) audioPlayer.play();
}

function skipTime(seconds) {
    audioPlayer.currentTime += seconds;
}

// --- UI Updates ---
function renderPlaylist() {
    playlistEl.innerHTML = '';
    
    if (tracks.length === 0) {
        playlistEl.innerHTML = '<li class="empty-state">No hay audios. Toca \'Importar\' para empezar.</li>';
        trackTitleEl.textContent = "Ningún archivo seleccionado";
        return;
    }

    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        if (index === currentTrackIndex) li.classList.add('active');
        
        li.innerHTML = `
            <div class="item-icon"><i class="fa-solid fa-music"></i></div>
            <div class="item-title">${track.name.replace(/\.[^/.]+$/, "")}</div>
        `;
        
        li.addEventListener('click', () => {
            loadTrack(index);
            initVisualizer();
            audioPlayer.play();
            isPlaying = true;
            playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            artworkEl.classList.add('playing');
            drawVisualizer();
        });
        
        playlistEl.appendChild(li);
    });
}

async function loadLibrary() {
    try {
        tracks = await getAllFilesFromDB();
        renderPlaylist();
        
        // Restore last played track
        const lastTrackId = localStorage.getItem('walkplayer_lastTrackId');
        const lastTime = localStorage.getItem('walkplayer_lastTime') || 0;
        
        if (tracks.length > 0) {
            let trackIndexToLoad = 0;
            if (lastTrackId) {
                const index = tracks.findIndex(t => t.id == lastTrackId);
                if (index !== -1) trackIndexToLoad = index;
            }
            loadTrack(trackIndexToLoad, parseFloat(lastTime));
        }
    } catch (err) {
        console.error("Error loading library:", err);
    }
}

// --- Event Listeners ---
playPauseBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);
rewindBtn.addEventListener('click', () => skipTime(-15));
forwardBtn.addEventListener('click', () => skipTime(15));

speedSelect.addEventListener('change', (e) => {
    audioPlayer.playbackRate = parseFloat(e.target.value);
    localStorage.setItem('walkplayer_speed', e.target.value);
});

audioPlayer.addEventListener('timeupdate', () => {
    const current = audioPlayer.currentTime;
    const duration = audioPlayer.duration;
    
    currentTimeEl.textContent = formatTime(current);
    
    if (!isNaN(duration)) {
        durationTimeEl.textContent = formatTime(duration);
        progressBar.value = (current / duration) * 100;
    }
    
    // Periodically save time (every ~5 seconds) to avoid thrashing localStorage
    if (Math.floor(current) % 5 === 0) {
        localStorage.setItem('walkplayer_lastTime', current);
    }
});

audioPlayer.addEventListener('ended', playNext);

progressBar.addEventListener('input', (e) => {
    const time = (e.target.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = time;
    currentTimeEl.textContent = formatTime(time);
});

fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    trackTitleEl.textContent = "Importando...";
    
    for (const file of files) {
        if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.m4a')) {
            await saveFileToDB(file);
        }
    }
    
    await loadLibrary();
    if (tracks.length > 0 && currentTrackIndex === -1) {
        loadTrack(0);
    }
});

clearDbBtn.addEventListener('click', async () => {
    if (confirm('¿Estás seguro de que quieres borrar todos los audios guardados?')) {
        await clearDB();
        tracks = [];
        currentTrackIndex = -1;
        audioPlayer.pause();
        audioPlayer.src = "";
        isPlaying = false;
        playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        artworkEl.classList.remove('playing');
        cancelAnimationFrame(animationId);
        if (canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        progressBar.value = 0;
        currentTimeEl.textContent = "0:00";
        durationTimeEl.textContent = "0:00";
        localStorage.removeItem('walkplayer_lastTrackId');
        localStorage.removeItem('walkplayer_lastTime');
        renderPlaylist();
    }
});

// Save explicit state before unloading
window.addEventListener('beforeunload', () => {
    if (currentTrackIndex !== -1) {
        localStorage.setItem('walkplayer_lastTime', audioPlayer.currentTime);
    }
});

// --- Initialization ---
async function init() {
    await initDB();
    
    // Load saved speed
    const savedSpeed = localStorage.getItem('walkplayer_speed');
    if (savedSpeed) {
        speedSelect.value = savedSpeed;
    }
    
    await loadLibrary();
}

init();

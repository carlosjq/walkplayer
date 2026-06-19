const DB_NAME = 'WalkPlayerDB';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;
const POSITION_SAVE_INTERVAL = 5;

let db;
let tracks = [];
let currentTrackIndex = -1;
let currentObjectURL = null;
let lastSavedPosition = -1;

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
const statusMessageEl = document.getElementById('status-message');

const icons = {
    play: '▶',
    pause: 'Ⅱ'
};

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

function saveFileToDB(file) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const request = transaction.objectStore(STORE_NAME).add({
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            data: file
        });

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAllFilesFromDB() {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteFileFromDB(id) {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function clearDB() {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function getTrackTitle(track) {
    return track.name.replace(/\.[^/.]+$/, '');
}

function currentTrack() {
    return tracks[currentTrackIndex] ?? null;
}

function showStatus(message, isError = false) {
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle('is-error', isError);
}

function clearStatus() {
    showStatus('');
}

function updateControls() {
    const hasTracks = tracks.length > 0;
    [playPauseBtn, prevBtn, nextBtn, rewindBtn, forwardBtn].forEach((button) => {
        button.disabled = !hasTracks;
    });
    clearDbBtn.disabled = !hasTracks;
}

function updateMediaSession() {
    if (!('mediaSession' in navigator) || !currentTrack()) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: getTrackTitle(currentTrack()),
        artist: 'WalkPlayer',
        artwork: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
    });
}

function syncPlaybackUI() {
    const playing = !audioPlayer.paused && !audioPlayer.ended;
    playPauseBtn.textContent = playing ? icons.pause : icons.play;
    playPauseBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    playPauseBtn.title = playing ? 'Pausar' : 'Reproducir';
    artworkEl.classList.toggle('playing', playing);

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
}

function persistCurrentPosition() {
    if (!currentTrack() || !Number.isFinite(audioPlayer.currentTime)) return;
    localStorage.setItem('walkplayer_lastTrackId', currentTrack().id);
    localStorage.setItem('walkplayer_lastTime', String(audioPlayer.currentTime));
    lastSavedPosition = audioPlayer.currentTime;
}

function revokeCurrentObjectURL() {
    if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = null;
    }
}

function resetPlayer() {
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
    revokeCurrentObjectURL();
    currentTrackIndex = -1;
    trackTitleEl.textContent = 'Ningún archivo seleccionado';
    progressBar.value = 0;
    currentTimeEl.textContent = '0:00';
    durationTimeEl.textContent = '0:00';
    syncPlaybackUI();
}

function loadTrack(index, startTime = 0) {
    if (index < 0 || index >= tracks.length) return;

    const wasPlaying = !audioPlayer.paused;
    revokeCurrentObjectURL();
    currentTrackIndex = index;
    const track = currentTrack();
    currentObjectURL = URL.createObjectURL(track.data);
    audioPlayer.src = currentObjectURL;
    audioPlayer.playbackRate = Number(speedSelect.value);
    trackTitleEl.textContent = getTrackTitle(track);
    lastSavedPosition = -1;

    audioPlayer.onloadedmetadata = () => {
        const targetTime = Math.min(Math.max(Number(startTime) || 0, 0), audioPlayer.duration || 0);
        if (targetTime > 0) audioPlayer.currentTime = targetTime;
        durationTimeEl.textContent = formatTime(audioPlayer.duration);
    };

    localStorage.setItem('walkplayer_lastTrackId', track.id);
    localStorage.setItem('walkplayer_lastTime', String(startTime));
    updateMediaSession();
    renderPlaylist();
    clearStatus();

    if (wasPlaying) playCurrent();
}

async function playCurrent() {
    if (currentTrackIndex === -1 && tracks.length > 0) loadTrack(0);
    if (currentTrackIndex === -1) return;

    try {
        await audioPlayer.play();
        clearStatus();
    } catch (error) {
        syncPlaybackUI();
        showStatus('No se pudo iniciar el audio. Vuelve a tocar Reproducir.', true);
        console.error('Playback failed:', error);
    }
}

function togglePlay() {
    if (audioPlayer.paused) {
        playCurrent();
    } else {
        audioPlayer.pause();
    }
}

function playNext(forcePlay = false) {
    if (!tracks.length) return;
    const shouldPlay = forcePlay || !audioPlayer.paused;
    const nextIndex = currentTrackIndex < 0 || currentTrackIndex + 1 >= tracks.length ? 0 : currentTrackIndex + 1;
    loadTrack(nextIndex);
    if (shouldPlay) playCurrent();
}

function playPrev() {
    if (!tracks.length) return;
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        persistCurrentPosition();
        return;
    }

    const shouldPlay = !audioPlayer.paused;
    const previousIndex = currentTrackIndex <= 0 ? tracks.length - 1 : currentTrackIndex - 1;
    loadTrack(previousIndex);
    if (shouldPlay) playCurrent();
}

function skipTime(seconds) {
    if (!currentTrack() || !Number.isFinite(audioPlayer.duration)) return;
    audioPlayer.currentTime = Math.min(Math.max(audioPlayer.currentTime + seconds, 0), audioPlayer.duration);
    persistCurrentPosition();
}

function isDuplicate(file) {
    return tracks.some((track) =>
        track.name === file.name && track.size === file.size && track.lastModified === file.lastModified
    );
}

function renderPlaylist() {
    playlistEl.replaceChildren();
    updateControls();

    if (!tracks.length) {
        const emptyState = document.createElement('li');
        emptyState.className = 'empty-state';
        emptyState.textContent = "No hay audios. Toca 'Importar' para empezar.";
        playlistEl.append(emptyState);
        return;
    }

    tracks.forEach((track, index) => {
        const item = document.createElement('li');
        item.className = 'playlist-item';
        item.classList.toggle('active', index === currentTrackIndex);

        const selectButton = document.createElement('button');
        selectButton.className = 'track-select';
        selectButton.type = 'button';
        selectButton.title = `Reproducir ${getTrackTitle(track)}`;
        selectButton.setAttribute('aria-label', `Reproducir ${getTrackTitle(track)}`);
        selectButton.addEventListener('click', () => {
            loadTrack(index);
            playCurrent();
        });

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '♫';

        const title = document.createElement('span');
        title.className = 'item-title';
        title.textContent = getTrackTitle(track);
        selectButton.append(icon, title);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-track-btn';
        deleteButton.type = 'button';
        deleteButton.textContent = '×';
        deleteButton.title = `Eliminar ${getTrackTitle(track)}`;
        deleteButton.setAttribute('aria-label', `Eliminar ${getTrackTitle(track)}`);
        deleteButton.addEventListener('click', () => deleteTrack(track));

        item.append(selectButton, deleteButton);
        playlistEl.append(item);
    });
}

async function refreshLibrary() {
    const activeId = currentTrack()?.id;
    tracks = await getAllFilesFromDB();
    currentTrackIndex = activeId ? tracks.findIndex((track) => track.id === activeId) : -1;
    renderPlaylist();
}

async function deleteTrack(track) {
    const deletingCurrentTrack = currentTrack()?.id === track.id;
    try {
        await deleteFileFromDB(track.id);
        if (deletingCurrentTrack) {
            resetPlayer();
            localStorage.removeItem('walkplayer_lastTrackId');
            localStorage.removeItem('walkplayer_lastTime');
        }
        await refreshLibrary();
        showStatus(`Se eliminó “${getTrackTitle(track)}”.`);
    } catch (error) {
        console.error('Delete failed:', error);
        showStatus('No se pudo eliminar el audio.', true);
    }
}

async function loadInitialLibrary() {
    tracks = await getAllFilesFromDB();
    renderPlaylist();
    if (!tracks.length) return;

    const lastTrackId = Number(localStorage.getItem('walkplayer_lastTrackId'));
    const lastTime = Number(localStorage.getItem('walkplayer_lastTime')) || 0;
    const savedIndex = tracks.findIndex((track) => track.id === lastTrackId);
    loadTrack(savedIndex >= 0 ? savedIndex : 0, lastTime);
}

function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
        play: playCurrent,
        pause: () => audioPlayer.pause(),
        previoustrack: playPrev,
        nexttrack: () => playNext(),
        seekbackward: (details) => skipTime(-(details.seekOffset || 15)),
        seekforward: (details) => skipTime(details.seekOffset || 15),
        seekto: (details) => {
            if (Number.isFinite(details.seekTime)) audioPlayer.currentTime = details.seekTime;
        }
    };
    Object.entries(handlers).forEach(([action, handler]) => {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (_) {
            // Some browsers expose Media Session but do not implement every action.
        }
    });
}

playPauseBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', () => playNext());
prevBtn.addEventListener('click', playPrev);
rewindBtn.addEventListener('click', () => skipTime(-15));
forwardBtn.addEventListener('click', () => skipTime(15));

speedSelect.addEventListener('change', (event) => {
    audioPlayer.playbackRate = Number(event.target.value);
    localStorage.setItem('walkplayer_speed', event.target.value);
});

let isDraggingProgressBar = false;
['pointerdown', 'touchstart'].forEach((eventName) => {
    progressBar.addEventListener(eventName, () => { isDraggingProgressBar = true; }, { passive: true });
});
['pointerup', 'pointercancel', 'touchend'].forEach((eventName) => {
    progressBar.addEventListener(eventName, () => { isDraggingProgressBar = false; });
});

progressBar.addEventListener('input', (event) => {
    isDraggingProgressBar = true;
    if (Number.isFinite(audioPlayer.duration)) {
        currentTimeEl.textContent = formatTime((Number(event.target.value) / 100) * audioPlayer.duration);
    }
});

progressBar.addEventListener('change', (event) => {
    if (Number.isFinite(audioPlayer.duration)) {
        audioPlayer.currentTime = (Number(event.target.value) / 100) * audioPlayer.duration;
        persistCurrentPosition();
    }
    isDraggingProgressBar = false;
});

audioPlayer.addEventListener('play', syncPlaybackUI);
audioPlayer.addEventListener('pause', () => {
    syncPlaybackUI();
    persistCurrentPosition();
});
audioPlayer.addEventListener('timeupdate', () => {
    const current = audioPlayer.currentTime;
    const duration = audioPlayer.duration;
    if (!isDraggingProgressBar) {
        currentTimeEl.textContent = formatTime(current);
        if (Number.isFinite(duration) && duration > 0) progressBar.value = (current / duration) * 100;
    }
    if (Math.abs(current - lastSavedPosition) >= POSITION_SAVE_INTERVAL) persistCurrentPosition();
});
audioPlayer.addEventListener('ended', () => playNext(true));
audioPlayer.addEventListener('error', () => {
    syncPlaybackUI();
    showStatus('No se pudo leer este archivo de audio.', true);
});

fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    let added = 0;
    let skipped = 0;
    let failed = 0;
    showStatus('Importando audios…');

    for (const file of files) {
        if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name)) {
            skipped += 1;
            continue;
        }
        if (isDuplicate(file)) {
            skipped += 1;
            continue;
        }
        try {
            await saveFileToDB(file);
            tracks.push({ name: file.name, size: file.size, lastModified: file.lastModified });
            added += 1;
        } catch (error) {
            console.error('Import failed:', error);
            failed += 1;
        }
    }

    await refreshLibrary();
    if (currentTrackIndex === -1 && tracks.length) loadTrack(0);
    const result = `${added} audio${added === 1 ? '' : 's'} importado${added === 1 ? '' : 's'}${skipped ? `, ${skipped} omitido${skipped === 1 ? '' : 's'}` : ''}${failed ? `, ${failed} con error` : ''}.`;
    showStatus(result, failed > 0);
    fileInput.value = '';
});

clearDbBtn.addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que quieres borrar todos los audios guardados?')) return;
    try {
        await clearDB();
        tracks = [];
        resetPlayer();
        localStorage.removeItem('walkplayer_lastTrackId');
        localStorage.removeItem('walkplayer_lastTime');
        renderPlaylist();
        showStatus('Biblioteca eliminada.');
    } catch (error) {
        console.error('Clear library failed:', error);
        showStatus('No se pudo borrar la biblioteca.', true);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistCurrentPosition();
});
window.addEventListener('pagehide', persistCurrentPosition);

async function init() {
    try {
        await initDB();
        const savedSpeed = localStorage.getItem('walkplayer_speed');
        if (savedSpeed) speedSelect.value = savedSpeed;
        audioPlayer.playbackRate = Number(speedSelect.value);
        setupMediaSession();
        await loadInitialLibrary();
        syncPlaybackUI();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch((error) => {
                console.error('Service Worker registration failed:', error);
                showStatus('La interfaz funcionará, pero no se pudo activar el modo sin conexión.', true);
            });
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        showStatus('No se pudo abrir la biblioteca local.', true);
    }
}

init();

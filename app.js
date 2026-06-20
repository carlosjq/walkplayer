/* Lector de textos + Reproductor — PWA local, optimizada para caminatas.
 * Reúsa el motor de WalkPlayer (reproducción en segundo plano iOS, Media Session,
 * memoria de posición) y añade lecturas con resaltado y doble-toque para saltar. */

const DB_NAME = 'LectorDB';
const STORE_NAME = 'items';
const DB_VERSION = 1;
const POSITION_SAVE_INTERVAL = 5;
const DOUBLE_TAP_MS = 350;

let db;
let tracks = [];
let currentTrackIndex = -1;
let currentObjectURL = null;
let lastSavedPosition = -1;

// Estado de la lectura activa.
let currentSentences = null;   // [{i, t, s, e}] o null si es un MP3 normal
let sentenceSpans = [];        // spans del DOM, alineados con currentSentences
let currentSentenceIdx = -1;
let lastTapIdx = -1;
let lastTapTime = 0;

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
const readerEl = document.getElementById('reader');
const readerTextEl = document.getElementById('reader-text');

const icons = { play: '▶', pause: 'Ⅱ' };

/* ----------------------------- IndexedDB ------------------------------ */
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (event) => { db = event.target.result; resolve(); };
        request.onerror = () => reject(request.error);
    });
}

function saveItemToDB(record) {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(record);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAllItemsFromDB() {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteItemFromDB(id) {
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

/* ------------------------------ Utilidades ---------------------------- */
function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function isLectura(track) {
    return track && track.kind === 'lectura';
}

function getTrackTitle(track) {
    if (!track) return '';
    if (isLectura(track)) return track.name;
    return track.name.replace(/\.[^/.]+$/, '');
}

function currentTrack() {
    return tracks[currentTrackIndex] ?? null;
}

function showStatus(message, isError = false) {
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle('is-error', isError);
}

function clearStatus() { showStatus(''); }

function updateControls() {
    const hasTracks = tracks.length > 0;
    [playPauseBtn, prevBtn, nextBtn, rewindBtn, forwardBtn].forEach((b) => { b.disabled = !hasTracks; });
    clearDbBtn.disabled = !hasTracks;
}

function updateMediaSession() {
    if (!('mediaSession' in navigator) || !currentTrack()) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: getTrackTitle(currentTrack()),
        artist: 'Lector',
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
    localStorage.setItem('lector_lastTrackId', currentTrack().id);
    localStorage.setItem('lector_lastTime', String(audioPlayer.currentTime));
    lastSavedPosition = audioPlayer.currentTime;
}

function revokeCurrentObjectURL() {
    if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }
}

/* ------------------------- Vista de lectura --------------------------- */
function renderReader(sentences) {
    readerTextEl.replaceChildren();
    sentenceSpans = [];
    currentSentenceIdx = -1;
    sentences.forEach((frase, idx) => {
        const span = document.createElement('span');
        span.className = 'sentence';
        span.textContent = frase.t;
        span.dataset.idx = String(idx);
        span.addEventListener('click', () => handleSentenceTap(idx));
        readerTextEl.append(span);
        readerTextEl.append(document.createTextNode(' '));
        sentenceSpans.push(span);
    });
}

function handleSentenceTap(idx) {
    const now = Date.now();
    if (idx === lastTapIdx && now - lastTapTime < DOUBLE_TAP_MS) {
        seekToSentence(idx);
        lastTapIdx = -1;
    } else {
        lastTapIdx = idx;
        lastTapTime = now;
    }
}

function seekToSentence(idx) {
    if (!currentSentences || !currentSentences[idx]) return;
    const start = currentSentences[idx].s;
    const apply = () => {
        audioPlayer.currentTime = start + 0.001;
        persistCurrentPosition();
        highlightSentence(idx);
        playCurrent();
    };
    if (Number.isFinite(audioPlayer.duration)) apply();
    else audioPlayer.addEventListener('loadedmetadata', apply, { once: true });
}

function findSentenceAt(time) {
    if (!currentSentences || !currentSentences.length) return -1;
    let lo = 0, hi = currentSentences.length - 1, res = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (currentSentences[mid].s <= time) { res = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return res;
}

function highlightSentence(idx) {
    if (idx === currentSentenceIdx || idx < 0) return;
    if (sentenceSpans[currentSentenceIdx]) sentenceSpans[currentSentenceIdx].classList.remove('current');
    const span = sentenceSpans[idx];
    if (span) {
        span.classList.add('current');
        const top = span.offsetTop - readerTextEl.clientHeight / 2 + span.offsetHeight / 2;
        readerTextEl.scrollTo({ top, behavior: 'smooth' });
    }
    currentSentenceIdx = idx;
}

function updateReaderHighlight() {
    if (!currentSentences) return;
    highlightSentence(findSentenceAt(audioPlayer.currentTime));
}

function showReaderFor(track) {
    if (isLectura(track) && Array.isArray(track.sentences) && track.sentences.length) {
        currentSentences = track.sentences;
        renderReader(currentSentences);
        readerEl.hidden = false;
        document.body.classList.add('reading-mode');
    } else {
        currentSentences = null;
        sentenceSpans = [];
        currentSentenceIdx = -1;
        readerEl.hidden = true;
        readerTextEl.replaceChildren();
        document.body.classList.remove('reading-mode');
    }
}

/* ------------------------- Reproducción ------------------------------- */
function resetPlayer() {
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
    revokeCurrentObjectURL();
    currentTrackIndex = -1;
    trackTitleEl.textContent = 'Nada seleccionado';
    progressBar.value = 0;
    currentTimeEl.textContent = '0:00';
    durationTimeEl.textContent = '0:00';
    showReaderFor(null);
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

    showReaderFor(track);

    audioPlayer.onloadedmetadata = () => {
        const targetTime = Math.min(Math.max(Number(startTime) || 0, 0), audioPlayer.duration || 0);
        if (targetTime > 0) audioPlayer.currentTime = targetTime;
        durationTimeEl.textContent = formatTime(audioPlayer.duration);
        updateReaderHighlight();
    };

    localStorage.setItem('lector_lastTrackId', track.id);
    localStorage.setItem('lector_lastTime', String(startTime));
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
    if (audioPlayer.paused) playCurrent();
    else audioPlayer.pause();
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
    updateReaderHighlight();
}

/* ------------------------- Biblioteca / UI ---------------------------- */
function isDuplicate(record) {
    if (record.kind === 'lectura') {
        return tracks.some((t) => t.kind === 'lectura' && t.name === record.name);
    }
    return tracks.some((t) => t.kind !== 'lectura'
        && t.name === record.name && t.size === record.size && t.lastModified === record.lastModified);
}

function renderPlaylist() {
    playlistEl.replaceChildren();
    updateControls();

    if (!tracks.length) {
        const emptyState = document.createElement('li');
        emptyState.className = 'empty-state';
        emptyState.textContent = "No hay nada aún. Toca 'Importar' para empezar.";
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
        selectButton.addEventListener('click', () => { loadTrack(index); playCurrent(); });

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = isLectura(track) ? '📖' : '♫';

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
    tracks = await getAllItemsFromDB();
    currentTrackIndex = activeId ? tracks.findIndex((t) => t.id === activeId) : -1;
    renderPlaylist();
}

async function deleteTrack(track) {
    const deletingCurrent = currentTrack()?.id === track.id;
    try {
        await deleteItemFromDB(track.id);
        if (deletingCurrent) {
            resetPlayer();
            localStorage.removeItem('lector_lastTrackId');
            localStorage.removeItem('lector_lastTime');
        }
        await refreshLibrary();
        showStatus(`Se eliminó “${getTrackTitle(track)}”.`);
    } catch (error) {
        console.error('Delete failed:', error);
        showStatus('No se pudo eliminar.', true);
    }
}

async function loadInitialLibrary() {
    tracks = await getAllItemsFromDB();
    renderPlaylist();
    if (!tracks.length) return;
    const lastTrackId = Number(localStorage.getItem('lector_lastTrackId'));
    const lastTime = Number(localStorage.getItem('lector_lastTime')) || 0;
    const savedIndex = tracks.findIndex((t) => t.id === lastTrackId);
    loadTrack(savedIndex >= 0 ? savedIndex : 0, lastTime);
}

/* ----------------------------- Importar ------------------------------- */
function base64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/mpeg' });
}

function looksLikeLectura(file) {
    return /\.(lectura|json)$/i.test(file.name);
}

function isAudioFile(file) {
    return file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name);
}

async function importLectura(file) {
    const bundle = JSON.parse(await file.text());
    if (!bundle.audio_b64 || !Array.isArray(bundle.frases)) {
        throw new Error('Archivo de lectura no válido');
    }
    const blob = base64ToBlob(bundle.audio_b64, bundle.audio_mime);
    const name = bundle.titulo || file.name.replace(/\.[^/.]+$/, '');
    const record = { kind: 'lectura', name, sentences: bundle.frases, duration: bundle.duracion || 0, data: blob };
    if (isDuplicate(record)) return 'skipped';
    await saveItemToDB(record);
    return 'added';
}

async function importAudio(file) {
    const record = {
        kind: 'audio', name: file.name, type: file.type,
        size: file.size, lastModified: file.lastModified, data: file
    };
    if (isDuplicate(record)) return 'skipped';
    await saveItemToDB(record);
    return 'added';
}

fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    let added = 0, skipped = 0, failed = 0;
    showStatus('Importando…');

    for (const file of files) {
        try {
            let result;
            if (looksLikeLectura(file)) result = await importLectura(file);
            else if (isAudioFile(file)) result = await importAudio(file);
            else { skipped += 1; continue; }
            if (result === 'added') added += 1; else skipped += 1;
        } catch (error) {
            console.error('Import failed:', error);
            failed += 1;
        }
    }

    await refreshLibrary();
    if (currentTrackIndex === -1 && tracks.length) loadTrack(0);
    const result = `${added} importado${added === 1 ? '' : 's'}`
        + `${skipped ? `, ${skipped} omitido${skipped === 1 ? '' : 's'}` : ''}`
        + `${failed ? `, ${failed} con error` : ''}.`;
    showStatus(result, failed > 0);
    fileInput.value = '';
});

/* --------------------------- Media Session ---------------------------- */
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
        play: playCurrent,
        pause: () => audioPlayer.pause(),
        previoustrack: playPrev,
        nexttrack: () => playNext(),
        seekbackward: (d) => skipTime(-(d.seekOffset || 15)),
        seekforward: (d) => skipTime(d.seekOffset || 15),
        seekto: (d) => { if (Number.isFinite(d.seekTime)) { audioPlayer.currentTime = d.seekTime; updateReaderHighlight(); } }
    };
    Object.entries(handlers).forEach(([action, handler]) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* no soportado */ }
    });
}

/* ------------------------------ Eventos ------------------------------- */
playPauseBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', () => playNext());
prevBtn.addEventListener('click', playPrev);
rewindBtn.addEventListener('click', () => skipTime(-15));
forwardBtn.addEventListener('click', () => skipTime(15));

speedSelect.addEventListener('change', (event) => {
    audioPlayer.playbackRate = Number(event.target.value);
    localStorage.setItem('lector_speed', event.target.value);
});

let isDraggingProgressBar = false;
['pointerdown', 'touchstart'].forEach((e) => progressBar.addEventListener(e, () => { isDraggingProgressBar = true; }, { passive: true }));
['pointerup', 'pointercancel', 'touchend'].forEach((e) => progressBar.addEventListener(e, () => { isDraggingProgressBar = false; }));

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
        updateReaderHighlight();
    }
    isDraggingProgressBar = false;
});

audioPlayer.addEventListener('play', syncPlaybackUI);
audioPlayer.addEventListener('pause', () => { syncPlaybackUI(); persistCurrentPosition(); });
audioPlayer.addEventListener('timeupdate', () => {
    const current = audioPlayer.currentTime;
    const duration = audioPlayer.duration;
    if (!isDraggingProgressBar) {
        currentTimeEl.textContent = formatTime(current);
        if (Number.isFinite(duration) && duration > 0) progressBar.value = (current / duration) * 100;
    }
    updateReaderHighlight();
    if (Math.abs(current - lastSavedPosition) >= POSITION_SAVE_INTERVAL) persistCurrentPosition();
});
audioPlayer.addEventListener('ended', () => playNext(true));
audioPlayer.addEventListener('error', () => { syncPlaybackUI(); showStatus('No se pudo leer este archivo.', true); });

clearDbBtn.addEventListener('click', async () => {
    if (!confirm('¿Borrar TODA la biblioteca (audios y lecturas)?')) return;
    try {
        await clearDB();
        tracks = [];
        resetPlayer();
        localStorage.removeItem('lector_lastTrackId');
        localStorage.removeItem('lector_lastTime');
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

/* ------------------------------- Init --------------------------------- */
async function init() {
    try {
        await initDB();
        const savedSpeed = localStorage.getItem('lector_speed');
        if (savedSpeed) speedSelect.value = savedSpeed;
        audioPlayer.playbackRate = Number(speedSelect.value);
        setupMediaSession();
        await loadInitialLibrary();
        syncPlaybackUI();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch((error) => {
                console.error('Service Worker registration failed:', error);
                showStatus('Funciona, pero no se activó el modo sin conexión.', true);
            });
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        showStatus('No se pudo abrir la biblioteca local.', true);
    }
}

init();

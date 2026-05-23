// ─────────────────────────────────────────
//   Kitap Okuma Listesi – Emircan Kural
//   app.js  |  Firebase + Uygulama Mantığı
// ─────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';


// ─── Uygulama Durumu ───────────────────────────────────────────────────────────

let books = [
  {
    id: 'local-1',
    title: '1984',
    author: 'George Orwell',
    status: 'okundu',
    pages: 328,
    genre: 'Distopya',
    stars: 5,
    date: Date.now() - 86400000 * 10,
  },
  {
    id: 'local-2',
    title: 'Dune',
    author: 'Frank Herbert',
    status: 'okunuyor',
    pages: 688,
    genre: 'Bilim Kurgu',
    stars: 0,
    date: Date.now() - 86400000 * 3,
  },
  {
    id: 'local-3',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    status: 'listede',
    pages: 443,
    genre: 'Tarih',
    stars: 0,
    date: Date.now(),
  },
];

let activeFilter = 'hepsi';
let firebaseApp   = null;
let db           = null;
let auth         = null;
let currentUser  = null;
let authMode     = 'login';
let unsubscribe  = null;
let useFirebase  = false;
let demoSession  = false;
let nextLocalId  = 4;

const FIREBASE_CONFIG_STORAGE_KEY = 'bookPanelFirebaseConfig';
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBDBi1d_YlHZNy3OmgbPljMPJLrmRveegM',
  authDomain: 'bulut-tabanli-kitap-okuma.firebaseapp.com',
  projectId: 'bulut-tabanli-kitap-okuma',
  appId: '1:683576486187:web:4cf1c40a573dea78b47d6e',
};
const FIREBASE_FIELD_IDS = {
  apiKey: ['app-fb-apiKey', 'fb-apiKey'],
  projectId: ['app-fb-projectId', 'fb-projectId'],
  appId: ['app-fb-appId', 'fb-appId'],
  authDomain: ['app-fb-authDomain', 'fb-authDomain'],
};

// Kitap sırtusu arka plan rengi ve emoji haritası
const SPINE_MAP = {
  listede:  { bg: '#FEF9EE', emoji: '📋' },
  okunuyor: { bg: '#EFF6FF', emoji: '📖' },
  okundu:   { bg: '#F0FBF4', emoji: '✅' },
};


// ─── Firebase Bağlantısı ───────────────────────────────────────────────────────

function readFirebaseField(name) {
  return FIREBASE_FIELD_IDS[name]
    .map((id) => document.getElementById(id)?.value.trim() || '')
    .find(Boolean) || '';
}

function setFirebaseField(name, value) {
  FIREBASE_FIELD_IDS[name].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = value || '';
  });
}

function readFirebaseConfigFromForm() {
  const projectId = readFirebaseField('projectId');

  return {
    apiKey: readFirebaseField('apiKey'),
    projectId,
    appId: readFirebaseField('appId'),
    authDomain: readFirebaseField('authDomain') || (projectId ? `${projectId}.firebaseapp.com` : ''),
  };
}

function fillFirebaseConfigForm(config) {
  Object.keys(FIREBASE_FIELD_IDS).forEach((key) => setFirebaseField(key, config?.[key] || ''));
}

function getSavedFirebaseConfig() {
  try {
    return JSON.parse(localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY) || 'null') || DEFAULT_FIREBASE_CONFIG;
  } catch {
    return DEFAULT_FIREBASE_CONFIG;
  }
}

function saveFirebaseConfig(config) {
  localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function hideFirebaseConfigPanels() {
  document.getElementById('config-section')?.classList.add('is-hidden');
  document.querySelector('.app-config')?.classList.add('is-hidden');
}

window.connectFirebase = async function () {
  const config = readFirebaseConfigFromForm();

  if (!config.apiKey || !config.projectId || !config.appId) {
    showToast('apiKey, projectId ve appId zorunlu.');
    return;
  }

  setStatus('connecting');

  try {
    firebaseApp = firebaseApp || initializeApp(config);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    bindAuthListener();
    saveFirebaseConfig(config);
    fillFirebaseConfigForm(config);

    useFirebase = true;
    setStatus('connected');
    hideFirebaseConfigPanels();
    showToast('Firebase bağlandı. Şimdi giriş yapabilirsin.');
  } catch (e) {
    setStatus('error');
    showToast('Bağlantı başarısız: ' + e.message);
  }
};

async function connectFirebaseFromSavedConfig() {
  const config = getSavedFirebaseConfig();
  if (!config?.apiKey || !config?.projectId || !config?.appId) return;

  fillFirebaseConfigForm(config);

  try {
    firebaseApp = firebaseApp || initializeApp(config);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    bindAuthListener();
    useFirebase = true;
    setStatus('connected');
    hideFirebaseConfigPanels();
  } catch (e) {
    setStatus('error');
    console.error('Kaydedilen Firebase ayarlari yuklenemedi:', e);
  }
}

function bindAuthListener() {
  if (!auth || auth._booksAuthBound) return;

  auth._booksAuthBound = true;
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    demoSession = false;

    if (user) {
      openApp(user.email || 'Firebase kullanıcı');
      startBooksListener();
    } else {
      stopBooksListener();
      showAuthScreen();
    }
  });
}

function startBooksListener() {
  if (!db || !currentUser) return;
  stopBooksListener();

  const colRef = collection(db, 'users', currentUser.uid, 'books');
  unsubscribe = onSnapshot(
    colRef,
    (snap) => {
      books = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        date: d.data().date?.toMillis?.() || Date.now(),
      }));
      render();
      updateStats();
    },
    (err) => {
      console.error(err);
      setStatus('error');
      showToast('Firestore bağlantı hatası: ' + err.message);
    }
  );
}

function stopBooksListener() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function bookCollectionRef() {
  if (currentUser) {
    return collection(db, 'users', currentUser.uid, 'books');
  }

  return collection(db, 'books');
}

function bookDocRef(id) {
  if (currentUser) {
    return doc(db, 'users', currentUser.uid, 'books', id);
  }

  return doc(db, 'books', id);
}

function openApp(label) {
  document.getElementById('auth-screen').classList.add('is-hidden');
  document.getElementById('app-shell').classList.remove('is-hidden');
  document.getElementById('user-chip').textContent = label;
  render();
  updateStats();
}

function showAuthScreen() {
  if (demoSession) return;
  document.getElementById('auth-screen').classList.remove('is-hidden');
  document.getElementById('app-shell').classList.add('is-hidden');
}

window.setAuthMode = function (mode) {
  authMode = mode;
  const isRegister = mode === 'register';

  document.getElementById('login-tab').classList.toggle('active', !isRegister);
  document.getElementById('register-tab').classList.toggle('active', isRegister);
  document.getElementById('auth-title').textContent = isRegister ? 'Kayıt ol' : 'Giriş yap';
  document.getElementById('auth-copy').textContent = isRegister
    ? 'Yeni hesabını oluştur, kitaplarını kendi bulut listende sakla.'
    : 'Firebase bağlantını yap, ardından hesabınla kitap paneline gir.';
  document.getElementById('auth-submit').textContent = isRegister ? 'Kayıt ol' : 'Giriş yap';
  document.getElementById('auth-password').autocomplete = isRegister ? 'new-password' : 'current-password';
};

window.submitAuth = async function () {
  if (!auth) {
    showToast('Önce Firebase bağlantısını yapmalısın.');
    return;
  }

  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  if (!email || password.length < 6) {
    showToast('E-posta ve en az 6 karakter şifre gir.');
    return;
  }

  const btn = document.getElementById('auth-submit');
  btn.disabled = true;
  btn.textContent = authMode === 'register' ? 'Kaydediliyor...' : 'Giriş yapılıyor...';

  try {
    if (authMode === 'register') {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast('Kayıt oluşturuldu.');
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Giriş başarılı.');
    }
  } catch (e) {
    showToast(readableAuthError(e.code || e.message));
  }

  btn.disabled = false;
  btn.textContent = authMode === 'register' ? 'Kayıt ol' : 'Giriş yap';
};

window.continueLocalDemo = function () {
  demoSession = true;
  currentUser = null;
  useFirebase = false;
  setStatus('disconnected');
  openApp('Firebase olmadan demo');
};

window.logoutUser = async function () {
  stopBooksListener();

  if (auth && currentUser) {
    await signOut(auth);
    showToast('Çıkış yapıldı.');
    return;
  }

  demoSession = false;
  showAuthScreen();
};

function readableAuthError(code) {
  const map = {
    'auth/email-already-in-use': 'Bu e-posta ile kayıt zaten var.',
    'auth/invalid-email': 'E-posta adresi geçerli değil.',
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/operation-not-allowed': 'Firebase Authentication içinde Email/Password sağlayıcısını açmalısın.',
  };

  return map[code] || ('Auth hatası: ' + code);
}

/**
 * Firebase bağlantı durumu göstergesini günceller.
 * @param {'connecting'|'connected'|'disconnected'|'error'} state
 */
function setStatus(state) {
  const el = document.getElementById('fb-status');
  const map = {
    connecting:   ['disconnected', '⏳ Bağlanıyor...'],
    connected:    ['connected',    '☁️ Firebase bağlı – Gerçek zamanlı senkronizasyon aktif'],
    disconnected: ['disconnected', '💾 Yerel mod – Firebase bağlı değil'],
    error:        ['error',        '❌ Firebase bağlantı hatası'],
  };
  const [cls, txt] = map[state];
  el.className = 'fb-status ' + cls;
  el.innerHTML = `<span class="dot"></span> ${txt}`;
}


// ─── Kitap CRUD İşlemleri ──────────────────────────────────────────────────────

/** Yeni kitap ekler (Firebase veya yerel). */
window.addBook = async function () {
  const title = document.getElementById('inp-title').value.trim();

  if (!title) {
    document.getElementById('inp-title').focus();
    showToast('📚 Kitap adı zorunlu!');
    return;
  }

  const book = {
    title,
    author: document.getElementById('inp-author').value.trim() || 'Bilinmiyor',
    status: document.getElementById('inp-status').value,
    pages:  parseInt(document.getElementById('inp-pages').value) || 0,
    genre:  document.getElementById('inp-genre').value.trim() || '',
    cover:  pendingCover,   // Google Books kapak URL'i (yoksa boş string)
    stars:  0,
    date:   Date.now(),
  };

  // Butonu yükleniyor moduna al
  const btn = document.getElementById('add-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ekleniyor...';

  try {
    if (useFirebase && db) {
      await addDoc(bookCollectionRef(), { ...book, date: serverTimestamp() });
      showToast("☁️ Kitap Firebase'e kaydedildi!");
    } else {
      book.id = 'local-' + nextLocalId++;
      books.unshift(book);
      render();
      updateStats();
      showToast('💾 Kitap yerel olarak eklendi.');
    }
  } catch (e) {
    showToast('❌ Hata: ' + e.message);
  }

  // Formu ve butonu sıfırla
  btn.disabled = false;
  btn.innerHTML = '+ Kitap Ekle';
  resetBookForm({ showMessage: false });
};

window.resetBookForm = function ({ showMessage = true } = {}) {
  ['inp-title', 'inp-author', 'inp-pages', 'inp-genre'].forEach(
    (id) => (document.getElementById(id).value = '')
  );
  document.getElementById('inp-status').value = 'listede';
  pendingCover = '';
  hideSuggestions();

  if (showMessage) {
    showToast('Form sıfırlandı.');
  }
};

/**
 * Kitabın durumunu değiştirir.
 * @param {string} id
 * @param {string} newStatus
 */
window.changeStatus = async function (id, newStatus) {
  if (useFirebase && db) {
    await updateDoc(bookDocRef(id), { status: newStatus });
  } else {
    const book = books.find((b) => b.id === id);
    if (book) {
      book.status = newStatus;
      render();
      updateStats();
    }
  }
};

/**
 * Kitabı siler.
 * @param {string} id
 */
window.deleteBook = async function (id) {
  if (!confirm('Bu kitabı silmek istediğine emin misin?')) return;

  if (useFirebase && db) {
    await deleteDoc(bookDocRef(id));
    showToast('🗑️ Kitap silindi.');
  } else {
    books = books.filter((b) => b.id !== id);
    render();
    updateStats();
    showToast('🗑️ Kitap silindi.');
  }
};

/**
 * Kitaba yıldız puanı verir.
 * @param {string} id
 * @param {number} n  1–5 arası puan
 */
window.setStars = async function (id, n) {
  if (useFirebase && db) {
    await updateDoc(bookDocRef(id), { stars: n });
  } else {
    const book = books.find((b) => b.id === id);
    if (book) {
      book.stars = n;
      render();
    }
  }
};


// ─── Filtreleme ────────────────────────────────────────────────────────────────

/**
 * Aktif filtre düğmesini değiştirir.
 * @param {HTMLElement} btn
 */
window.setFilter = function (btn) {
  activeFilter = btn.dataset.filter;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  render();
};


// ─── Arayüz Render ────────────────────────────────────────────────────────────

/** Kitap listesini ve istatistikleri yeniden çizer. */
window.render = function () {
  const search = (document.getElementById('search')?.value || '').toLowerCase();
  const sortBy = document.getElementById('sort-by')?.value || 'date';

  // Filtrele ve ara
  let list = books.filter((b) => {
    const matchFilter = activeFilter === 'hepsi' || b.status === activeFilter;
    const matchSearch =
      !search ||
      b.title.toLowerCase().includes(search) ||
      b.author.toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  // Sırala
  list.sort((a, b) => {
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'tr');
    if (sortBy === 'pages') return (b.pages || 0) - (a.pages || 0);
    return (b.date || 0) - (a.date || 0); // varsayılan: en yeni
  });

  const el = document.getElementById('book-list');

  if (list.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📚</div>
        <p>Henüz kitap yok. Yukarıdan ekleyebilirsin!</p>
      </div>`;
    return;
  }

  el.innerHTML = list.map((b) => buildBookCard(b)).join('');
};

/**
 * Tek bir kitap kartının HTML'ini üretir.
 * @param {object} b  Kitap nesnesi
 * @returns {string}
 */
function buildBookCard(b) {
  const { bg, emoji } = SPINE_MAP[b.status] || { bg: '#f5f5f5', emoji: '📖' };

  // Kapak: Google Books'tan geldiyse gerçek görsel, yoksa emoji
  const spineHTML = b.cover
    ? `<div class="book-spine book-spine--cover">
         <img src="${b.cover}" alt="${b.title}" loading="lazy"
              onerror="this.parentElement.innerHTML='${emoji}'; this.parentElement.style.background='${bg}';" />
       </div>`
    : `<div class="book-spine" style="background: ${bg}">${emoji}</div>`;

  // Yıldızlar
  const starsHTML = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<span class="star ${n <= (b.stars || 0) ? 'lit' : ''}"
               onclick="setStars('${b.id}', ${n})">★</span>`
    )
    .join('');

  // Tarih
  const dateStr = b.date
    ? new Date(b.date).toLocaleDateString('tr-TR', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : '';

  // İlerleme çubuğu (sadece "okunuyor" kitaplar için)
  const progressHTML =
    b.status === 'okunuyor' && b.pages
      ? `<div class="progress-wrap">
           <div class="progress-label">
             <span>İlerleme</span><span>Okunuyor...</span>
           </div>
           <div class="progress-bar">
             <div class="progress-fill" style="width: 45%"></div>
           </div>
         </div>`
      : '';

  const statusLabel = { listede: 'Listede', okunuyor: 'Okunuyor', okundu: 'Okundu' };

  return `
    <div class="book-card">
      ${spineHTML}

      <div class="book-body">
        <div class="book-title-text">${b.title}</div>
        <div class="book-author-text">${b.author}</div>
        ${b.genre ? `<div class="book-genre">${b.genre}</div>` : ''}
        <div class="book-meta-row">
          <span class="status-badge status-${b.status}">${statusLabel[b.status]}</span>
          ${b.pages ? `<span class="pages-text">${b.pages} sayfa</span>` : ''}
          <div class="stars">${starsHTML}</div>
        </div>
        ${progressHTML}
      </div>

      <div class="book-actions">
        <select class="action-select" onchange="changeStatus('${b.id}', this.value)">
          <option value="listede"  ${b.status === 'listede'  ? 'selected' : ''}>Listede</option>
          <option value="okunuyor" ${b.status === 'okunuyor' ? 'selected' : ''}>Okunuyor</option>
          <option value="okundu"   ${b.status === 'okundu'   ? 'selected' : ''}>Okundu</option>
        </select>
        <button class="del-btn" onclick="deleteBook('${b.id}')">Sil</button>
        ${dateStr ? `<span class="date-text">${dateStr}</span>` : ''}
      </div>
    </div>`;
}


// ─── İstatistik Güncelleme ────────────────────────────────────────────────────

/** Üstteki istatistik kartlarını günceller. */
function updateStats() {
  document.getElementById('s-total').textContent   = books.length;
  document.getElementById('s-read').textContent    = books.filter((b) => b.status === 'okundu').length;
  document.getElementById('s-reading').textContent = books.filter((b) => b.status === 'okunuyor').length;
  document.getElementById('s-pages').textContent   = books
    .filter((b) => b.status === 'okundu')
    .reduce((sum, b) => sum + (b.pages || 0), 0)
    .toLocaleString('tr');
}


// ─── Toast Bildirimi ──────────────────────────────────────────────────────────

/**
 * Ekranın sağ altında geçici bildirim gösterir.
 * @param {string} msg
 */
window.showToast = function (msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
};


// ─── Google Books Autocomplete ────────────────────────────────────────────────

const BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_API = 'https://openlibrary.org/search.json';

let searchTimer   = null;   // debounce zamanlayıcısı
let focusedIndex  = -1;     // klavye navigasyon indeksi
let suggestionList = [];    // anlık öneri listesi

const GENRE_KEYWORDS = [
  { genre: 'Bilim Kurgu', keywords: ['science fiction', 'sci-fi', 'bilim kurgu'] },
  { genre: 'Fantastik', keywords: ['fantasy', 'fantastik'] },
  { genre: 'Distopya', keywords: ['dystopia', 'dystopian', 'distopya'] },
  { genre: 'Polisiye', keywords: ['detective', 'mystery', 'crime', 'thriller', 'polisiye'] },
  { genre: 'Korku', keywords: ['horror', 'korku'] },
  { genre: 'Romantik', keywords: ['romance', 'love story', 'romantik'] },
  { genre: 'Tarih', keywords: ['history', 'historical', 'tarih'] },
  { genre: 'Biyografi', keywords: ['biography', 'autobiography', 'memoir', 'biyografi'] },
  { genre: 'Kişisel Gelişim', keywords: ['self-help', 'personal development', 'kişisel gelişim'] },
  { genre: 'Psikoloji', keywords: ['psychology', 'psikoloji'] },
  { genre: 'Felsefe', keywords: ['philosophy', 'felsefe'] },
  { genre: 'Şiir', keywords: ['poetry', 'poem', 'şiir'] },
  { genre: 'Tiyatro', keywords: ['drama', 'plays', 'theater', 'theatre', 'tiyatro'] },
  { genre: 'Çocuk', keywords: ['children', 'juvenile', 'kids', 'çocuk'] },
  { genre: 'Eğitim', keywords: ['education', 'study', 'textbook', 'eğitim'] },
  { genre: 'İş', keywords: ['business', 'management', 'economics', 'işletme'] },
  { genre: 'Din', keywords: ['religion', 'spirituality', 'din'] },
  { genre: 'Mizah', keywords: ['humor', 'comedy', 'mizah'] },
  { genre: 'Çizgi Roman', keywords: ['comics', 'graphic novel', 'çizgi roman'] },
  { genre: 'Roman', keywords: ['fiction', 'novel', 'literature', 'roman'] },
];

/**
 * Kitap adı inputu her değiştiğinde çağrılır.
 * 350 ms debounce ile Google Books API'ye istek atar.
 * @param {string} val
 */
window.onTitleInput = function (val) {
  clearTimeout(searchTimer);
  focusedIndex = -1;

  if (val.trim().length < 2) {
    hideSuggestions();
    return;
  }

  showSuggestionsLoading();

  searchTimer = setTimeout(() => fetchSuggestions(val.trim()), 350);
};

/**
 * Google Books API'den önerileri çeker.
 * @param {string} query
 */
async function fetchSuggestions(query) {
  try {
    suggestionList = await fetchGoogleBooksSuggestions(query);
    if (!suggestionList.length) {
      suggestionList = await fetchOpenLibrarySuggestions(query);
    }
  } catch (e) {
    try {
      suggestionList = await fetchOpenLibrarySuggestions(query);
    } catch (fallbackError) {
      suggestionList = [];
      console.error('Kitap önerileri alınamadı:', fallbackError);
    }
  }

  renderSuggestions();
}

async function fetchGoogleBooksSuggestions(query) {
  const url = `${BOOKS_API}?q=${encodeURIComponent(query)}&langRestrict=tr&maxResults=8&fields=items(id,volumeInfo)`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Google Books API hatası: ${res.status}`);
  }

  const data = await res.json();

  return (data.items || []).map((item) => {
    const v = item.volumeInfo || {};
    const categories = v.categories || [];
    return {
      title:     v.title || '',
      authors:   (v.authors || []).join(', ') || 'Bilinmiyor',
      pages:     v.pageCount || 0,
      genre:     normalizeGenre(categories),
      cover:     v.imageLinks?.thumbnail?.replace('http://', 'https://') || '',
      published: v.publishedDate ? v.publishedDate.slice(0, 4) : '',
    };
  }).filter((b) => b.title);
}

async function fetchOpenLibrarySuggestions(query) {
  const params = new URLSearchParams({
    title: query,
    limit: '8',
    fields: 'title,author_name,number_of_pages_median,subject,cover_i,first_publish_year',
  });
  const res = await fetch(`${OPEN_LIBRARY_API}?${params}`);

  if (!res.ok) {
    throw new Error(`Open Library API hatası: ${res.status}`);
  }

  const data = await res.json();

  return (data.docs || []).map((book) => {
    const subjects = Array.isArray(book.subject) ? book.subject : [];
    return {
      title:     book.title || '',
      authors:   (book.author_name || []).join(', ') || 'Bilinmiyor',
      pages:     book.number_of_pages_median || 0,
      genre:     normalizeGenre(subjects),
      cover:     book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : '',
      published: book.first_publish_year ? String(book.first_publish_year) : '',
    };
  }).filter((b) => b.title);
}

function normalizeGenre(values) {
  const categories = (values || []).filter(Boolean);
  const text = categories.join(' ').toLocaleLowerCase('tr');
  const match = GENRE_KEYWORDS.find((item) =>
    item.keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase('tr')))
  );

  if (match) return match.genre;
  return cleanGenreName(categories[0] || '');
}

function cleanGenreName(value) {
  return value
    .split(/[>/]/)
    .pop()
    .replace(/\s*&\s*/g, ' ve ')
    .trim();
}

/** Öneri listesini DOM'a çizer. */
function renderSuggestions() {
  const box = document.getElementById('suggestions');

  if (!suggestionList.length) {
    box.innerHTML = '<div class="suggestion-empty">📭 Sonuç bulunamadı</div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = suggestionList.map((b, i) => {
    const coverHTML = b.cover
      ? `<img class="suggestion-cover" src="${b.cover}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="suggestion-cover-placeholder">📖</div>`;

    const metaParts = [];
    if (b.pages)     metaParts.push(`${b.pages} sayfa`);
    if (b.published) metaParts.push(b.published);
    if (b.genre)     metaParts.push(b.genre.split(',')[0]);

    const metaHTML = metaParts.length
      ? `<div class="suggestion-meta">${metaParts.map((p) => `<span>${p}</span>`).join('')}</div>`
      : '';

    return `
      <div class="suggestion-item" data-index="${i}"
           onclick="selectSuggestion(${i})"
           onmouseenter="setFocus(${i})">
        ${coverHTML}
        <div class="suggestion-info">
          <div class="suggestion-title">${b.title}</div>
          <div class="suggestion-author">${b.authors}</div>
          ${metaHTML}
        </div>
      </div>`;
  }).join('');

  box.style.display = 'block';
}

/** Yükleniyor göstergesi. */
function showSuggestionsLoading() {
  const box = document.getElementById('suggestions');
  box.innerHTML = '<div class="suggestion-loading"><span class="spinner"></span> Aranıyor...</div>';
  box.style.display = 'block';
}

/** Öneri kutusunu gizler. */
function hideSuggestions() {
  const box = document.getElementById('suggestions');
  box.style.display = 'none';
  box.innerHTML     = '';
  suggestionList    = [];
  focusedIndex      = -1;
}

/**
 * Bir öneri seçilince formu doldurur.
 * @param {number} index
 */
// Google Books'tan seçilen kitabın kapak URL'ini geçici saklarız
let pendingCover = '';

window.selectSuggestion = function (index) {
  const book = suggestionList[index];
  if (!book) return;

  document.getElementById('inp-title').value  = book.title;
  document.getElementById('inp-author').value = book.authors;
  if (book.pages) document.getElementById('inp-pages').value = book.pages;
  if (book.genre) document.getElementById('inp-genre').value = book.genre.split(',')[0].trim();

  // Kapağı daha sonra addBook'ta kullanmak üzere sakla
  pendingCover = book.cover || '';

  hideSuggestions();
  showToast(`✅ "${book.title}" seçildi – Ekle butonuna bas!`);
};

/**
 * Klavye ile öneri navigasyonu (↑ ↓ Enter Escape).
 * @param {KeyboardEvent} e
 */
window.onTitleKeydown = function (e) {
  const items = document.querySelectorAll('.suggestion-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
    updateFocusedItem(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedIndex = Math.max(focusedIndex - 1, 0);
    updateFocusedItem(items);
  } else if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    selectSuggestion(focusedIndex);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
};

/**
 * Odaklanmış öneri öğesini görsel olarak işaretler.
 * @param {NodeList} items
 */
function updateFocusedItem(items) {
  items.forEach((el, i) => {
    el.classList.toggle('focused', i === focusedIndex);
  });
}

/**
 * Mouse hover ile odak değiştirme.
 * @param {number} i
 */
window.setFocus = function (i) {
  focusedIndex = i;
  updateFocusedItem(document.querySelectorAll('.suggestion-item'));
};

// Öneri kutusu dışına tıklanınca kapat
document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-wrap')) hideSuggestions();
});

fillFirebaseConfigForm(getSavedFirebaseConfig());
connectFirebaseFromSavedConfig();

// ─── Başlangıç Render ─────────────────────────────────────────────────────────

render();
updateStats();

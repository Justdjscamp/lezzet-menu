// Lezzet Cafe - Serverless GitHub Admin CRM
// Reads & commits menu.json and WebP images directly to GitHub via REST API

let state = {
  repo: localStorage.getItem('lezzet_gh_repo') || '',
  token: localStorage.getItem('lezzet_gh_token') || '',
  branch: localStorage.getItem('lezzet_gh_branch') || 'main',
  menuSha: null,
  version: '1',
  categories: [],
  dishes: [],
  files: [],
  activeCategory: 'all',
  searchQuery: '',
  currentTab: 'dishes',
  activeLang: 'ru'
};

// Local preview URLs for newly uploaded images before GitHub Pages CDN updates
const localImagePreviews = new Map();

// --- DOM References ---
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const loginRepo = document.getElementById('loginRepo');
const loginToken = document.getElementById('loginToken');
const loginBranch = document.getElementById('loginBranch');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const headerActionBtn = document.getElementById('headerActionBtn');
const currentVersionBadge = document.getElementById('currentVersionBadge');
const mobileVersionBadge = document.getElementById('mobileVersionBadge');

const dishSearchInput = document.getElementById('dishSearchInput');
const categoryFilterBar = document.getElementById('categoryFilterBar');
const dishesGrid = document.getElementById('dishesGrid');
const categoriesGrid = document.getElementById('categoriesGrid');

const dishModal = document.getElementById('dishModal');
const dishForm = document.getElementById('dishForm');
const dishModalTitle = document.getElementById('dishModalTitle');
const dishDropzone = document.getElementById('dishDropzone');
const dishFileInput = document.getElementById('dishFileInput');
const dishDropzonePreview = document.getElementById('dishDropzonePreview');
const dishDropzoneContent = document.getElementById('dishDropzoneContent');

const categoryModal = document.getElementById('categoryModal');
const categoryForm = document.getElementById('categoryForm');
const categoryModalTitle = document.getElementById('categoryModalTitle');
const catDropzone = document.getElementById('catDropzone');
const catFileInput = document.getElementById('catFileInput');
const catDropzonePreview = document.getElementById('catDropzonePreview');
const catDropzoneContent = document.getElementById('catDropzoneContent');

const toastEl = document.getElementById('adminToast');

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `admin-toast show ${type}`;
  clearTimeout(window._adminToastTimer);
  window._adminToastTimer = setTimeout(() => {
    toastEl.className = 'admin-toast hidden';
  }, 3500);
}

// Auto-detect owner/repo when hosted on GitHub Pages
function detectGitHubRepo() {
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length > 0) return `${owner}/${parts[0]}`;
  }
  return '';
}

function getImageSrc(filename) {
  if (!filename) return './uploads/logo.webp';
  if (localImagePreviews.has(filename)) return localImagePreviews.get(filename);
  return `./uploads/${encodeURIComponent(filename)}`;
}

// --- Base64 UTF-8 Helpers ---
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// --- GitHub API ---
async function ghApi(path, options = {}) {
  const url = `https://api.github.com/repos/${state.repo}/contents/${path}${options.method === 'GET' || !options.method ? `?ref=${encodeURIComponent(state.branch)}&t=${Date.now()}` : ''}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${state.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `GitHub API ошибка (${res.status})`);
  }
  return data;
}

async function loadMenuFromGitHub() {
  const fileData = await ghApi('menu.json');
  state.menuSha = fileData.sha;
  const parsed = JSON.parse(base64ToUtf8(fileData.content));
  state.version = parsed.menu_version || '1';
  state.categories = parsed.categories || [];
  state.dishes = parsed.dishes || [];
  state.files = parsed.files || [];

  currentVersionBadge.textContent = `#${state.version}`;
  if (mobileVersionBadge) mobileVersionBadge.textContent = `#${state.version}`;

  const repoInfo = document.getElementById('settingsRepoInfo');
  const branchInfo = document.getElementById('settingsBranchInfo');
  if (repoInfo) repoInfo.textContent = state.repo;
  if (branchInfo) branchInfo.textContent = state.branch;

  renderCategoryFilters();
  populateCategorySelect();
  switchTab(state.currentTab || 'dishes');
}

async function commitMenuToGitHub(commitMessage) {
  state.version = Date.now().toString();
  const payloadObj = {
    menu_version: state.version,
    updated_at: new Date().toISOString(),
    categories: state.categories,
    dishes: state.dishes,
    files: buildFilesList()
  };

  const jsonStr = JSON.stringify(payloadObj, null, 2);
  const body = {
    message: commitMessage,
    content: utf8ToBase64(jsonStr),
    branch: state.branch,
    sha: state.menuSha
  };

  const res = await ghApi('menu.json', {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  if (res && res.content && res.content.sha) {
    state.menuSha = res.content.sha;
  }
  currentVersionBadge.textContent = `#${state.version}`;
  if (mobileVersionBadge) mobileVersionBadge.textContent = `#${state.version}`;
}

function buildFilesList() {
  const map = new Map();
  state.files.forEach(f => {
    if (f && f.filename) map.set(f.filename, f);
  });
  state.categories.forEach(c => {
    if (c.cover_image) {
      map.set(c.cover_image, {
        filename: c.cover_image,
        hash: c.cover_hash || map.get(c.cover_image)?.hash || '',
        url: `./uploads/${encodeURIComponent(c.cover_image)}`
      });
    }
  });
  state.dishes.forEach(d => {
    if (d.img) {
      map.set(d.img, {
        filename: d.img,
        hash: d.img_hash || map.get(d.img)?.hash || '',
        url: `./uploads/${encodeURIComponent(d.img)}`
      });
    }
  });
  return Array.from(map.values());
}

// --- Auth ---
function showLogin() {
  loginScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const btn = document.getElementById('loginSubmitBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.innerHTML = `<span class="btn-spinner"></span> Подключение...`;

  try {
    state.repo = loginRepo.value.trim();
    state.token = loginToken.value.trim();
    state.branch = loginBranch.value.trim() || 'main';

    await loadMenuFromGitHub();

    localStorage.setItem('lezzet_gh_repo', state.repo);
    localStorage.setItem('lezzet_gh_token', state.token);
    localStorage.setItem('lezzet_gh_branch', state.branch);

    showApp();
    showToast('Подключено к GitHub!');
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.innerHTML = orig;
  }
});

function handleLogout() {
  localStorage.removeItem('lezzet_gh_token');
  state.token = '';
  showLogin();
  showToast('Вы вышли', 'info');
}

logoutBtn.addEventListener('click', handleLogout);
if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);

// --- Search & Tabs ---
if (dishSearchInput) {
  dishSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderDishes();
  });
}

navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

function switchTab(tab) {
  state.currentTab = tab;
  navItems.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  tabPanes.forEach(p => p.classList.toggle('active', p.id === `tab${capitalize(tab)}`));

  if (tab === 'dishes') {
    pageTitle.textContent = 'Блюда и позиции меню';
    pageSubtitle.textContent = 'Редактирование и сохранение напрямую в GitHub (WebP)';
    headerActionBtn.style.display = 'inline-flex';
    headerActionBtn.innerHTML = `<span>+ Добавить блюдо</span>`;
    headerActionBtn.onclick = () => openDishModal(null, state.activeCategory !== 'all' ? state.activeCategory : '');
    renderDishes();
  } else if (tab === 'categories') {
    pageTitle.textContent = 'Категории меню';
    pageSubtitle.textContent = 'Управление разделами и обложками';
    headerActionBtn.style.display = 'inline-flex';
    headerActionBtn.innerHTML = `<span>+ Добавить категорию</span>`;
    headerActionBtn.onclick = () => openCategoryModal();
    renderCategories();
  } else if (tab === 'settings') {
    pageTitle.textContent = 'Настройки & Экспорт';
    pageSubtitle.textContent = 'Синхронизация с GitHub и выгрузка menu.json';
    headerActionBtn.style.display = 'none';
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// --- Filters & Render ---
function renderCategoryFilters() {
  let html = `
    <button class="cat-pill ${state.activeCategory === 'all' ? 'active' : ''}" data-cat="all">
      <span>Все позиции</span>
      <span class="count">${state.dishes.length}</span>
    </button>
  `;
  state.categories.forEach(cat => {
    const count = state.dishes.filter(d => d.category_id === cat.id).length;
    html += `
      <button class="cat-pill ${state.activeCategory === cat.id ? 'active' : ''}" data-cat="${cat.id}">
        <span>${escapeHtml(cat.name_ru)}</span>
        <span class="count">${count}</span>
      </button>
    `;
  });
  categoryFilterBar.innerHTML = html;
  categoryFilterBar.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeCategory = btn.dataset.cat;
      categoryFilterBar.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDishes();
    });
  });
}

function renderDishes() {
  let filtered = state.activeCategory === 'all'
    ? state.dishes
    : state.dishes.filter(d => d.category_id === state.activeCategory);

  if (state.searchQuery) {
    const q = state.searchQuery;
    filtered = filtered.filter(d =>
      (d.name_ru || '').toLowerCase().includes(q) ||
      (d.name_tm || '').toLowerCase().includes(q) ||
      (d.name_en || '').toLowerCase().includes(q) ||
      (d.price || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    dishesGrid.innerHTML = `
      <div class="empty-state">
        <p>${state.searchQuery ? 'По запросу «' + escapeHtml(state.searchQuery) + '» ничего не найдено' : 'В этой категории пока нет блюд'}</p>
      </div>
    `;
    return;
  }

  dishesGrid.innerHTML = filtered.map(dish => {
    const isWide = dish.size === 'wide';
    const cat = state.categories.find(c => c.id === dish.category_id);
    const catName = cat ? cat.name_ru : '';
    const imgUrl = getImageSrc(dish.img);
    const tags = Array.isArray(dish.tags) ? dish.tags : [];

    return `
      <article class="dish-admin-card ${isWide ? 'dish-admin-card-wide' : ''}" data-id="${dish.id}">
        <div class="dish-card-media">
          <img src="${imgUrl}" alt="${escapeHtml(dish.name_ru)}" loading="lazy" onerror="this.src='./uploads/logo.webp'">
          ${dish.badge ? `<span class="dish-badge">${escapeHtml(dish.badge)}</span>` : ''}
          <div class="dish-card-price">${escapeHtml(dish.price)}</div>
        </div>
        <div class="dish-card-body">
          <div class="dish-card-meta">
            <span class="dish-cat-label">${escapeHtml(catName)}</span>
            ${dish.sub ? `<span class="dish-sub-label">${escapeHtml(dish.sub)}</span>` : ''}
          </div>
          <h3 class="dish-title-ru">${escapeHtml(dish.name_ru)}</h3>
          <div class="dish-trans-peek">
            <span>🇹🇲 ${escapeHtml(dish.name_tm || '—')}</span>
            <span>🇬🇧 ${escapeHtml(dish.name_en || '—')}</span>
          </div>
          ${dish.desc_ru ? `<p class="dish-desc">${escapeHtml(dish.desc_ru)}</p>` : ''}
          ${tags.length > 0 ? `<div class="dish-tags-list">${tags.map(t => `<span class="tag-badge">${renderTagLabel(t)}</span>`).join('')}</div>` : ''}
          <div class="dish-card-actions">
            <button class="btn btn-secondary btn-sm" onclick="editDish('${dish.id}')">Изменить</button>
            <button class="btn btn-danger btn-sm" onclick="deleteDish('${dish.id}')" title="Удалить">✕</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderTagLabel(tag) {
  const map = { chef: '👑 Шеф', spicy: '🌶️ Острое', seafood: '🦐 Морепродукты', veg: '🌱 Вегетарианское', nuts: '🥜 Орехи' };
  return map[tag] || tag;
}

function renderCategories() {
  if (state.categories.length === 0) {
    categoriesGrid.innerHTML = `<div class="empty-state"><p>Категорий пока нет</p></div>`;
    return;
  }
  categoriesGrid.innerHTML = state.categories.map((cat, idx) => {
    const count = state.dishes.filter(d => d.category_id === cat.id).length;
    const coverUrl = getImageSrc(cat.cover_image);
    return `
      <div class="category-admin-card" data-id="${cat.id}">
        <div class="cat-card-cover">
          <img src="${coverUrl}" alt="${escapeHtml(cat.name_ru)}" onerror="this.src='./uploads/logo.webp'">
          <span class="cat-order-badge">№ ${idx + 1}</span>
        </div>
        <div class="cat-card-body">
          <div class="cat-card-names">
            <h4>🇷🇺 ${escapeHtml(cat.name_ru)}</h4>
            <p>🇹🇲 ${escapeHtml(cat.name_tm || '—')}</p>
            <p>🇬🇧 ${escapeHtml(cat.name_en || '—')}</p>
          </div>
          <div class="cat-card-foot">
            <span class="cat-dishes-badge">${count} блюд</span>
            <div class="cat-btn-group">
              <button class="btn btn-secondary btn-sm" onclick="editCategory('${cat.id}')">Изменить</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCategory('${cat.id}')">✕</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Client-side WebP Conversion + GitHub Upload ---
async function convertToWebP(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const MAX = 1200;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Не удалось сконвертировать в WebP'));
        const buf = await blob.arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        const hash = hashArr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
        resolve({ blob, buf, hash });
      }, 'image/webp', 0.82);
    };
    img.onerror = () => reject(new Error('Ошибка чтения изображения'));
    img.src = url;
  });
}

async function uploadImageToGitHub(file, type) {
  showToast('Конвертация в WebP и загрузка в GitHub...', 'info');
  try {
    const { blob, buf, hash } = await convertToWebP(file);
    const filename = `img_${Date.now()}_${hash.slice(0, 6)}.webp`;
    const b64 = arrayBufferToBase64(buf);

    await ghApi(`uploads/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Upload ${filename}`,
        content: b64,
        branch: state.branch
      })
    });

    const previewUrl = URL.createObjectURL(blob);
    localImagePreviews.set(filename, previewUrl);

    if (type === 'dish') {
      document.getElementById('dishImg').value = filename;
      document.getElementById('dishImgHash').value = hash;
      dishDropzonePreview.style.backgroundImage = `url('${previewUrl}')`;
      dishDropzonePreview.classList.add('has-image');
      dishDropzoneContent.style.display = 'none';
      showToast(`Фото загружено (WebP, ${Math.round(blob.size / 1024)} KB)`);
    } else {
      document.getElementById('categoryCover').value = filename;
      document.getElementById('categoryCoverHash').value = hash;
      catDropzonePreview.style.backgroundImage = `url('${previewUrl}')`;
      catDropzonePreview.classList.add('has-image');
      catDropzoneContent.style.display = 'none';
      showToast('Обложка категории загружена!');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

dishDropzone.addEventListener('click', () => dishFileInput.click());
dishFileInput.addEventListener('change', (e) => {
  if (e.target.files?.[0]) uploadImageToGitHub(e.target.files[0], 'dish');
});
catDropzone.addEventListener('click', () => catFileInput.click());
catFileInput.addEventListener('change', (e) => {
  if (e.target.files?.[0]) uploadImageToGitHub(e.target.files[0], 'category');
});

// --- Dish Modal ---
function populateCategorySelect() {
  const sel = document.getElementById('dishCategorySelect');
  sel.innerHTML = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name_ru)}</option>`).join('');
}

function openDishModal(dish = null, preselectCat = '') {
  dishForm.reset();
  document.getElementById('dishId').value = '';
  document.getElementById('dishImg').value = '';
  document.getElementById('dishImgHash').value = '';
  dishDropzonePreview.style.backgroundImage = '';
  dishDropzonePreview.classList.remove('has-image');
  dishDropzoneContent.style.display = 'flex';
  populateCategorySelect();

  if (dish) {
    dishModalTitle.textContent = 'Редактирование блюда';
    document.getElementById('dishId').value = dish.id;
    document.getElementById('dishCategorySelect').value = dish.category_id;
    document.getElementById('dishPrice').value = dish.price || '';
    document.getElementById('dishBadge').value = dish.badge || '';
    document.getElementById('dishSize').value = dish.size || 'small';
    document.getElementById('dishSub').value = dish.sub || '';
    document.getElementById('dishNameRu').value = dish.name_ru || '';
    document.getElementById('dishDescRu').value = dish.desc_ru || '';
    document.getElementById('dishNameTm').value = dish.name_tm || '';
    document.getElementById('dishDescTm').value = dish.desc_tm || '';
    document.getElementById('dishNameEn').value = dish.name_en || '';
    document.getElementById('dishDescEn').value = dish.desc_en || '';

    if (dish.img) {
      document.getElementById('dishImg').value = dish.img;
      document.getElementById('dishImgHash').value = dish.img_hash || '';
      dishDropzonePreview.style.backgroundImage = `url('${getImageSrc(dish.img)}')`;
      dishDropzonePreview.classList.add('has-image');
      dishDropzoneContent.style.display = 'none';
    }
    const tags = Array.isArray(dish.tags) ? dish.tags : [];
    document.querySelectorAll('.dish-tag-cb').forEach(cb => { cb.checked = tags.includes(cb.value); });
  } else {
    dishModalTitle.textContent = 'Новое блюдо';
    if (preselectCat) document.getElementById('dishCategorySelect').value = preselectCat;
    document.querySelectorAll('.dish-tag-cb').forEach(cb => { cb.checked = false; });
  }

  toggleDrinkSubGroup();
  switchLangTab('ru');
  dishModal.showModal();
}

window.closeDishModal = () => dishModal.close();
window.editDish = (id) => {
  const dish = state.dishes.find(d => d.id === id);
  if (dish) openDishModal(dish);
};

window.deleteDish = async (id) => {
  const dish = state.dishes.find(d => d.id === id);
  if (!dish || !confirm(`Удалить блюдо "${dish.name_ru}"?`)) return;
  const backup = [...state.dishes];
  state.dishes = state.dishes.filter(d => d.id !== id);
  try {
    await commitMenuToGitHub(`Delete dish: ${dish.name_ru}`);
    renderCategoryFilters();
    renderDishes();
    showToast(`Блюдо "${dish.name_ru}" удалено!`);
  } catch (err) {
    state.dishes = backup;
    showToast(err.message, 'error');
  }
};

document.getElementById('dishCategorySelect').addEventListener('change', toggleDrinkSubGroup);
function toggleDrinkSubGroup() {
  const cat = document.getElementById('dishCategorySelect').value;
  const catObj = state.categories.find(c => c.id === cat);
  const isDrink = cat === 'cat_bar' || cat === 'bar' || cat === 'drinks' || (catObj && catObj.name_ru === 'Напитки');
  document.getElementById('dishSubGroup').style.display = isDrink ? 'block' : 'none';
}

document.querySelectorAll('.lang-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchLangTab(btn.dataset.lang));
});
function switchLangTab(lang) {
  state.activeLang = lang;
  document.querySelectorAll('.lang-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.lang-tab-content').forEach(c => c.classList.toggle('active', c.id === `langTab_${lang}`));
}

// Dish Form Submit with Spinner Feedback
dishForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameRu = document.getElementById('dishNameRu').value.trim();
  const nameTm = document.getElementById('dishNameTm').value.trim();
  const nameEn = document.getElementById('dishNameEn').value.trim();
  if (!nameRu || !nameTm || !nameEn) {
    showToast('Заполните названия на всех 3-х языках (RU, TM, EN)!', 'error');
    return;
  }

  const submitBtn = document.getElementById('saveDishBtn');
  const origHtml = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.classList.add('btn-loading');
  submitBtn.innerHTML = `<span class="btn-spinner"></span> Сохранение...`;

  const tags = [];
  document.querySelectorAll('.dish-tag-cb:checked').forEach(cb => tags.push(cb.value));

  const existingId = document.getElementById('dishId').value;
  const dishObj = {
    id: existingId || `dish_${Date.now()}`,
    category_id: document.getElementById('dishCategorySelect').value,
    order_num: existingId ? (state.dishes.find(d => d.id === existingId)?.order_num ?? 0) : state.dishes.length,
    price: document.getElementById('dishPrice').value.trim(),
    badge: document.getElementById('dishBadge').value,
    size: document.getElementById('dishSize').value,
    sub: document.getElementById('dishSub').value,
    tags,
    name_ru: nameRu,
    desc_ru: document.getElementById('dishDescRu').value.trim(),
    name_tm: nameTm,
    desc_tm: document.getElementById('dishDescTm').value.trim(),
    name_en: nameEn,
    desc_en: document.getElementById('dishDescEn').value.trim(),
    img: document.getElementById('dishImg').value || 'logo.webp',
    img_hash: document.getElementById('dishImgHash').value || ''
  };

  const backup = [...state.dishes];
  if (existingId) {
    const idx = state.dishes.findIndex(d => d.id === existingId);
    if (idx !== -1) state.dishes[idx] = dishObj;
  } else {
    state.dishes.push(dishObj);
  }

  try {
    await commitMenuToGitHub(`${existingId ? 'Update' : 'Add'} dish: ${nameRu}`);
    submitBtn.classList.remove('btn-loading');
    submitBtn.classList.add('btn-success-state');
    submitBtn.innerHTML = `✓ Сохранено!`;

    setTimeout(() => {
      closeDishModal();
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn-success-state');
      submitBtn.innerHTML = origHtml;
      renderCategoryFilters();
      renderDishes();
      showToast('Блюдо сохранено в GitHub!');
    }, 400);
  } catch (err) {
    state.dishes = backup;
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn-loading');
    submitBtn.innerHTML = origHtml;
    showToast(err.message, 'error');
  }
});

// --- Category Modal ---
function openCategoryModal(cat = null) {
  categoryForm.reset();
  document.getElementById('categoryId').value = '';
  document.getElementById('categoryCover').value = '';
  document.getElementById('categoryCoverHash').value = '';
  catDropzonePreview.style.backgroundImage = '';
  catDropzonePreview.classList.remove('has-image');
  catDropzoneContent.style.display = 'flex';

  if (cat) {
    categoryModalTitle.textContent = 'Редактирование категории';
    document.getElementById('categoryId').value = cat.id;
    document.getElementById('catNameRu').value = cat.name_ru || '';
    document.getElementById('catNameTm').value = cat.name_tm || '';
    document.getElementById('catNameEn').value = cat.name_en || '';
    if (cat.cover_image) {
      document.getElementById('categoryCover').value = cat.cover_image;
      document.getElementById('categoryCoverHash').value = cat.cover_hash || '';
      catDropzonePreview.style.backgroundImage = `url('${getImageSrc(cat.cover_image)}')`;
      catDropzonePreview.classList.add('has-image');
      catDropzoneContent.style.display = 'none';
    }
  } else {
    categoryModalTitle.textContent = 'Новая категория';
  }
  categoryModal.showModal();
}

window.closeCategoryModal = () => categoryModal.close();
window.editCategory = (id) => {
  const cat = state.categories.find(c => c.id === id);
  if (cat) openCategoryModal(cat);
};
window.deleteCategory = async (id) => {
  const cat = state.categories.find(c => c.id === id);
  if (!cat || !confirm(`Удалить категорию "${cat.name_ru}"?`)) return;
  const backup = [...state.categories];
  state.categories = state.categories.filter(c => c.id !== id);
  try {
    await commitMenuToGitHub(`Delete category: ${cat.name_ru}`);
    renderCategories();
    renderCategoryFilters();
    showToast(`Категория "${cat.name_ru}" удалена!`);
  } catch (err) {
    state.categories = backup;
    showToast(err.message, 'error');
  }
};

categoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameRu = document.getElementById('catNameRu').value.trim();
  const nameTm = document.getElementById('catNameTm').value.trim();
  const nameEn = document.getElementById('catNameEn').value.trim();
  if (!nameRu || !nameTm || !nameEn) {
    showToast('Заполните названия категории на всех 3-х языках!', 'error');
    return;
  }

  const submitBtn = document.getElementById('saveCategoryBtn');
  const origHtml = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.classList.add('btn-loading');
  submitBtn.innerHTML = `<span class="btn-spinner"></span> Сохранение...`;

  const existingId = document.getElementById('categoryId').value;
  const catObj = {
    id: existingId || `cat_${Date.now()}`,
    order_num: existingId ? (state.categories.find(c => c.id === existingId)?.order_num ?? 0) : state.categories.length,
    name_ru: nameRu,
    name_tm: nameTm,
    name_en: nameEn,
    cover_image: document.getElementById('categoryCover').value || 'logo.webp',
    cover_hash: document.getElementById('categoryCoverHash').value || ''
  };

  const backup = [...state.categories];
  if (existingId) {
    const idx = state.categories.findIndex(c => c.id === existingId);
    if (idx !== -1) state.categories[idx] = catObj;
  } else {
    state.categories.push(catObj);
  }

  try {
    await commitMenuToGitHub(`${existingId ? 'Update' : 'Add'} category: ${nameRu}`);
    submitBtn.classList.remove('btn-loading');
    submitBtn.classList.add('btn-success-state');
    submitBtn.innerHTML = `✓ Сохранено!`;

    setTimeout(() => {
      closeCategoryModal();
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn-success-state');
      submitBtn.innerHTML = origHtml;
      renderCategories();
      renderCategoryFilters();
      populateCategorySelect();
      showToast('Категория сохранена в GitHub!');
    }, 400);
  } catch (err) {
    state.categories = backup;
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn-loading');
    submitBtn.innerHTML = origHtml;
    showToast(err.message, 'error');
  }
});

// --- Settings Actions ---
document.getElementById('refreshFromGitBtn')?.addEventListener('click', async () => {
  try {
    await loadMenuFromGitHub();
    showToast('Данные обновлены из GitHub');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('downloadMenuJsonBtn')?.addEventListener('click', () => {
  const payload = {
    menu_version: state.version,
    updated_at: new Date().toISOString(),
    categories: state.categories,
    dishes: state.dishes,
    files: buildFilesList()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `menu_${state.version}.json`;
  a.click();
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', async () => {
  const detected = detectGitHubRepo();
  if (detected && !state.repo) state.repo = detected;

  loginRepo.value = state.repo;
  loginToken.value = state.token;
  loginBranch.value = state.branch;

  if (state.repo && state.token) {
    try {
      await loadMenuFromGitHub();
      showApp();
    } catch (err) {
      showLogin();
    }
  } else {
    showLogin();
  }
});

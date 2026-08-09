const state = {
  idToken: null,
  user: null,
  products: [],
  orders: [],
  items: [],
  dashboard: null,
  selectedItems: [],
  editItems: [],
  editOrderId: null,
  orderFilter: 'Open',
  orderSort: { field: 'datum', dir: 'desc' },
  orderSearch: '',
  editingProductSku: null,
};

function applyAppName() {
  const name = (CONFIG && CONFIG.APP_NAME) || 'Orders';
  document.title = name;
  const a = document.getElementById('login-app-name');
  const b = document.getElementById('header-app-name');
  if (a) a.textContent = name;
  if (b) b.textContent = name;
}

function initGoogleLogin() {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: true,
    use_fedcm_for_prompt: true,
  });
  google.accounts.id.renderButton(document.getElementById('google-signin-button'), {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    width: 260,
  });

  const stored = loadStoredToken();
  if (stored) {
    applyToken(stored);
    showApp();
    restoreDraft();
    loadBootstrap();
  } else {
    attemptSilentLogin();
  }
  scheduleSilentRefresh();
  scheduleSilentSync();
}

function saveStoredToken(idToken) {
  try { localStorage.setItem('stb_id_token', idToken); } catch (err) { /* privé-browsen ofzo, dan negeren we het gewoon */ }
}

function clearStoredToken() {
  try { localStorage.removeItem('stb_id_token'); } catch (err) { /* niks aan te doen */ }
}

function loadStoredToken() {
  try {
    const t = localStorage.getItem('stb_id_token');
    if (!t) return null;
    const payload = decodeJwt(t);
    if (payload.exp && payload.exp * 1000 > Date.now()) return t;
    return null;
  } catch (err) {
    return null;
  }
}

function applyToken(idToken) {
  state.idToken = idToken;
  const payload = decodeJwt(idToken);
  state.user = { name: payload.name, email: payload.email, picture: payload.picture };
}

function attemptSilentLogin() {
  google.accounts.id.prompt(function (notification) {
    if (
      notification.isNotDisplayed &&
      (notification.isNotDisplayed() || notification.isSkippedMoment() || notification.isDismissedMoment())
    ) {
      if (!state.idToken) revealManualLogin();
    }
  });
}

function revealManualLogin() {
  const checking = document.getElementById('login-checking');
  const manual = document.getElementById('login-manual');
  if (checking) checking.classList.add('hidden');
  if (manual) manual.classList.remove('hidden');
}

function scheduleSilentRefresh() {
  setInterval(function () {
    if (state.idToken) {
      google.accounts.id.prompt();
    }
  }, 50 * 60 * 1000);
}

function scheduleSilentSync() {
  setInterval(function () {
    silentSync();
  }, 45 * 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') silentSync();
  });
}

function silentSync() {
  if (!state.idToken) return;
  callApi('bootstrap')
    .then(function (data) {
      state.products = (data.products || []).map(function (p) {
        return Object.assign({}, p, { SKU: String(p.SKU) });
      });
      state.orders = (data.orders || []).map(function (o) {
        return Object.assign({}, o, { OrderID: String(o.OrderID) });
      });
      state.items = (data.items || []).map(function (it) {
        return Object.assign({}, it, { OrderID: String(it.OrderID), SKU: String(it.SKU) });
      });
      state.dashboard = data.dashboard || null;

      const active = document.querySelector('.view.active');
      const activeId = active ? active.id : '';
      if (activeId === 'view-orders') renderOrders();
      if (activeId === 'view-dashboard') renderDashboard();
    })
    .catch(function () {
      // stille achtergrond-sync, geen melding tonen bij een gemiste poging
    });
}

function decodeJwt(token) {
  const payload = token.split('.')[1];
  const json = decodeURIComponent(
    atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      .split('')
      .map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join('')
  );
  return JSON.parse(json);
}

function handleCredentialResponse(response) {
  const isFirstLogin = !state.idToken;
  applyToken(response.credential);
  saveStoredToken(response.credential);
  if (isFirstLogin) {
    showApp();
    restoreDraft();
    loadBootstrap();
  }
}

function logout() {
  google.accounts.id.disableAutoSelect();
  state.idToken = null;
  state.user = null;
  clearStoredToken();
  showLogin();
}

function trySilentReauth() {
  return new Promise(function (resolve) {
    if (!window.google || !google.accounts || !google.accounts.id) { resolve(null); return; }
    google.accounts.id.prompt();
    setTimeout(function () { resolve(state.idToken); }, 600);
  });
}

function callApi(action, payload, isRetry) {
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ idToken: state.idToken, action: action, payload: payload || {} }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (res) {
      if (!res.ok) {
        const msg = String(res.error || '').toLowerCase();
        const isAuthIssue = msg.indexOf('log opnieuw') !== -1 || msg.indexOf('inloggegevens') !== -1 || msg.indexOf('niet ingelogd') !== -1;
        if (isAuthIssue && !isRetry) {
          return trySilentReauth().then(function () {
            return callApi(action, payload, true);
          });
        }
        throw new Error(res.error || 'Er ging iets mis.');
      }
      return res.data;
    });
}

function loadBootstrap(quiet) {
  if (!quiet) showSpinner('Gegevens ophalen...');
  return callApi('bootstrap')
    .then(function (data) {
      state.products = (data.products || []).map(function (p) {
        return Object.assign({}, p, { SKU: String(p.SKU) });
      });
      state.orders = (data.orders || []).map(function (o) {
        return Object.assign({}, o, { OrderID: String(o.OrderID) });
      });
      state.items = (data.items || []).map(function (it) {
        return Object.assign({}, it, { OrderID: String(it.OrderID), SKU: String(it.SKU) });
      });
      state.dashboard = data.dashboard || null;
      renderAll();
    })
    .catch(function (err) {
      toast(err.message, true);
      if (String(err.message).toLowerCase().indexOf('log opnieuw') !== -1) logout();
    })
    .finally(function () { if (!quiet) hideSpinner(); });
}

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  revealManualLogin();
}

function showApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('user-avatar').src = state.user.picture;
  switchView('new-order');
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.querySelector('.bottom-nav').classList.toggle('hidden', name === 'order-detail');
  if (name === 'orders') renderOrders();
  if (name === 'products') renderProducts();
  if (name === 'dashboard') renderDashboard();
  if (name === 'order-detail') renderOrderDetailPage();
}

function renderAll() {
  renderProductPicker('');
  renderSelectedItems();
  renderOrders();
  renderProducts();
  renderDashboard();
}

let toastTimer;
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
}

function showSpinner(msg) {
  const el = document.getElementById('spinner');
  el.textContent = msg || 'Even geduld...';
  el.classList.remove('hidden');
}
function hideSpinner() {
  document.getElementById('spinner').classList.add('hidden');
}

function getCartQtyForSku(sku) {
  const item = state.selectedItems.filter(function (i) { return i.sku === sku; })[0];
  return item ? item.aantal : 0;
}

function buildProductTileHtml(p, cartQty) {
  const remaining = Number(p.Voorraad) - cartQty;
  const low = remaining <= 3;
  const photoHtml = p.Foto
    ? '<img src="' + escapeAttr(p.Foto) + '" class="product-tile__photo">'
    : '<div class="product-tile__photo product-tile__photo--placeholder"></div>';
  const badgeHtml = cartQty > 0 ? '<span class="product-tile__badge">' + cartQty + '</span>' : '';
  const metaParts = [];
  if (p.Categorie) metaParts.push(escapeHtml(p.Categorie));
  metaParts.push('&euro;' + Number(p.Prijs).toFixed(2));
  return (
    '<div class="product-tile" data-sku="' + escapeAttr(p.SKU) + '">' +
    '<div class="product-tile__photo-wrap">' + photoHtml + badgeHtml + '</div>' +
    '<div class="product-tile__name ' + (low ? 'stock-low' : '') + '">' + escapeHtml(p.Naam) + ' (' + remaining + ')</div>' +
    '<div class="product-tile__meta">' + metaParts.join(' &middot; ') + '</div>' +
    '</div>'
  );
}

function renderProductPicker(query) {
  const list = document.getElementById('product-picker-list');
  const q = (query || '').toLowerCase();
  const filtered = state.products
    .filter(function (p) { return p.Actief; })
    .filter(function (p) {
      return !q || (p.Naam + ' ' + p.SKU + ' ' + p.Categorie).toLowerCase().indexOf(q) !== -1;
    });

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Geen producten gevonden.</div>';
    return;
  }

  list.innerHTML = filtered
    .map(function (p) { return buildProductTileHtml(p, getCartQtyForSku(p.SKU)); })
    .join('');

  list.querySelectorAll('.product-tile').forEach(function (el) {
    el.addEventListener('click', function () { addProductToOrder(el.dataset.sku); });
  });
}

function addProductToOrder(sku) {
  const product = state.products.filter(function (p) { return p.SKU === sku; })[0];
  if (!product) return;
  const existing = state.selectedItems.filter(function (i) { return i.sku === sku; })[0];
  if (existing) {
    existing.aantal++;
  } else {
    state.selectedItems.push({ sku: sku, naam: product.Naam, prijs: Number(product.Prijs), aantal: 1 });
  }
  renderSelectedItems();
  renderProductPicker(document.getElementById('product-search').value);
  saveDraft();
}

function renderSelectedItems() {
  const wrap = document.getElementById('selected-items');
  if (!state.selectedItems.length) {
    wrap.innerHTML = '<div class="empty-state">Nog geen producten toegevoegd. Tik hierboven op een product.</div>';
    updateTotal();
    return;
  }

  wrap.innerHTML = state.selectedItems
    .map(function (it, idx) {
      return (
        '<div class="selected-item">' +
        '<span class="name">' + escapeHtml(it.naam) + '</span>' +
        '<span class="qty-text" data-idx="' + idx + '">' + it.aantal + '&times;</span>' +
        '<span class="price">&euro;' + (it.prijs * it.aantal).toFixed(2) + '</span>' +
        '<button class="remove" data-idx="' + idx + '"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button>' +
        '</div>'
      );
    })
    .join('');

  wrap.querySelectorAll('.remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.selectedItems.splice(Number(btn.dataset.idx), 1);
      renderSelectedItems();
      renderProductPicker(document.getElementById('product-search').value);
      saveDraft();
    });
  });

  updateTotal();
}

function updateTotal() {
  const subtotaal = state.selectedItems.reduce(function (s, it) { return s + it.prijs * it.aantal; }, 0);
  const korting = Number(document.getElementById('input-korting').value) || 0;
  const totaal = Math.max(subtotaal - korting, 0);
  document.getElementById('order-total').textContent = '\u20ac' + totaal.toFixed(2);
}

function setStatusSegment(value) {
  document.querySelectorAll('#status-segmented button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.value === value);
  });
}

function getActiveStatus() {
  const active = document.querySelector('#status-segmented button.active');
  return active ? active.dataset.value : 'Open';
}

function normalizePostcode(pc) {
  return String(pc || '').replace(/\s+/g, '').toUpperCase();
}

function isValidPostcode(pc) {
  return /^[1-9][0-9]{3}[A-Z]{2}$/.test(normalizePostcode(pc));
}

function tryAutoFillAddress() {
  const pc = normalizePostcode(document.getElementById('input-postcode').value);
  const huisnr = document.getElementById('input-huisnummer').value.trim();
  if (!isValidPostcode(pc) || !huisnr) return;

  const params = new URLSearchParams();
  params.append('fq', 'postcode:' + pc);
  params.append('fq', 'huisnummer:' + huisnr);
  params.append('fq', 'type:adres');
  params.append('fl', 'straatnaam,woonplaatsnaam');
  params.append('rows', '1');

  fetch('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?' + params.toString())
    .then(function (r) { return r.json(); })
    .then(function (data) {
      const doc = data.response && data.response.docs && data.response.docs[0];
      if (!doc) {
        toast('Adres niet gevonden, vul handmatig in.', true);
        return;
      }
      document.getElementById('input-straat').value = doc.straatnaam + ' ' + huisnr;
      document.getElementById('input-plaats').value = doc.woonplaatsnaam;
    })
    .catch(function () {
      // stil falen: adres blijft gewoon handmatig invulbaar
    });
}

function resizeImageFile(file, maxDim) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function () {
      const img = new Image();
      img.onerror = reject;
      img.onload = function () {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round(h * (maxDim / w));
            w = maxDim;
          } else {
            w = Math.round(w * (maxDim / h));
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl.split(',')[1]);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function uploadPhotoForSku(sku, file) {
  return resizeImageFile(file, 1000).then(function (base64) {
    return callApi('uploadProductPhoto', {
      sku: sku,
      fileName: file.name,
      mimeType: 'image/jpeg',
      data: base64,
    });
  });
}

const DRAFT_KEY = 'stb_order_draft';

function saveDraft() {
  try {
    const draft = {
      voornaam: document.getElementById('input-voornaam').value,
      achternaam: document.getElementById('input-achternaam').value,
      straat: document.getElementById('input-straat').value,
      postcode: document.getElementById('input-postcode').value,
      huisnummer: document.getElementById('input-huisnummer').value,
      plaats: document.getElementById('input-plaats').value,
      notitie: document.getElementById('input-notitie').value,
      korting: document.getElementById('input-korting').value,
      status: getActiveStatus(),
      betaald: document.getElementById('toggle-betaald').checked,
      items: state.selectedItems,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    // geen opslagruimte of privé-browsen, dan negeren we het gewoon
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (err) { /* niks aan te doen */ }
}

function restoreDraft() {
  let draft;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    draft = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (!draft || !draft.items || !draft.items.length) return;

  document.getElementById('input-voornaam').value = draft.voornaam || '';
  document.getElementById('input-achternaam').value = draft.achternaam || '';
  document.getElementById('input-straat').value = draft.straat || '';
  document.getElementById('input-postcode').value = draft.postcode || '';
  document.getElementById('input-huisnummer').value = draft.huisnummer || '';
  document.getElementById('input-plaats').value = draft.plaats || '';
  document.getElementById('input-notitie').value = draft.notitie || '';
  document.getElementById('input-korting').value = draft.korting || 0;
  document.getElementById('toggle-betaald').checked = !!draft.betaald;
  setStatusSegment(draft.status || 'Open');
  state.selectedItems = draft.items;
  renderSelectedItems();
  toast('Concept-order hersteld, je was onderbroken maar niks is kwijt.');
}

function resetOrderForm() {
  document.getElementById('form-new-order').reset();
  state.selectedItems = [];
  renderSelectedItems();
  setStatusSegment('Open');
  document.getElementById('toggle-betaald').checked = false;
  document.getElementById('product-search').classList.add('hidden');
  renderProductPicker('');
  clearDraft();
}

function submitNewOrder(ev) {
  ev.preventDefault();
  if (!state.selectedItems.length) {
    toast('Voeg minstens 1 product toe.', true);
    return;
  }
  const payload = {
    voornaam: document.getElementById('input-voornaam').value.trim(),
    achternaam: document.getElementById('input-achternaam').value.trim(),
    straat: document.getElementById('input-straat').value.trim(),
    postcode: document.getElementById('input-postcode').value.trim(),
    plaats: document.getElementById('input-plaats').value.trim(),
    status: getActiveStatus(),
    betaald: document.getElementById('toggle-betaald').checked,
    korting: Number(document.getElementById('input-korting').value) || 0,
    notitie: document.getElementById('input-notitie').value.trim(),
    items: state.selectedItems.map(function (it) {
      return { sku: it.sku, naam: it.naam, prijs: it.prijs, aantal: it.aantal };
    }),
  };

  if (!payload.voornaam || !payload.achternaam) {
    toast('Vul voornaam en achternaam in.', true);
    return;
  }

  showSpinner('Order opslaan...');
  callApi('createOrder', payload)
    .then(function (result) {
      toast('Order opgeslagen!');
      resetOrderForm();
      return loadBootstrap(true).then(function () {
        openOrderDetail(result.orderId);
      });
    })
    .catch(function (err) { toast(err.message, true); })
    .finally(hideSpinner);
}

function itemsForOrder(orderId) {
  return state.items.filter(function (i) { return i.OrderID === orderId; });
}

function normalizeStatus(status) {
  if (status === 'Nieuw') return 'Open';
  if (status === 'Klaar voor verzending' || status === 'Verzonden') return 'Verzenden';
  return status;
}

function badgeClassForStatus(status) {
  const s = normalizeStatus(status);
  if (s === 'Verzenden') return 'badge-klaar';
  if (s === 'Afgerond') return 'badge-afgerond';
  return 'badge-nieuw';
}

function initialsFor(o) {
  const a = (o.Voornaam || '').charAt(0);
  const b = (o.Achternaam || '').charAt(0);
  return (a + b).toUpperCase() || '?';
}

function compareOrders(a, b, field) {
  if (field === 'naam') {
    const an = (a.Voornaam + ' ' + a.Achternaam).toLowerCase();
    const bn = (b.Voornaam + ' ' + b.Achternaam).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  if (field === 'datum') {
    return new Date(a.Datum) - new Date(b.Datum);
  }
  if (field === 'status') {
    const as = normalizeStatus(a.Status) || '';
    const bs = normalizeStatus(b.Status) || '';
    return as < bs ? -1 : as > bs ? 1 : 0;
  }
  if (field === 'bedrag') {
    return Number(a.Totaal) - Number(b.Totaal);
  }
  return 0;
}

function renderOrdersTableHeader() {
  document.querySelectorAll('.order-col').forEach(function (btn) {
    const isActive = btn.dataset.field === state.orderSort.field;
    btn.classList.toggle('sorted', isActive);
    const icon = btn.querySelector('.sort-icon');
    icon.textContent = isActive ? (state.orderSort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : '';
  });
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  const q = (state.orderSearch || '').toLowerCase();

  const filtered = state.orders
    .filter(function (o) {
      const s = normalizeStatus(o.Status);
      if (state.orderFilter === 'Afgerond') return s === 'Afgerond';
      return s === state.orderFilter;
    })
    .filter(function (o) {
      if (!q) return true;
      const haystack = (o.Voornaam + ' ' + o.Achternaam + ' ' + (o.Notitie || '')).toLowerCase();
      return haystack.indexOf(q) !== -1;
    })
    .sort(function (a, b) {
      const dir = state.orderSort.dir === 'asc' ? 1 : -1;
      return compareOrders(a, b, state.orderSort.field) * dir;
    });

  renderOrdersTableHeader();

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Geen orders gevonden.</div>';
    return;
  }

  list.innerHTML = filtered
    .map(function (o) {
      const items = itemsForOrder(o.OrderID);
      const itemCount = items.reduce(function (s, i) { return s + (Number(i.Aantal) || 0); }, 0);
      return (
        '<div class="order-row" data-id="' + escapeAttr(o.OrderID) + '">' +
        '<div class="order-row__name">' + escapeHtml(o.Voornaam) + ' ' + escapeHtml(o.Achternaam) + '</div>' +
        '<div class="order-row__bottom">' +
        '<span class="order-row__meta">' + formatDate(o.Datum) + ' &middot; ' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + '</span>' +
        '<div class="order-row__side">' +
        '<span class="badge-paid-icon ' + (o.Betaald ? 'is-paid' : 'is-unpaid') + '"><span class="material-symbols-outlined">euro</span>' + (o.Betaald ? 'Ja' : 'Nee') + '</span>' +
        '<span class="order-row__amount">&euro;' + Number(o.Totaal).toFixed(2) + '</span>' +
        '<span class="material-symbols-outlined order-row__chevron">chevron_right</span>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  list.querySelectorAll('.order-row').forEach(function (row) {
    row.addEventListener('click', function () {
      openOrderDetail(row.dataset.id);
    });
  });
}

function openOrderDetail(orderId) {
  const order = state.orders.filter(function (o) { return o.OrderID === orderId; })[0];
  if (!order) return;
  state.editOrderId = orderId;
  state.editItems = itemsForOrder(orderId).map(function (it) {
    return { sku: it.SKU, naam: it.Naam, prijs: Number(it.PrijsPerStuk), aantal: Number(it.Aantal) };
  });
  switchView('order-detail');
}

function closeOrderDetail() {
  state.editOrderId = null;
  state.editItems = [];
  switchView('orders');
}

function renderEditSelectedItemsHtml() {
  return (
    state.editItems
      .map(function (it, idx) {
        return (
          '<div class="selected-item">' +
          '<span class="name">' + escapeHtml(it.naam) + '</span>' +
          '<input type="number" min="1" value="' + it.aantal + '" data-idx="' + idx + '" class="edit-qty-input">' +
          '<span class="price">&euro;' + (it.prijs * it.aantal).toFixed(2) + '</span>' +
          '<button type="button" class="remove edit-remove-item" data-idx="' + idx + '"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button>' +
          '</div>'
        );
      })
      .join('') || '<div class="empty-state">Geen producten in deze order.</div>'
  );
}

function refreshEditPanel() {
  const content = document.getElementById('order-detail-content');
  content.querySelector('.edit-selected-items').innerHTML = renderEditSelectedItemsHtml();
  const subtotaal = state.editItems.reduce(function (s, it) { return s + it.prijs * it.aantal; }, 0);
  const korting = Number(content.querySelector('.edit-korting').value) || 0;
  const totaal = Math.max(subtotaal - korting, 0);
  content.querySelector('.edit-total').textContent = '\u20ac' + totaal.toFixed(2);
  bindEditItemRowEvents(content);
  renderEditProductPicker(content, content.querySelector('.edit-product-search').value);
}

function bindEditItemRowEvents(content) {
  content.querySelectorAll('.edit-qty-input').forEach(function (input) {
    input.addEventListener('change', function () {
      const idx = Number(input.dataset.idx);
      state.editItems[idx].aantal = Math.max(1, Number(input.value) || 1);
      refreshEditPanel();
    });
  });
  content.querySelectorAll('.edit-remove-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.editItems.splice(Number(btn.dataset.idx), 1);
      refreshEditPanel();
    });
  });
}

function renderOrderDetailPage() {
  const o = state.orders.filter(function (x) { return x.OrderID === state.editOrderId; })[0];
  const content = document.getElementById('order-detail-content');
  if (!o) {
    content.innerHTML = '<div class="empty-state">Order niet gevonden.</div>';
    return;
  }

  const itemsHtml = renderEditSelectedItemsHtml();
  const subtotaal = state.editItems.reduce(function (s, it) { return s + it.prijs * it.aantal; }, 0);
  const korting = Number(o.Korting) || 0;
  const totaal = Math.max(subtotaal - korting, 0);

  content.innerHTML =
    '<div class="card">' +
    '<h2>' + escapeHtml(o.Voornaam) + ' ' + escapeHtml(o.Achternaam) + '</h2>' +
    '<p class="order-card__meta">' + formatDate(o.Datum) + ' &middot; ' + escapeHtml(o.OrderID) + '</p>' +
    '</div>' +

    '<div class="card">' +
    '<h3>Klantgegevens</h3>' +
    '<label>Voornaam</label><input type="text" class="edit-voornaam" value="' + escapeAttr(o.Voornaam) + '">' +
    '<label>Achternaam</label><input type="text" class="edit-achternaam" value="' + escapeAttr(o.Achternaam) + '">' +
    '<label>Straat + huisnr</label><input type="text" class="edit-straat" value="' + escapeAttr(o.Straat || '') + '">' +
    '<div class="field-row">' +
    '<div><label>Postcode</label><input type="text" class="edit-postcode" value="' + escapeAttr(o.Postcode || '') + '"></div>' +
    '<div><label>Woonplaats</label><input type="text" class="edit-plaats" value="' + escapeAttr(o.Plaats || '') + '"></div>' +
    '</div>' +
    '</div>' +

    '<div class="card">' +
    '<div class="card-title-row">' +
    '<h3>Producten</h3>' +
    '<button type="button" class="btn-ghost edit-product-search-toggle" aria-label="Zoeken"><span class="material-symbols-outlined">search</span></button>' +
    '</div>' +
    '<input type="text" class="edit-product-search product-search hidden" placeholder="Zoek product om toe te voegen...">' +
    '<div class="product-grid edit-product-list"></div>' +
    '<div class="selected-items edit-selected-items">' + itemsHtml + '</div>' +
    '<div class="korting-row">' +
    '<label style="margin:0;">Korting (&euro;)</label>' +
    '<input type="number" step="0.01" min="0" class="edit-korting korting-input" value="' + korting + '">' +
    '</div>' +
    '<div class="total-row"><span>Totaal</span><span class="edit-total">&euro;' + totaal.toFixed(2) + '</span></div>' +
    '</div>' +

    '<div class="card">' +
    '<h3>Status</h3>' +
    '<div class="segmented edit-status-segmented">' +
    ['Open', 'Verzenden', 'Afgerond'].map(function (s) {
      return '<button type="button" data-value="' + s + '" class="' + (normalizeStatus(o.Status) === s ? 'active' : '') + '">' + s + '</button>';
    }).join('') +
    '</div>' +
    '<div class="toggle-row">' +
    '<label><span class="material-symbols-outlined" style="font-size:18px;">euro</span> Betaald</label>' +
    '<label class="switch"><input type="checkbox" class="edit-betaald" ' + (o.Betaald ? 'checked' : '') + '><span class="switch-track"></span></label>' +
    '</div>' +
    '<label>Notitie</label>' +
    '<textarea class="edit-notitie">' + escapeHtml(o.Notitie || '') + '</textarea>' +
    '</div>' +

    '<button type="button" id="order-detail-save" class="btn btn-primary">Wijzigingen opslaan</button>';

  bindOrderDetailEvents(o);
}

function bindOrderDetailEvents(o) {
  const content = document.getElementById('order-detail-content');

  renderEditProductPicker(content, '');
  content.querySelector('.edit-product-search').addEventListener('input', function (e) {
    renderEditProductPicker(content, e.target.value);
  });

  content.querySelector('.edit-product-search-toggle').addEventListener('click', function () {
    const input = content.querySelector('.edit-product-search');
    input.classList.toggle('hidden');
    if (!input.classList.contains('hidden')) input.focus();
  });

  bindEditItemRowEvents(content);

  content.querySelector('.edit-korting').addEventListener('input', function () {
    refreshEditPanel();
  });

  content.querySelectorAll('.edit-status-segmented button').forEach(function (b) {
    b.addEventListener('click', function () {
      content.querySelectorAll('.edit-status-segmented button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
    });
  });

  content.querySelector('.edit-betaald').addEventListener('change', function (e) {
    if (e.target.checked) {
      const active = content.querySelector('.edit-status-segmented button.active');
      if (active && active.dataset.value === 'Open') {
        content.querySelectorAll('.edit-status-segmented button').forEach(function (x) {
          x.classList.toggle('active', x.dataset.value === 'Verzenden');
        });
      }
    }
  });

  document.getElementById('order-detail-save').addEventListener('click', function () {
    const status = content.querySelector('.edit-status-segmented button.active').dataset.value;
    const betaald = content.querySelector('.edit-betaald').checked;
    const notitie = content.querySelector('.edit-notitie').value;
    const korting = Number(content.querySelector('.edit-korting').value) || 0;

    if (!state.editItems.length) {
      toast('Een order heeft minstens 1 product nodig.', true);
      return;
    }

    showSpinner('Opslaan...');
    callApi('updateOrder', {
      orderId: o.OrderID,
      Status: status,
      Betaald: betaald,
      Notitie: notitie,
      Voornaam: content.querySelector('.edit-voornaam').value.trim(),
      Achternaam: content.querySelector('.edit-achternaam').value.trim(),
      Straat: content.querySelector('.edit-straat').value.trim(),
      Postcode: content.querySelector('.edit-postcode').value.trim(),
      Plaats: content.querySelector('.edit-plaats').value.trim(),
      korting: korting,
      items: state.editItems.map(function (it) {
        return { sku: it.sku, naam: it.naam, prijs: it.prijs, aantal: it.aantal };
      }),
    })
      .then(function () {
        toast('Order bijgewerkt.');
        closeOrderDetail();
        loadBootstrap(true);
      })
      .catch(function (err) { toast(err.message, true); })
      .finally(hideSpinner);
  });
}

function getEditCartQtyForSku(sku) {
  const item = state.editItems.filter(function (i) { return i.sku === sku; })[0];
  return item ? item.aantal : 0;
}

function renderEditProductPicker(content, query) {
  const list = content.querySelector('.edit-product-list');
  const q = (query || '').toLowerCase();
  const filtered = state.products
    .filter(function (p) { return p.Actief; })
    .filter(function (p) {
      return !q || (p.Naam + ' ' + p.SKU + ' ' + p.Categorie).toLowerCase().indexOf(q) !== -1;
    });

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Geen producten gevonden.</div>';
    return;
  }

  list.innerHTML = filtered
    .map(function (p) { return buildProductTileHtml(p, getEditCartQtyForSku(p.SKU)); })
    .join('');

  list.querySelectorAll('.product-tile').forEach(function (el) {
    el.addEventListener('click', function () {
      addProductToEdit(el.dataset.sku);
      refreshEditPanel();
    });
  });
}

function addProductToEdit(sku) {
  const product = state.products.filter(function (p) { return p.SKU === sku; })[0];
  if (!product) return;
  const existing = state.editItems.filter(function (i) { return i.sku === sku; })[0];
  if (existing) {
    existing.aantal++;
  } else {
    state.editItems.push({ sku: sku, naam: product.Naam, prijs: Number(product.Prijs), aantal: 1 });
  }
}

function deleteCurrentOrder() {
  const o = state.orders.filter(function (x) { return x.OrderID === state.editOrderId; })[0];
  if (!o) return;
  if (!confirm('Order van ' + o.Voornaam + ' ' + o.Achternaam + ' definitief verwijderen? Voorraad wordt teruggezet.')) return;

  showSpinner('Verwijderen...');
  callApi('deleteOrder', { orderId: o.OrderID })
    .then(function () {
      toast('Order verwijderd.');
      closeOrderDetail();
      loadBootstrap(true);
    })
    .catch(function (err) { toast(err.message, true); })
    .finally(hideSpinner);
}

function setOrderFilter(value) {
  state.orderFilter = value;
  document.querySelectorAll('#order-filter-tabs button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.value === value);
  });
  renderOrders();
}

function renderProducts() {
  const list = document.getElementById('products-list');
  if (!state.products.length) {
    list.innerHTML = '<div class="empty-state">Nog geen producten. Voeg er hierboven eentje toe.</div>';
    return;
  }

  list.innerHTML = state.products
    .map(function (p) {
      const isEditing = state.editingProductSku === p.SKU;
      const low = Number(p.Voorraad) <= 3;
      return (
        '<div class="card" data-sku="' + escapeAttr(p.SKU) + '">' +
        '<div class="card-title-row">' +
        '<div style="display:flex;align-items:center;">' +
        (p.Foto ? '<img src="' + escapeAttr(p.Foto) + '" class="product-thumb">' : '') +
        '<div><strong>' + escapeHtml(p.Naam) + '</strong><br><small style="color:var(--brown)">' + escapeHtml(p.SKU) + ' &middot; ' + escapeHtml(p.Categorie || '') + '</small></div>' +
        '</div>' +
        '<button class="btn-ghost edit-toggle">' + (isEditing ? 'Sluiten' : 'Bewerken') + '</button>' +
        '</div>' +
        '<div class="order-card__meta">&euro;' + Number(p.Prijs).toFixed(2) + ' &middot; voorraad: <span class="' + (low ? 'stock-low' : '') + '">' + p.Voorraad + '</span> ' +
        (p.Actief ? '' : '&middot; <em>uitgeschakeld</em>') + '</div>' +
        (isEditing ? renderProductEditForm(p) : '') +
        '</div>'
      );
    })
    .join('');

  list.querySelectorAll('.edit-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const sku = btn.closest('.card').dataset.sku;
      state.editingProductSku = state.editingProductSku === sku ? null : sku;
      renderProducts();
    });
  });

  bindProductEditForms();
}

function renderProductEditForm(p) {
  const currentPhoto = p.Foto
    ? '<img src="' + escapeAttr(p.Foto) + '" class="product-thumb" style="width:56px;height:56px;margin:0 0 8px;">'
    : '';
  return (
    '<div class="product-edit-form" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">' +
    currentPhoto +
    '<label>Naam</label><input type="text" class="e-naam" value="' + escapeAttr(p.Naam) + '">' +
    '<div class="field-row">' +
    '<div><label>Categorie</label><input type="text" class="e-categorie" value="' + escapeAttr(p.Categorie || '') + '"></div>' +
    '<div><label>Prijs (&euro;)</label><input type="number" step="0.01" class="e-prijs" value="' + Number(p.Prijs) + '"></div>' +
    '</div>' +
    '<div class="field-row">' +
    '<div><label>Voorraad</label><input type="number" class="e-voorraad" value="' + Number(p.Voorraad) + '"></div>' +
    '<div><label>Status</label><select class="e-actief"><option value="true" ' + (p.Actief ? 'selected' : '') + '>Actief</option><option value="false" ' + (!p.Actief ? 'selected' : '') + '>Uitgeschakeld</option></select></div>' +
    '</div>' +
    '<label>Foto ' + (p.Foto ? 'vervangen' : 'toevoegen') + '</label>' +
    '<input type="file" class="e-foto" accept="image/*">' +
    '<button type="button" class="btn btn-primary e-save" style="margin-top:10px;">Opslaan</button>' +
    '<button type="button" class="btn btn-secondary e-delete" style="margin-top:8px;">Product verwijderen</button>' +
    '</div>'
  );
}

function bindProductEditForms() {
  document.querySelectorAll('.product-edit-form').forEach(function (form) {
    const card = form.closest('.card');
    const sku = card.dataset.sku;

    form.querySelector('.e-save').addEventListener('click', function () {
      const payload = {
        sku: sku,
        naam: form.querySelector('.e-naam').value.trim(),
        categorie: form.querySelector('.e-categorie').value.trim(),
        prijs: Number(form.querySelector('.e-prijs').value) || 0,
        voorraad: Number(form.querySelector('.e-voorraad').value) || 0,
        actief: form.querySelector('.e-actief').value === 'true',
      };
      const fotoFile = form.querySelector('.e-foto').files[0];

      showSpinner('Opslaan...');
      callApi('saveProduct', payload)
        .then(function () {
          if (fotoFile) return uploadPhotoForSku(sku, fotoFile);
        })
        .then(function () {
          toast('Product opgeslagen.');
          state.editingProductSku = null;
          loadBootstrap(true);
        })
        .catch(function (err) { toast(err.message, true); })
        .finally(hideSpinner);
    });

    form.querySelector('.e-delete').addEventListener('click', function () {
      if (!confirm('Product "' + sku + '" verwijderen?')) return;
      showSpinner('Verwijderen...');
      callApi('deleteProduct', { sku: sku })
        .then(function () {
          toast('Product verwijderd.');
          state.editingProductSku = null;
          loadBootstrap(true);
        })
        .catch(function (err) { toast(err.message, true); })
        .finally(hideSpinner);
    });
  });
}

function submitNewProduct(ev) {
  ev.preventDefault();
  const payload = {
    sku: document.getElementById('np-sku').value.trim(),
    naam: document.getElementById('np-naam').value.trim(),
    categorie: document.getElementById('np-categorie').value.trim(),
    prijs: Number(document.getElementById('np-prijs').value) || 0,
    voorraad: Number(document.getElementById('np-voorraad').value) || 0,
    actief: true,
  };
  if (!payload.naam) {
    toast('Vul minimaal een naam in.', true);
    return;
  }
  const fotoFile = document.getElementById('np-foto').files[0];

  showSpinner('Product toevoegen...');
  callApi('saveProduct', payload)
    .then(function (result) {
      if (fotoFile) {
        return uploadPhotoForSku(result.sku, fotoFile);
      }
    })
    .then(function () {
      toast('Product toegevoegd.');
      document.getElementById('form-new-product').reset();
      loadBootstrap(true);
    })
    .catch(function (err) { toast(err.message, true); })
    .finally(hideSpinner);
}

function renderDashboard() {
  const d = state.dashboard;
  const wrap = document.getElementById('dashboard-content');
  if (!d) {
    wrap.innerHTML = '<div class="empty-state">Nog geen data.</div>';
    return;
  }

  const bestsellersHtml = d.bestsellers.length
    ? d.bestsellers
        .map(function (b, i) {
          return '<div class="bestseller-row"><span><span class="bestseller-rank">' + (i + 1) + '.</span>' + escapeHtml(b.naam) + '</span><span>' + b.aantal + ' verkocht</span></div>';
        })
        .join('')
    : '<div class="empty-state">Nog geen verkopen.</div>';

  const lowStockHtml = d.lowStock.length
    ? d.lowStock.map(function (p) { return '<div class="bestseller-row"><span>' + escapeHtml(p.naam) + '</span><span class="stock-low">nog ' + p.voorraad + '</span></div>'; }).join('')
    : '<div class="empty-state">Alle voorraad op peil.</div>';

  const dupWarning = (d.duplicateSkus && d.duplicateSkus.length)
    ? '<div class="card" style="border-color:var(--rust-dark);"><h3 style="color:var(--rust-dark);">Let op: dubbele SKU\'s</h3><p>Deze SKU-waarden komen meerdere keren voor in je Producten-tabblad: <strong>' + d.duplicateSkus.map(escapeHtml).join(', ') + '</strong>. Producten met dezelfde SKU worden door het systeem als \u00e9\u00e9n product behandeld. Maak elke SKU uniek.</p></div>'
    : '';

  wrap.innerHTML =
    dupWarning +
    '<div class="stat-grid">' +
    '<div class="stat-card"><div class="value">&euro;' + d.omzetTotaal.toFixed(0) + '</div><div class="label">Omzet totaal</div></div>' +
    '<div class="stat-card"><div class="value">&euro;' + d.omzetMaand.toFixed(0) + '</div><div class="label">Omzet deze maand</div></div>' +
    '<div class="stat-card"><div class="value">' + d.ordersMaand + '</div><div class="label">Orders deze maand</div></div>' +
    '<div class="stat-card"><div class="value">' + (d.statusCount['Verzenden'] || 0) + '</div><div class="label">Te verzenden</div></div>' +
    '</div>' +
    '<div class="card"><h3>Bestsellers</h3>' + bestsellersHtml + '</div>' +
    '<div class="card"><h3>Voorraad bijna op</h3>' + lowStockHtml + '</div>';
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function escapeAttr(str) { return escapeHtml(str); }

function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function waitForGoogleThenInit() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    initGoogleLogin();
  } else {
    setTimeout(waitForGoogleThenInit, 150);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  applyAppName();
  waitForGoogleThenInit();

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.bottom-nav button').forEach(function (b) {
    b.addEventListener('click', function () { switchView(b.dataset.view); });
  });

  document.getElementById('form-new-order').addEventListener('submit', submitNewOrder);
  document.getElementById('form-new-order').addEventListener('input', saveDraft);
  document.getElementById('form-new-product').addEventListener('submit', submitNewProduct);

  document.getElementById('product-search').addEventListener('input', function (e) {
    renderProductPicker(e.target.value);
  });

  document.getElementById('product-search-toggle').addEventListener('click', function () {
    const input = document.getElementById('product-search');
    input.classList.toggle('hidden');
    if (!input.classList.contains('hidden')) input.focus();
  });

  document.getElementById('input-korting').addEventListener('input', updateTotal);

  document.getElementById('input-postcode').addEventListener('blur', tryAutoFillAddress);
  document.getElementById('input-huisnummer').addEventListener('blur', tryAutoFillAddress);

  document.querySelectorAll('#status-segmented button').forEach(function (b) {
    b.addEventListener('click', function () { setStatusSegment(b.dataset.value); saveDraft(); });
  });

  document.querySelectorAll('#order-filter-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setOrderFilter(b.dataset.value); });
  });

  document.querySelectorAll('.order-col').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const field = btn.dataset.field;
      if (state.orderSort.field === field) {
        state.orderSort.dir = state.orderSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.orderSort.field = field;
        state.orderSort.dir = 'asc';
      }
      renderOrders();
    });
  });

  document.getElementById('order-search').addEventListener('input', function (e) {
    state.orderSearch = e.target.value;
    renderOrders();
  });

  document.getElementById('order-detail-back').addEventListener('click', closeOrderDetail);
  document.getElementById('order-detail-delete').addEventListener('click', deleteCurrentOrder);

  document.getElementById('toggle-betaald').addEventListener('change', function (e) {
    if (e.target.checked) {
      const active = document.querySelector('#status-segmented button.active');
      if (active && active.dataset.value === 'Open') setStatusSegment('Verzenden');
    }
    saveDraft();
  });
});
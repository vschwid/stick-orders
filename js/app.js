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
  orderFilter: 'Alle',
  expandedOrderId: null,
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
  });
  google.accounts.id.renderButton(document.getElementById('google-signin-button'), {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    width: 260,
  });
  attemptSilentLogin();
  scheduleSilentRefresh();
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
  state.idToken = response.credential;
  const payload = decodeJwt(response.credential);
  state.user = { name: payload.name, email: payload.email, picture: payload.picture };
  showApp();
  loadBootstrap();
}

function logout() {
  google.accounts.id.disableAutoSelect();
  state.idToken = null;
  state.user = null;
  showLogin();
}

function callApi(action, payload) {
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ idToken: state.idToken, action: action, payload: payload || {} }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'Er ging iets mis.');
      return res.data;
    });
}

function loadBootstrap() {
  showSpinner('Gegevens ophalen...');
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
      renderAll();
    })
    .catch(function (err) {
      toast(err.message, true);
      if (String(err.message).toLowerCase().indexOf('log opnieuw') !== -1) logout();
    })
    .finally(hideSpinner);
}

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  revealManualLogin();
}

function showApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('user-name').textContent = state.user.name.split(' ')[0];
  document.getElementById('user-avatar').src = state.user.picture;
  switchView('new-order');
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'orders') renderOrders();
  if (name === 'products') renderProducts();
  if (name === 'dashboard') renderDashboard();
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
    .map(function (p) {
      const low = Number(p.Voorraad) <= 3;
      return (
        '<div class="product-list-item" data-sku="' + escapeAttr(p.SKU) + '">' +
        '<div><strong>' + escapeHtml(p.Naam) + '</strong>' +
        '<small>' + escapeHtml(p.Categorie || '') + ' &middot; &euro;' + Number(p.Prijs).toFixed(2) +
        ' &middot; <span class="' + (low ? 'stock-low' : '') + '">voorraad: ' + p.Voorraad + '</span></small></div>' +
        '<span>+</span></div>'
      );
    })
    .join('');

  list.querySelectorAll('.product-list-item').forEach(function (el) {
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
        '<input type="number" min="1" value="' + it.aantal + '" data-idx="' + idx + '" class="qty-input">' +
        '<span class="price">&euro;' + (it.prijs * it.aantal).toFixed(2) + '</span>' +
        '<button class="remove" data-idx="' + idx + '">&times;</button>' +
        '</div>'
      );
    })
    .join('');

  wrap.querySelectorAll('.qty-input').forEach(function (input) {
    input.addEventListener('change', function () {
      const idx = Number(input.dataset.idx);
      state.selectedItems[idx].aantal = Math.max(1, Number(input.value) || 1);
      renderSelectedItems();
    });
  });
  wrap.querySelectorAll('.remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.selectedItems.splice(Number(btn.dataset.idx), 1);
      renderSelectedItems();
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
  return active ? active.dataset.value : 'Nieuw';
}

function resetOrderForm() {
  document.getElementById('form-new-order').reset();
  state.selectedItems = [];
  renderSelectedItems();
  setStatusSegment('Nieuw');
  document.getElementById('toggle-betaald').checked = false;
  renderProductPicker('');
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
    .then(function () {
      toast('Order opgeslagen!');
      resetOrderForm();
      loadBootstrap();
    })
    .catch(function (err) { toast(err.message, true); })
    .finally(hideSpinner);
}

function itemsForOrder(orderId) {
  return state.items.filter(function (i) { return i.OrderID === orderId; });
}

function badgeClassForStatus(status) {
  if (status === 'Verzonden') return 'badge-verzonden';
  if (status === 'Afgerond') return 'badge-afgerond';
  return 'badge-nieuw';
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  const filtered = state.orders.filter(function (o) {
    return state.orderFilter === 'Alle' || o.Status === state.orderFilter;
  });

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Geen orders in dit filter.</div>';
    return;
  }

  list.innerHTML = filtered
    .map(function (o) {
      const items = itemsForOrder(o.OrderID);
      const itemsSummary = items.map(function (i) { return i.Aantal + '\u00d7 ' + i.Naam; }).join(', ');
      const isOpen = state.expandedOrderId === o.OrderID;
      return (
        '<div class="card order-card" data-id="' + escapeAttr(o.OrderID) + '">' +
        '<div class="order-card__top">' +
        '<span class="order-card__name">' + escapeHtml(o.Voornaam) + ' ' + escapeHtml(o.Achternaam) + '</span>' +
        '<span class="order-card__amount">&euro;' + Number(o.Totaal).toFixed(2) + '</span>' +
        '</div>' +
        '<div class="order-card__meta">' + escapeHtml(itemsSummary) + '</div>' +
        '<div class="order-card__meta">' + formatDate(o.Datum) + '</div>' +
        '<div>' +
        '<span class="badge ' + badgeClassForStatus(o.Status) + '">' + escapeHtml(o.Status) + '</span> ' +
        (o.Betaald ? '<span class="badge badge-betaald">Betaald</span>' : '<span class="badge badge-betaald">Nog niet betaald</span>') +
        '</div>' +
        (isOpen ? renderOrderEditPanel(o) : '') +
        '</div>'
      );
    })
    .join('');

  list.querySelectorAll('.order-card').forEach(function (card) {
    card.addEventListener('click', function (ev) {
      if (ev.target.closest('.order-edit-panel')) return;
      const id = card.dataset.id;
      if (state.expandedOrderId === id) {
        state.expandedOrderId = null;
        state.editOrderId = null;
        state.editItems = [];
      } else {
        const order = state.orders.filter(function (o) { return o.OrderID === id; })[0];
        state.expandedOrderId = id;
        state.editOrderId = id;
        state.editItems = itemsForOrder(id).map(function (it) {
          return { sku: it.SKU, naam: it.Naam, prijs: Number(it.PrijsPerStuk), aantal: Number(it.Aantal) };
        });
      }
      renderOrders();
    });
  });

  bindOrderEditPanels();
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
          '<button type="button" class="remove edit-remove-item" data-idx="' + idx + '">&times;</button>' +
          '</div>'
        );
      })
      .join('') || '<div class="empty-state">Geen producten in deze order.</div>'
  );
}

function refreshEditPanel(panel) {
  panel.querySelector('.edit-selected-items').innerHTML = renderEditSelectedItemsHtml();
  const subtotaal = state.editItems.reduce(function (s, it) { return s + it.prijs * it.aantal; }, 0);
  const korting = Number(panel.querySelector('.edit-korting').value) || 0;
  const totaal = Math.max(subtotaal - korting, 0);
  panel.querySelector('.edit-total').textContent = '\u20ac' + totaal.toFixed(2);
  bindEditItemRowEvents(panel);
}

function bindEditItemRowEvents(panel) {
  panel.querySelectorAll('.edit-qty-input').forEach(function (input) {
    input.addEventListener('change', function () {
      const idx = Number(input.dataset.idx);
      state.editItems[idx].aantal = Math.max(1, Number(input.value) || 1);
      refreshEditPanel(panel);
    });
  });
  panel.querySelectorAll('.edit-remove-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.editItems.splice(Number(btn.dataset.idx), 1);
      refreshEditPanel(panel);
    });
  });
}

function renderOrderEditPanel(o) {
  const itemsHtml = state.editItems
    .map(function (it, idx) {
      return (
        '<div class="selected-item">' +
        '<span class="name">' + escapeHtml(it.naam) + '</span>' +
        '<input type="number" min="1" value="' + it.aantal + '" data-idx="' + idx + '" class="edit-qty-input">' +
        '<span class="price">&euro;' + (it.prijs * it.aantal).toFixed(2) + '</span>' +
        '<button type="button" class="remove edit-remove-item" data-idx="' + idx + '">&times;</button>' +
        '</div>'
      );
    })
    .join('') || '<div class="empty-state">Geen producten in deze order.</div>';

  const subtotaal = state.editItems.reduce(function (s, it) { return s + it.prijs * it.aantal; }, 0);
  const korting = Number(o.Korting) || 0;
  const totaal = Math.max(subtotaal - korting, 0);

  return (
    '<div class="order-edit-panel" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">' +
    '<label>Voornaam</label><input type="text" class="edit-voornaam" value="' + escapeAttr(o.Voornaam) + '">' +
    '<label>Achternaam</label><input type="text" class="edit-achternaam" value="' + escapeAttr(o.Achternaam) + '">' +
    '<label>Straat + huisnr</label><input type="text" class="edit-straat" value="' + escapeAttr(o.Straat || '') + '">' +
    '<div class="field-row">' +
    '<div><label>Postcode</label><input type="text" class="edit-postcode" value="' + escapeAttr(o.Postcode || '') + '"></div>' +
    '<div><label>Woonplaats</label><input type="text" class="edit-plaats" value="' + escapeAttr(o.Plaats || '') + '"></div>' +
    '</div>' +

    '<label>Producten</label>' +
    '<input type="text" class="edit-product-search" placeholder="Zoek product om toe te voegen...">' +
    '<div class="product-list edit-product-list"></div>' +
    '<div class="selected-items edit-selected-items">' + itemsHtml + '</div>' +

    '<label>Korting (&euro;)</label>' +
    '<input type="number" step="0.01" min="0" class="edit-korting" value="' + korting + '">' +
    '<div class="total-row"><span>Totaal</span><span class="edit-total">&euro;' + totaal.toFixed(2) + '</span></div>' +

    '<label>Status</label>' +
    '<div class="segmented" data-order="' + escapeAttr(o.OrderID) + '">' +
    ['Nieuw', 'Verzonden', 'Afgerond'].map(function (s) {
      return '<button type="button" data-value="' + s + '" class="' + (o.Status === s ? 'active' : '') + '">' + s + '</button>';
    }).join('') +
    '</div>' +
    '<div class="toggle-row">' +
    '<label>Betaald</label>' +
    '<label class="switch"><input type="checkbox" class="edit-betaald" ' + (o.Betaald ? 'checked' : '') + '><span class="switch-track"></span></label>' +
    '</div>' +
    '<label>Notitie</label>' +
    '<textarea class="edit-notitie">' + escapeHtml(o.Notitie || '') + '</textarea>' +
    '<button type="button" class="btn btn-primary edit-save" style="margin-top:10px;">Wijzigingen opslaan</button>' +
    '</div>'
  );
}

function renderEditProductPicker(panel, query) {
  const list = panel.querySelector('.edit-product-list');
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
    .map(function (p) {
      const low = Number(p.Voorraad) <= 3;
      return (
        '<div class="product-list-item" data-sku="' + escapeAttr(p.SKU) + '">' +
        '<div><strong>' + escapeHtml(p.Naam) + '</strong>' +
        '<small>' + escapeHtml(p.Categorie || '') + ' &middot; &euro;' + Number(p.Prijs).toFixed(2) +
        ' &middot; <span class="' + (low ? 'stock-low' : '') + '">voorraad: ' + p.Voorraad + '</span></small></div>' +
        '<span>+</span></div>'
      );
    })
    .join('');

  list.querySelectorAll('.product-list-item').forEach(function (el) {
    el.addEventListener('click', function () {
      addProductToEdit(el.dataset.sku);
      refreshEditPanel(panel);
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

function bindOrderEditPanels() {
  document.querySelectorAll('.order-edit-panel').forEach(function (panel) {
    const card = panel.closest('.order-card');
    const orderId = card.dataset.id;

    renderEditProductPicker(panel, '');

    panel.querySelector('.edit-product-search').addEventListener('input', function (e) {
      renderEditProductPicker(panel, e.target.value);
    });

    bindEditItemRowEvents(panel);

    panel.querySelector('.edit-korting').addEventListener('input', function () {
      refreshEditPanel(panel);
    });

    panel.querySelectorAll('.segmented button').forEach(function (b) {
      b.addEventListener('click', function () {
        panel.querySelectorAll('.segmented button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });

    panel.querySelector('.edit-save').addEventListener('click', function () {
      const status = panel.querySelector('.segmented button.active').dataset.value;
      const betaald = panel.querySelector('.edit-betaald').checked;
      const notitie = panel.querySelector('.edit-notitie').value;
      const korting = Number(panel.querySelector('.edit-korting').value) || 0;

      if (!state.editItems.length) {
        toast('Een order heeft minstens 1 product nodig.', true);
        return;
      }

      showSpinner('Opslaan...');
      callApi('updateOrder', {
        orderId: orderId,
        Status: status,
        Betaald: betaald,
        Notitie: notitie,
        Voornaam: panel.querySelector('.edit-voornaam').value.trim(),
        Achternaam: panel.querySelector('.edit-achternaam').value.trim(),
        Straat: panel.querySelector('.edit-straat').value.trim(),
        Postcode: panel.querySelector('.edit-postcode').value.trim(),
        Plaats: panel.querySelector('.edit-plaats').value.trim(),
        korting: korting,
        items: state.editItems.map(function (it) {
          return { sku: it.sku, naam: it.naam, prijs: it.prijs, aantal: it.aantal };
        }),
      })
        .then(function () {
          toast('Order bijgewerkt.');
          state.expandedOrderId = null;
          state.editOrderId = null;
          state.editItems = [];
          loadBootstrap();
        })
        .catch(function (err) { toast(err.message, true); })
        .finally(hideSpinner);
    });
  });
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
        '<div><strong>' + escapeHtml(p.Naam) + '</strong><br><small style="color:var(--brown)">' + escapeHtml(p.SKU) + ' &middot; ' + escapeHtml(p.Categorie || '') + '</small></div>' +
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
  return (
    '<div class="product-edit-form" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">' +
    '<label>Naam</label><input type="text" class="e-naam" value="' + escapeAttr(p.Naam) + '">' +
    '<div class="field-row">' +
    '<div><label>Categorie</label><input type="text" class="e-categorie" value="' + escapeAttr(p.Categorie || '') + '"></div>' +
    '<div><label>Prijs (&euro;)</label><input type="number" step="0.01" class="e-prijs" value="' + Number(p.Prijs) + '"></div>' +
    '</div>' +
    '<div class="field-row">' +
    '<div><label>Voorraad</label><input type="number" class="e-voorraad" value="' + Number(p.Voorraad) + '"></div>' +
    '<div><label>Status</label><select class="e-actief"><option value="true" ' + (p.Actief ? 'selected' : '') + '>Actief</option><option value="false" ' + (!p.Actief ? 'selected' : '') + '>Uitgeschakeld</option></select></div>' +
    '</div>' +
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
      showSpinner('Opslaan...');
      callApi('saveProduct', payload)
        .then(function () {
          toast('Product opgeslagen.');
          state.editingProductSku = null;
          loadBootstrap();
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
          loadBootstrap();
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
  showSpinner('Product toevoegen...');
  callApi('saveProduct', payload)
    .then(function () {
      toast('Product toegevoegd.');
      document.getElementById('form-new-product').reset();
      loadBootstrap();
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
    ? '<div class="card" style="border-color:var(--orange-dark);"><h3 style="color:var(--orange-dark);">Let op: dubbele SKU\'s</h3><p>Deze SKU-waarden komen meerdere keren voor in je Producten-tabblad: <strong>' + d.duplicateSkus.map(escapeHtml).join(', ') + '</strong>. Producten met dezelfde SKU worden door het systeem als \u00e9\u00e9n product behandeld. Maak elke SKU uniek.</p></div>'
    : '';

  wrap.innerHTML =
    dupWarning +
    '<div class="stat-grid">' +
    '<div class="stat-card"><div class="value">&euro;' + d.omzetTotaal.toFixed(0) + '</div><div class="label">Omzet totaal</div></div>' +
    '<div class="stat-card"><div class="value">&euro;' + d.omzetMaand.toFixed(0) + '</div><div class="label">Omzet deze maand</div></div>' +
    '<div class="stat-card"><div class="value">' + d.ordersMaand + '</div><div class="label">Orders deze maand</div></div>' +
    '<div class="stat-card"><div class="value">' + (d.statusCount['Nieuw'] || 0) + '</div><div class="label">Nog te verzenden</div></div>' +
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
  document.getElementById('form-new-product').addEventListener('submit', submitNewProduct);

  document.getElementById('product-search').addEventListener('input', function (e) {
    renderProductPicker(e.target.value);
  });

  document.getElementById('input-korting').addEventListener('input', updateTotal);

  document.querySelectorAll('#status-segmented button').forEach(function (b) {
    b.addEventListener('click', function () { setStatusSegment(b.dataset.value); });
  });

  document.querySelectorAll('#order-filter-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setOrderFilter(b.dataset.value); });
  });
});

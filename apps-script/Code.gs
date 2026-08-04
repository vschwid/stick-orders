const SHEET_NAMES = {
  ORDERS: 'Orders',
  ITEMS: 'OrderItems',
  PRODUCTS: 'Producten',
};

const LOW_STOCK_THRESHOLD = 3;

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'Ongeldige aanvraag.' });
  }

  try {
    const email = verifyIdToken(body.idToken);
    const action = body.action;
    const payload = body.payload || {};

    switch (action) {
      case 'bootstrap':
        return jsonOut({ ok: true, data: bootstrap() });
      case 'createOrder':
        return jsonOut({ ok: true, data: createOrder(payload, email) });
      case 'updateOrder':
        return jsonOut({ ok: true, data: updateOrder(payload) });
      case 'saveProduct':
        return jsonOut({ ok: true, data: saveProduct(payload) });
      case 'deleteProduct':
        return jsonOut({ ok: true, data: deleteProduct(payload) });
      default:
        return jsonOut({ ok: false, error: 'Onbekende actie: ' + action });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return ContentService.createTextOutput(
    'API draait. Gebruik POST vanuit de app.'
  );
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function verifyIdToken(idToken) {
  if (!idToken) throw new Error('Niet ingelogd.');

  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('CLIENT_ID');
  const allowedEmails = (props.getProperty('ALLOWED_EMAILS') || '')
    .split(',')
    .map(function (s) {
      return s.trim().toLowerCase();
    })
    .filter(Boolean);

  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (resp.getResponseCode() !== 200) {
    throw new Error('Inloggegevens ongeldig of verlopen. Log opnieuw in.');
  }

  const info = JSON.parse(resp.getContentText());

  if (info.aud !== clientId) {
    throw new Error('Deze login hoort niet bij deze app.');
  }
  if (!info.email || !info.email_verified) {
    throw new Error('E-mailadres niet geverifieerd door Google.');
  }
  if (allowedEmails.length && allowedEmails.indexOf(info.email.toLowerCase()) === -1) {
    throw new Error('Dit account heeft geen toegang tot deze app.');
  }

  return info.email;
}

function getSheet(name) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Tabblad "' + name + '" niet gevonden in de sheet.');
  return sheet;
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) {
      obj[h] = row[i];
    });
    return obj;
  });
}

function appendRow(sheet, headers, obj) {
  sheet.appendRow(
    headers.map(function (h) {
      return obj[h] !== undefined ? obj[h] : '';
    })
  );
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function findRowByValue(sheet, colName, value) {
  const headers = getHeaders(sheet);
  const col = headers.indexOf(colName);
  if (col === -1) return -1;
  const values = sheet.getRange(2, col + 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

function bootstrap() {
  const productsSheet = getSheet(SHEET_NAMES.PRODUCTS);
  const ordersSheet = getSheet(SHEET_NAMES.ORDERS);
  const itemsSheet = getSheet(SHEET_NAMES.ITEMS);

  const products = sheetToObjects(productsSheet);
  const orders = sheetToObjects(ordersSheet).reverse();
  const items = sheetToObjects(itemsSheet);

  return {
    products: products,
    orders: orders,
    items: items,
    dashboard: buildDashboard(orders, items, products),
  };
}

function buildDashboard(orders, items, products) {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  let omzetTotaal = 0;
  let omzetMaand = 0;
  let ordersMaand = 0;
  const statusCount = {};

  orders.forEach(function (o) {
    const bedrag = Number(o.Totaal) || 0;
    omzetTotaal += bedrag;

    const d = new Date(o.Datum);
    if (!isNaN(d) && d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
      omzetMaand += bedrag;
      ordersMaand++;
    }

    const status = o.Status || 'Onbekend';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });

  const salesBySku = {};
  items.forEach(function (it) {
    const sku = it.SKU;
    salesBySku[sku] = (salesBySku[sku] || 0) + (Number(it.Aantal) || 0);
  });

  const bestsellers = Object.keys(salesBySku)
    .map(function (sku) {
      const product = products.filter(function (p) {
        return p.SKU === sku;
      })[0];
      return {
        sku: sku,
        naam: product ? product.Naam : sku,
        aantal: salesBySku[sku],
      };
    })
    .sort(function (a, b) {
      return b.aantal - a.aantal;
    })
    .slice(0, 5);

  const lowStock = products
    .filter(function (p) {
      return p.Actief && Number(p.Voorraad) <= LOW_STOCK_THRESHOLD;
    })
    .map(function (p) {
      return { sku: p.SKU, naam: p.Naam, voorraad: p.Voorraad };
    });

  return {
    omzetTotaal: omzetTotaal,
    omzetMaand: omzetMaand,
    ordersMaand: ordersMaand,
    statusCount: statusCount,
    bestsellers: bestsellers,
    lowStock: lowStock,
  };
}

function generateOrderId() {
  const now = new Date();
  const stamp = Utilities.formatDate(now, 'Europe/Amsterdam', 'yyyyMMdd-HHmmss');
  const rand = Math.floor(Math.random() * 900) + 100;
  return 'ORD-' + stamp + '-' + rand;
}

function createOrder(payload, email) {
  const ordersSheet = getSheet(SHEET_NAMES.ORDERS);
  const itemsSheet = getSheet(SHEET_NAMES.ITEMS);
  const productsSheet = getSheet(SHEET_NAMES.PRODUCTS);

  const orderId = generateOrderId();
  const orderHeaders = getHeaders(ordersSheet);
  const itemHeaders = getHeaders(itemsSheet);

  const items = payload.items || [];
  const subtotaal = items.reduce(function (sum, it) {
    return sum + Number(it.aantal) * Number(it.prijs);
  }, 0);
  const korting = Number(payload.korting) || 0;
  const totaal = Math.max(subtotaal - korting, 0);

  appendRow(ordersSheet, orderHeaders, {
    OrderID: orderId,
    Datum: payload.datum || Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd'),
    Voornaam: payload.voornaam,
    Achternaam: payload.achternaam,
    Straat: payload.straat,
    Postcode: payload.postcode,
    Plaats: payload.plaats,
    Status: payload.status || 'Nieuw',
    Betaald: !!payload.betaald,
    Korting: korting,
    Totaal: totaal,
    Notitie: payload.notitie || '',
  });

  items.forEach(function (it) {
    appendRow(itemsSheet, itemHeaders, {
      OrderID: orderId,
      SKU: it.sku,
      Naam: it.naam,
      Aantal: it.aantal,
      PrijsPerStuk: it.prijs,
      Subtotaal: Number(it.aantal) * Number(it.prijs),
    });

    const row = findRowByValue(productsSheet, 'SKU', it.sku);
    if (row !== -1) {
      const headers = getHeaders(productsSheet);
      const stockCol = headers.indexOf('Voorraad') + 1;
      const current = Number(productsSheet.getRange(row, stockCol).getValue()) || 0;
      productsSheet.getRange(row, stockCol).setValue(Math.max(current - Number(it.aantal), 0));
    }
  });

  return { orderId: orderId, totaal: totaal };
}

function updateOrder(payload) {
  const ordersSheet = getSheet(SHEET_NAMES.ORDERS);
  const row = findRowByValue(ordersSheet, 'OrderID', payload.orderId);
  if (row === -1) throw new Error('Order niet gevonden.');

  const headers = getHeaders(ordersSheet);
  const updatable = ['Status', 'Betaald', 'Notitie', 'Voornaam', 'Achternaam', 'Straat', 'Postcode', 'Plaats'];
  updatable.forEach(function (field) {
    if (payload[field] !== undefined) {
      const col = headers.indexOf(field) + 1;
      if (col > 0) ordersSheet.getRange(row, col).setValue(payload[field]);
    }
  });

  return { orderId: payload.orderId };
}

function saveProduct(payload) {
  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  const headers = getHeaders(sheet);
  const row = findRowByValue(sheet, 'SKU', payload.sku);

  const obj = {
    SKU: payload.sku,
    Naam: payload.naam,
    Categorie: payload.categorie || '',
    Prijs: Number(payload.prijs) || 0,
    Voorraad: Number(payload.voorraad) || 0,
    Actief: payload.actief !== undefined ? !!payload.actief : true,
  };

  if (row === -1) {
    appendRow(sheet, headers, obj);
  } else {
    headers.forEach(function (h, i) {
      sheet.getRange(row, i + 1).setValue(obj[h]);
    });
  }

  return { sku: payload.sku };
}

function deleteProduct(payload) {
  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  const row = findRowByValue(sheet, 'SKU', payload.sku);
  if (row !== -1) sheet.deleteRow(row);
  return { sku: payload.sku };
}

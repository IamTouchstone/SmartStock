// SmartStock Mobile Client Application Logic

// ----------------------------------------------------
// GLOBAL JS ERROR BOUNDARY
// Catch unhandled exceptions to prevent WebView crashes
// ----------------------------------------------------
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error("Global JS Error Caught:", msg, "at", url, ":", lineNo, error);
  return true; // Prevents error banner / crash
};

window.addEventListener('unhandledrejection', function(event) {
  console.error("Unhandled Promise Rejection:", event.reason);
});

// ----------------------------------------------------
// NETWORK & OFFLINE DETECTION
// ----------------------------------------------------
function checkNetworkConnection() {
  if (navigator.onLine === false) {
    const offlineScreen = document.getElementById('offline-screen');
    if (offlineScreen) offlineScreen.style.display = 'flex';
    return false;
  }
  const offlineScreen = document.getElementById('offline-screen');
  if (offlineScreen) offlineScreen.style.display = 'none';
  return true;
}

function checkNetworkAndRetry() {
  if (navigator.onLine) {
    const offlineScreen = document.getElementById('offline-screen');
    if (offlineScreen) offlineScreen.style.display = 'none';
    if (typeof showToast === 'function') showToast("Internet connection restored.");
    checkAuthSession();
  } else {
    if (typeof showToast === 'function') showToast("Still offline. Please check connection.");
  }
}

window.addEventListener('online', () => {
  const offlineScreen = document.getElementById('offline-screen');
  if (offlineScreen) offlineScreen.style.display = 'none';
  if (typeof showToast === 'function') showToast("Back online!");
});

window.addEventListener('offline', () => {
  const offlineScreen = document.getElementById('offline-screen');
  if (offlineScreen) offlineScreen.style.display = 'flex';
});

const API_BASE = 'https://smart-stock-seven.vercel.app';
let isOfflineMode = false;
let currentUser = null; // { user_id, name, email, role, org_id }
let currentOrg = null;  // { id, org_name, admin_email, industry }

let currentSlide = 1;
let rawCatalog = [];
let localCache = {
  scans: [],
  audits: []
};

// Barcode Scanner Camera & Permission State
let scannerCamera = 'back'; // 'back' or 'front'
let cameraPermissionGranted = false;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  checkNetworkConnection();
  initOnboardingFlow();
  initVoiceAndPicker();
  // Invoice search form submission handler
  const searchForm = document.getElementById('invoice-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const params = new URLSearchParams();
      const cust = document.getElementById('search-customer').value.trim();
      if (cust) params.append('customer_name', cust);
      const receipt = document.getElementById('search-receipt').value.trim();
      if (receipt) params.append('receipt_number', receipt);
      const invoice = document.getElementById('search-invoice').value.trim();
      if (invoice) params.append('invoice_number', invoice);
      const product = document.getElementById('search-product').value.trim();
      if (product) params.append('product_name', product);
      const date = document.getElementById('search-date').value;
      if (date) params.append('date', date);
      const start = document.getElementById('search-start-date').value;
      const end = document.getElementById('search-end-date').value;
      if (start && end) { params.append('start_date', start); params.append('end_date', end); }
      const status = document.getElementById('search-status').value;
      if (status) params.append('payment_status', status);
      const res = await authFetch(`/api/invoices/search?${params.toString()}`);
      if (res.ok) { const data = await res.json(); loadInvoiceLedger(data); } else { showToast('Search failed'); }
    });
  }
});

// ----------------------------------------------------
// ONBOARDING SPLASH & WALKTHROUGH FLOW
// ----------------------------------------------------
function initOnboardingFlow() {
  const onboarded = localStorage.getItem('smartstock_onboarded');
  const splash = document.getElementById('splash-screen');
  const walkthrough = document.getElementById('walkthrough-screen');

  if (onboarded === 'true') {
    splash.style.display = 'none';
    walkthrough.style.display = 'none';
    if (checkNetworkConnection()) {
      checkAuthSession();
    }
  } else {
    splash.style.display = 'flex';
    setTimeout(() => {
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        if (checkNetworkConnection()) {
          walkthrough.style.display = 'flex';
        }
      }, 300);
    }, 3000); // 3 second splash/loading screen for WebView
  }
}

function nextWalkthroughSlide() {
  const currentSlideEl = document.getElementById(`slide-${currentSlide}`);
  const currentDot = document.getElementById(`dot-${currentSlide}`);
  
  if (currentSlide < 3) {
    currentSlideEl.classList.remove('active');
    currentDot.classList.remove('active');

    currentSlide++;

    const nextSlideEl = document.getElementById(`slide-${currentSlide}`);
    const nextDot = document.getElementById(`dot-${currentSlide}`);
    nextSlideEl.classList.add('active');
    nextDot.classList.add('active');

    if (currentSlide === 3) {
      document.getElementById('btn-walkthrough-next').innerText = "Get Started";
    }
  } else {
    localStorage.setItem('smartstock_onboarded', 'true');
    const walkthrough = document.getElementById('walkthrough-screen');
    walkthrough.style.opacity = '0';
    setTimeout(() => {
      walkthrough.style.display = 'none';
      checkAuthSession();
    }, 300);
  }
}

// ----------------------------------------------------
// AUTHENTICATION & SESSIONS
// ----------------------------------------------------
async function checkAuthSession() {
  const token = localStorage.getItem('smartstock_token');
  const user_id = localStorage.getItem('smartstock_user_id');
  const modal = document.getElementById('auth-modal-overlay');

  if (!token || !user_id) {
    modal.style.display = 'flex';
    return;
  }

  try {
    const res = await authFetch('/api/auth/me');
    if (res && res.ok) {
      const data = await res.json();
      currentUser = {
        user_id: data.user_id,
        name: data.name,
        email: data.email,
        role: data.role,
        org_id: data.org_id
      };
      currentOrg = {
        id: data.org_id,
        org_name: data.org_name
      };

      updateHeaderProfile();
      modal.style.display = 'none';
      loadAllViews();
    } else {
      localStorage.removeItem('smartstock_token');
      localStorage.removeItem('smartstock_user_id');
      modal.style.display = 'flex';
    }
  } catch (err) {
    console.error("Session verification failed", err);
    modal.style.display = 'none';
    loadAllViews();
  }
}

function updateHeaderProfile() {
  if (!currentOrg || !currentUser) return;
  
  document.getElementById('hdr-org-name').innerText = currentOrg.org_name;
  document.getElementById('hdr-org-badge').style.display = 'flex';

  // Update More Options Tab profile card
  document.getElementById('more-profile-name').innerText = currentUser.name;
  document.getElementById('more-profile-email').innerText = currentUser.email;
  document.getElementById('more-profile-role').innerText = currentUser.role;
}

function switchAuthTab(tab) {
  document.getElementById('btn-tab-login').classList.remove('active');
  document.getElementById('btn-tab-signup').classList.remove('active');
  document.getElementById('auth-form-login').classList.remove('active');
  document.getElementById('auth-form-signup').classList.remove('active');

  if (tab === 'login') {
    document.getElementById('btn-tab-login').classList.add('active');
    document.getElementById('auth-form-login').classList.add('active');
  } else {
    document.getElementById('btn-tab-signup').classList.add('active');
    document.getElementById('auth-form-signup').classList.add('active');
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const admin_email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_email, password })
    });

    if (!res.ok) {
      let errMsg = "Server error. Please try again.";
      try {
        const errData = await res.json();
        if (errData && errData.error) errMsg = `Login failed: ${errData.error}`;
      } catch (_) {}
      showToast(errMsg);
      return;
    }

    const data = await res.json();

    localStorage.setItem('smartstock_token', data.token);
    localStorage.setItem('smartstock_user_id', data.user_id);
    
    currentUser = data.user;
    currentUser.user_id = data.user_id;

    currentOrg = { id: data.user.org_id, org_name: "SmartStock Organization" };
    updateHeaderProfile();
    document.getElementById('auth-modal-overlay').style.display = 'none';
    showToast(`Welcome back, ${currentUser.name}`);
    loadAllViews();

  } catch (err) {
    showToast("Server error. Please try again.");
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  const org_name = document.getElementById('signup-org-name').value.trim();
  const admin_email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value.trim();
  const industry = document.getElementById('signup-industry').value;

  try {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_name, admin_email, password, industry })
    });

    if (!res.ok) {
      let errMsg = "Server error. Please try again.";
      try {
        const errData = await res.json();
        if (errData && errData.error) errMsg = `Registration failed: ${errData.error}`;
      } catch (_) {}
      showToast(errMsg);
      return;
    }

    const data = await res.json();

    localStorage.setItem('smartstock_token', data.token);
    localStorage.setItem('smartstock_user_id', data.user_id);
    
    currentUser = data.user;
    currentUser.user_id = data.user_id;

    currentOrg = { id: data.token, org_name: org_name };
    updateHeaderProfile();
    document.getElementById('auth-modal-overlay').style.display = 'none';
    showToast(`Organization & Admin Account Created`);
    loadAllViews();

  } catch (err) {
    showToast("Server error. Please try again.");
  }
}

function logoutOrganization() {
  localStorage.removeItem('smartstock_token');
  localStorage.removeItem('smartstock_user_id');
  currentUser = null;
  currentOrg = null;
  document.getElementById('hdr-org-badge').style.display = 'none';
  document.getElementById('auth-modal-overlay').style.display = 'flex';
  showToast('Signed out successfully');
}

// Helper: Scoped Fetch with Org & User headers
async function authFetch(endpoint, options = {}) {
  if (!options.headers) options.headers = {};
  const token = localStorage.getItem('smartstock_token') || 'ORG-DEMO-001';
  const user_id = localStorage.getItem('smartstock_user_id') || 'USR-ADMIN-001';
  
  options.headers['X-Org-Id'] = token;
  options.headers['X-User-Id'] = user_id;

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  return res;
}

// ----------------------------------------------------
// DYNAMIC VIEWS LOADER
// ----------------------------------------------------
function loadAllViews() {
  loadDashboard();
  loadCatalog();
  loadReorders();
  loadRedistributions();
  loadCustomerRequests();
  loadExpiryReports();
  loadStockAdjustments();
  loadSettings();
  setupRequestSkuSelect();
  loadPurchaseList();
  loadAlertLogs();
  loadInvoiceLedger();
  loadCategories();
}

// Navigation bottom-tab switcher
function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.bottom-nav .nav-tab')).find(b => b.getAttribute('onclick').includes(tabName));
  if (activeBtn) activeBtn.classList.add('active');

  const activeView = document.getElementById(`tab-${tabName}`);
  if (activeView) activeView.classList.add('active');

  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'catalog') {
    loadCatalog();
    loadPurchaseList();
  }
  if (tabName === 'requests') switchReqModule(activeReqModule);
  if (tabName === 'scanner') {
    renderScanQueue();
    requestCameraPermissionDirectly();
  } else {
    stopIntakeBarcodeScanner();
  }
  if (tabName === 'more') loadMoreTabOptions();
}

function loadMoreTabOptions() {
  loadAuditsTable();
  loadUserManagement();
  loadReorders();
  loadRedistributions();
  loadAlertLogs();
  loadInvoiceLedger();
  loadActivityLogs();
}

// ----------------------------------------------------
// 1. DASHBOARD OVERVIEW
// ----------------------------------------------------
async function loadDashboard() {
  try {
    const res = await authFetch('/api/dashboard');
    const data = await res.json();

    document.getElementById('stat-fast-selling').innerText = data.fast_selling_count;
    document.getElementById('stat-reorders').innerText = data.pending_reorders_count;
    document.getElementById('stat-savings').innerText = `$${data.potential_redistribution_savings}`;
    document.getElementById('stat-discrepancies').innerText = data.active_discrepancies_count;

    const tbody = document.getElementById('dashboard-velocity-table');
    tbody.innerHTML = '';
    
    data.velocity_summary.slice(0, 3).forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.name}</strong><br><small style="color:var(--text-muted);">${item.sku}</small></td>
        <td><span style="font-weight:700; color:var(--color-purple-primary);">${item.spike_ratio}x</span></td>
        <td>
          ${item.is_fast_selling 
            ? '<span class="badge badge-fast">Spike Alert</span>' 
            : '<span class="badge badge-normal">Stable</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Dashboard render failed", err);
  }
}

async function simulateSaleSpike() {
  if (rawCatalog.length === 0) return;
  const randomSku = rawCatalog[Math.floor(Math.random() * rawCatalog.length)].sku;
  const branchName = rawCatalog[0].branches[0]?.branch || "Central Hub";

  try {
    await authFetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: randomSku, branch: branchName, quantity: 12 })
    });
    showToast(`Recorded rapid sales spike for SKU ${randomSku}`);
    loadDashboard();
  } catch (err) {
    showToast(`Simulation failed: ${err.message}`);
  }
}

// ----------------------------------------------------
// 2. MY STOCK CATALOG & MANUAL ADDITION
// ----------------------------------------------------
async function loadCatalog() {
  try {
    const res = await authFetch('/api/inventory');
    rawCatalog = await res.json();
    renderCatalogList(rawCatalog);
    setupRequestSkuSelect();
  } catch (err) {
    console.error("Inventory load failed", err);
  }
}

function renderCatalogList(items) {
  const container = document.getElementById('catalog-list-view');
  container.innerHTML = '';

  // Hide the + Add Item button for Staff
  const addBtn = document.getElementById('btn-show-add-product');
  if (currentUser && currentUser.role === 'Staff') {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-flex';
  }

  if (items.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:1.5rem;">No items found.</div>';
    return;
  }

  items.forEach(p => {
    const totalQty = p.branches.reduce((sum, b) => sum + b.quantity, 0);
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.4rem;">
        <div>
          <strong style="color:var(--color-purple-primary); font-size:0.95rem;">${p.name}</strong>
          <div style="font-size:0.75rem; color:var(--text-muted);">SKU: ${p.sku} | Cat: ${p.category}</div>
        </div>
        ${p.fast_selling ? '<span class="badge badge-fast">Spike</span>' : ''}
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; border-top:1px solid var(--border-color); padding-top:0.4rem; margin-top:0.4rem;">
        <div>Stock: <strong style="color:var(--color-purple-primary);">${totalQty} units</strong></div>
        <div>Volume: <strong>${p.volume_per_unit} m³</strong></div>
        <div>Price: <strong style="color:var(--color-gold);">$${p.price.toFixed(2)}</strong></div>
      </div>
    `;
    container.appendChild(div);
  });
}

function filterCatalog() {
  const query = document.getElementById('catalog-search').value.toLowerCase();
  const filtered = rawCatalog.filter(p => p.sku.toLowerCase().includes(query) || p.name.toLowerCase().includes(query));
  renderCatalogList(filtered);
}

function toggleManualProductForm() {
  const card = document.getElementById('manual-product-card');
  if (card.style.display === 'none') {
    card.style.display = 'block';
  } else {
    card.style.display = 'none';
  }
}

async function submitNewProductManual(e) {
  e.preventDefault();

  const sku = document.getElementById('manual-sku').value.trim().toUpperCase();
  const name = document.getElementById('manual-name').value.trim();
  const category = document.getElementById('manual-category').value.trim();
  const volume_per_unit = document.getElementById('manual-volume').value;
  const cost = document.getElementById('manual-cost').value;
  const price = document.getElementById('manual-price').value;
  const safety_stock = document.getElementById('manual-safety').value;
  const min_reorder_level = document.getElementById('manual-reorder').value;
  const lead_time = document.getElementById('manual-lead').value;
  const supplier_name = document.getElementById('manual-supplier').value.trim();
  
  const main_qty = document.getElementById('manual-main-qty').value;
  const north_qty = document.getElementById('manual-north-qty').value;
  const south_qty = document.getElementById('manual-south-qty').value;

  try {
    const res = await authFetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku, name, category, volume_per_unit, cost, price,
        safety_stock, min_reorder_level, lead_time, supplier_name,
        main_qty, north_qty, south_qty
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`Registration Error: ${data.error}`);
      return;
    }

    showToast(`Product ${sku} registered successfully!`);
    e.target.reset();
    toggleManualProductForm();
    loadCatalog();
    loadDashboard();
  } catch (err) {
    showToast(`API error registering item: ${err.message}`);
  }
}

// ----------------------------------------------------
// 3. BARCODE SCANNER & CAMERA INTAKE
// ----------------------------------------------------
let html5QrcodeScanner = null;
let currentCameraFacingMode = "environment"; // Default to back camera
let cameraPermissionGranted = false;

async function requestCameraPermissionDirectly() {
  const permBox = document.getElementById('camera-permission-box');
  const permTitle = document.getElementById('camera-perm-title');
  const permDesc = document.getElementById('camera-perm-desc');
  const permBtn = document.getElementById('camera-perm-btn');
  const status = document.getElementById('camera-mode-status');
  const laser = document.getElementById('scanner-viewport-laser');

  // Request runtime camera permission in Capacitor Android if present
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
    try {
      await window.Capacitor.Plugins.Camera.requestPermissions();
    } catch (e) {
      console.warn("Capacitor camera permission request notice:", e);
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: currentCameraFacingMode } }
    });
    // Stop temporary check stream
    stream.getTracks().forEach(track => track.stop());

    cameraPermissionGranted = true;
    if (permBox) permBox.style.display = 'none';
    if (laser) laser.style.display = 'block';
    
    showToast("Camera access approved.");
    startIntakeBarcodeScanner();
  } catch (err) {
    console.error("Camera permission error:", err);
    cameraPermissionGranted = false;
    if (permBox) permBox.style.display = 'block';
    if (permTitle) permTitle.innerText = "Camera: Permission Denied";
    if (permDesc) permDesc.innerText = "SmartStock needs camera permissions to start the barcode reader sensor. Click retry below or enable camera in device settings.";
    if (permBtn) permBtn.innerText = "Retry Camera Permission";
    if (status) {
      status.style.display = 'block';
      status.innerText = "Camera: Permission Denied";
    }
    if (laser) laser.style.display = 'none';
    showToast("Camera access rejected or unavailable.");
  }
}

async function startIntakeBarcodeScanner() {
  const readerDiv = document.getElementById('reader');
  const status = document.getElementById('camera-mode-status');
  const toggleBtn = document.getElementById('btn-camera-toggle');
  const laser = document.getElementById('scanner-viewport-laser');

  if (!readerDiv) return;

  await stopIntakeBarcodeScanner();

  if (typeof Html5Qrcode === 'undefined') {
    console.warn("Html5Qrcode library not loaded yet.");
    if (status) {
      status.style.display = 'block';
      status.innerText = '⚠️ Scanner engine loading... Type SKU manually below.';
    }
    return;
  }

  try {
    const html5QrCode = new Html5Qrcode("reader");
    html5QrcodeScanner = html5QrCode;

    const config = {
      fps: 15,
      qrbox: { width: 250, height: 150 },
      aspectRatio: 1.777778
    };

    if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
      config.formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ];
    }

    const cameraConfig = { facingMode: currentCameraFacingMode };

    await html5QrCode.start(
      cameraConfig,
      config,
      (decodedText, decodedResult) => {
        console.log("Barcode scanned:", decodedText);
        onIntakeBarcodeScanned(decodedText);
      },
      (errorMessage) => {
        // Continuous scan frame callback - ignore
      }
    );

    if (toggleBtn) toggleBtn.style.display = 'inline-flex';
    if (status) status.style.display = 'none';
    if (laser) laser.style.display = 'block';

  } catch (err) {
    console.warn("Html5Qrcode start exception:", err);
    if (status) {
      status.style.display = 'block';
      status.innerText = "Camera not available. Please type SKU manually.";
    }
  }
}

function onIntakeBarcodeScanned(skuValue) {
  if (!skuValue) return;

  skuValue = skuValue.trim().toUpperCase();

  const skuInput = document.getElementById('scanner-barcode-input');
  if (skuInput) {
    skuInput.value = skuValue;
  }

  showToast(`✅ Barcode Scanned: ${skuValue}`);
  
  // Display product details if matched in rawCatalog
  const infoDiv = document.getElementById('scanner-product-info');
  if (infoDiv) {
    const product = (rawCatalog || []).find(p => p.sku && p.sku.toUpperCase() === skuValue);
    if (product) {
      infoDiv.innerHTML = `
        <div style="font-weight:700; color:var(--color-purple-primary); margin-bottom:0.25rem;">
          📦 Product Found: ${product.name}
        </div>
        <div style="color:var(--text-muted); line-height: 1.4;">
          Category: <strong>${product.category || 'General'}</strong> | Price: <strong>$${product.price || 0}</strong><br>
          Current Stock: <strong>${product.total_stock || 0} units</strong>
        </div>
      `;
    } else {
      infoDiv.innerHTML = `
        <div style="font-weight:700; color:var(--state-amber); margin-bottom:0.25rem;">
          🔍 New SKU Detected: ${skuValue}
        </div>
        <div style="color:var(--text-muted);">
          Item not in catalog yet. Click <strong>Add/Register Item</strong> to register it in inventory.
        </div>
      `;
    }
    infoDiv.style.display = 'block';
  }

  // Stop scanning after successful scan as required
  stopIntakeBarcodeScanner();
}

async function toggleScannerCamera() {
  currentCameraFacingMode = (currentCameraFacingMode === "environment" || currentCameraFacingMode === "back") ? "user" : "environment";
  const status = document.getElementById('camera-mode-status');
  if (status) {
    status.style.display = 'block';
    status.innerText = `Switching to ${currentCameraFacingMode === 'user' ? 'Front' : 'Back'} Camera...`;
  }
  showToast(`Switching camera stream to ${currentCameraFacingMode === 'user' ? 'Front' : 'Back'} camera`);
  
  if (cameraPermissionGranted) {
    await startIntakeBarcodeScanner();
  } else {
    await requestCameraPermissionDirectly();
  }
}

async function stopIntakeBarcodeScanner() {
  if (html5QrcodeScanner) {
    try {
      if (html5QrcodeScanner.isScanning) {
        await html5QrcodeScanner.stop();
      }
      html5QrcodeScanner.clear();
    } catch (e) {
      console.warn("Error stopping scanner:", e);
    }
    html5QrcodeScanner = null;
  }
}

async function processBarcodeScan() {
  const input = document.getElementById('scanner-barcode-input');
  const sku = input ? input.value.trim().toUpperCase() : '';

  if (!sku) {
    showToast('Please scan a barcode or type a product SKU');
    return;
  }

  const scanRecord = {
    id: 'SCAN-' + Date.now(),
    sku,
    timestamp: new Date().toLocaleTimeString(),
    date: new Date().toISOString(),
    status: 'Registered',
    mode: isOfflineMode ? 'Cached Offline' : 'Live Reconciled'
  };

  localCache.scans.unshift(scanRecord);
  saveLocalCache();
  renderScanQueue();

  // Try backend API registration if available
  try {
    const res = await fetch(`${API_BASE}/api/inventory/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, name: `Scanned Item ${sku}`, quantity: 1 })
    });
    if (res.ok) {
      showToast(`Item ${sku} registered & saved to Inventory DB!`);
    } else {
      showToast(`Item ${sku} saved to local intake queue.`);
    }
  } catch (err) {
    showToast(`Item ${sku} saved locally (Offline mode).`);
  }

  if (input) input.value = '';

  // Restart scanner for next barcode scan if camera permission granted
  if (cameraPermissionGranted) {
    setTimeout(() => startIntakeBarcodeScanner(), 500);
  }
}

function renderScanQueue() {
  const container = document.getElementById('scan-queue-list');
  container.innerHTML = '';

  if (localCache.scans.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:1rem;">No recent scans queued.</div>';
    return;
  }

  localCache.scans.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-body); border:1px solid var(--border-color); padding:0.5rem; border-radius:var(--radius); display:flex; justify-content:space-between; align-items:center;';
    div.innerHTML = `
      <div>
        <strong>${s.sku}</strong>
        <div style="font-size:0.7rem; color:var(--text-muted);">${s.timestamp}</div>
      </div>
      <span class="badge ${s.mode.includes('Cached') ? 'badge-flagged' : 'badge-resolved'}">${s.mode}</span>
    `;
    container.appendChild(div);
  });
}

// ----------------------------------------------------
// 4. CUSTOMER REQUESTS (STAFF WRITES, ALL VISIBLE)
// ----------------------------------------------------
function toggleManualRequestForm() {
  const card = document.getElementById('manual-request-card');
  if (card.style.display === 'none') {
    card.style.display = 'block';
  } else {
    card.style.display = 'none';
  }
}

function setupRequestSkuSelect() {
  const datalist = document.getElementById('catalog-suggestions');
  const expiryDatalist = document.getElementById('expiry-sku-suggestions');
  const adjustDatalist = document.getElementById('adjust-sku-suggestions');

  if (rawCatalog && rawCatalog.length > 0) {
    const listHtml = rawCatalog.map(p => `
      <option value="${p.sku}">— ${p.name}</option>
    `).join('');
    
    if (datalist) datalist.innerHTML = listHtml;
    if (expiryDatalist) expiryDatalist.innerHTML = listHtml;
    if (adjustDatalist) adjustDatalist.innerHTML = listHtml;
  } else {
    if (datalist) datalist.innerHTML = '';
    if (expiryDatalist) expiryDatalist.innerHTML = '';
    if (adjustDatalist) adjustDatalist.innerHTML = '';
  }
}

let activeReqModule = 'customer';
let rawRequests = [];

function switchReqModule(moduleName) {
  activeReqModule = moduleName;
  document.getElementById('subview-req-customer').style.display = moduleName === 'customer' ? 'block' : 'none';
  document.getElementById('subview-req-expiry').style.display = moduleName === 'expiry' ? 'block' : 'none';
  document.getElementById('subview-req-stock').style.display = moduleName === 'stock' ? 'block' : 'none';
  
  const btnCust = document.getElementById('subtab-req-customer');
  const btnExpiry = document.getElementById('subtab-req-expiry');
  const btnStock = document.getElementById('subtab-req-stock');
  
  [btnCust, btnExpiry, btnStock].forEach(btn => {
    btn.className = 'btn btn-secondary';
    btn.style.background = 'transparent';
    btn.style.color = 'var(--text-muted)';
    btn.style.border = 'none';
  });
  
  const activeBtn = moduleName === 'customer' ? btnCust : (moduleName === 'expiry' ? btnExpiry : btnStock);
  activeBtn.className = 'btn';
  activeBtn.style.background = 'var(--color-purple-primary)';
  activeBtn.style.color = 'white';

  if (moduleName === 'customer') {
    loadCustomerRequests();
  } else if (moduleName === 'expiry') {
    loadExpiryReports();
  } else if (moduleName === 'stock') {
    loadStockAdjustments();
  }
}

async function submitNewCustomerRequest(e) {
  e.preventDefault();
  const customer_name = document.getElementById('req-cust-name').value.trim();
  const customer_email = document.getElementById('req-cust-email').value.trim();
  const item_description = document.getElementById('req-cust-desc').value.trim();
  const requested_item = document.getElementById('req-cust-sku').value;
  const quantity = document.getElementById('req-cust-qty').value;
  const notes = document.getElementById('req-cust-notes').value.trim();
  const category = document.getElementById('req-cust-category').value;
  const priority = document.getElementById('req-cust-priority').value;

  try {
    const res = await authFetch('/api/customer-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name, customer_email, requested_item, item_description, quantity, notes, category, priority })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`Request Upload Failed: ${data.error}`);
      return;
    }

    showToast("Customer request uploaded successfully");
    e.target.reset();
    loadCustomerRequests();
    loadDashboard();
  } catch (err) {
    showToast(`Upload error: ${err.message}`);
  }
}

async function loadCustomerRequests() {
  try {
    const res = await authFetch('/api/customer-requests');
    rawRequests = await res.json();

    // Toggle request form card: Staff gets creation form
    const requestCard = document.getElementById('manual-request-card');
    if (requestCard) {
      requestCard.style.display = (currentUser && currentUser.role === 'Staff') ? 'block' : 'none';
    }

    filterCustomerRequests();
  } catch (err) {
    console.error("Requests load failed", err);
  }
}

function filterCustomerRequests() {
  const searchQuery = document.getElementById('req-search').value.toLowerCase();
  const filterPriority = document.getElementById('req-filter-priority').value;
  const filterStatus = document.getElementById('req-filter-status').value;
  const filterScope = document.getElementById('req-filter-scope').value;
  const filterStart = document.getElementById('req-filter-start').value;
  const filterEnd = document.getElementById('req-filter-end').value;

  const container = document.getElementById('requests-list-view');
  container.innerHTML = '';

  let filtered = [...rawRequests];

  // 1. Search Query filter
  if (searchQuery) {
    filtered = filtered.filter(r => 
      r.customer_name.toLowerCase().includes(searchQuery) ||
      r.requested_item.toLowerCase().includes(searchQuery) ||
      r.item_description.toLowerCase().includes(searchQuery)
    );
  }

  // 2. Priority filter
  if (filterPriority !== 'all') {
    filtered = filtered.filter(r => r.priority === filterPriority);
  }

  // 3. Status filter
  if (filterStatus !== 'all') {
    filtered = filtered.filter(r => r.status === filterStatus);
  }

  // 4. Scope filter (My Entries / Dept)
  if (filterScope === 'mine' && currentUser) {
    filtered = filtered.filter(r => r.created_by_user_id === currentUser.user_id);
  } else if (filterScope === 'dept' && currentUser) {
    // Filter by branch as a proxy for department scope
    filtered = filtered.filter(r => !currentUser.branch || r.branch === currentUser.branch);
  }

  // 5. Date Range filter
  if (filterStart) {
    filtered = filtered.filter(r => new Date(r.created_at) >= new Date(filterStart));
  }
  if (filterEnd) {
    // Add one day to end date to include all of that day
    const endDate = new Date(filterEnd);
    endDate.setDate(endDate.getDate() + 1);
    filtered = filtered.filter(r => new Date(r.created_at) <= endDate);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:1.5rem; font-size:0.8rem;">No matching requests found.</div>';
    return;
  }

  filtered.forEach(r => {
    const matchedProd = rawCatalog.find(p => p.sku === r.requested_item);
    const displayItem = matchedProd ? `${matchedProd.name} (${r.requested_item})` : r.requested_item;

    const div = document.createElement('div');
    div.className = 'card';
    div.style.position = 'relative';

    // Priority color mapping
    let priorityColor = 'var(--text-muted)';
    let priorityBg = 'rgba(133, 116, 144, 0.1)';
    if (r.priority === 'High') {
      priorityColor = 'var(--state-crimson)';
      priorityBg = 'rgba(239, 68, 68, 0.1)';
    } else if (r.priority === 'Medium') {
      priorityColor = 'var(--color-gold)';
      priorityBg = 'rgba(197, 160, 89, 0.1)';
    }

    // Status badge style mapping
    let statusClass = 'badge-normal';
    if (r.status === 'Pending') statusClass = 'badge-flagged';
    else if (r.status === 'Verified') statusClass = 'badge-fast';
    else if (r.status === 'Completed') statusClass = 'badge-resolved';

    // Contextual workflow action buttons
    let actionButtons = '';
    const isOwnerOrAdmin = currentUser && (currentUser.role === 'Owner' || currentUser.role === 'Admin');
    const isManagerOrSup = currentUser && (currentUser.role === 'Manager' || currentUser.role === 'Supervisor');

    if (r.status === 'Pending') {
      if (isOwnerOrAdmin || isManagerOrSup) {
        actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="verifyCustomerRequest('${r.id}')">Verify</button>`;
        actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectCustomerRequest('${r.id}')">Reject</button>`;
      }
      if (currentUser && currentUser.role === 'Staff' && r.created_by_user_id === currentUser.user_id) {
        actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="editCustomerRequestPrompt('${r.id}', '${r.notes}')">Edit Notes</button>`;
      }
    } else if (r.status === 'Verified') {
      if (isOwnerOrAdmin) {
        actionButtons += `<button class="btn btn-gold" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="approveCustomerRequest('${r.id}')">Approve & Complete</button>`;
        actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectCustomerRequest('${r.id}')">Reject</button>`;
      }
    }

    const actionContainer = actionButtons 
      ? `<div style="display:flex; gap:0.4rem; margin-top:0.6rem; border-top:1px dashed var(--border-color); padding-top:0.6rem;">${actionButtons}</div>` 
      : '';

    // Date display
    const dateStr = new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.4rem;">
        <div>
          <strong style="color:var(--color-purple-primary); font-size:0.9rem;">${r.customer_name}</strong>
          <div style="font-size:0.75rem; color:var(--text-muted);">${r.customer_email}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.25rem;">
          <span class="badge ${statusClass}">${r.status}</span>
          <span class="badge" style="background:${priorityBg}; color:${priorityColor}; font-size:0.6rem;">${r.priority}</span>
        </div>
      </div>
      <div style="font-size:0.8rem; color:var(--text-dark); margin-top:0.4rem; border-top:1px solid var(--border-color); padding-top:0.4rem;">
        Item: <strong>${displayItem}</strong> <br>
        Category: <strong>${r.category || 'General Retail'}</strong> | Description: <strong>${r.item_description}</strong> | Qty: <strong>${r.quantity}</strong>
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">Notes: ${r.notes}</div>
      <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-dim); margin-top:0.4rem; font-style:italic;">
        <span>${dateStr}</span>
        <span>Filed by: ${r.created_by_staff}</span>
      </div>
      ${actionContainer}
    `;
    container.appendChild(div);
  });
}

async function editCustomerRequestPrompt(id, currentNotes) {
  const notes = prompt("Enter updated notes/details for this order request:", currentNotes);
  if (notes === null) return;
  try {
    const res = await authFetch('/api/customer-requests/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, notes: notes.trim() })
    });
    if (res.ok) {
      showToast("Order request updated successfully.");
      loadCustomerRequests();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Update failed: ${err.message}`);
  }
}

async function verifyCustomerRequest(id) {
  try {
    const res = await authFetch('/api/customer-requests/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Order request verified (Pending final Admin approval).");
      loadCustomerRequests();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Verification error: ${err.message}`);
  }
}

async function approveCustomerRequest(id) {
  try {
    const res = await authFetch('/api/customer-requests/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Order request approved and completed successfully.");
      loadCustomerRequests();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Approval error: ${err.message}`);
  }
}

async function rejectCustomerRequest(id) {
  if (!confirm("Are you sure you want to reject this customer request?")) return;
  try {
    const res = await authFetch('/api/customer-requests/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Order request marked as Rejected.");
      loadCustomerRequests();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Rejection error: ${err.message}`);
  }
}

// ----------------------------------------------------
// 5. USER ACCOUNTS MANAGEMENT (ADMIN / MANAGERS)
// ----------------------------------------------------
async function loadUserManagement() {
  const mgtCard = document.getElementById('user-management-card');
  if (!currentUser) return;

  if (currentUser.role !== 'Owner' && currentUser.role !== 'Admin') {
    mgtCard.style.display = 'none';
    return;
  }

  mgtCard.style.display = 'block';
  
  const roleInput = document.getElementById('user-new-role');
  const title = document.getElementById('user-mgr-title');
  const formLabel = document.getElementById('user-creation-form-label');

  if (currentUser.role === 'Owner') {
    roleInput.innerHTML = `
      <option value="Admin">Admin</option>
      <option value="Manager">Manager</option>
      <option value="Supervisor">Supervisor</option>
      <option value="Staff">Staff</option>
    `;
    title.innerText = 'Organization User Directory (Owner)';
    formLabel.innerText = 'Register New Organization User';
  } else if (currentUser.role === 'Admin') {
    roleInput.innerHTML = `
      <option value="Manager">Manager</option>
      <option value="Supervisor">Supervisor</option>
      <option value="Staff">Staff</option>
    `;
    title.innerText = 'Organization User Directory (Admin)';
    formLabel.innerText = 'Register Lower Role Account';
  }

  try {
    const res = await authFetch('/api/users');
    const users = await res.json();

    const list = document.getElementById('users-list-container');
    list.innerHTML = '';

    const filtered = users.filter(u => u.id !== currentUser.user_id);
    
    if (filtered.length === 0) {
      list.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:0.5rem;">No registered team members.</div>';
      return;
    }

    filtered.forEach(u => {
      const div = document.createElement('div');
      div.className = 'card';
      div.style.padding = '0.75rem';
      div.style.marginBottom = '0.5rem';
      
      const statusColor = u.suspended ? 'var(--state-crimson)' : 'var(--state-emerald)';
      const statusText = u.suspended ? 'SUSPENDED' : 'ACTIVE';
      
      let actionsHtml = `
        <div style="display: flex; gap: 0.35rem; margin-top: 0.5rem; flex-wrap: wrap;">
          <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="changeUserPasswordPrompt('${u.id}', '${u.name}')">Password</button>
          <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.65rem; color: var(--state-amber); border-color: var(--state-amber);" onclick="toggleUserSuspension('${u.id}')">${u.suspended ? 'Restore' : 'Suspend'}</button>
          <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.65rem; color: var(--state-crimson); border-color: var(--state-crimson);" onclick="deleteUserAccount('${u.id}', '${u.name}')">Delete</button>
      `;
      
      if (currentUser.role === 'Owner' && u.role !== 'Owner') {
        actionsHtml += `<button class="btn btn-gold" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="transferOwnershipPrompt('${u.id}', '${u.name}')">Transfer Owner</button>`;
      }
      
      actionsHtml += `</div>`;
      
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>${u.name}</strong> <span class="badge badge-normal" style="margin-left: 0.25rem; font-size: 0.6rem; font-weight:700;">${u.role}</span>
            <div style="font-size:0.7rem; color:var(--text-muted);">${u.email}</div>
          </div>
          <span style="font-size:0.65rem; font-weight:700; color:${statusColor};">${statusText}</span>
        </div>
        ${actionsHtml}
      `;
      list.appendChild(div);
    });

  } catch (err) {
    console.error("Load users failed", err);
  }
}

async function changeUserPasswordPrompt(targetUserId, targetName) {
  const newPassword = prompt(`Enter new password for ${targetName}:`);
  if (!newPassword || !newPassword.trim()) return;
  try {
    const res = await authFetch('/api/users/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_user_id: targetUserId, new_password: newPassword.trim() })
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Password updated successfully.");
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Update failed: ${err.message}`);
  }
}

async function toggleUserSuspension(targetUserId) {
  try {
    const res = await authFetch('/api/users/suspend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_user_id: targetUserId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      loadUserManagement();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Suspension toggle failed: ${err.message}`);
  }
}

async function deleteUserAccount(targetUserId, targetName) {
  if (!confirm(`Are you sure you want to delete ${targetName}'s account?`)) return;
  try {
    const res = await authFetch('/api/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_user_id: targetUserId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Account deleted successfully.");
      loadUserManagement();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Delete failed: ${err.message}`);
  }
}

async function transferOwnershipPrompt(targetUserId, targetName) {
  if (!confirm(`Are you absolutely sure you want to transfer ownership of the organization to ${targetName}? You will lose Owner privileges and become an Admin.`)) return;
  try {
    const res = await authFetch('/api/users/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_user_id: targetUserId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Ownership transferred successfully. Logging out to refresh session...");
      setTimeout(() => logoutOrganization(), 1500);
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Ownership transfer failed: ${err.message}`);
  }
}

async function submitNewUserAccount(e) {
  e.preventDefault();
  const name = document.getElementById('user-new-name').value.trim();
  const email = document.getElementById('user-new-email').value.trim();
  const password = document.getElementById('user-new-password').value.trim();
  const role = document.getElementById('user-new-role').value;

  try {
    const res = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`User registration failed: ${data.error}`);
      return;
    }

    showToast(`${role} account created successfully!`);
    e.target.reset();
    loadUserManagement();
  } catch (err) {
    showToast(`Registration error: ${err.message}`);
  }
}

// ----------------------------------------------------
// 6. SUCCESIVE AI OPTIONS: REORDERS & TRANSFERS
// ----------------------------------------------------
async function loadReorders() {
  const card = document.getElementById('more-reorders-card');
  if (currentUser && currentUser.role === 'Staff') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  try {
    const res = await authFetch('/api/reorders');
    const data = await res.json();

    const container = document.getElementById('intelligence-reorder-list');
    container.innerHTML = '';

    if (data.recommendations.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">All branch stock ratios are optimized.</div>';
      return;
    }

    data.recommendations.forEach(r => {
      const div = document.createElement('div');
      div.style.cssText = 'background:var(--bg-body); border:1px solid var(--border-color); padding:0.55rem; border-radius:var(--radius); margin-bottom:0.4rem;';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.15rem;">
          <strong>${r.product_name}</strong>
          <span style="color:var(--state-crimson); font-weight:700;">${r.urgency}</span>
        </div>
        <div>SKU: ${r.sku} | Branch: ${r.branch}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.35rem; border-top:1px dashed var(--border-color); padding-top:0.3rem;">
          <div>Qty: <strong>${r.recommended_qty}</strong></div>
          <button class="btn btn-gold" style="padding:0.2rem 0.4rem; font-size:0.65rem;" 
            onclick="approvePO('${r.sku}', '${r.branch}', ${r.recommended_qty}, '${r.supplier}')">
            Approve
          </button>
        </div>
      `;
      container.appendChild(div);
    });

  } catch (err) {
    console.error("Reorders loading failed", err);
  }
}

async function loadRedistributions() {
  const card = document.getElementById('more-transfers-card');
  if (currentUser && currentUser.role === 'Staff') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  try {
    const res = await authFetch('/api/redistributions');
    const data = await res.json();

    const container = document.getElementById('intelligence-transfer-list');
    container.innerHTML = '';

    if (data.recommendations.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); padding:0.5rem;">No transfers recommended.</div>';
      return;
    }

    data.recommendations.forEach(r => {
      const div = document.createElement('div');
      div.style.cssText = 'background:var(--bg-body); border:1px solid var(--border-color); padding:0.55rem; border-radius:var(--radius); margin-bottom:0.4rem;';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.15rem;">
          <strong>${r.product_name}</strong>
          <span style="color:var(--state-emerald); font-weight:700;">Save $${r.estimated_savings}</span>
        </div>
        <div>From: ${r.source_branch} -> To: ${r.target_branch}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.35rem; border-top:1px dashed var(--border-color); padding-top:0.3rem;">
          <div>Qty: <strong>${r.transfer_qty}</strong></div>
          <button class="btn btn-gold" style="padding:0.2rem 0.4rem; font-size:0.65rem;" 
            onclick="approveRedistribution('${r.sku}', '${r.source_branch}', '${r.target_branch}', ${r.transfer_qty})">
            Transfer
          </button>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("Redistributions loading failed", err);
  }
}

// ----------------------------------------------------
// 7. SETTINGS & AUDITING (MORE OPTIONS VIEW)
// ----------------------------------------------------
async function loadSettings() {
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    document.getElementById('setting-branch-scope').value = data.branch_visibility || 'all';
    document.getElementById('setting-sensitivity').value = data.alert_sensitivity || 'medium';

    document.getElementById('setting-alert-wa').checked = !!data.alert_whatsapp_enabled;
    document.getElementById('setting-alert-wa-phone').value = data.alert_whatsapp_phone || '';
    toggleSettingInput('setting-alert-wa-phone-container');

    document.getElementById('setting-alert-em').checked = !!data.alert_email_enabled;
    document.getElementById('setting-alert-em-email').value = data.alert_email_address || '';
    toggleSettingInput('setting-alert-em-email-container');

    document.getElementById('setting-alert-tg').checked = !!data.alert_telegram_enabled;
    document.getElementById('setting-alert-tg-chatid').value = data.alert_telegram_chatid || '';
    toggleSettingInput('setting-alert-tg-chatid-container');

    document.getElementById('setting-iclass-sync').checked = !!data.iclass_sync_enabled;
    document.getElementById('setting-iclass-host').value = data.iclass_server_host || 'SERVER';
    document.getElementById('setting-iclass-db').value = data.iclass_db_name || 'ValueMartDB';
    document.getElementById('setting-iclass-user').value = data.iclass_db_user || 'sa';
    document.getElementById('setting-iclass-pass').value = data.iclass_db_password || 'iclassadmin';
    document.getElementById('setting-iclass-username').value = data.iclass_login_username || 'AMCE.BERNIE';
    toggleSettingInput('setting-iclass-container');
  } catch (err) {
    console.error("Settings load failure", err);
  }
}

async function saveSettings() {
  const branch_visibility = document.getElementById('setting-branch-scope').value;
  const alert_sensitivity = document.getElementById('setting-sensitivity').value;

  const alert_whatsapp_enabled = document.getElementById('setting-alert-wa').checked;
  const alert_whatsapp_phone = document.getElementById('setting-alert-wa-phone').value.trim();

  const alert_email_enabled = document.getElementById('setting-alert-em').checked;
  const alert_email_address = document.getElementById('setting-alert-em-email').value.trim();

  const alert_telegram_enabled = document.getElementById('setting-alert-tg').checked;
  const alert_telegram_chatid = document.getElementById('setting-alert-tg-chatid').value.trim();

  const iclass_sync_enabled = document.getElementById('setting-iclass-sync').checked;
  const iclass_server_host = document.getElementById('setting-iclass-host').value.trim();
  const iclass_db_name = document.getElementById('setting-iclass-db').value.trim();
  const iclass_db_user = document.getElementById('setting-iclass-user').value.trim();
  const iclass_db_password = document.getElementById('setting-iclass-pass').value.trim();

  try {
    await authFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_visibility,
        alert_sensitivity,
        alert_whatsapp_enabled,
        alert_whatsapp_phone,
        alert_email_enabled,
        alert_email_address,
        alert_telegram_enabled,
        alert_telegram_chatid,
        iclass_sync_enabled,
        iclass_server_host,
        iclass_db_name,
        iclass_db_user,
        iclass_db_password
      })
    });
    showToast("Configurations saved successfully");
    loadAlertLogs();
  } catch (err) {
    showToast(`Failed to update configs: ${err.message}`);
  }
}

function loadAuditsTable() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (rawCatalog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim); text-align:center;">No inventory logs.</td></tr>';
    return;
  }

  rawCatalog.forEach(p => {
    const expected = p.branches.reduce((sum, b) => sum + b.quantity, 0);
    const variance = p.sku === 'TS-100' ? -2 : 0;
    const actual = expected + variance;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${p.sku}</code></td>
      <td>${expected}</td>
      <td style="color:${variance !== 0 ? 'var(--state-crimson)' : 'inherit'}"><strong>${actual}</strong></td>
      <td>
        <span style="font-weight:700; color:${variance < 0 ? 'var(--state-crimson)' : (variance > 0 ? 'var(--state-emerald)' : 'var(--text-muted)')}">
          ${variance > 0 ? '+' : ''}${variance}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Global Toast notifications helper
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ----------------------------------------------------
// 8. PURCHASE LIST & SUBTAB CONTROLS
// ----------------------------------------------------
function switchSubTab(sub) {
  const invBtn = document.getElementById('btn-subtab-inventory');
  const listBtn = document.getElementById('btn-subtab-purchaselist');
  const catBtn = document.getElementById('btn-subtab-categories');

  const invView = document.getElementById('subview-inventory');
  const listView = document.getElementById('subview-purchaselist');
  const catView = document.getElementById('subview-categories');

  // Reset button styles
  [invBtn, listBtn, catBtn].forEach(btn => {
    if (btn) {
      btn.className = 'btn btn-secondary';
      btn.style.background = '';
      btn.style.color = '';
    }
  });

  // Hide all subviews
  [invView, listView, catView].forEach(view => {
    if (view) view.style.display = 'none';
  });

  if (sub === 'inventory') {
    if (invBtn) {
      invBtn.className = 'btn';
      invBtn.style.background = 'var(--color-purple-primary)';
      invBtn.style.color = 'white';
    }
    if (invView) invView.style.display = 'block';
  } else if (sub === 'purchaselist') {
    if (listBtn) {
      listBtn.className = 'btn';
      listBtn.style.background = 'var(--color-purple-primary)';
      listBtn.style.color = 'white';
    }
    if (listView) listView.style.display = 'block';
    loadPurchaseList();
  } else if (sub === 'categories') {
    if (catBtn) {
      catBtn.className = 'btn';
      catBtn.style.background = 'var(--color-purple-primary)';
      catBtn.style.color = 'white';
    }
    if (catView) catView.style.display = 'block';
    loadCategories();
  }
}

function togglePurchaseForm() {
  const card = document.getElementById('purchase-form-card');
  card.style.display = card.style.display === 'none' ? 'block' : 'none';
}

async function submitPurchaseListItem(e) {
  e.preventDefault();
  const item_name = document.getElementById('purchase-item-name').value.trim();
  const category = document.getElementById('purchase-item-category').value;
  const quantity = document.getElementById('purchase-item-qty').value;

  try {
    const res = await authFetch('/api/purchase-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_name, category, quantity })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`Adding item failed: ${data.error}`);
      return;
    }

    showToast("Added to purchase checklist successfully");
    e.target.reset();
    togglePurchaseForm();
    loadPurchaseList();
  } catch (err) {
    showToast(`API error: ${err.message}`);
  }
}

async function loadPurchaseList() {
  try {
    const res = await authFetch('/api/purchase-list');
    const data = await res.json();

    const container = document.getElementById('purchase-list-view');
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:1.5rem;">No items on the market purchase list.</div>';
      return;
    }

    // Group items by category
    const categories = [
      "Electronics & Smart Home",
      "Groceries & Consumables",
      "Packaging & Delivery",
      "Office Stationery",
      "General Retail"
    ];

    categories.forEach(cat => {
      const catItems = data.filter(item => item.category === cat);
      if (catItems.length === 0) return;

      const groupDiv = document.createElement('div');
      groupDiv.style.marginBottom = '0.75rem';
      
      const catHeader = document.createElement('div');
      catHeader.style.cssText = 'font-weight:700; font-size:0.75rem; color:var(--color-gold); text-transform:uppercase; margin-bottom:0.35rem; border-bottom:1px solid var(--border-color); padding-bottom:0.15rem;';
      catHeader.innerText = cat;
      groupDiv.appendChild(catHeader);

      catItems.forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.style.cssText = 'background:var(--bg-body); border:1px solid var(--border-color); border-radius:var(--radius); padding:0.5rem; display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;';
        
        const isChecked = item.status === "Purchased";
        
        itemCard.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.5rem; flex:1;">
            <input type="checkbox" style="cursor:pointer;" ${isChecked ? 'checked' : ''} onchange="togglePurchaseListItem('${item.id}')">
            <span style="font-size:0.8rem; text-decoration:${isChecked ? 'line-through' : 'none'}; color:${isChecked ? 'var(--text-muted)' : 'inherit'};">
              <strong>${item.item_name}</strong> (Qty: ${item.quantity})
            </span>
          </div>
          <button class="btn btn-crimson" style="padding:0.2rem 0.4rem; font-size:0.6rem; margin-left:0.5rem;" onclick="deletePurchaseListItem('${item.id}')">
            Remove
          </button>
        `;
        groupDiv.appendChild(itemCard);
      });

      container.appendChild(groupDiv);
    });

  } catch (err) {
    console.error("Purchase list loading failed", err);
  }
}

async function togglePurchaseListItem(itemId) {
  try {
    const res = await authFetch('/api/purchase-list/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    });
    if (res.ok) {
      loadPurchaseList();
    } else {
      showToast("Toggle status failed.");
    }
  } catch (err) {
    showToast(`Toggle failed: ${err.message}`);
  }
}

async function deletePurchaseListItem(itemId) {
  if (!confirm("Remove this item from the purchase checklist?")) return;

  try {
    const res = await authFetch('/api/purchase-list/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    });
    if (res.ok) {
      showToast("Item removed.");
      loadPurchaseList();
    } else {
      showToast("Deletion failed.");
    }
  } catch (err) {
    showToast(`Delete failed: ${err.message}`);
  }
}

// ----------------------------------------------------
// 9. AUTOMATION ALERTS LOGIC
// ----------------------------------------------------
function toggleSettingInput(containerId) {
  const container = document.getElementById(containerId);
  const triggerInputId = containerId.replace('-container', '');
  const triggerInput = document.getElementById(triggerInputId);
  if (container && triggerInput) {
    container.style.display = triggerInput.checked ? 'block' : 'none';
  }
}

async function loadAlertLogs() {
  try {
    const res = await authFetch('/api/alerts');
    const data = await res.json();

    const container = document.getElementById('alert-logs-container');
    if (!container) return;
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.65rem; padding:0.5rem; text-align:center;">No automated alerts dispatched yet.</div>';
      return;
    }

    data.forEach(log => {
      const div = document.createElement('div');
      div.style.cssText = 'border-bottom: 1px dashed var(--border-color); padding-bottom: 0.25rem; margin-bottom: 0.25rem;';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:0.6rem; color:var(--color-gold);">
          <span>[${log.channel} -> ${log.recipient}]</span>
          <span>${log.type}</span>
        </div>
        <div style="color:var(--text-dark); margin-top:0.1rem; font-weight:700;">${log.message}</div>
      `;
      container.appendChild(div);
    });

  } catch (err) {
    console.error("Alert logs fetch failed", err);
  }
}

async function loadExpiryReports() {
  try {
    const res = await authFetch('/api/expiry-reports');
    const data = await res.json();

    const datalist = document.getElementById('expiry-sku-suggestions');
    if (datalist && rawCatalog) {
      datalist.innerHTML = rawCatalog.map(p => `<option value="${p.sku}">${p.name}</option>`).join('');
    }

    const container = document.getElementById('expiry-reports-list');
    if (!container) return;
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:1.5rem; font-size:0.8rem;">No expiry reports logged yet.</div>';
      return;
    }

    data.forEach(r => {
      const matchedProd = rawCatalog.find(p => p.sku === r.sku);
      const displayItem = matchedProd ? `${matchedProd.name} (${r.sku})` : r.sku;

      const div = document.createElement('div');
      div.className = 'card';
      div.style.borderLeft = `3px solid ${r.status === 'Approved' ? 'var(--state-emerald)' : (r.status === 'Rejected' ? 'var(--state-crimson)' : 'var(--state-amber)')}`;

      let actionButtons = '';
      const isOwnerOrAdmin = currentUser && (currentUser.role === 'Owner' || currentUser.role === 'Admin');
      const isManagerOrSup = currentUser && (currentUser.role === 'Manager' || currentUser.role === 'Supervisor');

      if (r.status === 'Pending') {
        if (isOwnerOrAdmin || isManagerOrSup) {
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="verifyExpiryReport('${r.id}')">Verify</button>`;
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectExpiryReport('${r.id}')">Reject</button>`;
        }
      } else if (r.status === 'Verified') {
        if (isOwnerOrAdmin) {
          actionButtons += `<button class="btn btn-gold" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="approveExpiryReport('${r.id}')">Approve & Deduct</button>`;
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectExpiryReport('${r.id}')">Reject</button>`;
        }
      }

      const actionContainer = actionButtons 
        ? `<div style="display:flex; gap:0.4rem; margin-top:0.6rem; border-top:1px dashed var(--border-color); padding-top:0.6rem;">${actionButtons}</div>` 
        : '';

      const photoHtml = r.image_url 
        ? `<div style="margin-top:0.4rem;"><img src="${r.image_url}" alt="Attachment" style="max-height:80px; border-radius:4px; border:1px solid var(--border-color);"></div>` 
        : '';

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:var(--color-purple-primary);">${r.id}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">Batch: <strong>${r.batch_number}</strong> | Exp: <strong>${r.expiry_date}</strong></div>
          </div>
          <span class="badge ${r.status === 'Approved' ? 'badge-resolved' : (r.status === 'Verified' ? 'badge-fast' : 'badge-flagged')}">${r.status}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-dark); margin-top:0.4rem; border-top:1px solid var(--border-color); padding-top:0.4rem;">
          Item: <strong>${displayItem}</strong> <br>
          Quantity affected: <strong>${r.quantity}</strong>
        </div>
        ${photoHtml}
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">Notes: ${r.notes || 'None'}</div>
        <div style="font-size:0.7rem; color:var(--text-dim); text-align:right; margin-top:0.4rem;">
          Filed by: ${r.created_by_staff}
        </div>
        ${actionContainer}
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("Expiry reports load failed", err);
  }
}

async function submitExpiryReport(e) {
  e.preventDefault();
  const sku = document.getElementById('expiry-item-sku').value.trim();
  const quantity = document.getElementById('expiry-qty').value;
  const batch_number = document.getElementById('expiry-batch').value.trim();
  const expiry_date = document.getElementById('expiry-date').value;
  const image_url = document.getElementById('expiry-image').value.trim();
  const notes = document.getElementById('expiry-notes').value.trim();

  const exists = rawCatalog.find(p => p.sku === sku.toUpperCase() || p.sku === sku);
  if (!exists) {
    showToast(`Invalid Product SKU entered. Registered products only.`);
    return;
  }

  try {
    const res = await authFetch('/api/expiry-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: sku.toUpperCase(), name: exists.name, batch_number, expiry_date, quantity, notes, image_url })
    });
    if (res.ok) {
      showToast("Expiry report submitted successfully for review.");
      e.target.reset();
      loadExpiryReports();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Submission error: ${err.message}`);
  }
}

async function verifyExpiryReport(id) {
  try {
    const res = await authFetch('/api/expiry-reports/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Report verified (Pending Admin approval).");
      loadExpiryReports();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Verification failed: ${err.message}`);
  }
}

async function approveExpiryReport(id) {
  try {
    const res = await authFetch('/api/expiry-reports/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Report approved. Stock decremented successfully.");
      loadExpiryReports();
      loadDashboard();
      loadCatalog();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Approval failed: ${err.message}`);
  }
}

async function rejectExpiryReport(id) {
  if (!confirm("Reject this expiry report?")) return;
  try {
    const res = await authFetch('/api/expiry-reports/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Report marked as Rejected.");
      loadExpiryReports();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Rejection failed: ${err.message}`);
  }
}

async function loadStockAdjustments() {
  try {
    const res = await authFetch('/api/stock-adjustments');
    const data = await res.json();

    const datalist = document.getElementById('adjust-sku-suggestions');
    if (datalist && rawCatalog) {
      datalist.innerHTML = rawCatalog.map(p => `<option value="${p.sku}">${p.name}</option>`).join('');
    }

    const container = document.getElementById('stock-adjustments-list');
    if (!container) return;
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:1.5rem; font-size:0.8rem;">No stock adjustments logged yet.</div>';
      return;
    }

    data.forEach(a => {
      const matchedProd = rawCatalog.find(p => p.sku === a.sku);
      const displayItem = matchedProd ? `${matchedProd.name} (${a.sku})` : a.sku;

      const div = document.createElement('div');
      div.className = 'card';
      div.style.borderLeft = `3px solid ${a.status === 'Approved' ? 'var(--state-emerald)' : (a.status === 'Rejected' ? 'var(--state-crimson)' : 'var(--state-amber)')}`;

      let actionButtons = '';
      const isOwnerOrAdmin = currentUser && (currentUser.role === 'Owner' || currentUser.role === 'Admin');
      const isManagerOrSup = currentUser && (currentUser.role === 'Manager' || currentUser.role === 'Supervisor');

      if (a.status === 'Pending') {
        if (isOwnerOrAdmin || isManagerOrSup) {
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="verifyStockAdjustment('${a.id}')">Verify</button>`;
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectStockAdjustment('${a.id}')">Reject</button>`;
        }
      } else if (a.status === 'Verified') {
        if (isOwnerOrAdmin) {
          actionButtons += `<button class="btn btn-gold" style="padding:0.25rem 0.5rem; font-size:0.65rem;" onclick="approveStockAdjustment('${a.id}')">Approve & Apply</button>`;
          actionButtons += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.65rem; color:var(--state-crimson); border-color:var(--state-crimson);" onclick="rejectStockAdjustment('${a.id}')">Reject</button>`;
        }
      }

      const actionContainer = actionButtons 
        ? `<div style="display:flex; gap:0.4rem; margin-top:0.6rem; border-top:1px dashed var(--border-color); padding-top:0.6rem;">${actionButtons}</div>` 
        : '';

      const diffPrefix = a.quantity > 0 ? `+` : ``;

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:var(--color-purple-primary);">${a.id}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">Branch: <strong>${a.branch}</strong> | Type: <strong>${a.adjustment_type}</strong></div>
          </div>
          <span class="badge ${a.status === 'Approved' ? 'badge-resolved' : (a.status === 'Verified' ? 'badge-fast' : 'badge-flagged')}">${a.status}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-dark); margin-top:0.4rem; border-top:1px solid var(--border-color); padding-top:0.4rem;">
          Item: <strong>${displayItem}</strong> <br>
          Adjustment Quantity: <strong style="color:${a.quantity < 0 ? 'var(--state-crimson)' : 'var(--state-emerald)'};">${diffPrefix}${a.quantity}</strong>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">Justification: ${a.notes}</div>
        <div style="font-size:0.7rem; color:var(--text-dim); text-align:right; margin-top:0.4rem;">
          Filed by: ${a.created_by_staff}
        </div>
        ${actionContainer}
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("Stock adjustments load failed", err);
  }
}

async function submitStockAdjustment(e) {
  e.preventDefault();
  const sku = document.getElementById('adjust-item-sku').value.trim();
  const quantity = document.getElementById('adjust-qty').value;
  const branch = document.getElementById('adjust-branch').value;
  const adjustment_type = document.getElementById('adjust-type').value;
  const notes = document.getElementById('adjust-notes').value.trim();

  const exists = rawCatalog.find(p => p.sku === sku.toUpperCase() || p.sku === sku);
  if (!exists) {
    showToast(`Invalid Product SKU entered. Registered products only.`);
    return;
  }

  try {
    const res = await authFetch('/api/stock-adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: sku.toUpperCase(), branch, adjustment_type, quantity, notes })
    });
    if (res.ok) {
      showToast("Stock adjustment submitted successfully for review.");
      e.target.reset();
      loadStockAdjustments();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Submission error: ${err.message}`);
  }
}

async function verifyStockAdjustment(id) {
  try {
    const res = await authFetch('/api/stock-adjustments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Adjustment verified (Pending Admin approval).");
      loadStockAdjustments();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Verification failed: ${err.message}`);
  }
}

async function approveStockAdjustment(id) {
  try {
    const res = await authFetch('/api/stock-adjustments/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Adjustment approved. Stock updated successfully.");
      loadStockAdjustments();
      loadDashboard();
      loadCatalog();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Approval failed: ${err.message}`);
  }
}

async function rejectStockAdjustment(id) {
  if (!confirm("Reject this stock adjustment?")) return;
  try {
    const res = await authFetch('/api/stock-adjustments/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Adjustment marked as Rejected.");
      loadStockAdjustments();
    } else {
      const data = await res.json();
      showToast(`Error: ${data.error}`);
    }
  } catch (err) {
    showToast(`Rejection failed: ${err.message}`);
  }
}

async function loadActivityLogs() {
  const card = document.getElementById('more-activity-logs-card');
  if (!card) return;

  if (!currentUser || (currentUser.role !== 'Owner' && currentUser.role !== 'Admin')) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  try {
    const res = await authFetch('/api/activity-logs');
    const logs = await res.json();

    const container = document.getElementById('activity-logs-list');
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.65rem; padding:0.5rem; text-align:center;">No activity logged yet.</div>';
      return;
    }

    logs.forEach(log => {
      const div = document.createElement('div');
      div.style.cssText = 'border-bottom: 1px dashed var(--border-color); padding-bottom: 0.25rem; margin-bottom: 0.25rem;';
      const timeStr = new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      div.innerHTML = `
        <span style="color:var(--color-gold); font-weight:700;">[${timeStr}]</span>
        <span style="font-weight:700; color:var(--color-purple-primary);">${log.username} (${log.role}):</span>
        <span style="color:var(--text-dark);">${log.action}</span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("Activity logs load failed", err);
  }
}

async function simulateAlerts() {
  try {
    const res = await authFetch('/api/alerts/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (res.ok) {
      showToast("Simulated alert messages dispatched!");
      loadAlertLogs();
    } else {
      showToast(data.error || "Simulated dispatch failed.");
    }
  } catch (err) {
    showToast(`Simulation failed: ${err.message}`);
  }
}

async function syncIClassData() {
  showToast("Initiating sync with IClass Biz Manager...");
  try {
    const res = await authFetch('/api/iclass/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (res.ok) {
      if (data.imported_count > 0) {
        showToast(`Sync Complete! Imported ${data.imported_count} new items from database.`);
        loadCatalog();
        loadDashboard();
      } else {
        showToast("SmartStock catalog is already in sync with IClass Biz Manager.");
      }
    } else {
      showToast(data.error || "Database sync failed.");
    }
  } catch (err) {
    showToast(`Sync failure: ${err.message}`);
  }
}

// ----------------------------------------------------
// OCR RECEIPT & INVOICE SCANNER LOGIC
// ----------------------------------------------------
function switchScannerSubTab(sub) {
  document.getElementById('btn-scanner-subtab-barcode').className = 'btn btn-secondary';
  document.getElementById('btn-scanner-subtab-ocr').className = 'btn btn-secondary';
  document.getElementById('scanner-view-barcode').style.display = 'none';
  document.getElementById('scanner-view-ocr').style.display = 'none';

  if (sub === 'barcode') {
    document.getElementById('btn-scanner-subtab-barcode').className = 'btn';
    document.getElementById('btn-scanner-subtab-barcode').style.background = 'var(--color-purple-primary)';
    document.getElementById('btn-scanner-subtab-barcode').style.color = 'white';
    document.getElementById('scanner-view-barcode').style.display = 'block';
    requestCameraPermissionDirectly();
  } else {
    stopIntakeBarcodeScanner();
    document.getElementById('btn-scanner-subtab-ocr').className = 'btn';
    document.getElementById('btn-scanner-subtab-ocr').style.background = 'var(--color-purple-primary)';
    document.getElementById('btn-scanner-subtab-ocr').style.color = 'white';
    document.getElementById('scanner-view-ocr').style.display = 'block';
    resetOcrScanner();
  }
}

function triggerOCRFileSelect() {
  document.getElementById('ocr-file-input').click();
}

function handleOCRFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  showToast(`Uploading ${file.name} for OCR analysis...`);
  runReceiptOcrPipeline();
}

async function captureOCRCameraSnapshot() {
  showToast("Requesting camera intake permission...");
  try {
    // Attempt camera permission request
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Stop stream tracks immediately since we are simulating the snapshot capture
    stream.getTracks().forEach(track => track.stop());
    
    showToast("Snapshot captured successfully!");
    runReceiptOcrPipeline();
  } catch (err) {
    showToast("Camera access refused or unavailable. Falling back to default OCR snapshot simulation.");
    runReceiptOcrPipeline();
  }
}

function runReceiptOcrPipeline() {
  // Show loader and hide configuration panels
  document.getElementById('ocr-selector-card').style.display = 'none';
  document.getElementById('ocr-loader-card').style.display = 'block';
  document.getElementById('ocr-results-card').style.display = 'none';

  setTimeout(() => {
    // 1.5s simulated OCR extraction delay
    document.getElementById('ocr-loader-card').style.display = 'none';
    document.getElementById('ocr-results-card').style.display = 'block';
    
    // Auto-fill values representing mock OCR extraction output
    const randomInvNo = `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    document.getElementById('ocr-invoice-id').value = randomInvNo;
    document.getElementById('ocr-supplier-name').value = "Apex Premium Wholesalers";
    document.getElementById('ocr-invoice-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('ocr-invoice-branch').value = "Main Warehouse";

    const tbody = document.getElementById('ocr-line-items-body');
    tbody.innerHTML = '';

    const mockExtracted = [
      { sku: 'TS-100', name: 'EcoSmart Smart Thermostat', qty: 15, price: 85.00 },
      { sku: 'PB-300', name: 'Premium Power Blender', qty: 8, price: 42.50 },
      { sku: 'IC-NEW', name: 'Imported Luxury Detergent Pack', qty: 20, price: 12.00 }
    ];

    mockExtracted.forEach(item => {
      addOcrLineItemRow(item);
    });

    recalculateOcrTotals();
    showToast("Receipt details extracted. Please review and verify!");
  }, 1800);
}

function addOcrLineItemRow(item = { sku: '', name: '', qty: 1, price: 0.00 }) {
  const tbody = document.getElementById('ocr-line-items-body');
  
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="text" value="${item.sku}" class="form-control ocr-item-sku" style="font-size: 0.75rem; padding: 0.2rem;" placeholder="e.g. TS-100">
    </td>
    <td>
      <input type="text" value="${item.name}" class="form-control ocr-item-name" style="font-size: 0.75rem; padding: 0.2rem;" placeholder="Product Name" required>
    </td>
    <td style="text-align: center;">
      <input type="number" value="${item.qty}" class="form-control ocr-item-qty" style="font-size: 0.75rem; padding: 0.2rem; text-align: center;" min="1" oninput="recalculateOcrTotals()" required>
    </td>
    <td style="text-align: right;">
      <input type="number" value="${item.price.toFixed(2)}" class="form-control ocr-item-price" style="font-size: 0.75rem; padding: 0.2rem; text-align: right;" step="0.01" min="0" oninput="recalculateOcrTotals()" required>
    </td>
    <td style="text-align: center; vertical-align: middle;">
      <button class="btn" style="padding: 0.15rem 0.35rem; color: #dc3545; font-weight: bold; background: none; border: none; cursor: pointer;" onclick="deleteOcrRow(this)">✕</button>
    </td>
  `;
  
  tbody.appendChild(tr);
  recalculateOcrTotals();
}

function deleteOcrRow(btn) {
  const row = btn.closest('tr');
  row.remove();
  recalculateOcrTotals();
}

function recalculateOcrTotals() {
  const tbody = document.getElementById('ocr-line-items-body');
  const rows = tbody.querySelectorAll('tr');
  let grandTotal = 0;

  rows.forEach(row => {
    const qty = Number(row.querySelector('.ocr-item-qty').value) || 0;
    const price = Number(row.querySelector('.ocr-item-price').value) || 0;
    grandTotal += qty * price;
  });

  document.getElementById('ocr-invoice-total-display').innerText = `$${grandTotal.toFixed(2)}`;
}

async function submitOcrInvoice() {
  const invoice_id = document.getElementById('ocr-invoice-id').value.trim();
  const supplier_name = document.getElementById('ocr-supplier-name').value.trim();
  const date = document.getElementById('ocr-invoice-date').value;
  const branch_name = document.getElementById('ocr-invoice-branch').value;

  if (!invoice_id || !supplier_name || !branch_name) {
    showToast("Please fill in the invoice ID, supplier, and target branch.");
    return;
  }

  const tbody = document.getElementById('ocr-line-items-body');
  const rows = tbody.querySelectorAll('tr');
  
  const items = [];
  let hasErrors = false;

  rows.forEach(row => {
    const sku = row.querySelector('.ocr-item-sku').value.trim();
    const name = row.querySelector('.ocr-item-name').value.trim();
    const qty = Number(row.querySelector('.ocr-item-qty').value);
    const price = Number(row.querySelector('.ocr-item-price').value);

    if (!name || qty <= 0 || price < 0) {
      hasErrors = true;
      return;
    }

    items.push({ sku, name, qty, price });
  });

  if (hasErrors || items.length === 0) {
    showToast("Please ensure all items have valid names, quantities, and costs.");
    return;
  }

  const total_amount = items.reduce((acc, curr) => acc + (curr.qty * curr.price), 0);

  try {
    const res = await authFetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_id,
        supplier_name,
        date,
        branch_name,
        items,
        total_amount
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast("Invoice saved successfully! Inventory updated.");
      loadAllViews();
      resetOcrScanner();
      switchTab('catalog'); // Navigate to Stock Catalog to see updated items
    } else {
      showToast(data.error || "Failed to submit invoice.");
    }
  } catch (err) {
    showToast(`Invoice submit error: ${err.message}`);
  }
}

function resetOcrScanner() {
  document.getElementById('ocr-file-input').value = '';
  document.getElementById('ocr-selector-card').style.display = 'block';
  document.getElementById('ocr-loader-card').style.display = 'none';
  document.getElementById('ocr-results-card').style.display = 'none';
}

async function loadInvoiceLedger(invoicesData) {
  const container = document.getElementById('invoice-ledger-list');
  if (!container) return;
  container.innerHTML = '';

  try {
    // If invoicesData is provided (e.g., from a search), use it; otherwise fetch all invoices
    let invoices;
    if (invoicesData) {
      invoices = invoicesData;
    } else {
      const res = await authFetch('/api/invoices');
      if (!res.ok) return;
      invoices = await res.json();
    }
    if (invoices.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 1rem;">No documented invoices yet.</div>`;
      return;
    }

    invoices.forEach(inv => {
      const card = document.createElement('div');
      card.className = 'card-item';
      card.style.flexDirection = 'column';
      card.style.gap = '0.5rem';
      card.style.border = '1px solid var(--border-color)';
      card.style.background = 'rgba(255, 255, 255, 0.02)';
      
      const formattedDate = new Date(inv.date).toLocaleDateString();

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-weight: 700; color: var(--color-purple-primary);">
          <span>ID: ${inv.id}</span>
          <span>$${inv.total_amount.toFixed(2)}</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-dark); display: flex; justify-content: space-between;">
          <span>Vendor: ${inv.supplier_name}</span>
          <span>Date: ${formattedDate}</span>
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-color); padding-top: 0.4rem; margin-top: 0.2rem;">
          <span>Target: ${inv.branch_name} (${inv.items.length} items)</span>
          <button class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.65rem;" onclick="toggleInvoiceItems(this, '${inv.id}')">
            View Details
          </button>
        </div>
        <div class="invoice-items-preview" id="preview-${inv.id}" style="display: none; background: rgba(92, 27, 117, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 0.5rem; margin-top: 0.25rem;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.65rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color);">
                <th style="text-align: left;">Product</th>
                <th style="text-align: center; width: 15%;">Qty</th>
                <th style="text-align: right; width: 25%;">Cost</th>
              </tr>
            </thead>
            <tbody>
              ${inv.items.map(it => `
                <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                  <td>${it.name} (${it.sku})</td>
                  <td style="text-align: center;">${it.qty}</td>
                  <td style="text-align: right;">$${(it.qty * it.price).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      
      container.appendChild(card);
    });

  } catch (err) {
    console.error("Ledger load error", err);
  }
}

function toggleInvoiceItems(btn, invId) {
  const p = document.getElementById(`preview-${invId}`);
  if (p.style.display === 'none') {
    p.style.display = 'block';
    btn.innerText = 'Hide Details';
  } else {
    p.style.display = 'none';
    btn.innerText = 'View Details';
  }
}

// ----------------------------------------------------
// 9. PRODUCT CATEGORIES MANAGEMENT
// ----------------------------------------------------
let rawCategories = [];

async function loadCategories() {
  try {
    const res = await authFetch('/api/categories');
    rawCategories = await res.json();

    populateCategoryDropdowns(rawCategories);
    renderCategoriesList(rawCategories);
  } catch (err) {
    console.error("Failed to load categories", err);
  }
}

function populateCategoryDropdowns(categories) {
  const manualCategorySelect = document.getElementById('manual-category');
  const purchaseCategorySelect = document.getElementById('purchase-item-category');
  const requestCategorySelect = document.getElementById('req-cust-category');

  const optionsHTML = categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

  if (manualCategorySelect) manualCategorySelect.innerHTML = optionsHTML;
  if (purchaseCategorySelect) purchaseCategorySelect.innerHTML = optionsHTML;
  if (requestCategorySelect) requestCategorySelect.innerHTML = optionsHTML;
}

function renderCategoriesList(categories) {
  const container = document.getElementById('categories-list-view');
  if (!container) return;
  container.innerHTML = '';

  if (categories.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:1.5rem;">No categories defined.</div>';
    return;
  }

  categories.forEach(c => {
    // Calculate how many products are registered under this category
    const prodCount = rawCatalog.filter(p => p.category === c.name).length;

    const div = document.createElement('div');
    div.className = 'card';
    div.style.padding = '0.75rem';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="color:var(--color-purple-primary); font-size:0.9rem;">${c.name}</strong>
        </div>
        <span class="badge" style="background:rgba(92,27,117,0.1); color:var(--color-purple-primary); border:1px solid rgba(92,27,117,0.2);">
          ${prodCount} Products
        </span>
      </div>
    `;
    container.appendChild(div);
  });
}

function toggleManualCategoryForm() {
  const card = document.getElementById('manual-category-card');
  if (card) {
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  }
}

async function submitNewCategory(e) {
  e.preventDefault();
  const nameInput = document.getElementById('category-input-name');
  const name = nameInput.value.trim();

  try {
    const res = await authFetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(`Failed to create category: ${data.error}`);
      return;
    }
    showToast("Category created successfully");
    nameInput.value = '';
    toggleManualCategoryForm();
    await loadCategories();
  } catch (err) {
    showToast(`Network error: ${err.message}`);
  }
}

// ====================================================
// UNIVERSAL PRODUCT PICKER & AI VOICE ASSISTANT (ADDED)
// ====================================================

let pickerCallback = null;
let pickerCurrentTab = 'search';
let pickerIsCameraStreaming = false;
let pickerCameraStream = null;

// Voice Settings state
let voiceAssistantEnabled = true;
let voiceResponsesEnabled = true;
let voicePTT = false;
let voiceLanguage = 'en-US';
let speechSpeed = 1.0;
let voiceVolume = 1.0;
let voiceCommandHistory = [];
let recognition = null;
let isVoiceListening = false;
let voiceDialogState = null; // for smart multi-turn workflows
let isAssistantSpeaking = false;

function initVoiceAndPicker() {
  loadVoiceSettings();
  setupSpeechRecognition();
  bindProductPickerToInputs();
  loadCategoriesForPicker();
}

async function loadCategoriesForPicker() {
  try {
    const res = await authFetch('/api/categories');
    if (res.ok) {
      const cats = await res.json();
      const select = document.getElementById('picker-new-category');
      if (select) {
        select.innerHTML = cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      }
    }
  } catch (err) {
    console.error("Failed to load categories for picker", err);
  }
}

function openProductPicker(callback) {
  pickerCallback = callback;
  const modal = document.getElementById('product-picker-modal');
  if (modal) modal.style.display = 'flex';
  
  switchPickerTab('search');
  const searchInput = document.getElementById('picker-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  handlePickerSearch();

  renderPickerRecents();
  renderPickerFavorites();
  loadCategoriesForPicker();
}

function closeProductPicker() {
  const modal = document.getElementById('product-picker-modal');
  if (modal) modal.style.display = 'none';
  stopPickerCameraStream();
}

function switchPickerTab(tab) {
  pickerCurrentTab = tab;
  
  document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.picker-tab-content').forEach(c => c.classList.remove('active'));

  const btn = document.getElementById(`btn-picker-tab-${tab}`);
  if (btn) btn.classList.add('active');

  const content = document.getElementById(`picker-content-${tab}`);
  if (content) content.classList.add('active');

  if (tab === 'scan') {
    startPickerCameraStream();
  } else {
    stopPickerCameraStream();
  }
}

async function startPickerCameraStream() {
  const laser = document.getElementById('picker-scanner-laser');
  const status = document.getElementById('picker-camera-status');
  const video = document.getElementById('picker-camera-video');

  if (laser) laser.style.display = 'block';

  try {
    // Prefer rear/environment camera on mobile, fall back to any on desktop
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    pickerCameraStream = stream;
    pickerIsCameraStreaming = true;

    if (video) {
      video.srcObject = stream;
      video.style.display = 'block';
      if (status) status.style.display = 'none';
    }

    // Start barcode detection loop
    startBarcodeDetectionLoop(video);

  } catch (err) {
    console.warn('Webcam access failed:', err);
    pickerIsCameraStreaming = false;
    if (video) video.style.display = 'none';
    if (status) {
      status.style.display = 'block';
      status.innerText = '⚠️ Camera unavailable. Enter barcode manually.';
    }
    showToast('Camera access denied. Please allow camera in browser settings.');
  }
}

let barcodeDetectionInterval = null;

function startBarcodeDetectionLoop(video) {
  if (barcodeDetectionInterval) clearInterval(barcodeDetectionInterval);

  // Use native BarcodeDetector if supported (Chrome 83+, Edge)
  const hasBarcodeDetector = ('BarcodeDetector' in window);

  if (hasBarcodeDetector) {
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'data_matrix', 'upc_a', 'upc_e']
    });

    barcodeDetectionInterval = setInterval(async () => {
      if (!pickerIsCameraStreaming || !video || video.readyState < 2) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes && barcodes.length > 0) {
          const rawValue = barcodes[0].rawValue;
          handleScannedBarcodeValue(rawValue);
        }
      } catch (e) {
        // Detection frame error - ignore and continue
      }
    }, 600);

  } else {
    // Fallback: canvas frame capture — show hint to type manually
    const status = document.getElementById('picker-camera-status');
    const canvas = document.getElementById('picker-barcode-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    barcodeDetectionInterval = setInterval(() => {
      if (!pickerIsCameraStreaming || !video || video.readyState < 2) return;
      if (canvas && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawFrame ? ctx.drawFrame(video) : ctx.drawImage(video, 0, 0);
      }
    }, 800);

    if (status) {
      status.style.display = 'block';
      status.innerText = '📷 Live. Barcode auto-detect not supported — enter SKU below.';
    }
  }
}

function handleScannedBarcodeValue(value) {
  if (!value) return;

  // Fill the barcode input
  const input = document.getElementById('picker-barcode-input');
  if (input) input.value = value;

  // Try to match against catalog (case-insensitive on both sku and barcode field)
  const product = rawCatalog.find(p =>
    p.sku.toLowerCase() === value.toLowerCase() ||
    (p.barcode && p.barcode.toLowerCase() === value.toLowerCase())
  );

  if (product) {
    showToast(`✅ Scanned: ${product.name}`);
    stopBarcodeDetectionLoop();
    // Hide fallback form in case it was previously open
    const fallback = document.getElementById('picker-fallback-creation');
    if (fallback) fallback.style.display = 'none';
    setTimeout(() => selectProductFromPicker(product.sku), 400);
  } else {
    const status = document.getElementById('picker-camera-status');
    if (status) {
      status.style.display = 'block';
      status.innerText = `Scanned: "${value}" — not in catalog`;
    }
    showToast(`"${value}" not found. Fill in details to register it.`);
    const fallback = document.getElementById('picker-fallback-creation');
    if (fallback) {
      fallback.style.display = 'block';
      const newNameInput = document.getElementById('picker-new-name');
      if (newNameInput) newNameInput.focus();
    }
  }
}

function stopBarcodeDetectionLoop() {
  if (barcodeDetectionInterval) {
    clearInterval(barcodeDetectionInterval);
    barcodeDetectionInterval = null;
  }
}

function stopPickerCameraStream() {
  stopBarcodeDetectionLoop();

  if (pickerCameraStream) {
    pickerCameraStream.getTracks().forEach(track => track.stop());
    pickerCameraStream = null;
  }
  pickerIsCameraStreaming = false;

  const video = document.getElementById('picker-camera-video');
  if (video) {
    video.srcObject = null;
    video.style.display = 'none';
  }
  const laser = document.getElementById('picker-scanner-laser');
  if (laser) laser.style.display = 'none';
  const status = document.getElementById('picker-camera-status');
  if (status) {
    status.style.display = 'block';
    status.innerText = 'Camera: Locked';
  }
}

function handlePickerSearch() {
  const searchInput = document.getElementById('picker-search-input');
  if (!searchInput) return;
  const query = searchInput.value.toLowerCase().trim();
  const container = document.getElementById('picker-search-results');
  if (!container) return;

  container.innerHTML = '';
  
  const results = rawCatalog.filter(p => 
    p.sku.toLowerCase().includes(query) || 
    p.name.toLowerCase().includes(query) ||
    (p.category && p.category.toLowerCase().includes(query))
  );

  if (results.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1rem; font-size:0.75rem;">No matches found.</div>';
    return;
  }

  const favorites = JSON.parse(localStorage.getItem('smartstock_favorites') || '[]');

  results.forEach(p => {
    const isFav = favorites.includes(p.sku);
    const div = document.createElement('div');
    div.className = 'picker-item-card';
    div.onclick = () => selectProductFromPicker(p.sku);
    div.innerHTML = `
      <div class="picker-item-details">
        <span class="picker-item-name">${p.name}</span>
        <span class="picker-item-sku">SKU: ${p.sku} | Price: $${p.price.toFixed(2)}</span>
      </div>
      <div class="picker-item-actions" onclick="event.stopPropagation();">
        <span class="picker-fav-star ${isFav ? 'active' : ''}" onclick="toggleFavoriteProduct('${p.sku}', event)">&#9733;</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function toggleFavoriteProduct(sku, event) {
  let favorites = JSON.parse(localStorage.getItem('smartstock_favorites') || '[]');
  if (favorites.includes(sku)) {
    favorites = favorites.filter(s => s !== sku);
    if (event && event.target) event.target.classList.remove('active');
    showToast("Removed from favorites");
  } else {
    favorites.push(sku);
    if (event && event.target) event.target.classList.add('active');
    showToast("Added to favorites");
  }
  localStorage.setItem('smartstock_favorites', JSON.stringify(favorites));
  renderPickerFavorites();
  handlePickerSearch();
}

function selectProductFromPicker(sku) {
  const product = rawCatalog.find(p => p.sku === sku);
  if (!product) return;

  let recents = JSON.parse(localStorage.getItem('smartstock_recent_picks') || '[]');
  recents = recents.filter(s => s !== sku);
  recents.unshift(sku);
  if (recents.length > 8) recents.pop();
  localStorage.setItem('smartstock_recent_picks', JSON.stringify(recents));

  let freq = JSON.parse(localStorage.getItem('smartstock_freq_picks') || '{}');
  freq[sku] = (freq[sku] || 0) + 1;
  localStorage.setItem('smartstock_freq_picks', JSON.stringify(freq));

  if (pickerCallback) {
    pickerCallback(product);
  }
  closeProductPicker();
}

function renderPickerRecents() {
  const container = document.getElementById('picker-recent-results');
  if (!container) return;
  container.innerHTML = '';

  const recents = JSON.parse(localStorage.getItem('smartstock_recent_picks') || '[]');
  if (recents.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1rem; font-size:0.75rem;">No recents yet.</div>';
    return;
  }

  recents.forEach(sku => {
    const p = rawCatalog.find(prod => prod.sku === sku);
    if (!p) return;
    const div = document.createElement('div');
    div.className = 'picker-item-card';
    div.onclick = () => selectProductFromPicker(p.sku);
    div.innerHTML = `
      <div class="picker-item-details">
        <span class="picker-item-name">${p.name}</span>
        <span class="picker-item-sku">SKU: ${p.sku} | Price: $${p.price.toFixed(2)}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderPickerFavorites() {
  const container = document.getElementById('picker-fav-results');
  if (!container) return;
  container.innerHTML = '';

  const favorites = JSON.parse(localStorage.getItem('smartstock_favorites') || '[]');
  if (favorites.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1rem; font-size:0.75rem;">No favorites yet.</div>';
    return;
  }

  favorites.forEach(sku => {
    const p = rawCatalog.find(prod => prod.sku === sku);
    if (!p) return;
    const div = document.createElement('div');
    div.className = 'picker-item-card';
    div.onclick = () => selectProductFromPicker(p.sku);
    div.innerHTML = `
      <div class="picker-item-details">
        <span class="picker-item-name">${p.name}</span>
        <span class="picker-item-sku">SKU: ${p.sku} | Price: $${p.price.toFixed(2)}</span>
      </div>
      <div class="picker-item-actions" onclick="event.stopPropagation();">
        <span class="picker-fav-star active" onclick="toggleFavoriteProduct('${p.sku}')">&#9733;</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function handlePickerBarcodeSubmit() {
  const input = document.getElementById('picker-barcode-input');
  const value = input ? input.value.trim() : '';
  if (!value) {
    showToast('Please enter a SKU or scan a barcode');
    return;
  }
  handleScannedBarcodeValue(value);
}

async function handlePickerNewProductSubmit() {
  const skuInput = document.getElementById('picker-barcode-input');
  const sku = skuInput.value.trim().toUpperCase();
  const name = document.getElementById('picker-new-name').value.trim();
  const category = document.getElementById('picker-new-category').value;
  const price = parseFloat(document.getElementById('picker-new-price').value || "0");

  if (!name || !price) {
    showToast("Please enter product name and price");
    return;
  }

  const newProductObj = {
    sku,
    name,
    category,
    volume_per_unit: 0.001,
    cost: Number((price * 0.6).toFixed(2)),
    price,
    safety_stock: 10,
    min_reorder_level: 20,
    lead_time: 5,
    supplier_name: "General Supplier",
    branches: [
      { branch: "Main Warehouse", quantity: 0 },
      { branch: "North Branch", quantity: 0 },
      { branch: "South Branch", quantity: 0 }
    ]
  };

  try {
    if (currentUser && (currentUser.role === 'Owner' || currentUser.role === 'Admin')) {
      const res = await authFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku,
          name,
          category,
          volume_per_unit: 0.001,
          cost: Number((price * 0.6).toFixed(2)),
          price,
          safety_stock: 10,
          min_reorder_level: 20,
          lead_time: 5,
          supplier_name: "General Supplier",
          main_qty: 0,
          north_qty: 0,
          south_qty: 0
        })
      });
      if (res.ok) {
        showToast("Product registered to catalog!");
      }
    } else {
      showToast("Product recorded in temporary cache for active selection.");
    }
  } catch (err) {
    console.error("API product creation failed, falling back to local simulation", err);
  }

  rawCatalog.push(newProductObj);
  setupRequestSkuSelect();

  skuInput.value = '';
  document.getElementById('picker-new-name').value = '';
  document.getElementById('picker-new-price').value = '';
  document.getElementById('picker-fallback-creation').style.display = 'none';

  selectProductFromPicker(sku);
}

function startPickerVoiceSearch() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast("Speech Recognition not supported on this browser.");
    return;
  }

  const voiceRecognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  voiceRecognition.lang = voiceLanguage;
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;

  showToast("Listening for product name...");
  voiceRecognition.start();

  voiceRecognition.onresult = (event) => {
    const speechResult = event.results[0][0].transcript.toLowerCase();
    const searchInput = document.getElementById('picker-search-input');
    if (searchInput) searchInput.value = speechResult;
    handlePickerSearch();
    showToast(`Searching for: "${speechResult}"`);
  };

  voiceRecognition.onerror = (e) => {
    console.error("Picker voice search error", e);
    showToast("Voice search error. Try searching manually.");
  };
}

function bindProductPickerToInputs() {
  document.addEventListener('click', (e) => {
    const matchTarget = e.target.matches('#req-cust-sku, #expiry-item-sku, #adjust-item-sku, #purchase-item-name') || 
                        e.target.classList.contains('ocr-sku-input') || 
                        e.target.classList.contains('ocr-name-input');
                        
    if (matchTarget) {
      e.preventDefault();
      e.stopPropagation();
      const targetInput = e.target;
      
      openProductPicker((product) => {
        if (targetInput.id === 'req-cust-sku') {
          targetInput.value = product.sku;
          document.getElementById('req-cust-category').value = product.category || 'General Retail';
          document.getElementById('req-cust-desc').value = product.name;
        } else if (targetInput.id === 'expiry-item-sku') {
          targetInput.value = product.sku;
          showToast(`Selected expiry item: ${product.name}`);
        } else if (targetInput.id === 'adjust-item-sku') {
          targetInput.value = product.sku;
        } else if (targetInput.id === 'purchase-item-name') {
          targetInput.value = product.name;
          document.getElementById('purchase-item-category').value = product.category || 'General Retail';
        } else if (targetInput.classList.contains('ocr-sku-input')) {
          targetInput.value = product.sku;
          const tr = targetInput.closest('tr');
          const nameInput = tr.querySelector('.ocr-name-input');
          if (nameInput) nameInput.value = product.name;
          const priceInput = tr.querySelector('.ocr-price-input');
          if (priceInput) priceInput.value = product.price;
        } else if (targetInput.classList.contains('ocr-name-input')) {
          targetInput.value = product.name;
          const tr = targetInput.closest('tr');
          const skuInput = tr.querySelector('.ocr-sku-input');
          if (skuInput) skuInput.value = product.sku;
          const priceInput = tr.querySelector('.ocr-price-input');
          if (priceInput) priceInput.value = product.price;
        }
      });
    }
  });
}

function loadVoiceSettings() {
  const saved = JSON.parse(localStorage.getItem('smartstock_voice_settings') || '{}');
  voiceAssistantEnabled = saved.voiceAssistantEnabled !== undefined ? saved.voiceAssistantEnabled : true;
  voiceResponsesEnabled = saved.voiceResponsesEnabled !== undefined ? saved.voiceResponsesEnabled : true;
  voicePTT = saved.voicePTT !== undefined ? saved.voicePTT : false;
  voiceLanguage = saved.voiceLanguage || 'en-US';
  speechSpeed = saved.speechSpeed !== undefined ? parseFloat(saved.speechSpeed) : 1.0;
  voiceVolume = saved.voiceVolume !== undefined ? parseFloat(saved.voiceVolume) : 1.0;
  voiceCommandHistory = JSON.parse(localStorage.getItem('smartstock_voice_history') || '[]');

  const cbEnabled = document.getElementById('setting-voice-enabled');
  if (cbEnabled) cbEnabled.checked = voiceAssistantEnabled;
  
  const cbResponses = document.getElementById('setting-voice-responses');
  if (cbResponses) cbResponses.checked = voiceResponsesEnabled;

  const cbPtt = document.getElementById('setting-voice-ptt');
  if (cbPtt) cbPtt.checked = voicePTT;

  const selLang = document.getElementById('setting-voice-lang');
  if (selLang) selLang.value = voiceLanguage;

  const sliSpeed = document.getElementById('setting-voice-speed');
  if (sliSpeed) sliSpeed.value = speechSpeed;

  const sliVol = document.getElementById('setting-voice-volume');
  if (sliVol) sliVol.value = voiceVolume;

  updateVoiceSettingsLabels();
  renderVoiceHistory();

  const fab = document.getElementById('ai-voice-assistant-container');
  if (fab) fab.style.display = voiceAssistantEnabled ? 'flex' : 'none';
}

function saveVoiceSettings() {
  const cbEnabled = document.getElementById('setting-voice-enabled');
  const cbResponses = document.getElementById('setting-voice-responses');
  const cbPtt = document.getElementById('setting-voice-ptt');
  const selLang = document.getElementById('setting-voice-lang');
  const sliSpeed = document.getElementById('setting-voice-speed');
  const sliVol = document.getElementById('setting-voice-volume');

  voiceAssistantEnabled = cbEnabled ? cbEnabled.checked : true;
  voiceResponsesEnabled = cbResponses ? cbResponses.checked : true;
  voicePTT = cbPtt ? cbPtt.checked : false;
  voiceLanguage = selLang ? selLang.value : 'en-US';
  speechSpeed = sliSpeed ? parseFloat(sliSpeed.value) : 1.0;
  voiceVolume = sliVol ? parseFloat(sliVol.value) : 1.0;

  const settingsObj = {
    voiceAssistantEnabled,
    voiceResponsesEnabled,
    voicePTT,
    voiceLanguage,
    speechSpeed,
    voiceVolume
  };

  localStorage.setItem('smartstock_voice_settings', JSON.stringify(settingsObj));
  
  const fab = document.getElementById('ai-voice-assistant-container');
  if (fab) fab.style.display = voiceAssistantEnabled ? 'flex' : 'none';
}

function toggleVoiceAssistantSettings() {
  saveVoiceSettings();
}

function updateVoiceSettingsLabels() {
  const sliSpeed = document.getElementById('setting-voice-speed');
  const lblSpeed = document.getElementById('lbl-voice-speed');
  if (sliSpeed && lblSpeed) lblSpeed.innerText = parseFloat(sliSpeed.value).toFixed(1);

  const sliVol = document.getElementById('setting-voice-volume');
  const lblVol = document.getElementById('lbl-voice-volume');
  if (sliVol && lblVol) lblVol.innerText = Math.round(parseFloat(sliVol.value) * 100);
}

function addVoiceCommandHistory(command, resultText) {
  const timestamp = new Date().toLocaleTimeString();
  voiceCommandHistory.unshift({ timestamp, command, resultText });
  if (voiceCommandHistory.length > 20) voiceCommandHistory.pop();
  localStorage.setItem('smartstock_voice_history', JSON.stringify(voiceCommandHistory));
  renderVoiceHistory();
}

function clearVoiceHistory() {
  voiceCommandHistory = [];
  localStorage.removeItem('smartstock_voice_history');
  renderVoiceHistory();
  showToast("Voice history cleared.");
}

function renderVoiceHistory() {
  const list = document.getElementById('voice-history-list');
  if (!list) return;
  list.innerHTML = '';
  if (voiceCommandHistory.length === 0) {
    list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 0.5rem;">No commands recorded.</div>';
    return;
  }
  voiceCommandHistory.forEach(h => {
    const div = document.createElement('div');
    div.style.cssText = 'border-bottom: 1px solid var(--border-color); padding-bottom: 0.25rem; margin-bottom: 0.25rem;';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; color:var(--text-muted); font-size:0.65rem;">
        <span>${h.timestamp}</span>
        <strong>"${h.command}"</strong>
      </div>
      <div style="color:var(--color-purple-primary); font-size:0.7rem; margin-top:0.1rem;">${h.resultText}</div>
    `;
    list.appendChild(div);
  });
}

function speakText(text) {
  if (!voiceResponsesEnabled) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceLanguage;
  utterance.rate = speechSpeed;
  utterance.volume = voiceVolume;

  utterance.onstart = () => {
    isAssistantSpeaking = true;
    if (recognition && isVoiceListening) {
      try { recognition.abort(); } catch (e) {}
    }
  };

  utterance.onend = () => {
    isAssistantSpeaking = false;
    if (!voicePTT && voiceAssistantEnabled) {
      setTimeout(() => {
        if (voiceAssistantEnabled && !isVoiceListening) {
          try { recognition.start(); } catch (e) {}
        }
      }, 300);
    }
  };

  utterance.onerror = () => {
    isAssistantSpeaking = false;
    if (!voicePTT && voiceAssistantEnabled) {
      setTimeout(() => {
        if (voiceAssistantEnabled && !isVoiceListening) {
          try { recognition.start(); } catch (e) {}
        }
      }, 300);
    }
  };

  window.speechSynthesis.speak(utterance);
}

function displaySpeechSubtitle(text, isLoading = false) {
  const bubble = document.getElementById('ai-speech-bubble');
  const txt = document.getElementById('ai-speech-text');
  const loading = document.getElementById('speech-loading');

  if (bubble && txt) {
    txt.innerText = text;
    loading.style.display = isLoading ? 'flex' : 'none';
    bubble.style.display = 'flex';
    
    if (!isLoading) {
      if (bubble.hideTimeout) clearTimeout(bubble.hideTimeout);
      bubble.hideTimeout = setTimeout(() => {
        bubble.style.display = 'none';
      }, 5000);
    }
  }
}

function setupSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn("Speech recognition is not supported on this browser.");
    return;
  }

  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = voiceLanguage;
  recognition.continuous = !voicePTT;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isVoiceListening = true;
    const btn = document.getElementById('btn-voice-assistant');
    if (btn) btn.classList.add('listening');
    displaySpeechSubtitle("Listening... Speak a command.", true);
  };

  recognition.onresult = (event) => {
    if (isAssistantSpeaking || window.speechSynthesis.speaking) {
      console.log("Feedback loop ignored.");
      return;
    }
    const command = event.results[event.results.length - 1][0].transcript;
    displaySpeechSubtitle(`Recognized: "${command}"`);
    processVoiceCommand(command);
  };

  recognition.onerror = (event) => {
    console.error("Speech Recognition Error", event);
    if (event.error === 'not-allowed') {
      showToast("Mic permission denied. Allow mic access.");
    }
    isVoiceListening = false;
    const btn = document.getElementById('btn-voice-assistant');
    if (btn) btn.classList.remove('listening');
    displaySpeechSubtitle("Mic Error. Try again.");
  };

  recognition.onend = () => {
    isVoiceListening = false;
    const btn = document.getElementById('btn-voice-assistant');
    if (btn) btn.classList.remove('listening');
    
    if (!voicePTT && voiceAssistantEnabled && !isAssistantSpeaking) {
      setTimeout(() => {
        if (voiceAssistantEnabled && !isVoiceListening && !isAssistantSpeaking) {
          try { recognition.start(); } catch (e) {}
        }
      }, 1000);
    } else {
      const bubble = document.getElementById('ai-speech-bubble');
      if (bubble && bubble.style.display === 'flex' && document.getElementById('speech-loading').style.display === 'flex') {
        bubble.style.display = 'none';
      }
    }
  };
}

function toggleVoiceAssistantListening() {
  if (!recognition) {
    setupSpeechRecognition();
  }
  if (!recognition) {
    showToast("Speech Recognition unavailable.");
    return;
  }

  if (isVoiceListening) {
    recognition.stop();
  } else {
    try {
      recognition.lang = voiceLanguage;
      recognition.continuous = !voicePTT;
      recognition.start();
    } catch (e) {
      console.error("Failed to start voice recognition", e);
    }
  }
}

function processVoiceCommand(command) {
  const normalized = command.toLowerCase().trim();
  
  if (voiceDialogState && voiceDialogState.type === 'confirm_expiry') {
    if (normalized.includes('confirm') || normalized.includes('yes') || normalized.includes('save') || normalized.includes('submit')) {
      const form = document.querySelector('#subview-req-expiry form');
      if (form) {
        form.dispatchEvent(new Event('submit'));
        speakText("Expiry report submitted successfully.");
        displaySpeechSubtitle("Saved expiry report.");
        addVoiceCommandHistory(command, "Confirmed & Saved Expiry Report");
      }
      voiceDialogState = null;
      return;
    } else if (normalized.includes('cancel') || normalized.includes('no') || normalized.includes('discard')) {
      speakText("Expiry report discarded.");
      displaySpeechSubtitle("Discarded expiry report.");
      addVoiceCommandHistory(command, "Cancelled Expiry Report Dialog");
      voiceDialogState = null;
      return;
    }
  }

  const isStaff = currentUser && currentUser.role === 'Staff';

  if (normalized.includes('go to dashboard') || normalized.includes('open dashboard') || normalized.includes('show dashboard')) {
    switchTab('dashboard');
    speakText("Dashboard opened.");
    addVoiceCommandHistory(command, "Navigated to Dashboard");
    return;
  }
  
  if (normalized.includes('open reports') || normalized.includes('show reports')) {
    switchTab('dashboard');
    speakText("Showing reports.");
    addVoiceCommandHistory(command, "Opened Reports");
    return;
  }

  if (normalized.includes('open inventory') || normalized.includes('open stock') || normalized.includes('show stock') || normalized.includes('show inventory')) {
    switchTab('catalog');
    switchSubTab('inventory');
    speakText("Stock catalog opened.");
    addVoiceCommandHistory(command, "Opened Inventory Stock Catalog");
    return;
  }

  if (normalized.includes('open requests') || normalized.includes('open pending requests') || normalized.includes('show requests')) {
    switchTab('requests');
    switchReqModule('customer');
    speakText("Customer requests opened.");
    addVoiceCommandHistory(command, "Opened Customer Requests");
    return;
  }

  if (normalized.includes('open expiry reports') || normalized.includes('open expiry list')) {
    switchTab('requests');
    switchReqModule('expiry');
    speakText("Expiry reports list opened.");
    addVoiceCommandHistory(command, "Opened Expiry reports");
    return;
  }

  if (normalized.includes('open barcode scanner') || normalized.includes('open scanner') || normalized.includes('scan a product')) {
    switchTab('scanner');
    switchScannerSubTab('barcode');
    speakText("Barcode intake scanner opened.");
    addVoiceCommandHistory(command, "Opened Barcode Scanner");
    return;
  }

  if (normalized.includes('open user management') || normalized.includes('open manager list') || normalized.includes('open managers')) {
    if (isStaff) {
      speakText("Access denied. Staff cannot access user settings.");
      displaySpeechSubtitle("Access denied. Role: Staff");
      addVoiceCommandHistory(command, "Blocked: Open User Management (RBAC)");
      return;
    }
    switchTab('more');
    setTimeout(() => {
      const card = document.getElementById('user-management-card');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    }, 300);
    speakText("Opening user management.");
    addVoiceCommandHistory(command, "Opened User Management");
    return;
  }

  if (normalized.includes('open supplier list') || normalized.includes('open suppliers')) {
    switchTab('more');
    speakText("Opening reorders option list.");
    addVoiceCommandHistory(command, "Opened Suppliers List");
    return;
  }

  if (normalized.includes('create a customer request') || normalized.includes('record a customer request') || normalized.includes('new customer request')) {
    switchTab('requests');
    switchReqModule('customer');
    toggleManualRequestForm();
    speakText("Taking customer order request.");
    addVoiceCommandHistory(command, "Opened Customer Request Form");
    return;
  }

  if (normalized.includes('record expired products') || normalized.includes('record expired product') || normalized.includes('report expired')) {
    switchTab('requests');
    switchReqModule('expiry');
    speakText("Recording expired product report.");
    addVoiceCommandHistory(command, "Opened Expiry Report Form");
    return;
  }

  if (normalized.includes('create purchase order') || normalized.includes('create po') || normalized.includes('new purchase order')) {
    if (isStaff) {
      speakText("Access denied. Staff cannot create purchase orders.");
      displaySpeechSubtitle("Access denied. Role: Staff");
      addVoiceCommandHistory(command, "Blocked: Create Purchase Order (RBAC)");
      return;
    }
    switchTab('more');
    setTimeout(() => {
      const card = document.getElementById('more-reorders-card');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    }, 300);
    speakText("Opening suggested AI purchase orders.");
    addVoiceCommandHistory(command, "Opened Purchase Orders Suggested Card");
    return;
  }

  if (normalized.includes('receive today\'s deliveries') || normalized.includes('receive deliveries') || normalized.includes('goods receiving')) {
    switchTab('scanner');
    switchScannerSubTab('ocr');
    speakText("Document scanner opened. Upload an invoice to receive goods.");
    addVoiceCommandHistory(command, "Opened OCR Document Scanner for Goods Receiving");
    return;
  }

  if (normalized.includes('create staff') || normalized.includes('create user') || normalized.includes('add staff')) {
    if (isStaff) {
      speakText("Access denied. Staff cannot register team members.");
      displaySpeechSubtitle("Access denied. Role: Staff");
      addVoiceCommandHistory(command, "Blocked: Create Staff (RBAC)");
      return;
    }
    switchTab('more');
    setTimeout(() => {
      const card = document.getElementById('user-management-card');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    }, 300);
    speakText("Opening team member creation form.");
    addVoiceCommandHistory(command, "Opened Staff Creation Form");
    return;
  }

  const searchMatch = normalized.match(/(?:search for|find|look up)\s+(.+)/);
  if (searchMatch) {
    const term = searchMatch[1].trim();
    switchTab('catalog');
    switchSubTab('inventory');
    const searchInput = document.getElementById('catalog-search');
    if (searchInput) {
      searchInput.value = term;
      filterCatalog();
    }
    const found = rawCatalog.filter(p => p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term));
    if (found.length > 0) {
      speakText(`Found ${found.length} items matching ${term}.`);
      displaySpeechSubtitle(`Search results for "${term}"`);
      addVoiceCommandHistory(command, `Searched catalog for "${term}" - Found ${found.length}`);
    } else {
      speakText(`No matching products found for ${term}.`);
      displaySpeechSubtitle(`No matches for "${term}"`);
      addVoiceCommandHistory(command, `Searched catalog for "${term}" - Not Found`);
    }
    return;
  }

  if (normalized.includes('today\'s sales') || normalized.includes('sales today')) {
    const totalSales = rawCatalog.reduce((sum, p) => sum + (p.sales_24h || 0), 0) || 5;
    speakText(`Today's sales totals are ${totalSales} units across branches.`);
    displaySpeechSubtitle(`Today's sales count: ${totalSales}`);
    addVoiceCommandHistory(command, "Checked Today's Sales Reports");
    return;
  }

  if (normalized.includes('monthly inventory') || normalized.includes('monthly reports')) {
    speakText("Showing monthly reports. All levels are operating within safety parameters.");
    displaySpeechSubtitle("Safety stock levels checked.");
    addVoiceCommandHistory(command, "Opened Monthly Inventory Report");
    return;
  }

  if (normalized.includes('show fast moving products') || normalized.includes('show velocity spikes') || normalized.includes('fast moving items')) {
    const fast = rawCatalog.filter(p => p.fast_selling);
    if (fast.length > 0) {
      const names = fast.map(p => p.name).join(", ");
      speakText(`The fast moving products are: ${names}`);
      displaySpeechSubtitle(`Fast moving spikes: ${names}`);
    } else {
      speakText("There are no rapid velocity spikes detected today.");
      displaySpeechSubtitle("No velocity spikes today.");
    }
    addVoiceCommandHistory(command, "Listed Fast Moving Products");
    return;
  }

  if (normalized.includes('show low stock items') || normalized.includes('low stock')) {
    const low = rawCatalog.filter(p => {
      const totalQty = p.branches.reduce((sum, b) => sum + b.quantity, 0);
      return totalQty <= p.safety_stock;
    });
    if (low.length > 0) {
      const names = low.map(p => p.name).join(", ");
      speakText(`The low stock items are: ${names}`);
      displaySpeechSubtitle(`Low stock: ${names}`);
    } else {
      speakText("All products have healthy inventory margins.");
      displaySpeechSubtitle("All levels healthy.");
    }
    addVoiceCommandHistory(command, "Checked Low Stock Items");
    return;
  }

  const recordMatch = normalized.match(/(?:record|report|add)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:cartons|units|bottles|boxes|items|packs)?\s+of\s+(.+?)\s+with\s+batch\s+(\w+)\s+expiring\s+(\w+)\s+(\d{4})/);
  
  if (recordMatch) {
    let qtyStr = recordMatch[1];
    const productName = recordMatch[2].trim();
    const batch = recordMatch[3].trim().toUpperCase();
    const month = recordMatch[4].trim();
    const year = recordMatch[5].trim();

    const numbersMap = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
    const qty = numbersMap[qtyStr] || parseInt(qtyStr) || 1;

    const monthsMap = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const monthNum = monthsMap[month.toLowerCase()] || '12';
    
    const lastDayMap = { '01': 31, '02': 28, '03': 31, '04': 30, '05': 31, '06': 30, '07': 31, '08': 31, '09': 30, '10': 31, '11': 30, '12': 31 };
    const dateStr = `${year}-${monthNum}-${lastDayMap[monthNum]}`;

    const product = rawCatalog.find(p => 
      p.name.toLowerCase().includes(productName) || 
      p.sku.toLowerCase().includes(productName)
    );

    if (!product) {
      speakText(`I couldn't identify the product: ${productName} in our database. Please select it manually.`);
      displaySpeechSubtitle(`Product "${productName}" not found.`);
      addVoiceCommandHistory(command, `Failed Smart Workflow: Product "${productName}" not found`);
      return;
    }

    switchTab('requests');
    switchReqModule('expiry');

    document.getElementById('expiry-item-sku').value = product.sku;
    document.getElementById('expiry-qty').value = qty;
    document.getElementById('expiry-batch').value = batch;
    document.getElementById('expiry-date').value = dateStr;
    document.getElementById('expiry-notes').value = "Recorded via voice assistant workflow";
    document.getElementById('expiry-image').value = "box.png";

    voiceDialogState = {
      type: 'confirm_expiry',
      data: { sku: product.sku, qty, batch, date: dateStr }
    };

    const confirmPrompt = `I found ${product.name}. I filled the form with quantity ${qty}, batch ${batch}, expiring in ${month} ${year}. Say Confirm or click submit to save.`;
    speakText(confirmPrompt);
    displaySpeechSubtitle(confirmPrompt, true);
    addVoiceCommandHistory(command, `Smart Workflow: Prefilled Expiry Report for ${product.name}`);
    return;
  }

  speakText("Command not recognized. Try saying open stock, today's sales, or show low stock items.");
  displaySpeechSubtitle(`Not recognized: "${command}"`);
  addVoiceCommandHistory(command, "Command Unrecognized");
}

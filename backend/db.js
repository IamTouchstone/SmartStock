const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_ORG_ID = "ORG-DEMO-001";

// Ensure database file and directories exist
function initDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const defaultData = getSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
    return defaultData;
  }

  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const db = JSON.parse(content);
    
    let updated = false;

    // Ensure organizations array exists
    if (!db.organizations) {
      db.organizations = getInitialOrganizations();
      updated = true;
    }
    // Ensure users array exists
    if (!db.users) {
      db.users = getInitialUsers();
      updated = true;
    }
    // Ensure customer_requests array exists
    if (!db.customer_requests) {
      db.customer_requests = [];
      updated = true;
    }
    // Ensure purchase_list array exists
    if (!db.purchase_list) {
      db.purchase_list = getInitialPurchaseList();
      updated = true;
    }
    // Ensure alert_logs array exists
    if (!db.alert_logs) {
      db.alert_logs = [];
      updated = true;
    }
    // Ensure categories array exists
    if (!db.categories) {
      db.categories = getInitialCategories();
      updated = true;
    }
    // Ensure activity_logs array exists
    if (!db.activity_logs) {
      db.activity_logs = [];
      updated = true;
    }
    // Ensure expiry_reports array exists
    if (!db.expiry_reports) {
      db.expiry_reports = [];
      updated = true;
    }
    // Ensure stock_adjustments array exists
    if (!db.stock_adjustments) {
      db.stock_adjustments = [];
      updated = true;
    }

    if (updated) {
      writeDB(db);
    }
    return db;
  } catch (e) {
    console.error("Database error. Re-initializing DB.", e);
    const defaultData = getSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
    return defaultData;
  }
}

// Read database
function readDB() {
  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return initDB();
  }
}

// Write database
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getInitialOrganizations() {
  return [
    {
      id: DEFAULT_ORG_ID,
      org_name: "SmartStock Global Retail",
      admin_email: "admin@smartstock.io",
      password: "password123",
      industry: "Electronics & Smart Home",
      created_at: new Date().toISOString()
    }
  ];
}

function getInitialUsers() {
  const nowStr = new Date().toISOString();
  return [
    {
      id: "USR-ADMIN-001",
      org_id: DEFAULT_ORG_ID,
      name: "Global Owner",
      email: "admin@smartstock.io",
      password: "password123",
      role: "Owner",
      created_by: "SYSTEM",
      created_at: nowStr
    },
    {
      id: "USR-CADMIN-001",
      org_id: DEFAULT_ORG_ID,
      name: "Global Admin",
      email: "coadmin@smartstock.io",
      password: "password123",
      role: "Admin",
      created_by: "USR-ADMIN-001",
      created_at: nowStr
    },
    {
      id: "USR-MGR-001",
      org_id: DEFAULT_ORG_ID,
      name: "Global Manager",
      email: "manager@smartstock.io",
      password: "password123",
      role: "Manager",
      created_by: "USR-CADMIN-001",
      created_at: nowStr
    },
    {
      id: "USR-SUP-001",
      org_id: DEFAULT_ORG_ID,
      name: "Global Supervisor",
      email: "supervisor@smartstock.io",
      password: "password123",
      role: "Supervisor",
      created_by: "USR-CADMIN-001",
      created_at: nowStr
    },
    {
      id: "USR-STF-001",
      org_id: DEFAULT_ORG_ID,
      name: "Global Staff",
      email: "staff@smartstock.io",
      password: "password123",
      role: "Staff",
      created_by: "USR-MGR-001",
      created_at: nowStr
    }
  ];
}

function getInitialPurchaseList() {
  return [
    {
      org_id: DEFAULT_ORG_ID,
      id: "SHOP-001",
      item_name: "Biodegradable Delivery Boxes",
      category: "Packaging & Delivery",
      quantity: 150,
      status: "Pending",
      created_at: new Date().toISOString()
    },
    {
      org_id: DEFAULT_ORG_ID,
      id: "SHOP-002",
      item_name: "Sticky Label Paper Reams",
      category: "Office Stationery",
      quantity: 25,
      status: "Purchased",
    }
  ];
}

function getInitialCategories() {
  return [
    { org_id: DEFAULT_ORG_ID, name: "Electronics & Smart Home" },
    { org_id: DEFAULT_ORG_ID, name: "Groceries & Consumables" },
    { org_id: DEFAULT_ORG_ID, name: "Packaging & Delivery" },
    { org_id: DEFAULT_ORG_ID, name: "Office Stationery" },
    { org_id: DEFAULT_ORG_ID, name: "General Retail" }
  ];
}

// Seed initial data scoped by Org ID
function getSeedData() {
  const organizations = getInitialOrganizations();
  const users = getInitialUsers();
  const purchase_list = getInitialPurchaseList();
  const org_id = DEFAULT_ORG_ID;

  const products = [
    {
      org_id,
      sku: "TS-100",
      name: "EcoSmart Smart Thermostat",
      category: "Home Automation",
      volume_per_unit: 0.0012,
      cost: 85.00,
      price: 149.99,
      safety_stock: 30,
      min_reorder_level: 50,
      lead_time: 5,
      supplier_name: "Apex Electronics",
      image_url: "thermostat"
    },
    {
      org_id,
      sku: "WC-500",
      name: "Titan 3-in-1 Wireless Charger",
      category: "Mobile Accessories",
      volume_per_unit: 0.0008,
      cost: 25.00,
      price: 49.99,
      safety_stock: 40,
      min_reorder_level: 70,
      lead_time: 7,
      supplier_name: "Apex Electronics",
      image_url: "charger"
    },
    {
      org_id,
      sku: "LL-800",
      name: "Nova Smart LED Bulb Pack",
      category: "Lighting",
      volume_per_unit: 0.0025,
      cost: 15.00,
      price: 29.99,
      safety_stock: 50,
      min_reorder_level: 90,
      lead_time: 3,
      supplier_name: "Lumina Global",
      image_url: "bulb"
    }
  ];

  const inventory = [
    { org_id, sku: "TS-100", branch: "Main Warehouse", quantity: 250 },
    { org_id, sku: "WC-500", branch: "Main Warehouse", quantity: 380 },
    { org_id, sku: "LL-800", branch: "Main Warehouse", quantity: 500 },

    { org_id, sku: "TS-100", branch: "North Branch", quantity: 12 },
    { org_id, sku: "WC-500", branch: "North Branch", quantity: 15 },
    { org_id, sku: "LL-800", branch: "North Branch", quantity: 8 },

    { org_id, sku: "TS-100", branch: "South Branch", quantity: 45 },
    { org_id, sku: "WC-500", branch: "South Branch", quantity: 85 },
    { org_id, sku: "LL-800", branch: "South Branch", quantity: 95 }
  ];

  const sales = [];
  const branches = ["Main Warehouse", "North Branch", "South Branch"];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  products.forEach(p => {
    branches.forEach(b => {
      let avgDailySales = 2;
      if (b === "North Branch") avgDailySales = 8;
      if (b === "Main Warehouse") avgDailySales = 1;

      for (let day = 7; day >= 1; day--) {
        const timestamp = now - (day * dayMs) + (Math.random() * 8 * 60 * 60 * 1000);
        const qty = Math.max(0, Math.floor(avgDailySales + (Math.random() * 4 - 2)));
        if (qty > 0) {
          sales.push({
            org_id,
            sku: p.sku,
            branch: b,
            quantity: qty,
            timestamp: new Date(timestamp).toISOString()
          });
        }
      }
    });
  });

  const redistributions = [];
  const customer_requests = [
    {
      org_id,
      id: "REQ-001",
      customer_name: "Alice Johnson",
      customer_email: "alice@example.com",
      requested_item: "TS-100",
      item_description: "Standard model with screen protector",
      quantity: 5,
      notes: "Hold in North Branch for warehouse pick up.",
      status: "Pending",
      created_by_staff: "Global Staff",
      created_at: new Date(now - 1 * dayMs).toISOString()
    }
  ];

  const settings = {
    [org_id]: {
      branch_visibility: "all",
      alert_sensitivity: "medium",
      velocity_threshold_coefficient: 1.5,
      alert_whatsapp_enabled: false,
      alert_whatsapp_phone: "",
      alert_email_enabled: false,
      alert_email_address: "",
      alert_telegram_enabled: false,
      alert_telegram_chatid: "",
      iclass_sync_enabled: false,
      iclass_server_host: "SERVER",
      iclass_db_name: "ValueMartDB",
      iclass_db_user: "sa",
      iclass_db_password: "iclassadmin",
      iclass_login_username: "AMCE.BERNIE"
    }
  };

  const suppliers = [
    { org_id, name: "Apex Electronics", lead_time: 5, contact: "orders@apexelectronics.com", active_orders: 1 },
    { org_id, name: "Lumina Global", lead_time: 3, contact: "supply@luminaglobal.com", active_orders: 0 }
  ];

  const purchaseOrders = [
    {
      org_id,
      id: "PO-2026-001",
      supplier: "Apex Electronics",
      sku: "TS-100",
      quantity: 50,
      status: "In Transit",
      eta: new Date(now + 2 * dayMs).toISOString(),
      cost: 4250.00
    }
  ];

  return {
    organizations,
    users,
    products,
    inventory,
    sales,
    redistributions,
    customer_requests,
    purchase_list,
    alert_logs: [],
    settings,
    suppliers,
    purchaseOrders,
    invoices: [],
    categories: getInitialCategories()
  };
}

// Seed default catalog for a newly registered Organization
function seedNewOrganization(org_id, org_name, industry) {
  const db = readDB();

  const newProducts = [
    {
      org_id,
      sku: "PRD-01",
      name: `${industry || 'Retail'} Standard Item A`,
      category: industry || "General Retail",
      volume_per_unit: 0.0015,
      cost: 40.00,
      price: 79.99,
      safety_stock: 20,
      min_reorder_level: 40,
      lead_time: 4,
      supplier_name: "Primary Logistics Corp",
      image_url: "box"
    },
    {
      org_id,
      sku: "PRD-02",
      name: `${industry || 'Retail'} Premium Item B`,
      category: industry || "General Retail",
      volume_per_unit: 0.0020,
      cost: 65.00,
      price: 129.99,
      safety_stock: 15,
      min_reorder_level: 30,
      lead_time: 5,
      supplier_name: "Primary Logistics Corp",
      image_url: "box"
    }
  ];

  const newInventory = [
    { org_id, sku: "PRD-01", branch: "Central Hub", quantity: 150 },
    { org_id, sku: "PRD-02", branch: "Central Hub", quantity: 100 },
    { org_id, sku: "PRD-01", branch: "East Outlet", quantity: 10 },
    { org_id, sku: "PRD-02", branch: "East Outlet", quantity: 8 }
  ];

  const now = Date.now();
  const newSales = [
    { org_id, sku: "PRD-01", branch: "East Outlet", quantity: 12, timestamp: new Date(now - 12 * 3600 * 1000).toISOString() },
    { org_id, sku: "PRD-02", branch: "East Outlet", quantity: 8, timestamp: new Date(now - 6 * 3600 * 1000).toISOString() }
  ];

  const newSuppliers = [
    { org_id, name: "Primary Logistics Corp", lead_time: 4, contact: `orders@${org_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`, active_orders: 0 }
  ];

  const defaultCategories = [
    { org_id, name: "Electronics & Smart Home" },
    { org_id, name: "Groceries & Consumables" },
    { org_id, name: "Packaging & Delivery" },
    { org_id, name: "Office Stationery" },
    { org_id, name: "General Retail" }
  ];
  if (industry && !defaultCategories.find(c => c.name.toLowerCase() === industry.toLowerCase())) {
    defaultCategories.push({ org_id, name: industry });
  }

  if (!db.categories) db.categories = [];
  db.categories.push(...defaultCategories);

  db.products.push(...newProducts);
  db.inventory.push(...newInventory);
  db.sales.push(...newSales);
  db.suppliers.push(...newSuppliers);

  if (!db.settings) db.settings = {};
  db.settings[org_id] = {
    branch_visibility: "all",
    alert_sensitivity: "medium",
    velocity_threshold_coefficient: 1.5,
    alert_whatsapp_enabled: false,
    alert_whatsapp_phone: "",
    alert_email_enabled: false,
    alert_email_address: "",
    alert_telegram_enabled: false,
    alert_telegram_chatid: "",
    iclass_sync_enabled: false,
    iclass_server_host: "SERVER",
    iclass_db_name: "ValueMartDB",
    iclass_db_user: "sa",
    iclass_db_password: "iclassadmin",
    iclass_login_username: "AMCE.BERNIE"
  };

  writeDB(db);
}

module.exports = {
  initDB,
  readDB,
  writeDB,
  seedNewOrganization,
  DEFAULT_ORG_ID,
  getInitialUsers
};

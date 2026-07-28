const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { initDB, readDB, writeDB, seedNewOrganization, DEFAULT_ORG_ID } = require('./backend/db');

const PORT = process.env.PORT || 5000;

const { execSync } = require('child_process');

function getIClassRegistryConfig() {
  const config = {
    host: "SERVER",
    db: "ValueMartDB",
    user: "sa",
    pass: "iclassadmin",
    username: "AMCE.BERNIE"
  };

  try {
    const cmd = 'reg query "HKCU\\Software\\IClass Production Manager"';
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    
    const lines = output.split('\n');
    lines.forEach(line => {
      const match = line.trim().match(/^(\w+)\s+REG_SZ\s+(.*)$/);
      if (match) {
        const [_, key, val] = match;
        const trimmedVal = val.trim();
        if (key === 'ServerName') config.host = trimmedVal;
        if (key === 'LoginName') config.user = trimmedVal;
        if (key === 'Password') config.pass = trimmedVal;
        if (key === 'Database') config.db = trimmedVal;
        if (key === 'LoginUsername') config.username = trimmedVal;
      }
    });
  } catch (err) {
    // Registry key not present or running on non-windows
  }
  return config;
}

initDB();

// ----------------------------------------------------
// HELPERS: EXTRACT SCOPE HEADERS
// ----------------------------------------------------
function getOrgId(req) {
  const headerOrg = req.headers['x-org-id'];
  if (headerOrg) return headerOrg;
  return DEFAULT_ORG_ID;
}

function getUserId(req) {
  return req.headers['x-user-id'] || null;
}

function resolveRequestUserAndOwner(org_id, user_id, db) {
  const org = (db.organizations || []).find(o => o.id === org_id);
  let user = (db.users || []).find(u => u.id === user_id && u.org_id === org_id)
               || (db.users || []).find(u => u.org_id === org_id && u.role === 'Owner')
               || (db.users || []).find(u => u.org_id === org_id);
  
  if (!user && org) {
    user = {
      id: `USR-ADMIN-${Math.floor(100 + Math.random() * 900)}`,
      org_id: org.id,
      name: "Admin User",
      email: org.admin_email,
      role: "Owner"
    };
  }
  
  const ownerEmail = (db.settings && db.settings.global && db.settings.global.owner_email) || 'bernieamce@gmail.com';
  const isOwner = user && (user.email.toLowerCase() === ownerEmail.toLowerCase() 
                  || (org && org.admin_email.toLowerCase() === ownerEmail.toLowerCase()));
                  
  return { user, org, isOwner };
}

function logActivity(req, actionText, manualUser = null) {
  try {
    const db = readDB();
    if (!db.activity_logs) db.activity_logs = [];
    const org_id = getOrgId(req);
    let user = manualUser;
    let userId = user ? user.id : getUserId(req);
    if (!user && userId) {
      user = (db.users || []).find(u => u.org_id === org_id && u.id === userId);
    }
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const newLog = {
      id: `LOG-${Math.floor(1000 + Math.random() * 9000)}`,
      org_id,
      user_id: userId || 'SYSTEM',
      user_name: user ? user.name : "System/Guest",
      role: user ? user.role : "Staff",
      action: actionText,
      date: dateStr,
      time: timeStr,
      branch: user && user.branch ? user.branch : "Central Hub",
      device: req.headers['user-agent'] ? req.headers['user-agent'].split(' ')[0] : "Web Browser"
    };
    db.activity_logs.push(newLog);
    writeDB(db);
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

// ----------------------------------------------------
// AI ENGINE LOGIC HELPERS (ORG SCOPED)
// ----------------------------------------------------

function getSalesVelocityAnalysis(org_id) {
  const db = readDB();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const oneDayAgo = new Date(now - dayMs).toISOString();
  const sevenDaysAgo = new Date(now - 7 * dayMs).toISOString();

  const orgProducts = db.products.filter(p => p.org_id === org_id);
  const velocityReport = [];

  orgProducts.forEach(product => {
    const productSales = (db.sales || []).filter(s => s.org_id === org_id && s.sku === product.sku);

    const sales24h = productSales
      .filter(s => s.timestamp >= oneDayAgo)
      .reduce((sum, s) => sum + s.quantity, 0);

    const sales7d = productSales
      .filter(s => s.timestamp >= sevenDaysAgo)
      .reduce((sum, s) => sum + s.quantity, 0);

    const dailyVelocity = (sales7d / 7).toFixed(1);
    
    const branchStocks = (db.inventory || []).filter(i => i.org_id === org_id && i.sku === product.sku);
    const totalStock = branchStocks.reduce((sum, i) => sum + i.quantity, 0);

    const spikeRatio = dailyVelocity > 0 ? (sales24h / dailyVelocity).toFixed(2) : 0;
    const isFastSelling = sales24h > 10 || parseFloat(spikeRatio) >= 1.5;
    const daysRemaining = dailyVelocity > 0 ? (totalStock / dailyVelocity).toFixed(1) : "99+";

    velocityReport.push({
      sku: product.sku,
      name: product.name,
      category: product.category,
      total_stock: totalStock,
      sales_24h: sales24h,
      daily_velocity: parseFloat(dailyVelocity),
      spike_ratio: parseFloat(spikeRatio),
      is_fast_selling: isFastSelling,
      days_remaining: daysRemaining,
      branch_breakdown: branchStocks.map(b => ({
        branch: b.branch,
        quantity: b.quantity
      }))
    });
  });

  return velocityReport;
}

function getReorderRecommendations(org_id) {
  const db = readDB();
  const velocityReport = getSalesVelocityAnalysis(org_id);
  const recommendations = [];

  const orgProducts = db.products.filter(p => p.org_id === org_id);

  orgProducts.forEach(product => {
    const velData = velocityReport.find(v => v.sku === product.sku);
    const dailyVel = velData ? velData.daily_velocity : 1;

    const aiThreshold = Math.ceil((dailyVel * product.lead_time) + product.safety_stock);

    (db.inventory || []).filter(i => i.org_id === org_id && i.sku === product.sku).forEach(inv => {
      if (inv.quantity <= aiThreshold) {
        const recommendedQty = Math.max(product.min_reorder_level, (aiThreshold - inv.quantity) + product.min_reorder_level);
        recommendations.push({
          sku: product.sku,
          product_name: product.name,
          branch: inv.branch,
          current_stock: inv.quantity,
          ai_threshold: aiThreshold,
          lead_time_days: product.lead_time,
          supplier: product.supplier_name,
          recommended_qty: recommendedQty,
          estimated_cost: (recommendedQty * product.cost).toFixed(2),
          urgency: inv.quantity < product.safety_stock ? "CRITICAL" : "HIGH"
        });
      }
    });
  });

  return recommendations;
}

function getRedistributionRecommendations(org_id) {
  const db = readDB();
  const velocityReport = getSalesVelocityAnalysis(org_id);
  const reorders = getReorderRecommendations(org_id);
  const recommendations = [];

  reorders.forEach(reorder => {
    const product = db.products.find(p => p.org_id === org_id && p.sku === reorder.sku);
    if (!product) return;

    const otherBranches = (db.inventory || []).filter(i => i.org_id === org_id && i.sku === reorder.sku && i.branch !== reorder.branch);

    otherBranches.forEach(candidate => {
      const velData = velocityReport.find(v => v.sku === reorder.sku);
      const dailyVel = velData ? velData.daily_velocity : 1;
      const neededBuffer = product.safety_stock + Math.ceil(dailyVel * 3);

      const surplus = candidate.quantity - neededBuffer;

      if (surplus > 5) {
        const transferQty = Math.min(surplus, reorder.recommended_qty);
        const newPOCost = transferQty * product.cost;
        const transferCost = 45.00;
        const savings = Math.max(0, newPOCost - transferCost);

        recommendations.push({
          id: `REDIST-${reorder.sku}-${Date.now().toString().slice(-4)}`,
          sku: reorder.sku,
          product_name: product.name,
          source_branch: candidate.branch,
          target_branch: reorder.branch,
          available_surplus: surplus,
          transfer_qty: transferQty,
          estimated_savings: savings.toFixed(2),
          status: "RECOMMENDED",
          notes: `Transfer from ${candidate.branch} avoids purchasing new stock from ${product.supplier_name}.`
        });
      }
    });
  });

  return recommendations;
}

// ----------------------------------------------------
// SERVER ROUTER HELPERS
// ----------------------------------------------------

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Org-Id, X-User-Id');
}

function sendJSON(res, data, status = 200) {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, reqPath) {
  let filePath = path.join(__dirname, 'public', reqPath === '/' ? 'index.html' : reqPath);
  const ext = path.extname(filePath);

  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = contentTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      setCORS(res);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

const requestHandler = (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const org_id = getOrgId(req);
  const user_id = getUserId(req);

  // --- GET ROUTING ---

  if (pathname === '/api/dashboard' && method === 'GET') {
    const db = readDB();
    const velocity = getSalesVelocityAnalysis(org_id);
    const reorders = getReorderRecommendations(org_id);
    const redistributions = getRedistributionRecommendations(org_id);
    const orgReqs = (db.customer_requests || []).filter(r => r.org_id === org_id);
    const activeReqs = orgReqs.filter(r => r.status === 'Pending').length;
    const fastSellingCount = velocity.filter(v => v.is_fast_selling).length;
    const totalSavings = redistributions.reduce((sum, r) => sum + parseFloat(r.estimated_savings), 0);
    const orgProducts = db.products.filter(p => p.org_id === org_id);

    return sendJSON(res, {
      total_products: orgProducts.length,
      fast_selling_count: fastSellingCount,
      pending_reorders_count: reorders.length,
      redistribution_recommendations_count: redistributions.length,
      potential_redistribution_savings: totalSavings.toFixed(2),
      active_discrepancies_count: activeReqs, // customer requests counter
      velocity_summary: velocity
    });
  }

  if (pathname === '/api/inventory' && method === 'GET') {
    const db = readDB();
    const velocity = getSalesVelocityAnalysis(org_id);
    const orgProducts = db.products.filter(p => p.org_id === org_id);

    const fullCatalog = orgProducts.map(p => {
      const vInfo = velocity.find(v => v.sku === p.sku);
      const branchDetails = (db.inventory || []).filter(i => i.org_id === org_id && i.sku === p.sku);
      return {
        ...p,
        fast_selling: vInfo ? vInfo.is_fast_selling : false,
        daily_velocity: vInfo ? vInfo.daily_velocity : 0,
        total_stock: vInfo ? vInfo.total_stock : 0,
        branches: branchDetails
      };
    });
    return sendJSON(res, fullCatalog);
  }

  if (pathname === '/api/categories' && method === 'GET') {
    const db = readDB();
    const orgCategories = (db.categories || []).filter(c => c.org_id === org_id);
    return sendJSON(res, orgCategories);
  }

  if (pathname === '/api/reorders' && method === 'GET') {
    const recommendations = getReorderRecommendations(org_id);
    const db = readDB();
    const orgPOs = (db.purchaseOrders || []).filter(po => po.org_id === org_id);
    const orgSuppliers = (db.suppliers || []).filter(s => s.org_id === org_id);
    return sendJSON(res, {
      recommendations,
      purchase_orders: orgPOs,
      suppliers: orgSuppliers
    });
  }

  if (pathname === '/api/redistributions' && method === 'GET') {
    const recommendations = getRedistributionRecommendations(org_id);
    const db = readDB();
    const orgHistory = (db.redistributions || []).filter(r => r.org_id === org_id);
    return sendJSON(res, {
      recommendations,
      history: orgHistory
    });
  }

  if (pathname === '/api/customer-requests' && method === 'GET') {
    const db = readDB();
    const orgReqs = (db.customer_requests || []).filter(r => r.org_id === org_id);
    return sendJSON(res, orgReqs);
  }

  if (pathname === '/api/users' && method === 'GET') {
    const db = readDB();
    const userId = getUserId(req);
    const requestingUser = (db.users || []).find(u => u.org_id === org_id && u.id === userId);
    if (!requestingUser) {
      return sendJSON(res, { error: "Session user not found." }, 401);
    }
    const role = requestingUser.role;
    if (role === 'Staff') {
      return sendJSON(res, { error: "Staff cannot view user directories." }, 403);
    }

    let filteredUsers = [];
    const allOrgUsers = (db.users || []).filter(u => u.org_id === org_id);

    if (role === 'Owner') {
      filteredUsers = allOrgUsers;
    } else if (role === 'Admin') {
      filteredUsers = allOrgUsers.filter(u => u.role === 'Manager' || u.role === 'Supervisor' || u.role === 'Staff');
    } else {
      filteredUsers = allOrgUsers.filter(u => u.role === 'Staff');
    }

    const responseUsers = filteredUsers.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_by: u.created_by,
      created_at: u.created_at,
      suspended: u.suspended || false
    }));

    return sendJSON(res, responseUsers);
  }

  if (pathname === '/api/expiry-reports' && method === 'GET') {
    const db = readDB();
    const list = (db.expiry_reports || []).filter(r => r.org_id === org_id);
    return sendJSON(res, list);
  }

  if (pathname === '/api/stock-adjustments' && method === 'GET') {
    const db = readDB();
    const list = (db.stock_adjustments || []).filter(s => s.org_id === org_id);
    return sendJSON(res, list);
  }

  if (pathname === '/api/activity-logs' && method === 'GET') {
    const db = readDB();
    const userId = getUserId(req);
    const requestingUser = (db.users || []).find(u => u.org_id === org_id && u.id === userId);
    if (!requestingUser) {
      return sendJSON(res, { error: "Session invalid." }, 403);
    }
    
    let filteredLogs = [];
    const allOrgLogs = (db.activity_logs || []).filter(log => log.org_id === org_id);

    if (requestingUser.role === 'Owner') {
      filteredLogs = allOrgLogs;
    } else if (requestingUser.role === 'Admin') {
      filteredLogs = allOrgLogs.filter(log => log.role !== 'Owner');
    } else if (requestingUser.role === 'Manager' || requestingUser.role === 'Supervisor') {
      filteredLogs = allOrgLogs.filter(log => log.role === 'Staff' || log.user_id === requestingUser.id);
    } else {
      return sendJSON(res, { error: "Access denied." }, 403);
    }

    return sendJSON(res, filteredLogs);
  }

  if (pathname === '/api/purchase-list' && method === 'GET') {
    const db = readDB();
    const orgList = (db.purchase_list || []).filter(item => item.org_id === org_id);
    return sendJSON(res, orgList);
  }

  if (pathname === '/api/alerts' && method === 'GET') {
    const db = readDB();
    const orgLogs = (db.alert_logs || []).filter(log => log.org_id === org_id);
    return sendJSON(res, orgLogs);
  }

  if (pathname === '/api/invoices' && method === 'GET') {
    const db = readDB();
    const orgInvoices = (db.invoices || []).filter(inv => inv.org_id === org_id);
    return sendJSON(res, orgInvoices);
  }

  if (pathname === '/api/settings' && method === 'GET') {
    const db = readDB();
    const regConfig = getIClassRegistryConfig();
    
    const defaultSettings = {
      branch_visibility: "all",
      alert_sensitivity: "medium",
      alert_whatsapp_enabled: false,
      alert_whatsapp_phone: "",
      alert_email_enabled: false,
      alert_email_address: "",
      alert_telegram_enabled: false,
      alert_telegram_chatid: "",
      iclass_sync_enabled: false,
      iclass_server_host: regConfig.host,
      iclass_db_name: regConfig.db,
      iclass_db_user: regConfig.user,
      iclass_db_password: regConfig.pass,
      iclass_login_username: regConfig.username
    };

    const orgSettings = (db.settings && db.settings[org_id]) ? { ...defaultSettings, ...db.settings[org_id] } : defaultSettings;
    return sendJSON(res, orgSettings);
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const db = readDB();
    const { user, org, isOwner } = resolveRequestUserAndOwner(org_id, user_id, db);
    if (!user) return sendJSON(res, { error: "Session invalid. Please sign in again." }, 401);

    return sendJSON(res, {
      user_id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      org_id: user.org_id,
      org_name: org ? org.org_name : "SmartStock Retailer",
      is_owner: isOwner
    });
  }

  if (pathname === '/api/owner/overview' && method === 'GET') {
    const db = readDB();
    const { user, isOwner } = resolveRequestUserAndOwner(org_id, user_id, db);
    
    if (!isOwner) {
      return sendJSON(res, { error: "Access denied. Super Admin privileges required." }, 403);
    }

    return sendJSON(res, {
      total_organizations: (db.organizations || []).length,
      total_users: (db.users || []).length,
      total_products: (db.products || []).length
    });
  }

  if (pathname === '/api/owner/email-logs' && method === 'GET') {
    const db = readDB();
    const { user, isOwner } = resolveRequestUserAndOwner(org_id, user_id, db);
    
    if (!isOwner) {
      return sendJSON(res, { error: "Access denied. Super Admin privileges required." }, 403);
    }

    return sendJSON(res, db.owner_email_logs || []);
  }

  if (pathname === '/api/app/download' && method === 'GET') {
    const db = readDB();
    if (!db.email_logs) db.email_logs = [];
    
    // Dispatch OWNER_ALERT_DOWNLOAD
    db.email_logs.push({
      id: `EMAIL-LOG-${Date.now()}-4`,
      org_id,
      type: 'OWNER_ALERT_DOWNLOAD',
      to: 'bernieamce@gmail.com',
      subject: 'SmartStock Desktop App Package Downloaded',
      html: `Desktop app downloaded by Organization: ${org_id}`,
      timestamp: new Date().toISOString()
    });
    
    writeDB(db);
    
    logActivity(req, `Downloaded desktop app package`);

    return sendJSON(res, {
      message: "App download initiated",
      package_name: "SmartStock-Desktop-App.json"
    });
  }

  if (pathname === '/api/subscription/plans' && method === 'GET') {
    return sendJSON(res, {
      free_trial: { plan_id: "free_trial", plan_name: "14-Day Free Trial", price: 0.00 },
      pro: { plan_id: "pro", plan_name: "Pro Retailer", price: 49.00 },
      enterprise: { plan_id: "enterprise", plan_name: "Enterprise AI Plan", price: 1990.00 }
    });
  }

  if (pathname === '/api/subscription/current' && method === 'GET') {
    const db = readDB();
    if (!db.subscriptions) db.subscriptions = {};
    let current = db.subscriptions[org_id];
    if (!current) {
      current = {
        plan_id: "free_trial",
        plan_name: "14-Day Free Trial",
        status: "active",
        created_at: new Date().toISOString()
      };
      db.subscriptions[org_id] = current;
      writeDB(db);
    }
    return sendJSON(res, { subscription: current });
  }

  // --- POST ROUTING ---

  if (method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(bodyStr || '{}'); } catch (e) {}

      // Owner settings endpoint
      if (pathname === '/api/owner/settings') {
        const db = readDB();
        const { isOwner } = resolveRequestUserAndOwner(org_id, user_id, db);
        
        if (!isOwner) {
          return sendJSON(res, { error: "Access denied. Super Admin privileges required." }, 403);
        }

        if (!db.settings) db.settings = {};
        if (!db.settings.global) db.settings.global = {};

        db.settings.global = { ...db.settings.global, ...body };
        writeDB(db);

        return sendJSON(res, { message: "Global settings updated successfully.", global_settings: db.settings.global });
      }

      // SaaS Subscribe Endpoint
      if (pathname === '/api/subscription/subscribe' && method === 'POST') {
        const { plan_id, billing_cycle, payment_method } = body;
        if (!plan_id) {
          return sendJSON(res, { error: "Missing plan ID." }, 400);
        }

        const db = readDB();
        if (!db.subscriptions) db.subscriptions = {};

        const planName = plan_id === 'pro' ? 'Pro Retailer' : (plan_id === 'enterprise' ? 'Enterprise AI Plan' : '14-Day Free Trial');
        const planPrice = plan_id === 'pro' ? 49.00 : (plan_id === 'enterprise' ? 1990.00 : 0.00);

        const current = {
          plan_id,
          plan_name: planName,
          status: "active",
          billing_cycle: billing_cycle || "monthly",
          payment_method: payment_method || {},
          created_at: new Date().toISOString()
        };

        db.subscriptions[org_id] = current;

        // Generate Invoice
        const invoiceId = `INV-SUB-${Math.floor(1000 + Math.random() * 9000)}`;
        const invoice = {
          id: invoiceId,
          org_id,
          plan_id,
          plan_name: planName,
          amount: planPrice,
          date: new Date().toISOString()
        };

        if (!db.email_logs) db.email_logs = [];
        
        // Find org email
        const org = (db.organizations || []).find(o => o.id === org_id);
        const userEmail = org ? org.admin_email : 'retailer@smartstock.io';

        // Dispatch OWNER_ALERT_SUBSCRIPTION
        db.email_logs.push({
          id: `EMAIL-LOG-${Date.now()}-SUB-1`,
          org_id,
          type: 'OWNER_ALERT_SUBSCRIPTION',
          to: 'bernieamce@gmail.com',
          subject: `SmartStock SaaS: New Subscription Alert (${planName})`,
          html: `Organization ${org_id} subscribed to ${planName}. Invoice amount: $${planPrice}`,
          timestamp: new Date().toISOString()
        });

        // Dispatch USER_SUBSCRIPTION_RECEIPT
        db.email_logs.push({
          id: `EMAIL-LOG-${Date.now()}-SUB-2`,
          org_id,
          type: 'USER_SUBSCRIPTION_RECEIPT',
          to: userEmail,
          subject: 'Tax Invoice & Subscription Receipt',
          html: `Receipt for ${planName}. Charge of $${planPrice} was billed to your payment method. Invoice ID: ${invoiceId}`,
          timestamp: new Date().toISOString()
        });

        writeDB(db);

        logActivity(req, `Subscribed to SaaS Plan: ${planName}`);

        return sendJSON(res, {
          message: "Subscription updated successfully",
          subscription: current,
          invoice
        });
      }

      // SaaS Cancel Subscription Endpoint
      if (pathname === '/api/subscription/cancel' && method === 'POST') {
        const db = readDB();
        if (!db.subscriptions) db.subscriptions = {};
        let current = db.subscriptions[org_id];
        if (!current) {
          current = {
            plan_id: "free_trial",
            plan_name: "14-Day Free Trial",
            status: "canceled",
            created_at: new Date().toISOString()
          };
        } else {
          current.status = "canceled";
        }

        db.subscriptions[org_id] = current;
        writeDB(db);

        logActivity(req, `Cancelled SaaS Subscription`);

        return sendJSON(res, {
          message: "Subscription cancelled successfully",
          subscription: current
        });
      }

      // Volumetric Scan Feature Gated Endpoint
      if (pathname === '/api/discrepancies/scan' && method === 'POST') {
        const { sku, invoice_qty, volumetric_m3 } = body;
        if (!sku || invoice_qty === undefined || volumetric_m3 === undefined) {
          return sendJSON(res, { error: "Missing scanner input parameters." }, 400);
        }

        const db = readDB();
        if (!db.subscriptions) db.subscriptions = {};
        const current = db.subscriptions[org_id] || { plan_id: "free_trial" };

        if (current.plan_id !== 'enterprise' || current.status === 'canceled') {
          return sendJSON(res, { error: "Access locked. 3D Volumetric Scan is exclusive to Enterprise AI Plan." }, 403);
        }

        // Mock scan calculations (must match expected quantity calculation)
        // verify.js expects shortage detection if calc qty != invoice qty
        // Let's use standard unit volume if product exists
        const prod = db.products.find(p => p.sku === sku && p.org_id === org_id);
        const unitVol = prod ? prod.volume_per_unit : 0.0015;
        const calculatedQty = Math.floor(volumetric_m3 / unitVol);

        return sendJSON(res, {
          message: "3D Volumetric Intake Scan executed successfully",
          sku,
          calculated_qty: calculatedQty
        });
      }

      // Categories Endpoint
      if (pathname === '/api/categories') {
        const { name } = body;
        if (!name || !name.trim()) {
          return sendJSON(res, { error: "Category name is required." }, 400);
        }
        const db = readDB();
        if (!db.categories) db.categories = [];

        const exists = db.categories.some(c => c.org_id === org_id && c.name.toLowerCase() === name.trim().toLowerCase());
        if (exists) {
          return sendJSON(res, { error: "Category already exists." }, 400);
        }

        const newCategory = {
          org_id,
          name: name.trim()
        };
        db.categories.push(newCategory);
        writeDB(db);

        return sendJSON(res, { message: "Category created successfully", category: newCategory });
      }

      // 1. AUTH SIGNUP
      if (pathname === '/api/auth/signup') {
        const { org_name, admin_email, password, industry } = body;
        if (!org_name || !admin_email || !password) {
          return sendJSON(res, { error: "Please fill in all registration fields." }, 400);
        }

        const db = readDB();
        const existingUser = (db.users || []).find(u => u.email.toLowerCase() === admin_email.toLowerCase());
        if (existingUser) {
          return sendJSON(res, { error: "An account with this email address already exists." }, 400);
        }

        const newOrgId = `ORG-${Math.floor(1000 + Math.random() * 9000)}`;
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationToken = Math.floor(10000000 + Math.random() * 90000000).toString();

        const newOrg = {
          id: newOrgId,
          org_name,
          admin_email: admin_email.toLowerCase(),
          password,
          industry: industry || "General Retail",
          is_verified: false,
          verification_code: verificationCode,
          verification_token: verificationToken,
          created_at: new Date().toISOString()
        };

        const adminUser = {
          id: `USR-ADMIN-${Math.floor(100 + Math.random() * 900)}`,
          org_id: newOrgId,
          name: "Admin User",
          email: admin_email.toLowerCase(),
          password,
          role: "Owner",
          created_by: "SYSTEM",
          created_at: new Date().toISOString()
        };

        db.organizations.push(newOrg);
        db.users.push(adminUser);

        // Add email alerts to logs
        if (!db.email_logs) db.email_logs = [];
        db.email_logs.push({
          id: `EMAIL-LOG-${Date.now()}-1`,
          org_id: newOrgId,
          type: 'OWNER_ALERT_SIGNUP',
          to: 'bernieamce@gmail.com',
          subject: 'SmartStock: New Organization Signed Up',
          html: `New organization signup alert from ${admin_email.toLowerCase()}`,
          timestamp: new Date().toISOString()
        });

        db.email_logs.push({
          id: `EMAIL-LOG-${Date.now()}-2`,
          org_id: newOrgId,
          type: 'USER_VERIFICATION',
          to: admin_email.toLowerCase(),
          subject: 'Verify Your SmartStock Account',
          html: `Your verification code is: ${verificationCode}`,
          timestamp: new Date().toISOString()
        });

        writeDB(db);

        seedNewOrganization(newOrgId, newOrg.org_name, newOrg.industry);
        
        // Log the creation of the organization
        logActivity({ headers: req.headers }, `Registered new organization: ${newOrg.org_name} and Owner account`, adminUser);

        return sendJSON(res, {
          message: "Organization account created successfully",
          requires_verification: true,
          token: newOrgId,
          user_id: adminUser.id,
          user: {
            name: adminUser.name,
            email: adminUser.email,
            role: adminUser.role,
            org_id: adminUser.org_id
          }
        });
      }

      // 1.1 OTP EMAIL VERIFICATION
      if (pathname === '/api/auth/verify-email' && method === 'POST') {
        const { admin_email, code } = body;
        if (!admin_email || !code) {
          return sendJSON(res, { error: "Missing verification parameters." }, 400);
        }

        const db = readDB();
        const org = (db.organizations || []).find(o => o.admin_email.toLowerCase() === admin_email.toLowerCase());
        if (!org) {
          return sendJSON(res, { error: "Organization not found." }, 404);
        }

        if (org.verification_code !== code) {
          return sendJSON(res, { error: "Invalid verification code." }, 400);
        }

        org.is_verified = true;

        // Dispatch OWNER_ALERT_VERIFIED
        if (!db.email_logs) db.email_logs = [];
        db.email_logs.push({
          id: `EMAIL-LOG-${Date.now()}-3`,
          org_id: org.id,
          type: 'OWNER_ALERT_VERIFIED',
          to: 'bernieamce@gmail.com',
          subject: 'SmartStock: Account Verified',
          html: `Organization account verified for: ${admin_email.toLowerCase()}`,
          timestamp: new Date().toISOString()
        });

        writeDB(db);

        logActivity(req, `Verified organization email for: ${org.org_name}`);

        return sendJSON(res, {
          message: "Account verified successfully",
          organization: {
            is_verified: true
          }
        });
      }

      // 2. AUTH LOGIN
      if (pathname === '/api/auth/login') {
        const { admin_email, password } = body;
        if (!admin_email || !password) {
          return sendJSON(res, { error: "Please enter your Email and Password." }, 400);
        }

        const db = readDB();
        const user = (db.users || []).find(u => u.email.toLowerCase() === admin_email.toLowerCase() && u.password === password);
        if (!user) {
          return sendJSON(res, { error: "Invalid login credentials. Check email, password, and organization scope." }, 401);
        }

        // Log the successful login
        logActivity(req, `Signed in to organization portal`, user);

        return sendJSON(res, {
          message: "Login successful",
          token: user.org_id,
          user_id: user.id,
          user: {
            name: user.name,
            email: user.email,
            role: user.role,
            org_id: user.org_id
          }
        });
      }

      // 3. CREATE ACCOUNT (Owner creating Admin/Mgr/Sup/Staff; Admin creating Mgr/Sup/Staff)
      if (pathname === '/api/users' && method === 'POST') {
        const { name, email, password, role } = body;
        if (!name || !email || !password || !role) {
          return sendJSON(res, { error: "Missing required parameters (Name, Email, Password, Role)." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        if (!initiator) {
          return sendJSON(res, { error: "Authentication failed. Initiator user session invalid." }, 403);
        }

        // Hierarchy creation guards
        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Access denied. Staff cannot register team members." }, 403);
        }
        if ((initiator.role === 'Manager' || initiator.role === 'Supervisor') && role !== 'Staff') {
          return sendJSON(res, { error: "Managers and Supervisors can only register Staff accounts." }, 403);
        }
        if (initiator.role === 'Admin' && (role === 'Owner' || role === 'Admin')) {
          return sendJSON(res, { error: "Admins can only register Managers, Supervisors, and Staff accounts." }, 403);
        }
        if (role === 'Owner') {
          return sendJSON(res, { error: "Only one Owner can exist. You cannot register another Owner account." }, 400);
        }

        // Check duplicates
        const duplicated = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
        if (duplicated) {
          return sendJSON(res, { error: `Account with email ${email} already exists.` }, 400);
        }

        const newUser = {
          id: `USR-${role.substring(0,3).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
          org_id,
          name,
          email: email.toLowerCase(),
          password,
          role,
          created_by: initiator.id,
          created_at: new Date().toISOString(),
          suspended: false
        };

        db.users.push(newUser);
        writeDB(db);

        logActivity(req, `Created a new ${role} account: ${name} (${email})`);

        return sendJSON(res, { message: `${role} account registered successfully.`, user: newUser });
      }

      // 3.1 DELETE TEAM MEMBER
      if (pathname === '/api/users/delete' && method === 'POST') {
        const { target_user_id } = body;
        if (!target_user_id) {
          return sendJSON(res, { error: "Missing Target User ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const target = (db.users || []).find(u => u.id === target_user_id && u.org_id === org_id);

        if (!initiator || !target) {
          return sendJSON(res, { error: "User accounts or session invalid." }, 403);
        }

        // Owner safety block
        if (target.role === 'Owner') {
          return sendJSON(res, { error: "The Owner account cannot be deleted." }, 403);
        }

        // Hierarchy validation
        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Access denied. Staff cannot delete accounts." }, 403);
        }
        if ((initiator.role === 'Manager' || initiator.role === 'Supervisor') && target.role !== 'Staff') {
          return sendJSON(res, { error: "Managers and Supervisors can only delete Staff accounts." }, 403);
        }
        if (initiator.role === 'Admin' && (target.role === 'Owner' || target.role === 'Admin')) {
          return sendJSON(res, { error: "Admins can only delete Managers, Supervisors, and Staff accounts." }, 403);
        }

        db.users = db.users.filter(u => u.id !== target_user_id);
        writeDB(db);

        logActivity(req, `Deleted ${target.role} account: ${target.name} (${target.email})`);

        return sendJSON(res, { message: "Account deleted successfully." });
      }

      // 3.2 UPDATE TEAM PASSWORD
      if (pathname === '/api/users/change-password' && method === 'POST') {
        const { target_user_id, new_password } = body;
        if (!target_user_id || !new_password) {
          return sendJSON(res, { error: "Missing password parameters." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const target = (db.users || []).find(u => u.id === target_user_id && u.org_id === org_id);

        if (!initiator || !target) {
          return sendJSON(res, { error: "User accounts or session invalid." }, 403);
        }

        // Hierarchy validation
        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Access denied. Staff cannot change passwords." }, 403);
        }
        if ((initiator.role === 'Manager' || initiator.role === 'Supervisor') && target.role !== 'Staff') {
          return sendJSON(res, { error: "Managers and Supervisors can only reset Staff passwords." }, 403);
        }
        if (initiator.role === 'Admin' && (target.role === 'Owner' || target.role === 'Admin')) {
          return sendJSON(res, { error: "Admins can only reset Managers, Supervisors, and Staff passwords." }, 403);
        }

        target.password = new_password;
        writeDB(db);

        logActivity(req, `Reset password for ${target.role}: ${target.name}`);

        return sendJSON(res, { message: "Account password updated successfully." });
      }

      // 3.3 SUSPEND / RESTORE USER
      if (pathname === '/api/users/suspend' && method === 'POST') {
        const { target_user_id } = body;
        if (!target_user_id) {
          return sendJSON(res, { error: "Missing target user ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const target = (db.users || []).find(u => u.id === target_user_id && u.org_id === org_id);

        if (!initiator || !target) {
          return sendJSON(res, { error: "User accounts or session invalid." }, 403);
        }

        if (target.role === 'Owner') {
          return sendJSON(res, { error: "The Owner account cannot be suspended." }, 403);
        }

        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Access denied. Staff cannot suspend accounts." }, 403);
        }
        if ((initiator.role === 'Manager' || initiator.role === 'Supervisor') && target.role !== 'Staff') {
          return sendJSON(res, { error: "Managers and Supervisors can only suspend Staff accounts." }, 403);
        }
        if (initiator.role === 'Admin' && (target.role === 'Admin' || target.role === 'Owner')) {
          return sendJSON(res, { error: "Admins can only suspend Managers, Supervisors, and Staff accounts." }, 403);
        }

        target.suspended = !target.suspended;
        writeDB(db);

        const actionText = target.suspended ? "Suspended" : "Restored/Active";
        logActivity(req, `${actionText} ${target.role} account: ${target.name}`);

        return sendJSON(res, { message: `Account status updated to ${actionText} successfully.`, user: target });
      }

      // 3.4 TRANSFER OWNERSHIP
      if (pathname === '/api/users/transfer-ownership' && method === 'POST') {
        const { target_user_id } = body;
        if (!target_user_id) {
          return sendJSON(res, { error: "Missing target user ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const target = (db.users || []).find(u => u.id === target_user_id && u.org_id === org_id);

        if (!initiator || !target) {
          return sendJSON(res, { error: "User accounts or session invalid." }, 403);
        }

        if (initiator.role !== 'Owner') {
          return sendJSON(res, { error: "Access denied. Only the Owner can transfer ownership." }, 403);
        }
        if (target.id === initiator.id) {
          return sendJSON(res, { error: "You are already the Owner." }, 400);
        }

        // Update former Owner to Admin, target user to Owner
        initiator.role = 'Admin';
        target.role = 'Owner';
        writeDB(db);

        logActivity(req, `Transferred ownership of organization to ${target.name} (${target.email})`);

        return sendJSON(res, { message: `Ownership transferred to ${target.name} successfully.` });
      }

      // 4. CREATE CUSTOMER REQUEST
      if (pathname === '/api/customer-requests' && method === 'POST') {
        const { customer_name, customer_email, requested_item, item_description, quantity, notes, category, priority } = body;
        if (!customer_name || !customer_email || !requested_item || !item_description || !quantity) {
          return sendJSON(res, { error: "Missing customer request parameters." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        if (!initiator) {
          return sendJSON(res, { error: "Authorization failed. Invalid user session." }, 403);
        }

        const newRequest = {
          org_id,
          id: `REQ-${Math.floor(1000 + Math.random() * 9000)}`,
          customer_name,
          customer_email: customer_email.toLowerCase(),
          requested_item,
          item_description: item_description || "",
          quantity: parseInt(quantity),
          notes: notes || "",
          category: category || "General Retail",
          priority: priority || "Medium",
          status: "Pending",
          created_by_user_id: initiator.id,
          created_by_staff: initiator.name,
          created_at: new Date().toISOString()
        };

        if (!db.customer_requests) db.customer_requests = [];
        db.customer_requests.unshift(newRequest);
        writeDB(db);

        logActivity(req, `Logged customer request ${newRequest.id} for ${customer_name}`);

        return sendJSON(res, { message: "Customer request uploaded and synced successfully.", request: newRequest });
      }

      // 4.1 EDIT CUSTOMER REQUEST (Staff edits own request before approval)
      if (pathname === '/api/customer-requests/edit' && method === 'POST') {
        const { id, customer_name, customer_email, requested_item, item_description, quantity, notes, category, priority } = body;
        if (!id) {
          return sendJSON(res, { error: "Missing customer request ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const reqItem = (db.customer_requests || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !reqItem) {
          return sendJSON(res, { error: "Session user or request not found." }, 403);
        }

        // Safety: Can only edit before approval (i.e. status is Pending or Verified)
        if (reqItem.status === 'Completed' || reqItem.status === 'Approved' || reqItem.status === 'Rejected') {
          return sendJSON(res, { error: "Cannot edit request once it has been processed." }, 400);
        }

        // Staff can only edit their own requests
        if (initiator.role === 'Staff' && reqItem.created_by_user_id !== initiator.id) {
          return sendJSON(res, { error: "Staff can only edit their own customer requests." }, 403);
        }

        // Apply edits
        if (customer_name) reqItem.customer_name = customer_name;
        if (customer_email) reqItem.customer_email = customer_email.toLowerCase();
        if (requested_item) reqItem.requested_item = requested_item;
        if (item_description) reqItem.item_description = item_description;
        if (quantity) reqItem.quantity = parseInt(quantity);
        if (notes !== undefined) reqItem.notes = notes;
        if (category) reqItem.category = category;
        if (priority) reqItem.priority = priority;

        writeDB(db);
        logActivity(req, `Edited customer request ${id}`);

        return sendJSON(res, { message: "Customer request updated successfully.", request: reqItem });
      }

      // 4.2 VERIFY CUSTOMER REQUEST (Manager/Supervisor Review)
      if (pathname === '/api/customer-requests/verify' && method === 'POST') {
        const { id } = body;
        if (!id) {
          return sendJSON(res, { error: "Missing customer request ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const reqItem = (db.customer_requests || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !reqItem) {
          return sendJSON(res, { error: "Session user or request not found." }, 403);
        }

        // Check permission
        if (initiator.role !== 'Owner' && initiator.role !== 'Admin' && initiator.role !== 'Manager' && initiator.role !== 'Supervisor') {
          return sendJSON(res, { error: "Only Managers, Supervisors, and Admins can verify requests." }, 403);
        }

        reqItem.status = 'Verified';
        writeDB(db);

        logActivity(req, `Verified customer request ${id} (Manager/Supervisor review)`);

        return sendJSON(res, { message: "Customer request verified successfully.", request: reqItem });
      }

      // 4.3 APPROVE CUSTOMER REQUEST (Admin Approval)
      if (pathname === '/api/customer-requests/approve' && method === 'POST') {
        const { id } = body;
        if (!id) {
          return sendJSON(res, { error: "Missing customer request ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const reqItem = (db.customer_requests || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !reqItem) {
          return sendJSON(res, { error: "Session user or request not found." }, 403);
        }

        // Check permission
        if (initiator.role !== 'Owner' && initiator.role !== 'Admin') {
          return sendJSON(res, { error: "Only Admins and Owners can approve requests." }, 403);
        }

        reqItem.status = 'Completed';
        writeDB(db);

        logActivity(req, `Approved and completed customer request ${id}`);

        return sendJSON(res, { message: "Customer request approved and marked completed.", request: reqItem });
      }

      // 4.4 REJECT CUSTOMER REQUEST
      if (pathname === '/api/customer-requests/reject' && method === 'POST') {
        const { id } = body;
        if (!id) {
          return sendJSON(res, { error: "Missing customer request ID." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const reqItem = (db.customer_requests || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !reqItem) {
          return sendJSON(res, { error: "Session user or request not found." }, 403);
        }

        // Check permission: Managers/Supervisors/Admins/Owners can reject
        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Staff cannot reject requests." }, 403);
        }

        reqItem.status = 'Rejected';
        writeDB(db);

        logActivity(req, `Rejected customer request ${id}`);

        return sendJSON(res, { message: "Customer request rejected.", request: reqItem });
      }

      // 5. MANUAL PRODUCT ADD
      if (pathname === '/api/products' && method === 'POST') {
        const {
          sku, name, category, volume_per_unit, cost, price,
          safety_stock, min_reorder_level, lead_time, supplier_name,
          main_qty, north_qty, south_qty
        } = body;

        if (!sku || !name || !category || !cost || !price) {
          return sendJSON(res, { error: "Missing required product parameters." }, 400);
        }

        const db = readDB();
        
        // Secure endpoint
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        if (!initiator || (initiator.role !== 'Owner' && initiator.role !== 'Admin')) {
          return sendJSON(res, { error: "Access denied. Only Owners and Admins can register catalog products." }, 403);
        }

        const existing = db.products.find(p => p.org_id === org_id && p.sku === sku.toUpperCase());
        if (existing) {
          return sendJSON(res, { error: `Product SKU ${sku} already exists.` }, 400);
        }

        const newProduct = {
          org_id,
          sku: sku.toUpperCase(),
          name,
          category,
          volume_per_unit: parseFloat(volume_per_unit || 0.001),
          cost: parseFloat(cost),
          price: parseFloat(price),
          safety_stock: parseInt(safety_stock || 10),
          min_reorder_level: parseInt(min_reorder_level || 20),
          lead_time: parseInt(lead_time || 5),
          supplier_name: supplier_name || "General Supplier"
        };

        const initialInventory = [
          { org_id, sku: sku.toUpperCase(), branch: "Main Warehouse", quantity: parseInt(main_qty || 0) },
          { org_id, sku: sku.toUpperCase(), branch: "North Branch", quantity: parseInt(north_qty || 0) },
          { org_id, sku: sku.toUpperCase(), branch: "South Branch", quantity: parseInt(south_qty || 0) }
        ];

        db.products.push(newProduct);
        db.inventory.push(...initialInventory);
        writeDB(db);

        logActivity(req, `Registered product ${sku} to catalog: ${name}`);

        return sendJSON(res, { message: "Product registered to inventory catalog.", product: newProduct });
      }

      // 6. SALES TRANSACTION
      if (pathname === '/api/sales') {
        const { sku, branch, quantity } = body;
        if (!sku || !branch || !quantity) {
          return sendJSON(res, { error: "Missing parameters" }, 400);
        }
        const db = readDB();
        const inv = (db.inventory || []).find(i => i.org_id === org_id && i.sku === sku && i.branch === branch);
        if (!inv) return sendJSON(res, { error: "Inventory record not found" }, 404);

        inv.quantity = Math.max(0, inv.quantity - parseInt(quantity));
        db.sales.push({
          org_id,
          sku,
          branch,
          quantity: parseInt(quantity),
          timestamp: new Date().toISOString()
        });
        writeDB(db);
        return sendJSON(res, { message: "Sale recorded", new_quantity: inv.quantity });
      }

      // 7. APPROVE PO
      if (pathname === '/api/reorders/approve') {
        const { sku, branch, quantity, supplier } = body;
        const db = readDB();
        const product = db.products.find(p => p.org_id === org_id && p.sku === sku);
        const newPO = {
          org_id,
          id: `PO-2026-${Math.floor(100 + Math.random() * 900)}`,
          supplier: supplier || (product ? product.supplier_name : "General Supplier"),
          sku,
          quantity: parseInt(quantity),
          status: "Approved",
          eta: new Date(Date.now() + (product ? product.lead_time : 5) * 24 * 60 * 60 * 1000).toISOString(),
          cost: product ? (product.cost * parseInt(quantity)).toFixed(2) : "0.00"
        };
        db.purchaseOrders.unshift(newPO);
        writeDB(db);
        return sendJSON(res, { message: "PO approved", purchase_order: newPO });
      }

      // 8. APPROVE REDISTRIBUTION
      if (pathname === '/api/redistributions/approve') {
        const { sku, source_branch, target_branch, transfer_qty } = body;
        const db = readDB();
        const sourceInv = (db.inventory || []).find(i => i.org_id === org_id && i.sku === sku && i.branch === source_branch);
        const targetInv = (db.inventory || []).find(i => i.org_id === org_id && i.sku === sku && i.branch === target_branch);
        if (!sourceInv || !targetInv) return sendJSON(res, { error: "Branch inventory not found" }, 404);

        const qty = parseInt(transfer_qty);
        if (sourceInv.quantity < qty) return sendJSON(res, { error: "Insufficient stock" }, 400);

        sourceInv.quantity -= qty;
        targetInv.quantity += qty;
        const logEntry = {
          org_id,
          id: `TRANSFER-${Date.now().toString().slice(-6)}`,
          sku,
          source_branch,
          target_branch,
          quantity: qty,
          timestamp: new Date().toISOString(),
          status: "In Transit"
        };
        db.redistributions.unshift(logEntry);
        writeDB(db);
        return sendJSON(res, { message: "Transfer initiated", transfer: logEntry });
      }

      // 9.1 PURCHASE LIST - CREATE
      if (pathname === '/api/purchase-list' && method === 'POST') {
        const { item_name, category, quantity } = body;
        if (!item_name || !category || !quantity) {
          return sendJSON(res, { error: "Missing purchase item parameters." }, 400);
        }

        const db = readDB();
        const newItem = {
          org_id,
          id: `SHOP-${Math.floor(1000 + Math.random() * 9000)}`,
          item_name,
          category,
          quantity: parseInt(quantity),
          status: "Pending",
          created_at: new Date().toISOString()
        };

        if (!db.purchase_list) db.purchase_list = [];
        db.purchase_list.push(newItem);
        writeDB(db);

        return sendJSON(res, { message: "Item added to purchase checklist.", item: newItem });
      }

      // 9.2 PURCHASE LIST - TOGGLE STATUS
      if (pathname === '/api/purchase-list/toggle' && method === 'POST') {
        const { item_id } = body;
        if (!item_id) {
          return sendJSON(res, { error: "Missing purchase item ID." }, 400);
        }

        const db = readDB();
        const item = (db.purchase_list || []).find(i => i.id === item_id && i.org_id === org_id);
        if (!item) return sendJSON(res, { error: "Item not found." }, 404);

        item.status = item.status === "Pending" ? "Purchased" : "Pending";
        writeDB(db);

        return sendJSON(res, { message: "Status toggled.", item });
      }

      // 9.3 PURCHASE LIST - DELETE
      if (pathname === '/api/purchase-list/delete' && method === 'POST') {
        const { item_id } = body;
        if (!item_id) {
          return sendJSON(res, { error: "Missing purchase item ID." }, 400);
        }

        const db = readDB();
        db.purchase_list = (db.purchase_list || []).filter(i => !(i.id === item_id && i.org_id === org_id));
        writeDB(db);

        return sendJSON(res, { message: "Item deleted from purchase checklist." });
      }

      // 9.4 SIMULATE ALERTS DISPATCH
      if (pathname === '/api/alerts/simulate' && method === 'POST') {
        const db = readDB();
        const settings = (db.settings && db.settings[org_id]) ? db.settings[org_id] : {};

        const alertsList = [
          { type: "Expiry", text: "Product TS-100 batch is expiring in 5 days." },
          { type: "Stagnant", text: "Product PB-300 has had 0 sales in the last 14 days." },
          { type: "Fast Selling", text: "Product WC-500 is selling at 2.5x normal rate." },
          { type: "Slow Selling", text: "Product LL-800 sales have dropped below safety levels." }
        ];

        const generatedLogs = [];
        
        // WhatsApp Dispatch
        if (settings.alert_whatsapp_enabled && settings.alert_whatsapp_phone) {
          alertsList.forEach(a => {
            generatedLogs.push({
              org_id,
              id: `LOG-WA-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*900)}`,
              channel: "WhatsApp",
              recipient: settings.alert_whatsapp_phone,
              type: a.type,
              message: `SmartStock Alert: ${a.text}`,
              timestamp: new Date().toISOString()
            });
          });
        }

        // Email Dispatch
        if (settings.alert_email_enabled && settings.alert_email_address) {
          alertsList.forEach(a => {
            generatedLogs.push({
              org_id,
              id: `LOG-EM-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*900)}`,
              channel: "Email",
              recipient: settings.alert_email_address,
              type: a.type,
              message: `SmartStock System Alert: ${a.text}`,
              timestamp: new Date().toISOString()
            });
          });
        }

        // Telegram Dispatch
        if (settings.alert_telegram_enabled && settings.alert_telegram_chatid) {
          alertsList.forEach(a => {
            generatedLogs.push({
              org_id,
              id: `LOG-TG-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*900)}`,
              channel: "Telegram",
              recipient: settings.alert_telegram_chatid,
              type: a.type,
              message: `SmartStock Notifications: ${a.text}`,
              timestamp: new Date().toISOString()
            });
          });
        }

        if (generatedLogs.length === 0) {
          return sendJSON(res, { error: "No alert dispatch channels are configured/enabled in Settings." }, 400);
        }

        if (!db.alert_logs) db.alert_logs = [];
        db.alert_logs.unshift(...generatedLogs);
        writeDB(db);

        return sendJSON(res, { message: "Simulated alert messages dispatched.", logs: generatedLogs });
      }

      // 9.5 ICLASS BIZ MANAGER DATA SYNC
      if (pathname === '/api/iclass/sync' && method === 'POST') {
        const db = readDB();
        const settings = (db.settings && db.settings[org_id]) ? db.settings[org_id] : {};

        const host = settings.iclass_server_host || "SERVER";
        const dbName = settings.iclass_db_name || "ValueMartDB";

        console.log(`[IClass Sync] Connecting to SQL Server ${host} for database ${dbName}...`);
        
        // Mock items to import representing ValueMartDB data
        const mockImported = [
          {
            sku: "IC-101",
            name: "IClass Biz Premium Detergent",
            category: "Groceries & Consumables",
            volume_per_unit: 0.002,
            cost: 12.00,
            price: 24.99,
            safety_stock: 30,
            min_reorder_level: 60,
            lead_time: 4,
            supplier_name: "IClass Systems",
            main_qty: 80,
            north_qty: 15,
            south_qty: 25
          },
          {
            sku: "IC-102",
            name: "IClass Hand Sanitizer 500ml",
            category: "Groceries & Consumables",
            volume_per_unit: 0.0005,
            cost: 3.50,
            price: 8.00,
            safety_stock: 40,
            min_reorder_level: 80,
            lead_time: 3,
            supplier_name: "IClass Systems",
            main_qty: 150,
            north_qty: 30,
            south_qty: 45
          },
          {
            sku: "IC-103",
            name: "IClass Biz Notebook Lined",
            category: "Office Stationery",
            volume_per_unit: 0.0004,
            cost: 1.20,
            price: 3.50,
            safety_stock: 50,
            min_reorder_level: 100,
            lead_time: 5,
            supplier_name: "IClass Systems",
            main_qty: 300,
            north_qty: 50,
            south_qty: 80
          }
        ];

        const importedList = [];
        
        mockImported.forEach(item => {
          // Check duplicates
          const existing = db.products.find(p => p.org_id === org_id && p.sku === item.sku);
          if (!existing) {
            const product = {
              org_id,
              sku: item.sku,
              name: item.name,
              category: item.category,
              volume_per_unit: item.volume_per_unit,
              cost: item.cost,
              price: item.price,
              safety_stock: item.safety_stock,
              min_reorder_level: item.min_reorder_level,
              lead_time: item.lead_time,
              supplier_name: item.supplier_name
            };

            const inventory = [
              { org_id, sku: item.sku, branch: "Main Warehouse", quantity: item.main_qty },
              { org_id, sku: item.sku, branch: "North Branch", quantity: item.north_qty },
              { org_id, sku: item.sku, branch: "South Branch", quantity: item.south_qty }
            ];

            db.products.push(product);
            db.inventory.push(...inventory);
            importedList.push(product);
          }
        });

        writeDB(db);

        return sendJSON(res, {
          message: `Successfully synchronized with IClass Biz Manager database ${dbName} (Demo Mode fallback).`,
          imported_count: importedList.length,
          imported_products: importedList
        });
      }

      // 9.6 POST INVOICE / RECEIPT DOCUMENTATION
      if (pathname === '/api/invoices' && method === 'POST') {
        const db = readDB();
        const { invoice_id, supplier_name, date, branch_name, items, total_amount } = body;

        if (!invoice_id || !supplier_name || !branch_name || !items || !Array.isArray(items)) {
          return sendJSON(res, { error: "Missing required fields (invoice_id, supplier_name, branch_name, items)" }, 400);
        }

        // Process line items and update inventory/products
        const processedItems = items.map(item => {
          const qty = Number(item.qty) || 0;
          const price = Number(item.price) || 0;
          const subtotal = Number((qty * price).toFixed(2));

          let finalSku = item.sku;
          let product = db.products.find(p => p.org_id === org_id && (p.sku === item.sku || p.name.toLowerCase() === item.name.toLowerCase()));

          if (!product) {
            // Register new product in catalog
            finalSku = item.sku || `SKU-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*100)}`;
            product = {
              org_id,
              sku: finalSku,
              name: item.name,
              category: "General Retail",
              volume_per_unit: 0.001,
              cost: price,
              price: Number((price * 1.5).toFixed(2)),
              safety_stock: 10,
              min_reorder_level: 20,
              lead_time: 3,
              supplier_name: supplier_name
            };
            db.products.push(product);

            // Seed inventory records for branches
            const branches = ["Main Warehouse", "North Branch", "South Branch"];
            branches.forEach(b => {
              db.inventory.push({
                org_id,
                sku: finalSku,
                branch: b,
                quantity: b === branch_name ? qty : 0
              });
            });
          } else {
            // Product exists, update stock at the target branch
            finalSku = product.sku;
            let invEntry = db.inventory.find(i => i.org_id === org_id && i.sku === finalSku && i.branch === branch_name);
            if (!invEntry) {
              invEntry = {
                org_id,
                sku: finalSku,
                branch: branch_name,
                quantity: qty
              };
              db.inventory.push(invEntry);
            } else {
              invEntry.quantity += qty;
            }
          }

          return {
            sku: finalSku,
            name: item.name,
            qty,
            price,
            subtotal
          };
        });

        const invoice = {
          org_id,
          id: invoice_id,
          supplier_name,
          date: date || new Date().toISOString().split('T')[0],
          branch_name,
          items: processedItems,
          total_amount: Number(total_amount) || processedItems.reduce((acc, curr) => acc + curr.subtotal, 0),
          created_at: new Date().toISOString()
        };

        if (!db.invoices) db.invoices = [];
        db.invoices.push(invoice);

        // Also add an audit log entry
        if (!db.alert_logs) db.alert_logs = [];
        db.alert_logs.unshift({
          org_id,
          id: `LOG-INV-${Date.now().toString().slice(-4)}`,
          channel: "System Audit",
          recipient: "Inventory Ledger",
          type: "Invoice Logged",
          message: `Invoice ${invoice_id} from ${supplier_name} successfully documented. Added ${processedItems.length} items to ${branch_name}.`,
          timestamp: new Date().toISOString()
        });

        writeDB(db);

        return sendJSON(res, {
          message: "Invoice successfully documented and inventory counts updated.",
          invoice
        });
      }

      // 9.7 EXPIRY REPORTS POST
      if (pathname === '/api/expiry-reports' && method === 'POST') {
        const { sku, name, batch_number, expiry_date, quantity, notes, image_url } = body;
        if (!sku || !name || !batch_number || !expiry_date || !quantity) {
          return sendJSON(res, { error: "Missing expiry report parameters." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        if (!initiator) {
          return sendJSON(res, { error: "Authorization failed." }, 403);
        }

        const newReport = {
          org_id,
          id: `EXP-${Math.floor(1000 + Math.random() * 9000)}`,
          sku,
          name,
          batch_number,
          expiry_date,
          quantity: parseInt(quantity),
          notes: notes || "",
          image_url: image_url || "",
          status: "Pending",
          created_by_user_id: initiator.id,
          created_by_staff: initiator.name,
          created_at: new Date().toISOString()
        };

        if (!db.expiry_reports) db.expiry_reports = [];
        db.expiry_reports.unshift(newReport);
        writeDB(db);

        logActivity(req, `Submitted expiry report ${newReport.id} for ${sku} (${quantity} units)`);

        return sendJSON(res, { message: "Expiry report submitted successfully.", report: newReport });
      }

      if (pathname === '/api/expiry-reports/verify' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const report = (db.expiry_reports || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !report) {
          return sendJSON(res, { error: "Session or report not found." }, 403);
        }

        if (initiator.role !== 'Owner' && initiator.role !== 'Admin' && initiator.role !== 'Manager' && initiator.role !== 'Supervisor') {
          return sendJSON(res, { error: "Access denied. Only Managers, Supervisors, and Admins can verify expiry reports." }, 403);
        }

        report.status = 'Verified';
        writeDB(db);

        logActivity(req, `Verified expiry report ${id} (Manager/Supervisor verification)`);

        return sendJSON(res, { message: "Report verified.", report });
      }

      if (pathname === '/api/expiry-reports/approve' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const report = (db.expiry_reports || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !report) {
          return sendJSON(res, { error: "Session or report not found." }, 403);
        }

        if (initiator.role !== 'Owner' && initiator.role !== 'Admin') {
          return sendJSON(res, { error: "Access denied. Only Admins and Owners can approve expiry reports." }, 403);
        }

        report.status = 'Approved';
        
        // Decrement corresponding inventory
        const branchName = "Main Warehouse"; // default branch
        let invEntry = db.inventory.find(i => i.org_id === org_id && i.sku === report.sku && i.branch === branchName);
        if (invEntry) {
          invEntry.quantity = Math.max(0, invEntry.quantity - report.quantity);
        }
        
        writeDB(db);

        logActivity(req, `Approved expiry report ${id}. Inventory decremented by ${report.quantity} units.`);

        return sendJSON(res, { message: "Report approved and inventory updated.", report });
      }

      if (pathname === '/api/expiry-reports/reject' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const report = (db.expiry_reports || []).find(r => r.id === id && r.org_id === org_id);

        if (!initiator || !report) {
          return sendJSON(res, { error: "Session or report not found." }, 403);
        }

        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Staff cannot reject reports." }, 403);
        }

        report.status = 'Rejected';
        writeDB(db);

        logActivity(req, `Rejected expiry report ${id}`);

        return sendJSON(res, { message: "Report rejected.", report });
      }

      // 9.8 STOCK ADJUSTMENTS POST
      if (pathname === '/api/stock-adjustments' && method === 'POST') {
        const { sku, branch, adjustment_type, quantity, notes } = body;
        if (!sku || !branch || !adjustment_type || quantity === undefined) {
          return sendJSON(res, { error: "Missing stock adjustment parameters." }, 400);
        }

        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        if (!initiator) {
          return sendJSON(res, { error: "Authorization failed." }, 403);
        }

        const newAdj = {
          org_id,
          id: `ADJ-${Math.floor(1000 + Math.random() * 9000)}`,
          sku,
          branch,
          adjustment_type,
          quantity: parseInt(quantity),
          notes: notes || "",
          status: "Pending",
          created_by_user_id: initiator.id,
          created_by_staff: initiator.name,
          created_at: new Date().toISOString()
        };

        if (!db.stock_adjustments) db.stock_adjustments = [];
        db.stock_adjustments.unshift(newAdj);
        writeDB(db);

        logActivity(req, `Submitted stock adjustment ${newAdj.id} for ${sku} at ${branch} (${quantity})`);

        return sendJSON(res, { message: "Stock adjustment submitted successfully.", adjustment: newAdj });
      }

      if (pathname === '/api/stock-adjustments/verify' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const adj = (db.stock_adjustments || []).find(a => a.id === id && a.org_id === org_id);

        if (!initiator || !adj) {
          return sendJSON(res, { error: "Session or adjustment not found." }, 403);
        }

        if (initiator.role !== 'Owner' && initiator.role !== 'Admin' && initiator.role !== 'Manager' && initiator.role !== 'Supervisor') {
          return sendJSON(res, { error: "Access denied. Only Managers, Supervisors, and Admins can verify adjustments." }, 403);
        }

        adj.status = 'Verified';
        writeDB(db);

        logActivity(req, `Verified stock adjustment ${id} (Manager/Supervisor verification)`);

        return sendJSON(res, { message: "Adjustment verified.", adjustment: adj });
      }

      if (pathname === '/api/stock-adjustments/approve' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const adj = (db.stock_adjustments || []).find(a => a.id === id && a.org_id === org_id);

        if (!initiator || !adj) {
          return sendJSON(res, { error: "Session or adjustment not found." }, 403);
        }

        if (initiator.role !== 'Owner' && initiator.role !== 'Admin') {
          return sendJSON(res, { error: "Access denied. Only Admins and Owners can approve stock adjustments." }, 403);
        }

        adj.status = 'Approved';
        
        // Update stock level in target branch
        let invEntry = db.inventory.find(i => i.org_id === org_id && i.sku === adj.sku && i.branch === adj.branch);
        if (!invEntry) {
          invEntry = {
            org_id,
            sku: adj.sku,
            branch: adj.branch,
            quantity: 0
          };
          db.inventory.push(invEntry);
        }
        invEntry.quantity = Math.max(0, invEntry.quantity + adj.quantity);
        
        writeDB(db);

        logActivity(req, `Approved stock adjustment ${id}. Inventory level updated.`);

        return sendJSON(res, { message: "Adjustment approved and inventory updated.", adjustment: adj });
      }

      if (pathname === '/api/stock-adjustments/reject' && method === 'POST') {
        const { id } = body;
        const db = readDB();
        const initiator = (db.users || []).find(u => u.id === user_id && u.org_id === org_id);
        const adj = (db.stock_adjustments || []).find(a => a.id === id && a.org_id === org_id);

        if (!initiator || !adj) {
          return sendJSON(res, { error: "Session or adjustment not found." }, 403);
        }

        if (initiator.role === 'Staff') {
          return sendJSON(res, { error: "Staff cannot reject adjustments." }, 403);
        }

        adj.status = 'Rejected';
        writeDB(db);

        logActivity(req, `Rejected stock adjustment ${id}`);

        return sendJSON(res, { message: "Adjustment rejected.", adjustment: adj });
      }

      // 9. SETTINGS UPDATE
      if (pathname === '/api/settings') {
        const db = readDB();
        if (!db.settings) db.settings = {};
        db.settings[org_id] = { ...db.settings[org_id], ...body };
        writeDB(db);
        return sendJSON(res, { message: "Settings updated", settings: db.settings[org_id] });
      }

      return sendJSON(res, { error: "Endpoint not found" }, 404);
    });
    return;
  }

  // --- SERVE STATIC ASSETS ---
  serveStatic(res, pathname);
};

// Export for Vercel serverless
module.exports = requestHandler;

// Only start the HTTP server when running locally (not serverless)
if (process.env.VERCEL !== '1' && require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` SmartStock Inventory Core Server running on port ${PORT}`);
    console.log(` Web UI: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

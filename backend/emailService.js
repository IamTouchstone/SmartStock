const nodemailer = require('nodemailer');
const { readDB, writeDB } = require('./db');

/**
 * Global Email Dispatcher
 * Checks for SMTP environment variables or fallback to internal Outbox Logger.
 */
async function sendEmail({ to, subject, html, text, type = 'NOTIFICATION' }) {
  const db = readDB();
  const timestamp = new Date().toISOString();

  // Create email record for internal outbox log
  const emailRecord = {
    id: `MAIL-${Math.floor(100000 + Math.random() * 900000)}`,
    to,
    subject,
    html,
    text,
    type,
    timestamp,
    status: 'SENT',
    transport: 'OUTBOX_LOGGER'
  };

  // Check if SMTP is configured via env
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM || 'no-reply@smartstock.io';

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort == 465,
        auth: { user: smtpUser, pass: smtpPass }
      });

      const info = await transporter.sendMail({
        from: `SmartStock Operating System <${fromEmail}>`,
        to,
        subject,
        text,
        html
      });

      emailRecord.transport = 'SMTP';
      emailRecord.smtpMessageId = info.messageId;
      console.log(`[EMAIL SERVICE - SMTP] Sent email to ${to}: "${subject}" (MessageId: ${info.messageId})`);
    } catch (err) {
      console.error(`[EMAIL SERVICE - SMTP ERROR] Failed to send via SMTP:`, err.message);
      emailRecord.status = 'SMTP_FAILED_FALLBACK_LOGGED';
      emailRecord.error = err.message;
    }
  } else {
    console.log(`\n=============================================================`);
    console.log(`[EMAIL OUTBOX LOGGER] (No SMTP credentials configured, logging locally)`);
    console.log(` TO:      ${to}`);
    console.log(` SUBJECT: ${subject}`);
    console.log(` TYPE:    ${type}`);
    console.log(` CONTENT: ${text}`);
    console.log(`=============================================================\n`);
  }

  // Record in Database email_logs
  if (!db.email_logs) db.email_logs = [];
  db.email_logs.unshift(emailRecord);
  // Keep last 100 email logs
  if (db.email_logs.length > 100) db.email_logs = db.email_logs.slice(0, 100);
  writeDB(db);

  return emailRecord;
}

/**
 * Get App Owner Email address from settings or fallback
 */
function getOwnerEmail() {
  const db = readDB();
  if (db.settings && db.settings.global && db.settings.global.owner_email) {
    return db.settings.global.owner_email;
  }
  return process.env.OWNER_EMAIL || "bernieamce@gmail.com";
}

/**
 * Check if Owner alerts are enabled
 */
function isOwnerAlertsEnabled() {
  const db = readDB();
  if (db.settings && db.settings.global && typeof db.settings.global.owner_alerts_enabled === 'boolean') {
    return db.settings.global.owner_alerts_enabled;
  }
  return true;
}

/**
 * 1. Alert Owner when someone creates an account (signs up)
 */
async function sendOwnerAccountCreatedAlert(orgData, clientIp = '127.0.0.1') {
  if (!isOwnerAlertsEnabled()) return;
  const ownerEmail = getOwnerEmail();

  const subject = `⚡ ALERT: New Organization Account Created — ${orgData.org_name}`;
  const text = `Hello App Owner,

A new organization account has just registered on SmartStock!

Details:
• Organization Name: ${orgData.org_name}
• Admin Email: ${orgData.admin_email}
• Industry Sector: ${orgData.industry}
• Account ID: ${orgData.id}
• Registration Date: ${new Date(orgData.created_at || Date.now()).toLocaleString()}
• Email Verification: Pending (Code: ${orgData.verification_code || 'N/A'})
• Client IP: ${clientIp}

Log in to your SmartStock admin dashboard to view details.
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #60a5fa; margin: 0;">⚡ SmartStock Owner Alert</h2>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">New Account Registration Notification</p>
      </div>

      <p style="font-size: 16px;">Hello Owner,</p>
      <p style="font-size: 15px; color: #cbd5e1;">A new organization account has just registered on your SmartStock platform:</p>

      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0;">
        <table style="width: 100%; color: #f8fafc; font-size: 14px;">
          <tr><td style="color: #94a3b8; padding: 4px 0;">Organization:</td><td><strong>${orgData.org_name}</strong></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Admin Email:</td><td><a href="mailto:${orgData.admin_email}" style="color: #60a5fa;">${orgData.admin_email}</a></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Industry:</td><td>${orgData.industry}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Org ID:</td><td><code>${orgData.id}</code></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Registered At:</td><td>${new Date(orgData.created_at || Date.now()).toLocaleString()}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Verification Status:</td><td><span style="background-color: #f59e0b; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">PENDING (OTP: ${orgData.verification_code})</span></td></tr>
        </table>
      </div>

      <p style="font-size: 13px; color: #64748b;">SmartStock Owner Automated Alert Engine</p>
    </div>
  `;

  return sendEmail({ to: ownerEmail, subject, html, text, type: 'OWNER_ALERT_SIGNUP' });
}

/**
 * 2. Alert Owner when someone downloads SmartStock App
 */
async function sendOwnerAppDownloadedAlert(downloadData, clientIp = '127.0.0.1') {
  if (!isOwnerAlertsEnabled()) return;
  const ownerEmail = getOwnerEmail();

  const subject = `📥 ALERT: Someone Downloaded SmartStock App! (${downloadData.platform || 'Desktop'})`;
  const text = `Hello App Owner,

Someone just downloaded the SmartStock Application!

Details:
• Platform / Edition: ${downloadData.platform || 'SmartStock Desktop Edition v1.0.0'}
• Organization: ${downloadData.org_name || 'Guest / Unauthenticated User'}
• User Email: ${downloadData.admin_email || 'Not logged in'}
• Download Timestamp: ${new Date(downloadData.timestamp || Date.now()).toLocaleString()}
• User Agent: ${downloadData.user_agent || 'Standard Web Client'}
• Client IP: ${clientIp}

Track user onboarding and app adoption inside your SmartStock Owner Portal.
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="border-bottom: 2px solid #8b5cf6; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #a78bfa; margin: 0;">📥 SmartStock Owner Alert</h2>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">App Download Notification</p>
      </div>

      <p style="font-size: 16px;">Hello Owner,</p>
      <p style="font-size: 15px; color: #cbd5e1;">A user has downloaded SmartStock application package:</p>

      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; border-left: 4px solid #8b5cf6; margin: 20px 0;">
        <table style="width: 100%; color: #f8fafc; font-size: 14px;">
          <tr><td style="color: #94a3b8; padding: 4px 0;">App Edition:</td><td><strong>${downloadData.platform || 'SmartStock Desktop v1.0.0'}</strong></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Organization:</td><td>${downloadData.org_name || 'Guest / Potential Customer'}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">User Email:</td><td>${downloadData.admin_email ? `<a href="mailto:${downloadData.admin_email}" style="color: #a78bfa;">${downloadData.admin_email}</a>` : 'Anonymous / Guest'}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Downloaded At:</td><td>${new Date(downloadData.timestamp || Date.now()).toLocaleString()}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Client IP:</td><td><code>${clientIp}</code></td></tr>
        </table>
      </div>

      <p style="font-size: 13px; color: #64748b;">SmartStock Owner Automated Alert Engine</p>
    </div>
  `;

  return sendEmail({ to: ownerEmail, subject, html, text, type: 'OWNER_ALERT_DOWNLOAD' });
}

/**
 * 3. Send User Email Verification Code & Link
 */
async function sendUserVerificationEmail(orgData, verificationCode, verificationToken, host = 'localhost:5000') {
  const verifyLink = `http://${host}/?verify_token=${verificationToken}&email=${encodeURIComponent(orgData.admin_email)}`;

  const subject = `✉️ Verify Your SmartStock Account — Code: ${verificationCode}`;
  const text = `Welcome to SmartStock, ${orgData.org_name}!

Please verify your email address to complete your registration.

Your 6-Digit Verification Code: ${verificationCode}

Or click the link below to verify your account automatically:
${verifyLink}

This code will expire in 24 hours.

If you did not sign up for SmartStock, please ignore this email.
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 24px;">
        <h2 style="color: #34d399; margin: 0; font-size: 24px;">⚡ Welcome to SmartStock</h2>
        <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">Predictive Retail Operating System</p>
      </div>

      <p style="font-size: 16px; color: #f8fafc;">Hello <strong>${orgData.org_name}</strong> Admin,</p>
      <p style="font-size: 15px; color: #cbd5e1;">Thank you for registering. Please verify your email address (<code>${orgData.admin_email}</code>) to activate your account and start using predictive inventory intelligence.</p>

      <div style="background-color: #1e293b; text-align: center; padding: 20px; border-radius: 10px; margin: 24px 0; border: 1px dashed #34d399;">
        <div style="font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Your Verification OTP Code</div>
        <div style="font-size: 32px; font-weight: 800; color: #34d399; letter-spacing: 6px; font-family: monospace;">${verificationCode}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 8px;">Valid for 24 Hours</div>
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${verifyLink}" style="background-color: #10b981; color: #000; font-weight: bold; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; display: inline-block;">Verify Email Account Now →</a>
      </div>

      <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 30px; border-top: 1px solid #334155; padding-top: 16px;">
        If button above doesn't work, copy & paste this link: <br>
        <a href="${verifyLink}" style="color: #60a5fa; word-break: break-all;">${verifyLink}</a>
      </p>
    </div>
  `;

  return sendEmail({ to: orgData.admin_email, subject, html, text, type: 'USER_VERIFICATION' });
}

/**
 * 4. Alert Owner when user completes Email Verification
 */
async function sendOwnerEmailVerifiedAlert(orgData) {
  if (!isOwnerAlertsEnabled()) return;
  const ownerEmail = getOwnerEmail();

  const subject = `✅ ALERT: Account Email Verified — ${orgData.org_name}`;
  const text = `Hello App Owner,

The email address for ${orgData.org_name} (${orgData.admin_email}) has been successfully verified!

Organization ID: ${orgData.id}
Verified Timestamp: ${new Date().toLocaleString()}
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="border-bottom: 2px solid #10b981; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #34d399; margin: 0;">✅ SmartStock Owner Alert</h2>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">User Email Verification Confirmed</p>
      </div>

      <p style="font-size: 16px;">Hello Owner,</p>
      <p style="font-size: 15px; color: #cbd5e1;">Organization <strong>${orgData.org_name}</strong> (Admin: <code>${orgData.admin_email}</code>) has completed email verification.</p>

      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0;">
        <span style="color: #34d399; font-weight: bold;">Status: ACCOUNT FULLY VERIFIED & ACTIVE</span>
      </div>
    </div>
  `;

  return sendEmail({ to: ownerEmail, subject, html, text, type: 'OWNER_ALERT_VERIFIED' });
}

/**
 * 5. Alert Owner when user Subscribes / Upgrades / Changes Subscription Plan
 */
async function sendOwnerSubscriptionAlert(orgData, subscriptionData, invoiceData) {
  if (!isOwnerAlertsEnabled()) return;
  const ownerEmail = getOwnerEmail();

  const subject = `💰 REVENUE ALERT: ${orgData.org_name} Subscribed to ${subscriptionData.plan_name}! ($${invoiceData ? invoiceData.amount : 0})`;
  const text = `Hello App Owner,

Great news! Organization "${orgData.org_name}" has just updated their subscription!

Subscription Details:
• Plan: ${subscriptionData.plan_name}
• Billing Cycle: ${subscriptionData.billing_cycle || 'monthly'}
• Price: $${invoiceData ? invoiceData.amount : 0}
• Invoice Ref: ${invoiceData ? invoiceData.id : 'N/A'}
• Admin Email: ${orgData.admin_email}
• Industry: ${orgData.industry}
• Timestamp: ${new Date().toLocaleString()}

Log in to your Owner Portal to track your Monthly Recurring Revenue (MRR).
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="border-bottom: 2px solid #10b981; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #34d399; margin: 0;">💰 SmartStock Revenue Alert</h2>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">New Paid Subscription Activated</p>
      </div>

      <p style="font-size: 16px;">Hello Owner,</p>
      <p style="font-size: 15px; color: #cbd5e1;">Organization <strong>${orgData.org_name}</strong> has subscribed to SmartStock SaaS:</p>

      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0;">
        <table style="width: 100%; color: #f8fafc; font-size: 14px;">
          <tr><td style="color: #94a3b8; padding: 4px 0;">Subscribed Plan:</td><td><strong style="color: #34d399; font-size: 16px;">${subscriptionData.plan_name}</strong></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Billing Amount:</td><td><strong style="color: #60a5fa;">$${invoiceData ? invoiceData.amount.toFixed(2) : '0.00'} USD</strong> (${subscriptionData.billing_cycle || 'monthly'})</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Invoice ID:</td><td><code>${invoiceData ? invoiceData.id : 'N/A'}</code></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Organization:</td><td>${orgData.org_name}</td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Admin Email:</td><td><a href="mailto:${orgData.admin_email}" style="color: #60a5fa;">${orgData.admin_email}</a></td></tr>
          <tr><td style="color: #94a3b8; padding: 4px 0;">Activated At:</td><td>${new Date().toLocaleString()}</td></tr>
        </table>
      </div>

      <p style="font-size: 13px; color: #64748b;">SmartStock Owner Automated Revenue Engine</p>
    </div>
  `;

  return sendEmail({ to: ownerEmail, subject, html, text, type: 'OWNER_ALERT_SUBSCRIPTION' });
}

/**
 * 6. Send User Subscription Receipt & Invoice
 */
async function sendUserSubscriptionReceipt(orgData, invoiceData) {
  const subject = `🧾 Payment Receipt & Subscription Invoice #${invoiceData.id} — SmartStock`;
  const text = `Hello ${orgData.org_name} Admin,

Thank you for subscribing to SmartStock ${invoiceData.plan_name}!

Invoice Details:
• Invoice Number: ${invoiceData.id}
• Plan: ${invoiceData.plan_name}
• Amount Paid: $${invoiceData.amount.toFixed(2)} USD
• Date: ${new Date(invoiceData.created_at).toLocaleString()}
• Payment Status: ${invoiceData.status}

Your subscription features are active immediately. Log in to access your upgraded features.
`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 24px;">
        <h2 style="color: #60a5fa; margin: 0; font-size: 24px;">🧾 Payment Confirmation</h2>
        <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">SmartStock SaaS Subscription Invoice</p>
      </div>

      <p style="font-size: 16px;">Hello <strong>${orgData.org_name}</strong> Admin,</p>
      <p style="font-size: 15px; color: #cbd5e1;">Thank you for your payment. Your subscription to <strong>${invoiceData.plan_name}</strong> is active!</p>

      <div style="background-color: #1e293b; padding: 20px; border-radius: 10px; margin: 24px 0; border: 1px solid #3b82f6;">
        <table style="width: 100%; color: #f8fafc; font-size: 14px;">
          <tr><td style="color: #94a3b8; padding: 6px 0;">Invoice ID:</td><td><code>${invoiceData.id}</code></td></tr>
          <tr><td style="color: #94a3b8; padding: 6px 0;">Subscription Tier:</td><td><strong>${invoiceData.plan_name}</strong></td></tr>
          <tr><td style="color: #94a3b8; padding: 6px 0;">Amount Paid:</td><td><strong style="color: #34d399; font-size: 16px;">$${invoiceData.amount.toFixed(2)} USD</strong></td></tr>
          <tr><td style="color: #94a3b8; padding: 6px 0;">Payment Date:</td><td>${new Date(invoiceData.created_at).toLocaleString()}</td></tr>
          <tr><td style="color: #94a3b8; padding: 6px 0;">Status:</td><td><span style="background-color: #10b981; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">PAID</span></td></tr>
        </table>
      </div>

      <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 24px;">
        Thank you for choosing SmartStock Inventory Operating System!
      </p>
    </div>
  `;

  return sendEmail({ to: orgData.admin_email, subject, html, text, type: 'USER_SUBSCRIPTION_RECEIPT' });
}

module.exports = {
  sendEmail,
  getOwnerEmail,
  isOwnerAlertsEnabled,
  sendOwnerAccountCreatedAlert,
  sendOwnerAppDownloadedAlert,
  sendUserVerificationEmail,
  sendOwnerEmailVerifiedAlert,
  sendOwnerSubscriptionAlert,
  sendUserSubscriptionReceipt
};

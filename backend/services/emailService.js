const axios = require('axios');

/**
 * MarketSphere Enterprise Email Service
 * 
 * Delivers transactional and authentication emails over outbound HTTPS REST APIs
 * (Port 443), completely eliminating dependency on outbound SMTP connectivity
 * (Ports 25, 465, 587) which are blocked on cloud hosting platforms like Render Free Tier.
 * 
 * Supported Providers:
 * - 'resend' : HTTPS API (https://api.resend.com/emails) via RESEND_API_KEY
 * - 'brevo'  : HTTPS API (https://api.brevo.com/v3/smtp/email) via BREVO_API_KEY
 * - 'console': Safe mock/console dispatch for local offline development & tests
 */
class EmailService {
  constructor() {
    this.timeoutMs = 8000;
  }

  /**
   * Resolves the active email provider based on configuration.
   */
  getProvider() {
    if (process.env.NODE_ENV === 'test') {
      return process.env.EMAIL_PROVIDER || 'mock';
    }

    const explicit = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    if (explicit) {
      return explicit;
    }

    if (process.env.RESEND_API_KEY) return 'resend';
    if (process.env.BREVO_API_KEY) return 'brevo';

    return 'console';
  }

  /**
   * Helper to safely mask email addresses in operational logs (e.g. j***e@example.com)
   * Prevents PII leakage in application logs.
   */
  maskEmail(email) {
    if (!email || typeof email !== 'string') return 'unknown';
    const parts = email.split('@');
    if (parts.length !== 2) return 'invalid-email';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length <= 2 ? name[0] + '*' : name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
    return `${maskedName}@${domain}`;
  }

  /**
   * Validates provider configuration on startup or health checks.
   */
  verifyConfiguration() {
    const provider = this.getProvider();
    const isProduction = process.env.NODE_ENV === 'production';

    if (provider === 'resend') {
      if (!process.env.RESEND_API_KEY) {
        const msg = '[EMAIL CONFIG ERROR] EMAIL_PROVIDER is set to "resend" but RESEND_API_KEY is not defined in environment variables.';
        if (isProduction) console.error(msg); else console.warn(msg);
        return { isValid: false, provider, error: msg };
      }
      return { isValid: true, provider };
    }

    if (provider === 'brevo') {
      if (!process.env.BREVO_API_KEY) {
        const msg = '[EMAIL CONFIG ERROR] EMAIL_PROVIDER is set to "brevo" but BREVO_API_KEY is not defined in environment variables.';
        if (isProduction) console.error(msg); else console.warn(msg);
        return { isValid: false, provider, error: msg };
      }
      return { isValid: true, provider };
    }

    if (provider === 'console' || provider === 'mock') {
      if (isProduction) {
        console.warn('[EMAIL CONFIG WARNING] Running in PRODUCTION with EMAIL_PROVIDER="console". Real emails will not reach external inboxes. Configure RESEND_API_KEY or BREVO_API_KEY.');
      }
      return { isValid: true, provider };
    }

    return { 
      isValid: false, 
      provider, 
      error: `Unsupported EMAIL_PROVIDER: "${provider}". Expected "resend", "brevo", or "console".` 
    };
  }

  /**
   * Internal dispatcher for Resend HTTPS REST API (api.resend.com)
   */
  async _sendViaResend(to, subject, html, text) {
    const apiKey = (process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
      return {
        delivered: false,
        provider: 'RESEND_HTTPS',
        error: 'RESEND_API_KEY is missing from environment variables.'
      };
    }

    const fromAddress = (process.env.EMAIL_FROM || 'MarketSphere <onboarding@resend.dev>').trim();

    try {
      const response = await axios.post(
        'https://api.resend.com/emails',
        {
          from: fromAddress,
          to: [to],
          subject,
          html,
          text
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeoutMs
        }
      );

      if (response.status >= 200 && response.status < 300) {
        console.log(`[EMAIL DISPATCH SUCCESS] Delivered email via Resend HTTPS API to ${this.maskEmail(to)}`);
        return {
          delivered: true,
          provider: 'RESEND_HTTPS',
          messageId: response.data?.id || null
        };
      }

      throw new Error(`Resend returned HTTP ${response.status}`);
    } catch (err) {
      const status = err.response?.status;
      const resendError = err.response?.data?.message || err.response?.data?.error || err.message;

      // Handle Resend onboarding sandbox domain restriction
      if (status === 403 && (resendError.includes('only send testing emails') || resendError.includes('verify a domain'))) {
        console.warn(`[EMAIL DISPATCH RESTRICTION] Resend Free Tier restriction: ${resendError}`);
        return {
          delivered: false,
          provider: 'RESEND_HTTPS',
          error: "Resend sandbox domain 'onboarding@resend.dev' can only send emails to your verified account email. To send OTPs to any email address, verify a custom domain in Resend or set EMAIL_PROVIDER=brevo with a verified sender."
        };
      }

      if (status === 401) {
        console.error('[EMAIL DISPATCH ERROR] Invalid RESEND_API_KEY. Please verify your API key in Render environment settings.');
        return {
          delivered: false,
          provider: 'RESEND_HTTPS',
          error: 'Email authentication failed. Please check provider credentials.'
        };
      }

      console.error(`[EMAIL DISPATCH ERROR] Resend HTTPS dispatch failed: ${resendError}`);
      return {
        delivered: false,
        provider: 'RESEND_HTTPS',
        error: `Email service unavailable (${resendError}). Please try again later.`
      };
    }
  }

  /**
   * Internal dispatcher for Brevo HTTPS REST API (api.brevo.com)
   * Brevo allows Single Sender Verification (e.g. verified Gmail address) without requiring a custom domain.
   */
  async _sendViaBrevo(to, subject, html, text) {
    let apiKey = (process.env.BREVO_API_KEY || '').trim();
    // Sanitize in case quotes or extra prefix were entered in Render
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();
    if (apiKey.toLowerCase().startsWith('api-key:')) {
      apiKey = apiKey.substring(8).trim();
    }

    if (!apiKey) {
      return {
        delivered: false,
        provider: 'BREVO_HTTPS',
        error: 'BREVO_API_KEY is missing from environment variables.'
      };
    }

    // Robust sender extraction: handles "Name <email@domain.com>", "Name email@domain.com", or standalone email
    let senderName = 'MarketSphere';
    let senderEmail = (process.env.BREVO_SENDER_EMAIL || '').trim().replace(/^["']|["']$/g, '');

    const fromAddress = (process.env.EMAIL_FROM || '').trim();
    const emailMatch = fromAddress.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      senderEmail = emailMatch[1].trim();
      const extractedName = fromAddress.replace(emailMatch[0], '').replace(/[<>"']/g, '').trim();
      if (extractedName) senderName = extractedName;
    } else if (!senderEmail) {
      senderEmail = (process.env.GMAIL_USER || 'no-reply@marketsphere.com').trim();
    }

    try {
      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text
        },
        {
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: this.timeoutMs
        }
      );

      if (response.status >= 200 && response.status < 300) {
        console.log(`[EMAIL DISPATCH SUCCESS] Delivered email via Brevo HTTPS API to ${this.maskEmail(to)}`);
        return {
          delivered: true,
          provider: 'BREVO_HTTPS',
          messageId: response.data?.messageId || null
        };
      }

      throw new Error(`Brevo returned HTTP ${response.status}`);
    } catch (err) {
      const status = err.response?.status;
      const brevoData = err.response?.data;
      const brevoError = brevoData?.message || brevoData?.error || err.message;
      const brevoCode = brevoData?.code || '';

      if (status === 401) {
        console.error(`[EMAIL DISPATCH ERROR] Brevo 401 Unauthorized: ${brevoError} (code: ${brevoCode})`);
        return {
          delivered: false,
          provider: 'BREVO_HTTPS',
          error: `Brevo authentication failed (${brevoError || 'Key not found'}). Make sure you copied an API v3 key (starts with 'xkeysib-') from Brevo's 'API Keys' tab, NOT the SMTP master password.`
        };
      }

      console.error(`[EMAIL DISPATCH ERROR] Brevo HTTPS dispatch failed: ${brevoError}`);
      return {
        delivered: false,
        provider: 'BREVO_HTTPS',
        error: `Brevo email dispatch failed (${brevoError}). Please check sender verification in Brevo dashboard.`
      };
    }
  }

  /**
   * Primary entry point for sending emails.
   */
  async sendEmail(to, subject, body, templateType = 'GENERAL', customHtml = null) {
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return { delivered: false, error: 'Valid recipient email address is required.' };
    }

    const htmlContent = customHtml || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">${subject}</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</p>
        <hr style="margin-top: 30px; border: 0; border-top: 1px solid #e2e8f0;" />
        <small style="color: #94a3b8; font-size: 12px;">MarketSphere Multi-Vendor Marketplace</small>
      </div>
    `;

    const provider = this.getProvider();

    // 1. Production / Active HTTPS Provider: Resend
    if (provider === 'resend') {
      return await this._sendViaResend(to, subject, htmlContent, body);
    }

    // 2. Production / Active HTTPS Provider: Brevo
    if (provider === 'brevo') {
      return await this._sendViaBrevo(to, subject, htmlContent, body);
    }

    // 3. Local / Test / Mock Provider
    if (provider === 'mock' || provider === 'console' || process.env.NODE_ENV === 'test') {
      console.log(`[EMAIL DISPATCH (MOCK/DEV)] ${templateType} to ${this.maskEmail(to)}: "${subject}"`);
      return {
        delivered: true,
        provider: 'MOCK_DEV',
        messageId: `mock_${Date.now()}`
      };
    }

    // 4. Fallback if misconfigured
    return {
      delivered: false,
      error: `Email service is not configured. Set EMAIL_PROVIDER=resend with RESEND_API_KEY, or EMAIL_PROVIDER=brevo with BREVO_API_KEY in Render environment settings.`
    };
  }

  /**
   * Dispatches a 6-digit OTP verification email with a branded, secure template.
   */
  async sendOtpEmail(to, otp) {
    const subject = `Your MarketSphere Verification Code is ${otp}`;
    const body = `Welcome to MarketSphere! Your one-time verification code (OTP) is: ${otp}. It is valid for 10 minutes. Please enter this code on the registration page to verify your email address. Do not share this code with anyone.`;
    
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #d97706; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">MarketSphere</h1>
          <p style="color: #64748b; font-size: 13px; margin: 6px 0 0 0;">Authentic & Independent Multi-Vendor Commerce</p>
        </div>
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%); border: 1px solid #fde68a; border-radius: 14px; padding: 28px 20px; text-align: center; margin-bottom: 24px;">
          <p style="color: #78350f; font-size: 15px; font-weight: 700; margin: 0 0 16px 0;">Verify Your Email Address</p>
          <div style="font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #0f172a; font-family: 'Courier New', Courier, monospace; padding: 14px 24px; background-color: #ffffff; border: 2px dashed #f59e0b; border-radius: 10px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            ${otp}
          </div>
          <p style="color: #92400e; font-size: 12px; margin: 16px 0 0 0; font-weight: 600;">
            ⏳ Valid for 10 minutes • Single-use only
          </p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
          Hi there, welcome to MarketSphere! Use the one-time verification code above to verify your email address and activate your account.
        </p>
        <div style="background-color: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;">
          <p style="color: #475569; font-size: 12px; line-height: 1.5; margin: 0;">
            🔒 <strong>Security Notice:</strong> Never share this code with anyone. MarketSphere representatives will never ask for your verification code.
          </p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
          If you did not initiate this request, you can safely disregard this email. Your email address will remain unlinked.
        </p>
        <hr style="margin-top: 28px; border: 0; border-top: 1px solid #f1f5f9;" />
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin: 16px 0 0 0;">
          © ${new Date().getFullYear()} MarketSphere Multi-Vendor Platform. All rights reserved.
        </p>
      </div>
    `;

    return this.sendEmail(to, subject, body, 'EMAIL_OTP_VERIFICATION', html);
  }

  async sendOrderConfirmation(to, order) {
    const orderId = (order._id || order.id || '').toString().slice(-6).toUpperCase();
    const subject = `Order Confirmation #${orderId}`;
    const body = `Thank you for your order! Total amount: ₹${order.totalAmount}. Order status: ${order.orderStatus}.`;
    return this.sendEmail(to, subject, body, 'ORDER_CONFIRMATION');
  }

  async sendSellerApproval(to, storeName) {
    const subject = `Congratulations! Your Seller Account "${storeName}" is Approved`;
    const body = `Your seller application has been approved by the MarketSphere team. You can now log in and manage products.`;
    return this.sendEmail(to, subject, body, 'SELLER_APPROVAL');
  }

  async sendSellerRejection(to, storeName, reason) {
    const subject = `Update on your Seller Application "${storeName}"`;
    const body = `We regret to inform you that your seller application could not be approved at this time. Reason: ${reason}`;
    return this.sendEmail(to, subject, body, 'SELLER_REJECTION');
  }
}

module.exports = new EmailService();

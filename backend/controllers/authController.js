const crypto = require('crypto');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const Seller = require('../models/Seller');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getJwtSecret } = require('../middlewares/auth');
const emailService = require('../services/emailService');

const { validateRealEmail, validateMobileNumber } = require('../utils/emailValidator');

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, getJwtSecret(), {
    expiresIn: '7d',
  });
};

/**
 * Computes SHA-256 hash of a numeric OTP for secure non-plaintext database storage.
 */
const hashOtp = (otp) => {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
};

/**
 * Secure, constant-time comparison for OTP verification.
 * Supports both hashed and legacy plaintext values.
 */
const compareOtp = (submittedOtp, storedHashOrOtp) => {
  if (!submittedOtp || !storedHashOrOtp) return false;
  const submittedHash = hashOtp(submittedOtp);
  if (storedHashOrOtp.length === 64) {
    try {
      return crypto.timingSafeEqual(Buffer.from(submittedHash, 'utf8'), Buffer.from(storedHashOrOtp, 'utf8'));
    } catch (_) {
      return false;
    }
  }
  const legacyHash = hashOtp(storedHashOrOtp);
  try {
    return crypto.timingSafeEqual(Buffer.from(submittedHash, 'utf8'), Buffer.from(legacyHash, 'utf8'));
  } catch (_) {
    return false;
  }
};

exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    // Strict input validation
    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'All fields (First Name, Last Name, Email, Mobile Number, Password) are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
    }

    // 1. Verify that email is syntactically valid, not disposable, and domain has active MX servers
    const emailValidation = await validateRealEmail(email);
    if (!emailValidation.isValid) {
      return res.status(400).json({ status: 'error', message: emailValidation.message });
    }
    const normalizedEmail = emailValidation.normalizedEmail;

    // 2. Validate mobile number format
    const phoneValidation = validateMobileNumber(phone);
    if (!phoneValidation.isValid) {
      return res.status(400).json({ status: 'error', message: phoneValidation.message });
    }
    const normalizedPhone = phoneValidation.normalizedPhone;

    // 3. Verify uniqueness of Email in confirmed Users
    const emailExists = await User.findOne({ email: normalizedEmail });
    if (emailExists) {
      if (!emailExists.isEmailVerified) {
        // Purge unverified legacy record so fresh registration proceeds cleanly
        await User.deleteOne({ _id: emailExists._id });
      } else {
        return res.status(400).json({ 
          status: 'error', 
          message: 'An account is already registered with this email address. Please sign in or use another email.' 
        });
      }
    }

    // 4. Verify uniqueness of Mobile Number in confirmed Users
    const phoneExists = await User.findOne({ phone: normalizedPhone });
    if (phoneExists) {
      if (!phoneExists.isEmailVerified) {
        await User.deleteOne({ _id: phoneExists._id });
      } else {
        return res.status(400).json({ 
          status: 'error', 
          message: 'An account is already registered with this mobile number. Each mobile number can only be linked to one account.' 
        });
      }
    }

    // 5. Cooldown Guard on existing pending registration (60-second limit)
    const existingPending = await PendingUser.findOne({ email: normalizedEmail });
    if (existingPending) {
      const elapsed = Date.now() - new Date(existingPending.lastResendAt || existingPending.createdAt).getTime();
      if (elapsed < 60000) {
        const waitSeconds = Math.ceil((60000 - elapsed) / 1000);
        return res.status(429).json({
          status: 'error',
          code: 'RESEND_COOLDOWN',
          message: `Please wait ${waitSeconds} seconds before requesting a new verification code.`,
          retryAfter: waitSeconds,
          requiresOtp: true,
          email: normalizedEmail
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate cryptographically secure 6-digit numeric OTP and compute its SHA-256 hash
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(otp);
    const emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear any existing unverified pending registration for this email or phone
    await PendingUser.deleteMany({
      $or: [{ email: normalizedEmail }, { phone: normalizedPhone }]
    });

    // Save strictly to PendingUser collection with hashed OTP
    await PendingUser.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      otpHash,
      otpExpires: emailOtpExpires,
      attempts: 0,
      maxAttempts: 5,
      lastResendAt: new Date()
    });

    // Dispatch OTP email via HTTPS API
    const emailDispatch = await emailService.sendOtpEmail(normalizedEmail, otp);
    if (!emailDispatch.delivered) {
      await PendingUser.deleteMany({ email: normalizedEmail });
      return res.status(503).json({
        status: 'error',
        message: emailDispatch.error || 'Unable to deliver verification email to your email address. Please try again later.'
      });
    }

    res.status(201).json({
      status: 'success',
      message: `A 6-digit verification code has been dispatched to your email address (${normalizedEmail}). Please check your inbox.`,
      requiresOtp: true,
      email: normalizedEmail,
      cooldownSeconds: 60
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmailOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ status: 'error', message: 'Email and 6-digit verification OTP are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ status: 'error', message: 'Verification OTP must be a 6-digit numeric code' });
    }

    // 1. First look up the pending registration
    const pending = await PendingUser.findOne({ email: normalizedEmail });

    if (!pending) {
      // Check if user is already verified and active in User collection
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser && existingUser.isEmailVerified) {
        return res.json({
          status: 'success',
          message: 'Email is already verified. You can log in.',
          data: {
            _id: existingUser._id,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            email: existingUser.email,
            role: existingUser.role,
            token: generateToken(existingUser._id, existingUser.role)
          }
        });
      }

      // Check if there is an older legacy user pending verification
      if (existingUser && !existingUser.isEmailVerified && (existingUser.emailOtpHash || existingUser.emailOtp)) {
        if (new Date() > new Date(existingUser.emailOtpExpires)) {
          return res.status(400).json({ status: 'error', message: 'Verification code has expired. Please request a new OTP.' });
        }

        if ((existingUser.emailOtpAttempts || 0) >= 5) {
          return res.status(400).json({ status: 'error', message: 'Too many invalid attempts. This verification code has been invalidated. Please request a new OTP.' });
        }

        const isMatch = compareOtp(cleanOtp, existingUser.emailOtpHash || existingUser.emailOtp);
        if (isMatch) {
          existingUser.isEmailVerified = true;
          existingUser.emailOtpHash = null;
          existingUser.emailOtp = null;
          existingUser.emailOtpExpires = null;
          existingUser.emailOtpAttempts = 0;
          await existingUser.save();

          return res.json({
            status: 'success',
            message: 'Email verified successfully! Welcome to MarketSphere.',
            data: {
              _id: existingUser._id,
              firstName: existingUser.firstName,
              lastName: existingUser.lastName,
              email: existingUser.email,
              role: existingUser.role,
              token: generateToken(existingUser._id, existingUser.role)
            }
          });
        } else {
          existingUser.emailOtpAttempts = (existingUser.emailOtpAttempts || 0) + 1;
          await existingUser.save();
          const remaining = Math.max(0, 5 - existingUser.emailOtpAttempts);
          return res.status(400).json({ status: 'error', message: `Invalid verification code. ${remaining} attempt(s) remaining.` });
        }
      }

      return res.status(400).json({ 
        status: 'error', 
        message: 'No pending registration found for this email address. Please register again.' 
      });
    }

    // Check expiration
    if (new Date() > new Date(pending.otpExpires)) {
      return res.status(400).json({ status: 'error', message: 'Verification code has expired. Please request a new OTP.' });
    }

    // Check attempt limits (max 5)
    const maxAttempts = pending.maxAttempts || 5;
    if ((pending.attempts || 0) >= maxAttempts) {
      await PendingUser.deleteOne({ _id: pending._id });
      return res.status(400).json({
        status: 'error',
        message: 'Too many invalid attempts. This verification code has been invalidated. Please register again or request a new OTP.'
      });
    }

    // Constant-time compare submitted OTP against hashed or legacy OTP
    const isOtpValid = compareOtp(cleanOtp, pending.otpHash || pending.otp);
    if (!isOtpValid) {
      pending.attempts = (pending.attempts || 0) + 1;
      await pending.save();
      const remaining = Math.max(0, maxAttempts - pending.attempts);
      return res.status(400).json({
        status: 'error',
        message: `Invalid verification code. ${remaining} attempt(s) remaining.`
      });
    }

    // Double check email & phone uniqueness in confirmed User collection
    const emailTaken = await User.findOne({ email: pending.email });
    if (emailTaken && emailTaken.isEmailVerified) {
      await PendingUser.deleteMany({ email: pending.email });
      return res.status(400).json({ status: 'error', message: 'An account is already verified with this email address.' });
    }

    const phoneTaken = await User.findOne({ phone: pending.phone });
    if (phoneTaken && phoneTaken.isEmailVerified) {
      return res.status(400).json({ status: 'error', message: 'This mobile number is already linked to an existing account.' });
    }

    // NOW create permanent verified user record in User collection
    const user = await User.create({
      firstName: pending.firstName,
      lastName: pending.lastName,
      email: pending.email,
      phone: pending.phone,
      passwordHash: pending.passwordHash,
      role: 'CUSTOMER',
      isActive: true,
      isEmailVerified: true
    });

    // Invalidate & remove pending registration record immediately
    await PendingUser.deleteMany({ email: pending.email });

    res.json({
      status: 'success',
      message: 'Email verified successfully! Welcome to MarketSphere.',
      data: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        token: generateToken(user._id, user.role)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.resendEmailOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = await PendingUser.findOne({ email: normalizedEmail });

    if (!pending) {
      const verifiedUser = await User.findOne({ email: normalizedEmail });
      if (verifiedUser && verifiedUser.isEmailVerified) {
        return res.status(400).json({ status: 'error', message: 'Email is already verified. Please sign in.' });
      }
      return res.status(404).json({ status: 'error', message: 'No pending registration found for this email. Please register again.' });
    }

    // Enforce 60-second cooldown between resends
    const lastResend = pending.lastResendAt || pending.createdAt;
    const elapsed = Date.now() - new Date(lastResend).getTime();
    if (elapsed < 60000) {
      const waitSeconds = Math.ceil((60000 - elapsed) / 1000);
      return res.status(429).json({
        status: 'error',
        code: 'RESEND_COOLDOWN',
        message: `Please wait ${waitSeconds} seconds before requesting a new verification code.`,
        retryAfter: waitSeconds
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    pending.otpHash = hashOtp(otp);
    pending.otp = undefined; // Clear any legacy plaintext
    pending.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    pending.attempts = 0;
    pending.lastResendAt = new Date();
    await pending.save();

    const emailDispatch = await emailService.sendOtpEmail(pending.email, otp);
    if (!emailDispatch.delivered) {
      return res.status(503).json({
        status: 'error',
        message: emailDispatch.error || 'Failed to dispatch verification email to your inbox.'
      });
    }

    res.json({
      status: 'success',
      message: 'A new 6-digit verification code has been dispatched to your email address.',
      email: pending.email,
      cooldownSeconds: 60
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ status: 'error', message: 'Account is deactivated or suspended. Please contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    if (user.isEmailVerified === false && process.env.NODE_ENV !== 'test' && user.role !== 'ADMIN') {
      const lastResend = user.emailOtpLastResendAt;
      const shouldDispatchNewOtp = !lastResend || (Date.now() - new Date(lastResend).getTime() >= 60000);

      if (shouldDispatchNewOtp) {
        const otp = crypto.randomInt(100000, 1000000).toString();
        user.emailOtpHash = hashOtp(otp);
        user.emailOtp = null;
        user.emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
        user.emailOtpAttempts = 0;
        user.emailOtpLastResendAt = new Date();
        await user.save();
        await emailService.sendOtpEmail(user.email, otp);
      }

      return res.status(403).json({
        status: 'error',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Your email address is not verified yet. A 6-digit verification OTP has been sent to your email.',
        requiresOtp: true,
        email: user.email
      });
    }

    let sellerStatus = null;
    if (user.role === 'SELLER') {
      const seller = await Seller.findOne({ userId: user._id });
      sellerStatus = seller ? seller.status : 'PENDING';
    }

    res.json({
      status: 'success',
      data: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        sellerStatus,
        token: generateToken(user._id, user.role)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id || req.user.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    let seller = null;
    if (user.role === 'SELLER') {
      seller = await Seller.findOne({ userId: user._id });
    }

    res.json({ 
      status: 'success', 
      data: {
        ...user.toObject(),
        seller: seller || null
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ status: 'success', message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await User.findById(req.user._id || req.user.id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone) {
      const phoneValidation = validateMobileNumber(phone);
      if (!phoneValidation.isValid) {
        return res.status(400).json({ status: 'error', message: phoneValidation.message });
      }
      const existingPhoneUser = await User.findOne({
        phone: phoneValidation.normalizedPhone,
        _id: { $ne: user._id }
      });
      if (existingPhoneUser) {
        return res.status(400).json({
          status: 'error',
          message: 'This mobile number is already linked to another account'
        });
      }
      user.phone = phoneValidation.normalizedPhone;
    }

    await user.save();
    res.json({ status: 'success', message: 'Profile updated', data: user });
  } catch (error) {
    next(error);
  }
};

exports.addAddress = async (req, res, next) => {
  try {
    const { fullName, phone, street, city, state, zipCode, country, isDefault } = req.body;
    if (!street || !city || !state || !zipCode) {
      return res.status(400).json({ status: 'error', message: 'Street, city, state, and zipCode are required' });
    }

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (isDefault) {
      user.addresses.forEach(a => { a.isDefault = false; });
    }

    user.addresses.push({
      fullName: fullName || `${user.firstName} ${user.lastName}`,
      phone: phone || user.phone || 'N/A',
      street,
      city,
      state,
      zipCode,
      country: country || 'India',
      isDefault: Boolean(isDefault)
    });

    await user.save();
    res.status(201).json({ status: 'success', message: 'Address added', data: user.addresses });
  } catch (error) {
    next(error);
  }
};

exports.deleteAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id || req.user.id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    user.addresses = user.addresses.filter(a => a._id.toString() !== req.params.addressId);
    await user.save();
    res.json({ status: 'success', message: 'Address removed', data: user.addresses });
  } catch (error) {
    next(error);
  }
};

exports.testEmailStatus = async (req, res, next) => {
  try {
    const to = (req.query.to || '').trim();
    if (!to) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Query parameter "to" is required (e.g. /api/v1/auth/test-email-status?to=yourname@gmail.com)' 
      });
    }

    const providerStatus = emailService.verifyConfiguration();
    const config = {
      activeProvider: emailService.getProvider(),
      isValid: providerStatus.isValid,
      hasResendKey: Boolean(process.env.RESEND_API_KEY),
      hasBrevoKey: Boolean(process.env.BREVO_API_KEY),
      configuredFrom: process.env.EMAIL_FROM || 'MarketSphere <onboarding@resend.dev>'
    };

    const result = await emailService.sendEmail(
      to,
      'MarketSphere Email Integration Test',
      'This is an automated test verification message to confirm that your MarketSphere HTTPS email integration is active.',
      'GENERAL',
      '<div style="font-family:sans-serif;padding:24px;border:1px solid #e2e8f0;border-radius:12px;max-width:500px;margin:0 auto;"><h2 style="color:#d97706;margin-top:0;">MarketSphere HTTPS Email Integration Test</h2><p style="color:#334155;font-size:14px;line-height:1.6;">Your transactional email delivery over HTTPS is configured and operational.</p><hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;"/><small style="color:#94a3b8;">Sent via MarketSphere API</small></div>'
    );

    res.json({
      status: result.delivered ? 'success' : 'failed',
      config,
      result
    });
  } catch (error) {
    next(error);
  }
};


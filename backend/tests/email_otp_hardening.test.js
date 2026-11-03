const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const authController = require('../controllers/authController');
const emailService = require('../services/emailService');
const { connectTestDb, disconnectTestDb, clearDatabase } = require('./testHelper');

// Mock express response helper
const createMockRes = () => {
  const res = {};
  res.statusCode = 200;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
};

describe('Email OTP & Registration Hardening Suite (18 Acceptance Tests)', () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  afterEach(async () => {
    await clearDatabase();
    jest.restoreAllMocks();
  });

  // TEST 1: Registration request with valid input
  it('1. Registration request with valid input succeeds and creates PendingUser', async () => {
    const sendOtpSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({
      delivered: true,
      provider: 'MOCK_DEV',
      messageId: 'mock-123'
    });

    const req = {
      body: {
        firstName: 'Aarav',
        lastName: 'Patel',
        email: 'aarav.patel@gmail.com',
        phone: '9876543210',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    const next = jest.fn();

    await authController.register(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.email).toBe('aarav.patel@gmail.com');
    expect(res.body.cooldownSeconds).toBe(60);
    expect(sendOtpSpy).toHaveBeenCalledTimes(1);

    const pending = await PendingUser.findOne({ email: 'aarav.patel@gmail.com' });
    expect(pending).toBeTruthy();
    expect(pending.otpHash).toBeDefined();
    expect(pending.otpHash).toHaveLength(64); // SHA-256 hash length
    expect(pending.attempts).toBe(0);
    expect(pending.maxAttempts).toBe(5);
  });

  // TEST 2: Registration request with invalid input
  it('2. Registration request with invalid input returns 400 validation error', async () => {
    const invalidCases = [
      { firstName: '', lastName: 'User', email: 'valid@gmail.com', phone: '9876543210', password: 'Pass' },
      { firstName: 'First', lastName: 'Last', email: 'invalid-email-format', phone: '9876543210', password: 'Password123' },
      { firstName: 'First', lastName: 'Last', email: 'valid@gmail.com', phone: '123', password: 'Password123' },
      { firstName: 'First', lastName: 'Last', email: 'valid@gmail.com', phone: '9876543210', password: '123' } // Too short
    ];

    for (const testCase of invalidCases) {
      const req = { body: testCase };
      const res = createMockRes();
      const next = jest.fn();

      await authController.register(req, res, next);
      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('error');
    }
  });

  // TEST 3: Cryptographically secure OTP generation & hashing
  it('3. OTP generation generates 6-digit numeric code and stores SHA-256 hash', async () => {
    let capturedOtp = null;
    jest.spyOn(emailService, 'sendOtpEmail').mockImplementation((to, otp) => {
      capturedOtp = otp;
      return Promise.resolve({ delivered: true, provider: 'MOCK' });
    });

    const req = {
      body: {
        firstName: 'Crypt',
        lastName: 'Test',
        email: 'crypto.test@gmail.com',
        phone: '9876500001',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    await authController.register(req, res, jest.fn());

    expect(capturedOtp).toMatch(/^\d{6}$/);
    const expectedHash = crypto.createHash('sha256').update(capturedOtp).digest('hex');

    const pending = await PendingUser.findOne({ email: 'crypto.test@gmail.com' });
    expect(pending.otpHash).toBe(expectedHash);
  });

  // TEST 4: OTP email service invocation
  it('4. OTP email service is invoked with recipient email and 6-digit OTP', async () => {
    const sendOtpSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ delivered: true, provider: 'MOCK' });

    const req = {
      body: {
        firstName: 'Dispatch',
        lastName: 'Target',
        email: 'dispatch.target@gmail.com',
        phone: '9876500002',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    await authController.register(req, res, jest.fn());

    expect(sendOtpSpy).toHaveBeenCalledWith('dispatch.target@gmail.com', expect.stringMatching(/^\d{6}$/));
  });

  // TEST 5: Missing email provider credentials
  it('5. Missing email provider credentials reports error and does not pretend delivery', async () => {
    const origProvider = process.env.EMAIL_PROVIDER;
    const origResend = process.env.RESEND_API_KEY;
    const origBrevo = process.env.BREVO_API_KEY;
    const origEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';
      process.env.EMAIL_PROVIDER = 'resend';
      delete process.env.RESEND_API_KEY;

      const result = await emailService.sendEmail('test@example.com', 'Subj', 'Body');
      expect(result.delivered).toBe(false);
      expect(result.error).toMatch(/RESEND_API_KEY is missing/i);
    } finally {
      process.env.EMAIL_PROVIDER = origProvider;
      if (origResend) process.env.RESEND_API_KEY = origResend;
      if (origBrevo) process.env.BREVO_API_KEY = origBrevo;
      process.env.NODE_ENV = origEnv;
    }
  });

  // TEST 6: Email provider returning an error
  it('6. Email provider returning an error is handled safely and cleans pending registration', async () => {
    jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({
      delivered: false,
      error: 'Resend sandbox domain restriction: recipients restricted'
    });

    const req = {
      body: {
        firstName: 'Fail',
        lastName: 'Delivery',
        email: 'fail.delivery@gmail.com',
        phone: '9876500003',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    await authController.register(req, res, jest.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toContain('Resend sandbox domain restriction');

    // Ensure pending user was cleaned up so user is not stuck
    const pending = await PendingUser.findOne({ email: 'fail.delivery@gmail.com' });
    expect(pending).toBeNull();
  });

  // TEST 7: Email provider timeout or network failure
  it('7. Email provider timeout or network failure is caught and returns safe message', async () => {
    jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({
      delivered: false,
      error: 'Email provider request timed out. Please try again later.'
    });

    const req = {
      body: {
        firstName: 'Timeout',
        lastName: 'User',
        email: 'timeout.user@gmail.com',
        phone: '9876500004',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    await authController.register(req, res, jest.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body.message).toMatch(/timed out/i);
  });

  // TEST 8: Correct OTP verification creates permanent User and cleans PendingUser
  it('8. Correct OTP verification creates permanent verified User and deletes PendingUser', async () => {
    const rawOtp = '654321';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya.sharma@gmail.com',
      phone: '9876500005',
      passwordHash: await bcrypt.hash('Secret123!', 10),
      otpHash,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      lastResendAt: new Date()
    });

    const req = {
      body: {
        email: 'priya.sharma@gmail.com',
        otp: '654321'
      }
    };
    const res = createMockRes();
    await authController.verifyEmailOtp(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.token).toBeDefined();

    // Verify permanent User created
    const user = await User.findOne({ email: 'priya.sharma@gmail.com' });
    expect(user).toBeTruthy();
    expect(user.isEmailVerified).toBe(true);
    expect(user.role).toBe('CUSTOMER');

    // Verify PendingUser removed
    const pending = await PendingUser.findOne({ email: 'priya.sharma@gmail.com' });
    expect(pending).toBeNull();
  });

  // TEST 9: Incorrect OTP verification increments attempts and returns remaining attempts
  it('9. Incorrect OTP verification increments attempts and returns remaining count', async () => {
    const rawOtp = '112233';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Wrong',
      lastName: 'Otp',
      email: 'wrong.otp@gmail.com',
      phone: '9876500006',
      passwordHash: 'dummyhash',
      otpHash,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5
    });

    const req = {
      body: {
        email: 'wrong.otp@gmail.com',
        otp: '999999'
      }
    };
    const res = createMockRes();
    await authController.verifyEmailOtp(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid verification code\. 4 attempt\(s\) remaining\./i);

    const pending = await PendingUser.findOne({ email: 'wrong.otp@gmail.com' });
    expect(pending.attempts).toBe(1);
  });

  // TEST 10: Expired OTP rejection
  it('10. Expired OTP is rejected with 400', async () => {
    const rawOtp = '123456';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Expired',
      lastName: 'Otp',
      email: 'expired.otp@gmail.com',
      phone: '9876500007',
      passwordHash: 'dummyhash',
      otpHash,
      otpExpires: new Date(Date.now() - 5000), // Expired 5 seconds ago
      attempts: 0,
      maxAttempts: 5
    });

    const req = {
      body: {
        email: 'expired.otp@gmail.com',
        otp: '123456'
      }
    };
    const res = createMockRes();
    await authController.verifyEmailOtp(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  // TEST 11: OTP reuse rejection
  it('11. OTP cannot be reused after successful verification', async () => {
    const rawOtp = '778899';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Reuse',
      lastName: 'Test',
      email: 'reuse.test@gmail.com',
      phone: '9876500008',
      passwordHash: await bcrypt.hash('Password123!', 10),
      otpHash,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5
    });

    // 1st Verification (Succeeds)
    const req1 = { body: { email: 'reuse.test@gmail.com', otp: '778899' } };
    const res1 = createMockRes();
    await authController.verifyEmailOtp(req1, res1, jest.fn());
    expect(res1.statusCode).toBe(200);

    // 2nd Verification with same code (Pending record gone; user is already verified)
    const req2 = { body: { email: 'reuse.test@gmail.com', otp: '778899' } };
    const res2 = createMockRes();
    await authController.verifyEmailOtp(req2, res2, jest.fn());
    expect(res2.body.message).toMatch(/already verified/i);

    // Ensure only 1 User record exists
    const usersCount = await User.countDocuments({ email: 'reuse.test@gmail.com' });
    expect(usersCount).toBe(1);
  });

  // TEST 12: Verification attempt limits (max 5 attempts)
  it('12. Verification locks out and invalidates code after 5 invalid attempts', async () => {
    const rawOtp = '445566';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Brute',
      lastName: 'Force',
      email: 'brute.force@gmail.com',
      phone: '9876500009',
      passwordHash: 'dummyhash',
      otpHash,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 4, // 4 attempts already made
      maxAttempts: 5
    });

    // 5th attempt (mismatched)
    const req5 = { body: { email: 'brute.force@gmail.com', otp: '000000' } };
    const res5 = createMockRes();
    await authController.verifyEmailOtp(req5, res5, jest.fn());
    expect(res5.statusCode).toBe(400);

    // 6th attempt (must be locked out / invalidated)
    const req6 = { body: { email: 'brute.force@gmail.com', otp: '445566' } };
    const res6 = createMockRes();
    await authController.verifyEmailOtp(req6, res6, jest.fn());
    expect(res6.statusCode).toBe(400);
    expect(res6.body.message).toMatch(/Too many invalid attempts|No pending registration/i);
  });

  // TEST 13: OTP resend cooldown (60 seconds)
  it('13. OTP resend within 60 seconds returns 429 RESEND_COOLDOWN', async () => {
    const rawOtp = '334455';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await PendingUser.create({
      firstName: 'Cooldown',
      lastName: 'Test',
      email: 'cooldown.test@gmail.com',
      phone: '9876500010',
      passwordHash: 'dummyhash',
      otpHash,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      lastResendAt: new Date(Date.now() - 20 * 1000) // Only 20s ago (cooldown is 60s)
    });

    const req = { body: { email: 'cooldown.test@gmail.com' } };
    const res = createMockRes();
    await authController.resendEmailOtp(req, res, jest.fn());

    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('RESEND_COOLDOWN');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeLessThanOrEqual(40);
  });

  // TEST 14: Duplicate registration behavior
  it('14. Duplicate registration for already verified email is rejected with 400', async () => {
    await User.create({
      firstName: 'Existing',
      lastName: 'User',
      email: 'existing.user@gmail.com',
      phone: '9876500011',
      passwordHash: 'dummyhash',
      role: 'CUSTOMER',
      isEmailVerified: true
    });

    const req = {
      body: {
        firstName: 'Another',
        lastName: 'Person',
        email: 'existing.user@gmail.com',
        phone: '9876500012',
        password: 'Password123!'
      }
    };
    const res = createMockRes();
    await authController.register(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already registered with this email/i);
  });

  // TEST 15: Unverified account restrictions
  it('15. Unverified user login is intercepted with 403 and triggers verification OTP', async () => {
    const sendOtpSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ delivered: true, provider: 'MOCK' });
    const passwordHash = await bcrypt.hash('Secret123!', 10);

    await User.create({
      firstName: 'Unverified',
      lastName: 'Guy',
      email: 'unverified.guy@gmail.com',
      phone: '9876500013',
      passwordHash,
      role: 'CUSTOMER',
      isEmailVerified: false
    });

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // To test production verification intercept

    try {
      const req = { body: { email: 'unverified.guy@gmail.com', password: 'Secret123!' } };
      const res = createMockRes();
      await authController.login(req, res, jest.fn());

      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.requiresOtp).toBe(true);
      expect(sendOtpSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  // TEST 16: Cross-user verification attempts
  it('16. Cross-user verification fails when using User A OTP for User B', async () => {
    const otpA = '123123';
    const otpB = '987987';

    await PendingUser.create({
      firstName: 'UserA',
      lastName: 'A',
      email: 'user.a@gmail.com',
      phone: '9876500014',
      passwordHash: 'hashA',
      otpHash: crypto.createHash('sha256').update(otpA).digest('hex'),
      otpExpires: new Date(Date.now() + 10 * 60 * 1000)
    });

    await PendingUser.create({
      firstName: 'UserB',
      lastName: 'B',
      email: 'user.b@gmail.com',
      phone: '9876500015',
      passwordHash: 'hashB',
      otpHash: crypto.createHash('sha256').update(otpB).digest('hex'),
      otpExpires: new Date(Date.now() + 10 * 60 * 1000)
    });

    // Submitting User A's OTP to User B's verification endpoint
    const req = { body: { email: 'user.b@gmail.com', otp: otpA } };
    const res = createMockRes();
    await authController.verifyEmailOtp(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid verification code/i);

    // Verify neither user was prematurely verified
    expect(await User.countDocuments({ email: { $in: ['user.a@gmail.com', 'user.b@gmail.com'] } })).toBe(0);
  });

  // TEST 17: Existing login behavior for verified users
  it('17. Verified user login succeeds and returns JWT and profile data', async () => {
    const passwordHash = await bcrypt.hash('ValidPass123!', 10);
    await User.create({
      firstName: 'Verified',
      lastName: 'Member',
      email: 'verified.member@gmail.com',
      phone: '9876500016',
      passwordHash,
      role: 'CUSTOMER',
      isEmailVerified: true
    });

    const req = { body: { email: 'verified.member@gmail.com', password: 'ValidPass123!' } };
    const res = createMockRes();
    await authController.login(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.email).toBe('verified.member@gmail.com');
  });

  // TEST 18: Existing password change behavior
  it('18. Change password validates current password and updates hash', async () => {
    const oldHash = await bcrypt.hash('OldPassword123!', 10);
    const user = await User.create({
      firstName: 'Pwd',
      lastName: 'Tester',
      email: 'pwd.tester@gmail.com',
      phone: '9876500017',
      passwordHash: oldHash,
      role: 'CUSTOMER',
      isEmailVerified: true
    });

    // 1. Wrong old password
    const reqWrong = {
      user: { id: user._id },
      body: { currentPassword: 'WrongPassword!', newPassword: 'BrandNewPassword123!' }
    };
    const resWrong = createMockRes();
    await authController.changePassword(reqWrong, resWrong, jest.fn());
    expect(resWrong.statusCode).toBe(401);

    // 2. Correct old password
    const reqCorrect = {
      user: { id: user._id },
      body: { currentPassword: 'OldPassword123!', newPassword: 'BrandNewPassword123!' }
    };
    const resCorrect = createMockRes();
    await authController.changePassword(reqCorrect, resCorrect, jest.fn());
    expect(resCorrect.statusCode).toBe(200);
    expect(resCorrect.body.message).toMatch(/Password updated successfully/i);

    // Verify hash changed and matches new password
    const updatedUser = await User.findById(user._id);
    const isNewMatch = await bcrypt.compare('BrandNewPassword123!', updatedUser.passwordHash);
    expect(isNewMatch).toBe(true);
  });
});


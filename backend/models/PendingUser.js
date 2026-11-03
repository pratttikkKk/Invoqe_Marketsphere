const mongoose = require('mongoose');

const pendingUserSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  otpHash: { type: String, required: true },
  otp: { type: String }, // Legacy compatibility fallback
  otpExpires: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lastResendAt: { type: Date, default: Date.now }
}, { timestamps: true });

// TTL Index: Auto-remove pending registration document after 15 minutes (900 seconds)
pendingUserSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });

module.exports = mongoose.model('PendingUser', pendingUserSchema);

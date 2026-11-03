const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zipCode: { type: String, required: true },
  country: { type: String, default: 'India' },
  isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  phone: { type: String, trim: true, unique: true, sparse: true },
  role: { type: String, enum: ['CUSTOMER', 'SELLER', 'ADMIN'], default: 'CUSTOMER' },
  addresses: [addressSchema],
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  emailOtpHash: { type: String, default: null },
  emailOtp: { type: String, default: null }, // Legacy compatibility fallback
  emailOtpExpires: { type: Date, default: null },
  emailOtpAttempts: { type: Number, default: 0 },
  emailOtpLastResendAt: { type: Date, default: null }
}, { timestamps: true });

userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);

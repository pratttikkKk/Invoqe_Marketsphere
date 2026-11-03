import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../../api/client';
import { useNotification } from '../../context/NotificationContext';
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  ArrowRight, 
  ShieldCheck, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  Sparkles
} from 'lucide-react';

export default function Register() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });
  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [otp, setOtp] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const navigate = useNavigate();
  const { toast, modal } = useNotification();

  useEffect(() => {
    let timer;
    if (step === 'otp' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, countdown]);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const validateInputs = () => {
    // 1. Name validation
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      return 'First and last name are required.';
    }

    // 2. Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      return 'Please enter a valid email address (e.g., name@gmail.com).';
    }

    // 3. Mobile number validation (10 to 15 digits)
    const cleanPhone = formData.phone.replace(/[\s\-\(\)\.]/g, '');
    if (!/^\+?\d{10,15}$/.test(cleanPhone)) {
      return 'Please enter a valid 10-digit mobile number.';
    }

    // 4. Password validation
    if (formData.password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (formData.password !== formData.confirmPassword) {
      return 'Passwords do not match.';
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      toast.error(validationError, 'Input Validation');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const cleanPhone = formData.phone.replace(/[\s\-\(\)\.]/g, '');
      const res = await apiClient.post('/auth/register', {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: cleanPhone,
        password: formData.password
      });

      if (res.status === 'success') {
        const targetEmail = res.email || formData.email.trim().toLowerCase();
        setVerificationEmail(targetEmail);
        setCountdown(res.cooldownSeconds || 60);
        setStep('otp');

        modal.success({
          title: 'Verification Code Sent! ✉️',
          message: `A 6-digit verification code has been dispatched to your email address:\n\n${targetEmail}\n\nPlease check your inbox (and spam folder) to complete your account registration.`,
          confirmText: 'Enter Verification Code'
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error?.message || err.message || 'Registration failed';
      if (err.response?.data?.requiresOtp) {
        setVerificationEmail(formData.email.trim().toLowerCase());
        setCountdown(err.response?.data?.retryAfter || 60);
        setStep('otp');
      }
      setError(msg);
      toast.error(msg, 'Registration Error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      const msg = 'Please enter the complete 6-digit verification code';
      setError(msg);
      toast.warning(msg, 'Incomplete Code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await apiClient.post('/auth/verify-otp', {
        email: verificationEmail,
        otp: otp.trim()
      });

      if (res.status === 'success') {
        const userData = res.data;
        if (userData?.token) {
          localStorage.setItem('token', userData.token);
          localStorage.setItem('user', JSON.stringify(userData));
        }

        modal.success({
          title: 'Email Verified Successfully! 🎉',
          message: `Welcome to MarketSphere, ${userData.firstName}! Your verified account is now active and ready to explore thousands of authentic products.`,
          confirmText: 'Start Shopping Now',
          onConfirm: () => navigate('/products')
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error?.message || err.message || 'OTP verification failed';
      setError(msg);
      toast.error(msg, 'Verification Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      const res = await apiClient.post('/auth/resend-otp', { email: verificationEmail });
      if (res.status === 'success') {
        setCountdown(res.cooldownSeconds || 60);
        toast.success(
          `A new verification code was sent to ${verificationEmail}. Please check your inbox.`,
          'Code Dispatched'
        );
      }
    } catch (err) {
      if (err.response?.status === 429 && err.response?.data?.retryAfter) {
        setCountdown(err.response.data.retryAfter);
      }
      const msg = err.response?.data?.message || err.message || 'Failed to resend code';
      setError(msg);
      toast.error(msg, 'Dispatch Failed');
    } finally {
      setResending(false);
    }
  };

  // STEP 2: Email OTP Verification Screen
  if (step === 'otp') {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-900/5 border border-slate-100 p-8 sm:p-10 relative overflow-hidden">
          {/* Header Accent Glow */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl text-2xl mb-4 ring-8 ring-amber-50/50 shadow-inner">
              <Mail className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Verify Your Email
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 max-w-xs mx-auto">
              To keep our marketplace authentic, we sent a 6-digit code to:
            </p>
            <div className="inline-block mt-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-xs font-mono font-bold text-slate-800">
                {verificationEmail}
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium text-rose-700 animate-in fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2 text-center uppercase tracking-wider">
                Enter 6-Digit Verification Code
              </label>
              <div className="relative">
                <input
                  type="text"
                  maxLength="6"
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  className="w-full text-center text-3xl font-mono font-extrabold tracking-[0.4em] py-3.5 border-2 border-slate-200 rounded-2xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition bg-slate-50/50 text-slate-900"
                  required
                />
              </div>
              <p className="text-[11px] text-center text-slate-400 mt-2">
                Check your inbox & spam folder for an email from MarketSphere
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-extrabold py-3.5 rounded-2xl transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  <span>Verify Email & Complete Registration</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-7 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resending || countdown > 0}
              className="text-amber-600 hover:text-amber-700 font-semibold hover:underline disabled:opacity-50 disabled:no-underline inline-flex items-center gap-1.5"
            >
              {resending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {resending 
                  ? 'Sending...' 
                  : countdown > 0 
                    ? `Resend Code (${countdown}s)` 
                    : 'Resend Code'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setError('');
              }}
              className="text-slate-500 hover:text-slate-700 font-medium hover:underline"
            >
              ← Edit Registration Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 1: Registration Form Screen
  return (
    <div className="max-w-lg mx-auto my-10 px-4">
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-900/5 border border-slate-100 p-8 sm:p-10 relative overflow-hidden">
        {/* Top Accent Gradient Bar */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200/60 rounded-full text-amber-700 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Join 50,000+ Verified Buyers</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Create an Account
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Experience authentic multi-vendor commerce with instant delivery tracking and genuine buyer protection.
          </p>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium text-rose-700 animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First & Last Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                First Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  name="firstName"
                  placeholder="e.g. Rahul"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                  value={formData.firstName}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Last Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  name="lastName"
                  placeholder="e.g. Sharma"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                  value={formData.lastName}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          </div>

          {/* Email Address */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Real Email Address *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                name="email"
                placeholder="you@gmail.com"
                className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              A 6-digit verification code will be sent to this email. Fake or temporary addresses will be rejected.
            </p>
          </div>

          {/* Unique Mobile Number */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Mobile Number (Unique) *
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                name="phone"
                placeholder="e.g. 9876543210 or +919876543210"
                className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                value={formData.phone}
                onChange={handleChange}
                required
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Used for order SMS notifications. Each mobile number can only be linked to one account.
            </p>
          </div>

          {/* Password & Confirm Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Password *
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  name="password"
                  placeholder="Min 6 characters"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Confirm Password *
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  name="confirmPassword"
                  placeholder="Repeat password"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-extrabold py-3.5 rounded-2xl transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50 text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Validating & Sending Code...</span>
              </>
            ) : (
              <>
                <span>Register & Send Email Verification Code</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-2.5">
          <p className="text-xs text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="text-amber-600 font-bold hover:underline">
              Sign In here
            </Link>
          </p>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>256-Bit SSL Encrypted Verification • Spam-Free Guarantee</span>
          </div>
        </div>
      </div>
    </div>
  );
}

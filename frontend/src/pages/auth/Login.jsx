import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../../api/client';
import { useNotification } from '../../context/NotificationContext';
import { 
  Mail, 
  Lock, 
  ArrowRight, 
  ShieldCheck, 
  RefreshCw, 
  AlertCircle 
} from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [infoMsg, setInfoMsg] = useState('');

  const navigate = useNavigate();
  const { toast, modal } = useNotification();

  useEffect(() => {
    let timer;
    if (showOtp && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showOtp, countdown]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);

    try {
      const res = await apiClient.post('/auth/login', { 
        email: email.trim().toLowerCase(), 
        password 
      });

      if (res.status === 'success') {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data));
        
        toast.success(`Welcome back, ${res.data.firstName}!`, 'Sign In Successful');

        if (res.data.role === 'SELLER') {
          navigate('/seller');
        } else if (res.data.role === 'ADMIN') {
          navigate('/admin');
        } else {
          navigate('/products');
        }
      }
    } catch (err) {
      if (err.response?.data?.requiresOtp) {
        setShowOtp(true);
        setCountdown(60);
        const msg = err.response.data.message || 'Please verify your email address to continue.';
        setInfoMsg(msg);
        modal.warning({
          title: 'Email Verification Required',
          message: `${msg}\n\nA fresh 6-digit verification code has been dispatched to ${email.trim().toLowerCase()}.`,
          confirmText: 'Enter Code'
        });
      } else {
        const msg = err.response?.data?.message || err.message || 'Login failed';
        setError(msg);
        toast.error(msg, 'Authentication Failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      const msg = 'Please enter the 6-digit verification code';
      setError(msg);
      toast.warning(msg, 'Incomplete Code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await apiClient.post('/auth/verify-otp', {
        email: email.trim().toLowerCase(),
        otp: otp.trim()
      });

      if (res.status === 'success') {
        const userData = res.data;
        if (userData?.token) {
          localStorage.setItem('token', userData.token);
          localStorage.setItem('user', JSON.stringify(userData));
        }

        modal.success({
          title: 'Email Verified! 🎉',
          message: 'Your email address is now verified. Welcome back to MarketSphere!',
          confirmText: 'Proceed to Dashboard',
          onConfirm: () => {
            if (userData?.role === 'SELLER') {
              navigate('/seller');
            } else if (userData?.role === 'ADMIN') {
              navigate('/admin');
            } else {
              navigate('/products');
            }
          }
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'OTP verification failed';
      setError(msg);
      toast.error(msg, 'Verification Error');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      const res = await apiClient.post('/auth/resend-otp', { email: email.trim().toLowerCase() });
      if (res.status === 'success') {
        setCountdown(res.cooldownSeconds || 60);
        toast.success(
          `A new verification code was sent to ${email.trim().toLowerCase()}. Please check your inbox.`,
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

  if (showOtp) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-900/5 border border-slate-100 p-8 sm:p-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl text-2xl mb-4 ring-8 ring-amber-50/50 shadow-inner">
              <Mail className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Verify Your Email
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 max-w-xs mx-auto">
              Enter the 6-digit verification code sent to your real email inbox:
            </p>
            <div className="inline-block mt-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-xs font-mono font-bold text-slate-800">
                {email}
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium text-rose-700 animate-in fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {infoMsg && !error && (
            <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-medium text-amber-800 animate-in fade-in">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
              <span>{infoMsg}</span>
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2 text-center uppercase tracking-wider">
                Enter 6-Digit Code
              </label>
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
              <p className="text-[11px] text-center text-slate-400 mt-2">
                Check your inbox & spam folder for an email from MarketSphere
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-extrabold py-3.5 rounded-2xl transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50 text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  <span>Verify Email & Sign In</span>
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
                setShowOtp(false);
                setError('');
                setInfoMsg('');
              }}
              className="text-slate-500 hover:text-slate-700 font-medium hover:underline"
            >
              ← Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto my-10 px-4">
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-900/5 border border-slate-100 p-8 sm:p-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

        <div className="text-center mb-7">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Welcome Back
          </h2>
          <p className="text-xs text-slate-500 mt-1.5">
            Log in to access your MarketSphere customer or seller account
          </p>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium text-rose-700 animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Email Address *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input 
                type="email" 
                placeholder="you@domain.com"
                className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input 
                type="password" 
                placeholder="••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-4 focus:ring-amber-100 outline-none transition text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50/30"
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-extrabold py-3.5 rounded-2xl transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50 text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-2">
          <p className="text-xs text-slate-600">
            Don't have an account?{' '}
            <Link to="/register" className="text-amber-600 font-bold hover:underline">
              Create an account
            </Link>
          </p>
          <p className="text-[11px] text-slate-400">
            Forgot password or need help? Contact support@marketsphere.com
          </p>
        </div>
      </div>
    </div>
  );
}

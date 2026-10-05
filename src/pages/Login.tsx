import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (user) navigate('/app/dashboard'); }, [user, navigate]);

  const reset = () => {
    setLoginId('');
    setPassword('');
    setError('');
    setSubmitting(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    const result = await login(loginId, password);
    if (result.ok) navigate('/app/dashboard');
    else {
      setSubmitting(false);
      setError(result.error || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f4f4] lg:grid lg:grid-cols-[58.3%_41.7%]">
      <div className="relative hidden min-h-screen overflow-hidden bg-[#0579b6] lg:flex lg:items-center lg:justify-center">
        <div className="px-12 text-center text-5xl font-bold leading-tight text-white">D-Mills Global<br />Private Limited</div>
      </div>

      <main className="flex min-h-screen items-start justify-center bg-white px-12 pt-[18vh] lg:px-[8vw]">
        <div className="w-full max-w-[465px]">
          <div className="mb-14 text-center">
            <div className="text-3xl font-black text-[#151515]">D-Mills Global Private Limited</div>
            <div className="mt-2 text-base text-[#333]">Omni-channel OMS &amp; WMS</div>
          </div>

          <form name="loginForm" onSubmit={submit} onReset={reset} className="space-y-8">
            <label className="flex items-center border-b-2 border-[#dedede] pb-2 text-[#9d9d9d] focus-within:border-[#269bd2]">
              <UserRound size={29} strokeWidth={1.2} />
              <input id="userName" name="userName" autoComplete="off" autoFocus aria-label="Login Id" placeholder="Login Id" value={loginId} onChange={(event) => setLoginId(event.target.value)} className="w-full bg-transparent px-3 py-1 text-base text-[#444] outline-none placeholder:text-[#aaa]" />
            </label>

            <label className="flex items-center border-b-2 border-[#dedede] pb-2 text-[#9d9d9d] focus-within:border-[#269bd2]">
              <LockKeyhole size={29} strokeWidth={1.2} />
              <input id="password" type="password" autoComplete="off" aria-label="Password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent px-3 py-1 text-base text-[#444] outline-none placeholder:text-[#aaa]" />
              <span className="text-xs text-[#555]">Contact your administrator to reset access.</span>
            </label>

            {error && <div role="alert" className="text-sm text-rose-600">{error}</div>}

            <div className="grid grid-cols-2 gap-4 px-14 pt-1">
              <button type="submit" disabled={submitting} className="h-11 rounded-lg bg-gradient-to-r from-[#c51e4d] to-[#2256ac] text-xl text-white disabled:opacity-60">Login</button>
              <button type="reset" className="h-11 rounded-lg bg-[#5a5b5d] text-xl text-white">Reset</button>
            </div>
          </form>

          <p className="mt-12 text-center text-sm text-slate-500">© 2026 D-Mills Global Private Limited</p>
        </div>
      </main>
    </div>
  );
}

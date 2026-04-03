import { LoginForm } from '@/components/auth/LoginForm'
import { Zap } from 'lucide-react'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center">
            <Zap size={15} className="text-[#22c55e]" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Yatsar</span>
          <span className="text-white/20 text-sm font-medium">SEO</span>
        </div>

        {/* Card */}
        <div className="bg-[#141414] border border-white/8 rounded-xl p-8">
          <h1 className="text-white font-bold text-xl mb-1">Welcome back</h1>
          <p className="text-white/40 text-sm mb-6">Sign in to your dashboard</p>
          <LoginForm />
        </div>
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  change?: number
  suffix?: string
  className?: string
}

export function StatCard({ label, value, change, suffix, className }: StatCardProps) {
  return (
    <div className={cn('bg-[#13151c] border border-white/5 rounded-xl p-5', className)}>
      <div className="text-xs text-slate-500 mb-2">{label}</div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-semibold text-white">
          {value}{suffix}
        </span>
        {change !== undefined && (
          <div className={cn('flex items-center gap-0.5 text-xs pb-0.5', change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
    </div>
  )
}

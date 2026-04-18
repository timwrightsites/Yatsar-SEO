import { ReviewQueueList } from '@/components/review-queue/ReviewQueueList'

export const dynamic = 'force-dynamic'

export default function ReviewQueuePage() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      <div className="mb-8">
        <h1 className="text-white font-bold text-3xl">Review Queue</h1>
        <p className="text-white/40 text-sm mt-1">
          Everything agents are waiting on — approve, reject, or edit before it goes out.
        </p>
      </div>

      <ReviewQueueList />
    </div>
  )
}

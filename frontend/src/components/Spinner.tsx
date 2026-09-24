export function Spinner({ size = 30 }: { size?: number }) {
  return (
    <span className="spin spinner" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite" aria-label={label}>
      <div className="loading-box">
        <Spinner />
      </div>
    </div>
  )
}

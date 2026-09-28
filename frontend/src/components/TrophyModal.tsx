import { useEffect } from 'react'
import type { RecentTrophy } from '../types'
import { formatDate } from '../format'
import { SourceTag } from './PlatformTag'

const GRADE_FILL: Record<'bronze' | 'silver' | 'gold' | 'platinum', string> = {
  bronze: 'var(--bronze)',
  silver: 'var(--silver)',
  gold: 'var(--gold)',
  platinum: 'var(--plat)',
}
const CUP_PATH =
  'M5 4h14v2h2v3a4 4 0 0 1-4 4h-.2A5 5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A5 5 0 0 1 7.2 13H7a4 4 0 0 1-4-4V6h2V4Zm0 4v1a2 2 0 0 0 2 2V8H5Zm14 0h-2v3a2 2 0 0 0 2-2V8Z'

function Cup({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true">
      <path d={CUP_PATH} />
    </svg>
  )
}

function rarityLabel(rarity?: number): string | null {
  if (rarity == null) return null
  if (rarity <= 5) return 'Ultra Rare'
  if (rarity <= 15) return 'Very Rare'
  if (rarity <= 40) return 'Rare'
  return 'Common'
}

function typeLabel(t: RecentTrophy): string {
  if (t.type) return t.type.charAt(0).toUpperCase() + t.type.slice(1)
  return t.provider === 'steam' ? 'Achievement' : 'Trophy'
}

export function TrophyModal({ trophy, onClose }: { trophy: RecentTrophy; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const glow = trophy.type ?? trophy.provider
  const rarity = rarityLabel(trophy.rarity)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trophy-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="trophy-modal-hero">
          {trophy.gameIconUrl ? (
            <div
              className="trophy-modal-hero-bg"
              style={{ backgroundImage: `url(${trophy.gameIconUrl})` }}
            />
          ) : null}
          {trophy.iconUrl ? (
            <img className={`trophy-modal-icon tt-glow-${glow}`} src={trophy.iconUrl} alt="" />
          ) : (
            <div className="trophy-modal-icon trophy-modal-icon-empty">
              {trophy.name.slice(0, 1)}
            </div>
          )}
        </div>

        <div className="trophy-modal-body">
          <h2 className="trophy-modal-name">{trophy.name}</h2>

          <div className="trophy-modal-badges">
            <span className="trophy-type-icon" title={typeLabel(trophy)}>
              <Cup color={trophy.type ? GRADE_FILL[trophy.type] : 'var(--text-dim)'} size={22} />
            </span>
            {rarity ? (
              <span className="trophy-rarity-label">
                {rarity}
                {trophy.rarity != null ? ` · ${trophy.rarity}%` : ''}
              </span>
            ) : null}
          </div>

          {trophy.detail ? <p className="trophy-modal-desc">{trophy.detail}</p> : null}

          <div className="trophy-modal-game">
            {trophy.gameIconUrl ? (
              <img
                className="trophy-modal-game-cover"
                src={trophy.gameIconUrl}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="trophy-modal-game-cover trophy-modal-game-cover-empty">
                {trophy.gameTitle.slice(0, 1)}
              </div>
            )}
            <div className="trophy-modal-game-info">
              <span className="trophy-modal-game-title">{trophy.gameTitle}</span>
              <span className="trophy-modal-game-sub">
                <SourceTag provider={trophy.provider} platform={trophy.platform} />
                {trophy.earnedAt ? <span>Earned {formatDate(trophy.earnedAt)}</span> : null}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

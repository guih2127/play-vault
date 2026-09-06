import { useEffect } from 'react'
import type { RecentTrophy } from '../types'
import { formatDate, providerLabel } from '../format'

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
            <span className={`trophy-type trophy-type-${trophy.type ?? 'steam'}`}>
              {typeLabel(trophy)}
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
                <span className={`src-tag src-${trophy.provider}`}>
                  {providerLabel(trophy.provider)}
                </span>
                {trophy.earnedAt ? <span>Earned {formatDate(trophy.earnedAt)}</span> : null}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

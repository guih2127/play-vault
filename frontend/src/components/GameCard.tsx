import { useEffect, useState } from 'react'
import type { AggregatedGame, DlcGroup, TrophySet } from '../types'
import { badgeClass, formatDate, formatHours } from '../format'

export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0
}

function isPlatinum(game: AggregatedGame): boolean {
  return game.platinum.earned > 0
}

function playtimeText(game: AggregatedGame): string {
  return game.playtimeKnown ? formatHours(game.totalPlaytimeMinutes) : 'playtime unknown'
}

function PlatinumTrophy({ className }: { className?: string }) {
  return (
    <svg
      className={`plat-trophy ${className ?? ''}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"
      />
    </svg>
  )
}

function PlatformBadges({ labels }: { labels: string[] }) {
  return (
    <div className="badges badges-left">
      {labels.map((p) => (
        <span key={p} className={`badge ${badgeClass(p)}`}>
          {p}
        </span>
      ))}
    </div>
  )
}

export function GameCard({
  game,
  onOpen,
}: {
  game: AggregatedGame
  onOpen: (key: string) => void
}) {
  const platinum = isPlatinum(game)
  const beaten = platinum || !!game.beaten
  const playing = !!game.playing
  return (
    <div className="card game" onClick={() => onOpen(game.key)}>
      <div className="cover">
        {game.coverUrl ? (
          <img src={game.coverUrl} alt={game.title} loading="lazy" />
        ) : (
          <div className="cover-fallback">{game.title.slice(0, 1)}</div>
        )}
        <PlatformBadges labels={game.platformLabels} />
        {platinum || beaten || playing ? (
          <div className="badges badges-bottom">
            {platinum ? (
              <span className="status-tag status-tag-plat">
                <PlatinumTrophy /> Platinum
              </span>
            ) : null}
            {beaten ? <span className="status-tag status-tag-beaten">✓ Beaten</span> : null}
            {playing && !beaten ? (
              <span className="status-tag status-tag-playing">▶ Playing</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="game-info">
        <div className="game-title" title={game.title}>
          {game.title}
        </div>
        <div className="game-meta">{playtimeText(game)}</div>
      </div>
    </div>
  )
}

export function GameModal({
  game,
  onClose,
  onToggleBeaten,
  onTogglePlaying,
  onRate,
  onDelete,
}: {
  game: AggregatedGame
  onClose: () => void
  onToggleBeaten: (key: string, beaten: boolean) => void | Promise<void>
  onTogglePlaying: (key: string, playing: boolean) => void | Promise<void>
  onRate: (key: string, rating: number) => void | Promise<void>
  onDelete?: (key: string) => void | Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const platinum = isPlatinum(game)
  const beaten = platinum || !!game.beaten
  const playing = !!game.playing
  const platImg = game.trophySets.find((s) => s.platinumIconUrl)?.platinumIconUrl

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleBeaten = async () => {
    if (platinum) return
    setSaving(true)
    try {
      await onToggleBeaten(game.key, !game.beaten)
    } finally {
      setSaving(false)
    }
  }

  const togglePlaying = async () => {
    setSaving(true)
    try {
      await onTogglePlaying(game.key, !playing)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div
          className="modal-banner"
          style={game.coverUrl ? { backgroundImage: `url(${game.coverUrl})` } : undefined}
        >
          <div className="modal-hero">
            <h2 className="modal-title">{game.title}</h2>
            <div className="modal-platforms">
              {game.platformLabels.map((p) => (
                <span key={p} className={`badge ${badgeClass(p)}`}>
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-content">
          <div className="modal-sub">
            <span>
              {game.playtimeKnown
                ? `${formatHours(game.totalPlaytimeMinutes)} played`
                : 'Playtime unknown'}
              {game.lastPlayed ? ` · last: ${formatDate(game.lastPlayed)}` : ''}
            </span>
            {game.genres.length ? (
              <span className="modal-genres">{game.genres.join(' · ')}</span>
            ) : null}
          </div>

          {platinum || beaten || playing ? (
            <div className="modal-tags">
              {platinum ? (
                <span className="status-tag status-tag-plat">
                  <PlatinumTrophy /> Platinum
                </span>
              ) : null}
              {beaten ? <span className="status-tag status-tag-beaten">✓ Beaten</span> : null}
              {playing && !beaten ? (
                <span className="status-tag status-tag-playing">▶ Playing</span>
              ) : null}
            </div>
          ) : null}

          <div className="rating-block">
            <span className="rating-label">Your rating</span>
            <StarRating value={game.rating ?? 0} onChange={(v) => onRate(game.key, v)} />
          </div>

          <div className="modal-body">
            {platImg ? (
              <div className="plat-showcase">
                <img className="plat-img" src={platImg} alt="Platinum trophy" />
                <div className="plat-showcase-info">
                  <div className="plat-showcase-title">
                    <PlatinumTrophy /> Platinum earned
                  </div>
                  {game.platinumEarnedAt ? (
                    <div className="detail-row">{formatDate(game.platinumEarnedAt)}</div>
                  ) : null}
                  {game.platinum.total > 1 ? (
                    <div className="detail-row">
                      {game.platinum.earned}/{game.platinum.total} versions platinumed
                    </div>
                  ) : null}
                </div>
              </div>
            ) : game.platinum.total > 1 ? (
              <div className="platinum-line">
                <PlatinumTrophy /> {game.platinum.earned}/{game.platinum.total} platinums
              </div>
            ) : null}
            {game.trophySets.length ? (
              game.trophySets.map((set, i) => (
                <TrophySetBar key={i} set={set} showLabel={game.trophySets.length > 1} />
              ))
            ) : (
              <div className="detail-row">
                {game.manual ? 'Manually added game.' : 'No trophies recorded.'}
              </div>
            )}
          </div>

          {!beaten ? (
            <button
              className={`playing-btn ${playing ? 'playing-btn-on' : ''}`}
              onClick={togglePlaying}
              disabled={saving}
            >
              {playing ? '▶ Stop playing' : '▶ Mark as currently playing'}
            </button>
          ) : null}
          <button className="beaten-btn" onClick={toggleBeaten} disabled={platinum || saving}>
            {platinum ? 'Platinum (beaten)' : game.beaten ? 'Unmark as beaten' : 'Mark as beaten'}
          </button>
          {game.manual && onDelete ? (
            <button className="delete-btn" onClick={() => onDelete(game.key)}>
              Remove game
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = shown >= n ? 100 : shown >= n - 0.5 ? 50 : 0
        return (
          <span key={n} className="star-wrap">
            <span className="star-bg">★</span>
            <span className="star-fill" style={{ width: `${fill}%` }}>
              ★
            </span>
            <button
              className="star-half left"
              onMouseEnter={() => setHover(n - 0.5)}
              onClick={() => onChange(value === n - 0.5 ? 0 : n - 0.5)}
              aria-label={`${n - 0.5}`}
            />
            <button
              className="star-half right"
              onMouseEnter={() => setHover(n)}
              onClick={() => onChange(value === n ? 0 : n)}
              aria-label={`${n}`}
            />
          </span>
        )
      })}
      {value ? <span className="stars-clear">{value}/5</span> : null}
    </div>
  )
}

function TrophySetBar({ set, showLabel }: { set: TrophySet; showLabel: boolean }) {
  const groups = set.groups && set.groups.length > 1 ? set.groups : null
  return (
    <div className="trophy">
      <div className="trophy-head">
        {showLabel ? <span className="trophy-plat">{set.label}</span> : <span />}
        <span className="trophy-label">
          🏆 {set.earned}/{set.total}
          {set.platinumEarned > 0 ? <PlatinumTrophy className="inline-plat" /> : null}
        </span>
      </div>
      {groups ? groups.map((g, i) => <GroupRow key={i} group={g} />) : <Bar pct={set.progress} />}
    </div>
  )
}

function GroupRow({ group }: { group: DlcGroup }) {
  return (
    <div className="group-row">
      <div className="group-meta">
        <span className="group-name">{group.isBase ? 'Base game' : group.name}</span>
        <span>
          {group.earned}/{group.total}
        </span>
      </div>
      <Bar pct={pct(group.earned, group.total)} />
    </div>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar">
      <div className="bar-fill trophy-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

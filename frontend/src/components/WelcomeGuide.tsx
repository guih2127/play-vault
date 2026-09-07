import { Spinner } from './Spinner'

/**
 * First-run guide shown on the Overview before the user has any synced games. Walks them
 * through the two steps that get data into the app: connect an account, then sync.
 */
export function WelcomeGuide({
  hasConnection,
  syncing,
  onConnect,
  onSync,
}: {
  hasConnection: boolean
  syncing: boolean
  onConnect: () => void
  onSync: () => void
}) {
  return (
    <div className="welcome">
      <h2 className="welcome-title">Welcome to PlayVault 👋</h2>
      <p className="welcome-sub">Two quick steps to bring your games and trophies together.</p>

      <ol className="welcome-steps">
        <li className={`welcome-step ${hasConnection ? 'welcome-step-done' : ''}`}>
          <span className="welcome-step-num">{hasConnection ? '✓' : '1'}</span>
          <div className="welcome-step-body">
            <div className="welcome-step-title">Connect an account</div>
            <div className="welcome-step-desc">Link your PlayStation, Steam or Xbox account.</div>
          </div>
          <button className="welcome-cta" onClick={onConnect}>
            {hasConnection ? 'Add another' : 'Connect'}
          </button>
        </li>

        <li className="welcome-step">
          <span className="welcome-step-num">2</span>
          <div className="welcome-step-body">
            <div className="welcome-step-title">Sync your library</div>
            <div className="welcome-step-desc">
              We pull in your games, trophies and playtime — the first sync can take a minute.
            </div>
          </div>
          <button
            className="welcome-cta"
            onClick={onSync}
            disabled={!hasConnection || syncing}
            title={hasConnection ? undefined : 'Connect an account first'}
          >
            {syncing ? (
              <span className="welcome-cta-busy">
                <Spinner size={16} />
                Syncing…
              </span>
            ) : (
              'Sync now'
            )}
          </button>
        </li>
      </ol>
    </div>
  )
}

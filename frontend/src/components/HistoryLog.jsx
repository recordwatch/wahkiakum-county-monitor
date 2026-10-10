import { formatCountyDate, formatTime, pacificDay, aboutDuration } from '../format'

// Bookings are grouped by the county's booking DATE (it has no time).
// Releases are grouped by the Pacific day we detected them.
export default function HistoryLog({ entries, search, windowDays }) {
  const days = {}
  const day = k => (days[k] ||= { booked: [], released: [] })

  entries.forEach(e => {
    if (e.bookingDate) day(e.bookingDate).booked.push(e)
    if (e.status === 'released' && e.releasedAt) day(pacificDay(e.releasedAt)).released.push(e)
  })
  const sorted = Object.keys(days).sort().reverse()

  if (!sorted.length) {
    return <div className="empty">{search ? 'No records match your search.' : 'Nothing recorded yet.'}</div>
  }

  return (
    <div className="history-log">
      <div className="history-header">
        <h2>Booked and Released Log</h2>
        <p className="history-subtitle">Newest first · releases from the last {windowDays} days</p>
      </div>

      {sorted.map(date => {
        const { booked, released } = days[date]
        return (
          <div key={date} className="history-day">
            <div className="history-date">{formatCountyDate(date)}</div>

            {booked.length > 0 && (
              <div className="history-section">
                <div className="history-section-title">Booked ({booked.length})</div>
                <ul className="history-list">
                  {booked.map(e => (
                    <li key={e.bookingNumber} className="history-item">
                      <span className="history-name">{e.name}</span>
                      <span className="history-meta">
                        Booking #{e.bookingNumber}
                        {e.seenOnFirstRun && ' · already in custody when monitoring began'}
                        {e.charges?.length > 0 && (
                          <span className="history-charges">Charges: {e.charges.map(c => c.violation).join(', ')}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {released.length > 0 && (
              <div className="history-section">
                <div className="history-section-title">Released ({released.length})</div>
                <ul className="history-list">
                  {released.map(e => {
                    const held = aboutDuration(e.bookingDate, e.releasedAt)
                    return (
                      <li key={e.bookingNumber} className="history-item">
                        <span className="history-name">{e.name}</span>
                        <span className="history-meta">
                          Gone from the roster between {formatTime(e.lastSeenInCustodyAt)} and {formatTime(e.releasedAt)} (detected)
                          {held && <span className="history-time-served"> · Held {held}</span>}
                          {e.charges?.length > 0 && (
                            <span className="history-charges">Charges: {e.charges.map(c => c.violation).join(', ')}</span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

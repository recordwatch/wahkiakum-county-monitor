import { useState } from 'react'
import {
  formatCountyDate, formatDateTime, aboutDuration, aboutDaysSince,
  formatMoney, formatHeight, formatRace, formatSex,
} from '../format'

// Notes about records that may be out of date. In-custody only: a release
// doesn't go stale.
function staleNote(e) {
  if (e.status !== 'in_custody') return null
  if (e.missingSince) {
    return `Not on the county's roster since ${formatDateTime(e.missingSince)}, but the county's detail page didn't confirm a release. Status may be out of date.`
  }
  if (e.detailStatus === 'failed') {
    return `The county's detail page couldn't be read on the last check${e.detailFetchedAt ? `; details shown are from ${formatDateTime(e.detailFetchedAt)}` : ''}.`
  }
  if (e.detailStatus === 'disagrees') {
    return "The county's roster lists this person, but its detail page says released. Status may be out of date."
  }
  return null
}

function Field({ label, value }) {
  return (
    <div className="desc-row">
      <span>{label}</span><span>{value ?? 'N/A'}</span>
    </div>
  )
}

export default function BookingCard({ entry: e }) {
  const [open, setOpen] = useState(false)
  const isReleased = e.status === 'released'
  const held = isReleased ? aboutDuration(e.bookingDate, e.releasedAt) : aboutDaysSince(e.bookingDate)
  const note = staleNote(e)

  return (
    <div className={`card ${isReleased ? 'card-released' : 'card-custody'}`}>
      <div className="card-header" onClick={() => setOpen(!open)}>
        <div className="card-left">
          <div className="card-name">{e.name}</div>
          <div className="card-meta">
            Booking #{e.bookingNumber} &nbsp;·&nbsp; Booked {formatCountyDate(e.bookingDate) || 'date unknown'}
            {held && <span className="card-time-held"> &nbsp;·&nbsp; {isReleased ? 'Held' : 'In custody'} {held}</span>}
          </div>
        </div>
        <div className="card-right">
          <span className={`badge ${isReleased ? 'badge-released' : 'badge-custody'}`}>
            {isReleased ? 'Released' : 'In Custody'}
          </span>
          <span className="card-toggle">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="card-body">
          {note && <div className="card-note">{note}</div>}

          {isReleased && (
            <div className="card-release-row">
              Released between {formatDateTime(e.lastSeenInCustodyAt)} and {formatDateTime(e.releasedAt)}
              <span className="approx"> (detected; the county doesn't publish release times)</span>
            </div>
          )}
          {!isReleased && e.schedRelease && (
            <div className="card-release-row">Scheduled release (county): {formatCountyDate(e.schedRelease)}</div>
          )}

          <div className="card-description">
            <Field label="Age" value={e.age} />
            <Field label="Sex" value={formatSex(e.sex)} />
            <Field label="Race" value={formatRace(e.race)} />
            <Field label="Height" value={formatHeight(e.height)} />
            <Field label="Weight" value={e.weight ? `${e.weight} lbs` : null} />
            <Field label="Hair" value={e.hair} />
            <Field label="Eyes" value={e.eyes} />
          </div>

          {e.charges?.length > 0 && (
            <div className="card-charges">
              <div className="charges-title">Charges ({e.charges.length})</div>
              {e.charges.map((c, i) => (
                <div key={i} className="charge-row">
                  <div className="charge-violation">
                    {c.violation}
                    {c.addDesc && <span className="charge-add-desc"> — {c.addDesc}</span>}
                    {c.level && <span className="charge-level">Level {c.level}</span>}
                    {c.cleared && <span className="charge-cleared"> ✓ Cleared</span>}
                  </div>
                  {(c.bondAmount > 0 || c.cashAmount > 0) && (
                    <div className="charge-bail">
                      Bail set{c.bondBailType ? ` (${c.bondBailType})` : ''}: {formatMoney(c.bondAmount)}
                      {c.cashAmount > 0 && <> &nbsp;·&nbsp; Cash: {formatMoney(c.cashAmount)}</>}
                    </div>
                  )}
                  {c.nextCourtDate && <div className="charge-court">Next court date: {formatCountyDate(c.nextCourtDate)}</div>}
                  {c.arrestAgency && <div className="charge-agency">Arresting agency: {c.arrestAgency}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

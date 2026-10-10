import { formatCountyDate, formatDateTime, formatMoney } from '../format'

// Every number on this page comes from data/stats.json, which holds counts
// only. Each card shows its n; the header shows the date range and "as of".

function Card({ title, n, unit = 'bookings', note, children }) {
  return (
    <div className="stats-card">
      <h3 className="stats-section-title">{title}</h3>
      {n !== undefined && <div className="stats-meta">n = {n} {unit}</div>}
      {note && <div className="stats-card-note">{note}</div>}
      {children}
    </div>
  )
}

function NoData({ children = 'Not enough data yet.' }) {
  return <div className="stats-nodata">{children}</div>
}

function CountTable({ rows, showPct = false }) {
  if (!rows?.length) return <NoData />
  const max = Math.max(...rows.map(r => r.count))
  return (
    <table className="stats-table">
      <tbody>
        {rows.map(r => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="bar-cell"><div className="bar" style={{ width: `${(r.count / max) * 100}%` }} /></td>
            <td className="stats-table-num">{r.count}</td>
            {showPct && <td className="stats-table-pct">{r.pct}%</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Box({ num, label, sub }) {
  return (
    <div className="stat-box">
      <div className="stat-box-num">{num ?? '—'}</div>
      <div className="stat-box-label">{label}</div>
      {sub && <div className="stat-box-sub">{sub}</div>}
    </div>
  )
}

export default function Stats({ data: s }) {
  const c = s.bookingCounts
  const range = s.bookingDateRange
  return (
    <div className="stats-page">
      <div className="stats-header">
        <h2>Jail Statistics</h2>
        <p className="stats-subtitle">
          As of {formatDateTime(s.generatedAt)} · monitoring since {formatDateTime(s.trackingSince)}
        </p>
        {range?.from && (
          <p className="stats-subtitle">
            Booking dates {formatCountyDate(range.from)} – {formatCountyDate(range.to)}
          </p>
        )}
      </div>

      <div className="notice">
        This is a very small jail (usually under ten people), so every number here rests on a handful
        of bookings and can swing a lot from one person. Monitoring started recently, so anyone booked
        before then only appears if they were still in custody on the first day.
      </div>

      <Card title="Overview">
        <div className="stat-boxes">
          <Box num={c.total} label="Bookings seen" />
          <Box num={c.inCustody} label="In custody" />
          <Box num={c.released} label="Released" />
          <Box num={c.launchCohort} label="Already held on day one" />
        </div>
      </Card>

      <Card
        title="Length of stay (released only)"
        n={s.stay.n}
        note={s.stay.n ? `Median about ${s.stay.medianDays} days · mean about ${s.stay.meanDays} days. All values are approximate.` : undefined}
      >
        {s.stay.n ? <CountTable rows={s.stay.histogram.filter(r => r.count > 0)} /> : <NoData>No releases recorded yet.</NoData>}
        <ul className="stats-caveats">{s.stay.caveats.map(t => <li key={t}>{t}</li>)}</ul>
      </Card>

      <div className="stats-grid-2">
        <Card title="Sex" n={s.gender.n}><CountTable rows={s.gender.rows} showPct /></Card>
        <Card title="Race" n={s.race.n} note="As recorded by the county."><CountTable rows={s.race.rows} showPct /></Card>
      </div>

      <Card title="Age" n={s.age.n} note={s.age.note}>
        {s.age.n ? (
          <>
            <div className="stats-age-meta"><span>Median {s.age.median}</span><span>Mean {s.age.mean}</span></div>
            <CountTable rows={s.age.histogram.filter(r => r.count > 0)} />
          </>
        ) : <NoData />}
      </Card>

      <Card title="Charge categories" n={s.topCharges.n} note="Each booking counts once per category. Categories are our grouping of the county's charge text.">
        <CountTable rows={s.topCharges.rows} />
      </Card>

      <div className="stats-grid-2">
        <Card title="Crime type" n={s.crimeTypes.n} note="Our grouping of the categories above.">
          <CountTable rows={s.crimeTypes.rows} />
        </Card>
        <Card title="County charge level" n={s.chargeLevels.n} unit="charges" note={`${s.chargeLevels.note} The county doesn't publish what each code means.`}>
          <CountTable rows={s.chargeLevels.rows} />
        </Card>
      </div>

      <Card title="Arresting agency" n={s.agencies.n} note={s.agencies.note}>
        <CountTable rows={s.agencies.rows} />
      </Card>

      <Card title="Bail set" n={s.bail.n} note={s.bail.note}>
        <div className="stat-boxes">
          <Box num={s.bail.withBailSet} label="With bail set" />
          <Box num={s.bail.noBailAmount} label="No bail amount" />
          <Box num={formatMoney(s.bail.median)} label="Median (highest per booking)" />
        </div>
      </Card>

      <div className="stats-grid-2">
        <Card title="Bookings by month" note={`By county booking date, from ${formatCountyDate(s.bookingsByMonth.since) || 'the first check'} on.`}>
          <CountTable rows={s.bookingsByMonth.rows.map(r => ({ label: r.month, count: r.count }))} />
        </Card>
        <Card title="Repeat bookings" note={s.repeatBookings.note}>
          <div className="stat-boxes">
            <Box num={s.repeatBookings.people} label="People" />
            <Box num={s.repeatBookings.withMoreThanOneBooking} label="Booked more than once" />
          </div>
        </Card>
      </div>
    </div>
  )
}

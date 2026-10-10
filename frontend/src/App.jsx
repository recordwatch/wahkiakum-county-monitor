import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import Header from './components/Header'
import StatBar from './components/StatBar'
import BookingCard from './components/BookingCard'
import HistoryLog from './components/HistoryLog'
import Stats from './components/Stats'
import About from './components/About'
import Footer from './components/Footer'
import { formatCountyDate, pacificDay } from './format'

function useJSON(file) {
  const [state, setState] = useState({ data: null, error: null })
  useEffect(() => {
    let alive = true
    fetch(`./data/${file}`, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => alive && setState({ data, error: null }))
      .catch(err => alive && setState({ data: null, error: err.message }))
    return () => { alive = false }
  }, [file])
  return state
}

function Nav({ search, setSearch, showSearch = true }) {
  return (
    <div className="controls">
      {showSearch && (
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
      )}
      <div className="filter-tabs">
        <NavLink to="/" end>In Custody</NavLink>
        <NavLink to="/released">Released</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/stats">Stats</NavLink>
        <NavLink to="/about">About</NavLink>
      </div>
    </div>
  )
}

function Loading({ error }) {
  if (error) return <div className="empty">Couldn't load the roster data ({error}). Try refreshing in a minute.</div>
  return <div className="loading">Loading records...</div>
}

function Layout({ children, status }) {
  return (
    <div className="app">
      <Header />
      {status && <StatBar status={status} />}
      {children}
      <Footer status={status} />
    </div>
  )
}

const byName = search => e => (e.name || '').toLowerCase().includes(search.trim().toLowerCase())

function groupBy(entries, keyFn) {
  const groups = []
  const index = {}
  for (const e of entries) {
    const k = keyFn(e)
    if (!index[k]) { index[k] = []; groups.push({ key: k, entries: index[k] }) }
    index[k].push(e)
  }
  return groups
}

function CardList({ entries, groupKey, groupLabel, emptyText }) {
  if (!entries.length) return <div className="empty">{emptyText}</div>
  return (
    <div className="log">
      <div className="log-count">{entries.length} record{entries.length !== 1 ? 's' : ''}</div>
      {groupBy(entries, groupKey).map(g => (
        <div key={g.key}>
          <div className="date-separator">{groupLabel(g.key)}</div>
          {g.entries.map(e => <BookingCard key={e.bookingNumber} entry={e} />)}
        </div>
      ))}
    </div>
  )
}

function InCustodyPage({ roster, status }) {
  const [search, setSearch] = useState('')
  const entries = (roster.data?.records || [])
    .filter(e => e.status === 'in_custody')
    .sort((a, b) => (b.bookingDate || '').localeCompare(a.bookingDate || ''))
    .filter(byName(search))
  return (
    <Layout status={status}>
      <Nav search={search} setSearch={setSearch} />
      {!roster.data ? <Loading error={roster.error} /> : (
        <CardList
          entries={entries}
          groupKey={e => e.bookingDate || ''}
          groupLabel={k => `Booked ${formatCountyDate(k) || 'date unknown'}`}
          emptyText={search ? 'No records match your search.' : 'No one is listed in custody right now.'}
        />
      )}
    </Layout>
  )
}

function ReleasedPage({ roster, status }) {
  const [search, setSearch] = useState('')
  const entries = (roster.data?.records || [])
    .filter(e => e.status === 'released')
    .sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt))
    .filter(byName(search))
  return (
    <Layout status={status}>
      <Nav search={search} setSearch={setSearch} />
      <div className="notice">
        Release times are <strong>detected</strong>: the county doesn't publish them, so each one is the
        first time we saw the person gone from the roster. The real release happened between the
        two times shown on each card. Releases older than {roster.data?.windowDays ?? 90} days aren't listed here.
      </div>
      {!roster.data ? <Loading error={roster.error} /> : (
        <CardList
          entries={entries}
          groupKey={e => pacificDay(e.releasedAt)}
          groupLabel={k => `Released ${formatCountyDate(k)}`}
          emptyText={search ? 'No records match your search.' : 'No releases recorded yet.'}
        />
      )}
    </Layout>
  )
}

function HistoryPage({ roster, status }) {
  const [search, setSearch] = useState('')
  return (
    <Layout status={status}>
      <Nav search={search} setSearch={setSearch} />
      {!roster.data ? <Loading error={roster.error} /> : (
        <HistoryLog entries={roster.data.records.filter(byName(search))} search={search} windowDays={roster.data.windowDays} />
      )}
    </Layout>
  )
}

function StatsPage({ status }) {
  const stats = useJSON('stats.json')
  return (
    <Layout status={status}>
      <Nav showSearch={false} />
      {!stats.data ? <Loading error={stats.error} /> : <Stats data={stats.data} />}
    </Layout>
  )
}

function AboutPage({ status }) {
  return (
    <Layout status={status}>
      <Nav showSearch={false} />
      <About status={status} />
    </Layout>
  )
}

export default function App() {
  const roster = useJSON('roster.json')
  const statusState = useJSON('status.json')
  const status = statusState.data
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<InCustodyPage roster={roster} status={status} />} />
        <Route path="/released" element={<ReleasedPage roster={roster} status={status} />} />
        <Route path="/history" element={<HistoryPage roster={roster} status={status} />} />
        <Route path="/stats" element={<StatsPage status={status} />} />
        <Route path="/about" element={<AboutPage status={status} />} />
        <Route path="*" element={<InCustodyPage roster={roster} status={status} />} />
      </Routes>
    </HashRouter>
  )
}


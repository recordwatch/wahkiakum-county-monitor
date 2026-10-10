import { Link } from 'react-router-dom'
import { formatDateTime } from '../format'

export default function Footer({ status }) {
  return (
    <footer className="footer">
      Source: Wahkiakum County public Web Jail Viewer. Independent monitor, not affiliated with the county.
      {status && <> Last checked {formatDateTime(status.lastUpdated)}.</>}
      {' '}<Link to="/about">How this works</Link>
    </footer>
  )
}

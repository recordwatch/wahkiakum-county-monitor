export default function About() {
  return (
    <div className="stats-card about">
      <h3 className="stats-section-title">About this site</h3>
      <p>
        This is an independent monitor of the Wahkiakum County jail roster. It is not run by or
        affiliated with Wahkiakum County or its Sheriff's Office. Inclusion on this site means a
        person was listed on the county's public jail roster. It does not mean they were convicted
        of anything.
      </p>

      <h3 className="stats-section-title">Where the data comes from</h3>
      <p>
        About every 30 minutes, a script reads the county's public Web Jail Viewer: the list of people
        currently in custody and each person's booking detail page. Names, booking dates, charges,
        bail amounts and arresting agencies are shown as the county lists them.
      </p>

      <h3 className="stats-section-title">What to keep in mind</h3>
      <p>
        <strong>Release times are estimates.</strong> The county only lists people currently in custody
        and doesn't publish release times. When someone disappears from the list and their detail page
        confirms the release, we record it. The real release happened between the last check that
        showed them and the first check that didn't.
      </p>
      <p>
        <strong>Stays are approximate.</strong> The county gives a booking date with no time, so stays
        are counted from midnight on the booking day and can be off by up to a day.
      </p>
      <p>
        <strong>Monitoring started October 2026.</strong> Anyone booked earlier only appears if they were
        still in custody when monitoring began.
      </p>
      <p>
        <strong>Bail is the amount set</strong> by the court for each charge, not bail posted.
      </p>
      <p>
        Records can be out of date if the county's site is unavailable. Cards say so when we couldn't
        confirm a record on the latest check.
      </p>
    </div>
  )
}

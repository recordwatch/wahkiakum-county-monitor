// test/mock-server.js
// A fake Wahkiakum Web Jail Viewer. Markup copies the structure of the real
// pages (captured 2026-10-09) with made-up people. Tests change `mock.state`
// between runs to create each scenario.

import http from 'http';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function makeInmate(n, overrides = {}) {
  return {
    bookingNumber: `B26${String(n).padStart(5, '0')}`,
    inmateId: `A${String(9000 + n).padStart(5, '0')}`,
    first: `FIRST${n}`, last: `LAST${n}`, middle: 'Q',
    race: 'W', sex: 'M', bookingDate: '09/01/2026', schRel: '', listRelease: '',
    age: 30 + n, height: '509', weight: 170,
    charges: [
      { violation: '9A.36.021(2)(A) - ASSAULT-2', level: 'B', addDesc: 'DOMESTIC VIOLENCE', agency: 'WCSO', arrestDate: '09/01/2026', bail: '$25,000.00', courtCase: '26-1-00001-35', nextCourt: '' },
      { violation: '69.50.401(2) - CONT SUB-MFG/DEL/POSS W/INT', level: 'F', addDesc: '', agency: 'WCSO', arrestDate: '09/01/2026', bail: '$0.00', courtCase: '', nextCourt: '01/01/1900' },
    ],
    ...overrides,
  };
}

function shell(title, body) {
  return `<!DOCTYPE html><html><head><title>${title} - Web Jail Viewer</title></head><body>
<nav class="navbar"><a class="navbar-brand" href="/">Web Jail Viewer</a></nav>
<div class="container body-content">${body}</div>
<footer><p>&copy; 2026 - Executive Information Services, Inc.</p></footer></body></html>`;
}

export function listPage(inmates, { total = inmates.length, omitTotal = false } = {}) {
  const rows = inmates.map((p, i) => `
        <tr>
            <td><a href="/Home/BookingSearchResult?LastName=%25&amp;BookingNumber=${i + 1}">View</a></td>
            <td>${esc(p.bookingNumber)}</td><td>${esc(p.first)}</td><td>${esc(p.last)}</td><td>${esc(p.middle)}</td>
            <td>01/01/1990</td><td>${esc(p.race)}</td><td>${esc(p.sex)}</td><td>${esc(p.bookingDate)}</td>
            <td>${esc(p.listRelease)}</td><td>${esc(p.schRel)}</td>
        </tr>`).join('');
  return shell('BookingSearchDetail', `
<h2>Inmate Database Search</h2><h3>Booking Search Results</h3>
<form><table class="table">
    <thead><tr>
        <th scope="col"></th><th scope="col"><a href="#">Booking #</a></th><th scope="col"><a href="#">First Name</a></th>
        <th scope="col"><a href="#">Last Name</a></th><th scope="col"><a href="#">Middle Name</a></th><th scope="col"><a href="#">DOB</a></th>
        <th scope="col"><a href="#">Race</a></th><th scope="col"><a href="#">Sex</a></th><th scope="col"><a href="#">Booking Date</a></th>
        <th scope="col"><a href="#">Release Date</a></th><th scope="col"><a href="#">Sch Rel Date</a></th>
    </tr></thead>
    <tbody>${rows}
    </tbody>
    </table>
</form>	${omitTotal ? '' : `<p2><b>   <h3>Total Candidates: <span class="text-warning">${total}</span></h3> </b><br /></p2>`}`);
}

function chargeBlock(c, n) {
  return `
                        <tr class="alert alert-dismissible alert-warning"><td rowspan="11"><p>${n}</p></td></tr>
                    <tr>
                        <td colspan="4"><p Class="text-primary">Violation: <span Class="text-danger"><strong>${esc(c.violation)} </strong></span></p></td>
                        <td colspan="1"><span class="text-primary">Level:</span> <strong>${esc(c.level)}</strong></td>
                    </tr>
                    <tr>
                        <td colspan="3"><span class="text-primary">Add. Desc.:</span> <strong>${esc(c.addDesc)}</strong></td>
                        <td colspan="2"><span class="text-primary">OBTS #:</span><strong> </strong></td>
                    </tr>
                    <tr>
                        <td colspan="2"><span class="text-primary">War.#:</span><strong> </strong></td>
                        <td colspan="2"><span class="text-primary">End Of Sentence Date:</span><strong> 01/01/1900</strong></td>
                        <td colspan="2"><span class="text-primary">Clearance: </span><strong></strong></td>
                    </tr>
                    <tr class="info"><td colspan="5"><span class="label label-primary">Arrest Information</span></td></tr>
                    <tr>
                        <td colspan="2"><span class="text-primary">Arrest Agency: </span><strong>${esc(c.agency)}</strong></td>
                        <td><span Class="text-primary">Case #:</span> <strong>260070</strong></td>
                        <td colspan = "2" ><span class="text-primary">Arrest Date: </span><strong>${esc(c.arrestDate)}</strong></td>
                    </tr>
                    <tr><td colspan="5"></td></tr>
                    <tr class="info"><td colspan="5"><span class="label label-primary">Court & Bail/Bond Information</span></td></tr>
                    <tr>
                        <td colspan="2"><span class="text-primary">Court Type: </span><strong></strong></td>
                        <td><span class="text-primary">Court Case #: </span><strong>${esc(c.courtCase)}</strong></td>
                        <td colspan = "2" ><span class="text-primary">Next Court Date </span><strong>${esc(c.nextCourt)}</strong></td>
                    </tr>
                    <tr>
                        <td colspan="2"><span class="text-primary">Req. Bond/Bail:</span> <strong>BAIL</strong></td>
                        <td colspan = "2" ><span class="text-primary">Bond Group #: </span><strong> 0</strong></td>
                        <td></td>
                    </tr>
                    <tr>
                        <td colspan="2"><span class="text-primary">Req. Bond Amt:</span><strong> ${esc(c.bail)}</strong></td>
                        <td colspan="2"><span class="text-primary">Req. Cash Amt: </span><strong>$0.00</strong></td>
                        <td><span class="text-primary">Bond Co. #:</span><strong> </strong></td>
                    </tr>`;
}

export function detailPage(p, { released = false, chargeCountOverride } = {}) {
  const v = released ? {} : p;
  const banner = released
    ? '<a Class="btn btn-success" href="#" style="float:right">RELEASED as of 10/09/26</a>'
    : '<a Class="btn btn-danger" href="#" style="float:right">IN CUSTODY as of 10/09/26</a>';
  const charges = released ? [] : p.charges;
  const count = chargeCountOverride ?? charges.length;
  return shell('BookingSearchDetail', `
<h1>Booking Search Detail</h1>
<div Class="panel panel-default">
    <div Class="panel-heading" valign="center"><h4>${esc(v.first)} ${esc(v.middle)} ${esc(v.last)} ${banner}</h4></div>
    <div Class="panel-body">
        <table style="width:100%;" border="0" class="table-condensed">
            <tr>
                <td colspan="1"><span class="text-primary">Booking Number: </span> <strong> ${esc(v.bookingNumber)}</strong></td>
                <td colspan="1"><span class="text-primary">Inmate ID:</span><strong> ${esc(v.inmateId)}</strong></td>
                <td colspan="2"><span class="text-primary">Booking Date: </span><strong>${esc(v.bookingDate)}</strong></td>
            </tr>
            <tr>
                <td colspan="1"><span class="text-primary">Location: </span><strong></strong></td>
                <td colspan="1"><span class="text-primary">Sched. Release: </span><strong>${esc(v.schRel)}</strong></td>
                <td colspan="2"><span class="text-primary">Released: </span><strong></strong></td>
            </tr>
            <tr Class="info"><td colspan = "4" ><span class="label label-primary">Personal Description </span></td></tr>
            <tr>
                <td><span class="text-primary">Date of Birth: </span><strong>${released ? '' : '01/01/1990'}</strong></td>
                <td><span class="text-primary">Age: </span><strong> ${esc(v.age)}</strong></td>
                <td><span class="text-primary">Sex: </span> <strong>${esc(v.sex)}</strong></td>
                <td><span class="text-primary">Race: </span> <strong> ${esc(v.race)}</strong></td>
            </tr>
            <tr>
                <td><span class="text-primary">Hair: </span><strong> ${released ? '' : 'BRO'}</strong></td>
                <td><span class="text-primary">Eyes: </span> <strong> ${released ? '' : 'BLU'}</strong></td>
                <td><span class="text-primary">Height: </span><strong> ${esc(v.height)}</strong></td>
                <td><span class="text-primary">Weight: </span> <strong>${esc(v.weight)}</strong></td>
            </tr>
        </table>
    </div>
</div>
<div Class="panel panel-default">
    <div Class="panel-heading"><h4>Charges: ${count}</h4></div>
    <div Class="panel-body">
        <table style="width:100%;" border="0" class="table-condensed">
            <tr>${charges.map((c, i) => chargeBlock(c, i + 1)).join('')}
        </table>
    </div>
</div>`);
}

export const REBUILD_PAGE = shell('Error', '<h2>Updating Information</h2><p>Please try again later.</p>');

/**
 * state: {
 *   roster: [inmate],                 who is on the list
 *   detainedNotListed: [inmate],      detail says IN CUSTODY but not on the list
 *   failures: { '<path-prefix>': n }  return 500 for the next n hits
 *   listOverride: html | null         serve this instead of the list
 *   listOptions: {}                   passed to listPage
 *   detailOptions: { bookingNumber: {} }
 * }
 */
export async function startMock() {
  const mock = {
    state: { roster: [], detainedNotListed: [], failures: {}, listOverride: null, listOptions: {}, detailOptions: {} },
    hits: [],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    mock.hits.push(url.pathname + url.search);
    const s = mock.state;
    for (const [prefix, n] of Object.entries(s.failures)) {
      if (n > 0 && url.pathname.startsWith(prefix)) {
        s.failures[prefix] = n - 1;
        res.writeHead(500); return res.end('Server Error');
      }
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/Home/BookingSearchResult') {
      if (url.searchParams.get('LastName') !== '%') { res.end(listPage([])); return; }
      res.end(s.listOverride ?? listPage(s.roster, s.listOptions));
      return;
    }
    if (url.pathname === '/Home/BookingSearchDetail') {
      const bn = url.searchParams.get('BookingNumber');
      const p = [...s.roster, ...s.detainedNotListed].find(x => x.bookingNumber === bn);
      res.end(p ? detailPage(p, s.detailOptions[bn]) : detailPage({}, { released: true }));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  mock.baseUrl = `http://127.0.0.1:${server.address().port}`;
  mock.close = () => new Promise(r => server.close(r));
  return mock;
}

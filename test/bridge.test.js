// Exercises the bridge's routes against a stubbed DB, so the auth guard,
// grouping, matching and payload shapes are verified without Postgres.
process.env.OPS_BRIDGE_KEY = 'test-secret-key';
const express = require('express');
const { createBridgeRouter } = require('../bridge.js');

// Two deals for Barings (one per event cycle), one for BlackRock, one cancelled.
const DEAL_ROWS = [
  { id: 1, title: 'Barings — Berlin', company: 'Barings LLC', contact_name: 'Jane Doe',
    amount: '4000.00', currency: 'GBP', stage: 'Won', notes: '', paid_inc_vat: '4800.00',
    tax_vat: '800.00', invoice_date: '2026-02-01', paid_date: '2026-02-14', bank: 'HSBC',
    invoice_number: 'INV-1042', invoice_agreement_sent: true, signature_received: true,
    initials: 'AB', deal_month: 'Feb', fiscal_year: 2026, stage_cancelled: false,
    is_flagged: false, created_at: '2026-01-05T00:00:00Z',
    events: [
      { event_id: 10, event_name: 'Berlin', event_date: '2026-05-12', location: 'Waldorf Astoria', allocated_amount: '2000.00', package_label: 'Gold' },
      { event_id: 11, event_name: 'CFO Miami', event_date: '2026-09-02', location: 'Four Seasons', allocated_amount: '2000.00', package_label: '' },
    ] },
  { id: 2, title: 'Barings renewal', company: 'Barings', contact_name: '', amount: '1500.00',
    currency: 'GBP', stage: 'Proposal', notes: '', paid_inc_vat: null, tax_vat: null,
    invoice_date: null, paid_date: null, bank: '', invoice_number: '',
    invoice_agreement_sent: false, signature_received: false, initials: '', deal_month: '',
    fiscal_year: 2027, stage_cancelled: false, is_flagged: false,
    created_at: '2026-03-01T00:00:00Z',
    events: [{ event_id: 12, event_name: 'Ops NYC', event_date: '2027-01-20', location: '', allocated_amount: '1500.00', package_label: 'Silver' }] },
  { id: 3, title: 'BlackRock', company: 'BlackRock', contact_name: '', amount: '9000.00',
    currency: 'USD', stage: 'Won', notes: '', paid_inc_vat: '9000.00', tax_vat: '0',
    invoice_date: null, paid_date: null, bank: '', invoice_number: '',
    invoice_agreement_sent: false, signature_received: false, initials: '', deal_month: '',
    fiscal_year: 2026, stage_cancelled: false, is_flagged: false,
    created_at: '2026-01-01T00:00:00Z',
    events: [{ event_id: 10, event_name: 'Berlin', event_date: '2026-05-12', location: '', allocated_amount: '9000.00', package_label: '' }] },
  { id: 4, title: 'Barings cancelled', company: 'Barings', contact_name: '', amount: '500.00',
    currency: 'GBP', stage: 'Lost', notes: '', paid_inc_vat: null, tax_vat: null,
    invoice_date: null, paid_date: null, bank: '', invoice_number: '',
    invoice_agreement_sent: false, signature_received: false, initials: '', deal_month: '',
    fiscal_year: 2026, stage_cancelled: true, is_flagged: false,
    created_at: '2026-01-02T00:00:00Z', events: [] },
];

async function q(sql) {
  if (/FROM deals d/i.test(sql) && /WHERE d\.id/i.test(sql)) return { rows: [DEAL_ROWS[0]] };
  if (/FROM deals d/i.test(sql)) return { rows: DEAL_ROWS };
  if (/SELECT\s+\(SELECT COUNT/i.test(sql)) return { rows: [{ deals: 4, events: 3, allocations: 4 }] };
  if (/FROM portfolio_events pe/i.test(sql)) {
    return { rows: [{ id: 10, name: 'Berlin', event_date: '2026-05-12', location: 'Waldorf', notes: '', deal_count: 2, allocated_total: '11000.00', allocated_paid: '11000.00' }] };
  }
  if (/FROM deal_events de/i.test(sql)) {
    return { rows: [{ deal_id: 1, company: 'Barings LLC', currency: 'GBP', stage: 'Won', paid_inc_vat: '4800.00', contact_name: 'Jane Doe', allocated_amount: '2000.00', package_label: 'Gold' }] };
  }
  throw new Error('unexpected SQL: ' + sql.slice(0, 60));
}

const app = express();
app.use('/api/bridge', createBridgeRouter({ q, ensureDb: async () => {} }));
const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api/bridge`;
  const KEY = { 'x-ops-key': 'test-secret-key' };
  let pass = 0, fail = 0;
  const check = (label, cond, detail) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  console.log('\nAuth');
  check('no key → 401', (await fetch(`${base}/ping`)).status === 401);
  check('wrong key → 401', (await fetch(`${base}/ping`, { headers: { 'x-ops-key': 'nope' } })).status === 401);
  check('bearer form accepted', (await fetch(`${base}/ping`, { headers: { authorization: 'Bearer test-secret-key' } })).status === 200);

  console.log('\nMatch: the Barings scenario');
  const m = await (await fetch(`${base}/match?name=Barings`, { headers: KEY })).json();
  const best = m.best;
  check('finds Barings', best?.company?.startsWith('Barings'), JSON.stringify(best?.company));
  check('exact match confidence', best?.exact === true, `confidence ${best?.confidence}`);
  check('groups both live deals, excludes the cancelled one', best?.deal_count === 2, `deal_count ${best?.deal_count}`);
  check('counts the cancelled deal separately', best?.cancelled_count === 1);
  check('rolls up 3 events', best?.event_count === 3, JSON.stringify(best?.events?.map(e => e.event_name)));
  const berlin = best?.events?.find(e => e.event_name === 'Berlin');
  check('Berlin allocation is 2000 (not BlackRock\'s 9000)', berlin?.allocated_amount === 2000, String(berlin?.allocated_amount));
  check('carries the package label', berlin?.package_labels?.includes('Gold'));
  check('GBP total is 5500 contracted', best?.totals?.[0]?.contracted === 5500, JSON.stringify(best?.totals));
  check('paid flagged', best?.has_payment === true);

  console.log('\nMatch: no false positives');
  const br = await (await fetch(`${base}/match?name=BlackRock`, { headers: KEY })).json();
  check('BlackRock resolves to BlackRock', br.best?.company === 'BlackRock', br.best?.company);
  check('BlackRock does not match Barings', !br.matches.some(x => x.company.startsWith('Barings')));
  const none = await (await fetch(`${base}/match?name=Zzyzx%20Holdings`, { headers: KEY })).json();
  check('unknown name → no matches', none.match_count === 0);
  check('blank name → 400', (await fetch(`${base}/match?name=`, { headers: KEY })).status === 400);

  console.log('\nCurrency handling');
  const all = await (await fetch(`${base}/companies`, { headers: KEY })).json();
  const brc = all.find(c => c.company === 'BlackRock');
  check('USD kept separate from GBP', brc?.totals?.length === 1 && brc.totals[0].currency === 'USD');
  const slim = await (await fetch(`${base}/companies?slim=1`, { headers: KEY })).json();
  check('slim carries deal_ids for reconcile', Array.isArray(slim[0]?.events?.[0]?.deal_ids));
  check('slim omits full deal bodies', slim[0]?.deals === undefined);

  console.log('\nOther routes');
  check('deals/:id returns a shaped deal', (await (await fetch(`${base}/deals/1`, { headers: KEY })).json()).invoice_number === 'INV-1042');
  check('events returns numbers not strings', typeof (await (await fetch(`${base}/events`, { headers: KEY })).json())[0].allocated_total === 'number');
  check('event sponsors listed', (await (await fetch(`${base}/events/10/sponsors`, { headers: KEY })).json())[0].company === 'Barings LLC');

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
});

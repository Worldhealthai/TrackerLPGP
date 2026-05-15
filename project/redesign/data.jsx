/* Realistic mock data for the LPGP Tracker */

const EMPLOYEES = [
  { id: 1, name: 'Amelia Hart',     title: 'Senior Operations Lead', dept: 'Operations',  type: 'payroll',       salary: 64800, currency: 'GBP', start: '2022-03-14', contractEnd: null,          status: 'active', daysOff: 4.5, allowance: 20, refMins: 142, refAmount: 188.32, dayOffDeduct: 0,    totalDeduct: 188.32, init: 'AH', av: 'av-a' },
  { id: 2, name: 'Marcus Chen',     title: 'Finance Manager',        dept: 'Finance',     type: 'payroll',       salary: 72000, currency: 'GBP', start: '2021-07-01', contractEnd: null,          status: 'active', daysOff: 9,   allowance: 20, refMins: 86,  refAmount: 124.10, dayOffDeduct: 0,    totalDeduct: 124.10, init: 'MC', av: 'av-b' },
  { id: 3, name: 'Priya Raman',     title: 'Talent Partner',         dept: 'People',      type: 'payroll',       salary: 52000, currency: 'GBP', start: '2023-01-09', contractEnd: null,          status: 'active', daysOff: 12,  allowance: 20, refMins: 18,  refAmount: 22.40,  dayOffDeduct: 0,    totalDeduct: 22.40,  init: 'PR', av: 'av-c' },
  { id: 4, name: 'Diego Alvarez',   title: 'Senior Designer',        dept: 'Product',     type: 'self_employed', salary: 58000, currency: 'GBP', start: '2024-02-20', contractEnd: '2026-08-20',  status: 'active', daysOff: 3,   allowance: 5,  refMins: 0,   refAmount: 0,      dayOffDeduct: 0,    totalDeduct: 0,      init: 'DA', av: 'av-d' },
  { id: 5, name: 'Olivia Bennett',  title: 'Event Producer',         dept: 'Marketing',   type: 'payroll',       salary: 48000, currency: 'GBP', start: '2022-11-03', contractEnd: null,          status: 'active', daysOff: 21,  allowance: 20, refMins: 312, refAmount: 374.20, dayOffDeduct: 76.92,totalDeduct: 451.12, init: 'OB', av: 'av-e', flagged: true },
  { id: 6, name: 'Jamal Idris',     title: 'Account Director',       dept: 'Sales',       type: 'payroll',       salary: 88000, currency: 'GBP', start: '2020-04-15', contractEnd: null,          status: 'active', daysOff: 6,   allowance: 20, refMins: 64,  refAmount: 116.92, dayOffDeduct: 0,    totalDeduct: 116.92, init: 'JI', av: 'av-f' },
  { id: 7, name: 'Sofia Werner',    title: 'Junior Analyst',         dept: 'Finance',     type: 'self_employed', salary: 36000, currency: 'GBP', start: '2024-09-02', contractEnd: '2026-09-02',  status: 'active', daysOff: 2,   allowance: 5,  refMins: 4,   refAmount: 2.88,   dayOffDeduct: 0,    totalDeduct: 2.88,   init: 'SW', av: 'av-g' },
  { id: 8, name: 'Henry Okoye',     title: 'Tech Lead',              dept: 'Engineering', type: 'payroll',       salary: 92000, currency: 'GBP', start: '2019-08-12', contractEnd: null,          status: 'active', daysOff: 11,  allowance: 20, refMins: 24,  refAmount: 53.08,  dayOffDeduct: 0,    totalDeduct: 53.08,  init: 'HO', av: 'av-a' },
  { id: 9, name: 'Layla Hashimi',   title: 'Office Coordinator',     dept: 'Operations',  type: 'payroll',       salary: 38000, currency: 'GBP', start: '2023-06-18', contractEnd: null,          status: 'active', daysOff: 14,  allowance: 20, refMins: 196, refAmount: 178.50, dayOffDeduct: 0,    totalDeduct: 178.50, init: 'LH', av: 'av-b' },
  { id: 10,name: 'Theo Mensah',     title: 'Sponsorship Lead',       dept: 'Sales',       type: 'self_employed', salary: 68000, currency: 'GBP', start: '2023-10-30', contractEnd: '2025-10-30',  status: 'active', daysOff: 5,   allowance: 5,  refMins: 12,  refAmount: 23.40,  dayOffDeduct: 0,    totalDeduct: 23.40,  init: 'TM', av: 'av-c', flagged: true },
  { id: 11,name: 'Anya Volkov',     title: 'Event Coordinator',      dept: 'Marketing',   type: 'payroll',       salary: 42000, currency: 'GBP', start: '2022-05-09', contractEnd: null,          status: 'active', daysOff: 8,   allowance: 20, refMins: 36,  refAmount: 36.46,  dayOffDeduct: 0,    totalDeduct: 36.46,  init: 'AV', av: 'av-d' },
  { id: 12,name: 'Connor Walsh',    title: 'BDR',                    dept: 'Sales',       type: 'payroll',       salary: 34000, currency: 'GBP', start: '2025-01-20', contractEnd: null,          status: 'active', daysOff: 1,   allowance: 20, refMins: 0,   refAmount: 0,      dayOffDeduct: 0,    totalDeduct: 0,      init: 'CW', av: 'av-e' },
];

const HOTEL_EXPENSES = [
  { id: 1, event: 'CFO Miami',         location: 'Miami, FL',     hotel: 'Fontainebleau',         cost: '$184,000',  costSub: '++ catering',  av: 12500,  avCur: 'USD', avBilling: 'separate', paid: 92000,  paidCur: 'USD', staffHotel: 4200,  flights: 6800,  printing: 1200, status: 'partial', notes: 'AV billed separately by venue' },
  { id: 2, event: 'EMEA Summit',       location: 'Lisbon, PT',    hotel: 'Tivoli Avenida',        cost: '€68,400',   costSub: 'all-in',       av: 0,      avCur: 'EUR', avBilling: 'included', paid: 68400,  paidCur: 'EUR', staffHotel: 1820,  flights: 3400,  printing: 540,  status: 'paid' },
  { id: 3, event: 'CHRO London',       location: 'London, UK',    hotel: 'Rosewood London',       cost: '£42,300',   costSub: '',             av: 6200,   avCur: 'GBP', avBilling: 'separate', paid: 0,      paidCur: 'GBP', staffHotel: 980,   flights: 0,     printing: 380,  status: 'pending' },
  { id: 4, event: 'APAC Roundtable',   location: 'Singapore',     hotel: 'Marina Bay Sands',      cost: '$74,500',   costSub: '',             av: 8800,   avCur: 'USD', avBilling: 'separate', paid: 37000,  paidCur: 'USD', staffHotel: 2200,  flights: 9400,  printing: 800,  status: 'partial' },
  { id: 5, event: 'Q4 All-Hands',      location: 'Zürich, CH',    hotel: 'Baur au Lac',           cost: 'CHF 38,000',costSub: '',             av: 4200,   avCur: 'CHF', avBilling: 'separate', paid: 38000,  paidCur: 'CHF', staffHotel: 1100,  flights: 2800,  printing: 0,    status: 'paid' },
  { id: 6, event: 'CFO Dubai',         location: 'Dubai, AE',     hotel: 'Atlantis The Palm',     cost: 'AED 96,000',costSub: '+ F&B',        av: 14200,  avCur: 'AED', avBilling: 'separate', paid: 24000,  paidCur: 'AED', staffHotel: 2400,  flights: 8200,  printing: 920,  status: 'partial' },
  { id: 7, event: 'CIO New York',      location: 'New York, NY',  hotel: 'The Pierre',            cost: '$112,000',  costSub: '++',           av: 9800,   avCur: 'USD', avBilling: 'separate', paid: 0,      paidCur: 'USD', staffHotel: 3400,  flights: 4200,  printing: 640,  status: 'pending' },
];

// Daily records for Amelia Hart in current month
const RECORDS = [
  { id: 1, empId: 1, date: '2026-05-01', break: 40, phone: 8,  wasted: 0,  late: 0,  dayOff: 0,    adj: 0,   refMins: 8,  refAmount: 9.94,  notes: '' },
  { id: 2, empId: 1, date: '2026-05-02', break: 55, phone: 12, wasted: 4,  late: 6,  dayOff: 0,    adj: 0,   refMins: 37, refAmount: 45.97, notes: 'Late train' },
  { id: 3, empId: 1, date: '2026-05-05', break: 42, phone: 0,  wasted: 0,  late: 0,  dayOff: 0,    adj: 0,   refMins: 2,  refAmount: 2.49,  notes: '' },
  { id: 4, empId: 1, date: '2026-05-06', break: 40, phone: 22, wasted: 0,  late: 0,  dayOff: 0,    adj: -10, refMins: 12, refAmount: 14.91, notes: 'Client call ran long' },
  { id: 5, empId: 1, date: '2026-05-07', break: 0,  phone: 0,  wasted: 0,  late: 0,  dayOff: 1,    adj: 0,   refMins: 0,  refAmount: 0,     notes: 'Annual leave' },
  { id: 6, empId: 1, date: '2026-05-08', break: 45, phone: 6,  wasted: 0,  late: 12, dayOff: 0,    adj: 0,   refMins: 23, refAmount: 28.58, notes: '' },
  { id: 7, empId: 1, date: '2026-05-09', break: 40, phone: 4,  wasted: 8,  late: 0,  dayOff: 0,    adj: 0,   refMins: 12, refAmount: 14.91, notes: '' },
  { id: 8, empId: 1, date: '2026-05-12', break: 40, phone: 0,  wasted: 0,  late: 0,  dayOff: 0,    adj: 0,   refMins: 0,  refAmount: 0,     notes: '' },
  { id: 9, empId: 1, date: '2026-05-13', break: 50, phone: 15, wasted: 0,  late: 0,  dayOff: 0,    adj: 0,   refMins: 25, refAmount: 31.06, notes: '' },
  { id: 10,empId: 1, date: '2026-05-14', break: 0,  phone: 0,  wasted: 0,  late: 0,  dayOff: 0.5,  adj: 0,   refMins: 0,  refAmount: 0,     notes: 'Half day — dentist' },
  { id: 11,empId: 1, date: '2026-05-15', break: 40, phone: 5,  wasted: 0,  late: 0,  dayOff: 0,    adj: 0,   refMins: 5,  refAmount: 6.21,  notes: '' },
];

// Salary cards
const SALARY_DATA = EMPLOYEES.map(e => {
  const monthly = Math.round(e.salary / 12);
  const paidMonths = e.id % 3 === 0 ? 3 : 4;
  const monthsElapsed = 5;
  const paid = monthly * paidMonths;
  const due = monthly * monthsElapsed;
  const outstanding = due - paid - e.totalDeduct;
  return {
    ...e,
    monthly,
    paid,
    due,
    outstanding,
    paidMonths,
    monthsElapsed,
    bonus: e.id === 6 ? 4000 : (e.id === 8 ? 2500 : 0),
  };
});

// Calendar events for current month (May 2026)
const CAL_EVENTS = {
  '2026-05-07': [{ type: 'full', emp: 'Amelia H.' }],
  '2026-05-14': [{ type: 'half', emp: 'Amelia H.' }],
  '2026-05-15': [{ type: 'reminder', cat: 'rent', label: 'Office Rent', amount: '£8,400' }],
  '2026-05-11': [{ type: 'full', emp: 'Marcus C.' }, { type: 'full', emp: 'Priya R.' }],
  '2026-05-20': [{ type: 'half', emp: 'Olivia B.' }],
  '2026-05-22': [{ type: 'full', emp: 'Olivia B.' }, { type: 'full', emp: 'Jamal I.' }],
  '2026-05-26': [{ type: 'reminder', cat: 'subscription', label: 'Notion (annual)', amount: '$960' }],
  '2026-05-28': [{ type: 'full', emp: 'Layla H.' }],
  '2026-05-29': [{ type: 'full', emp: 'Layla H.' }],
};

// Activity feed
const ACTIVITY = [
  { id: 1, who: 'You',           av: 'av-a', what: 'Logged payment',   detail: '£5,400 → Amelia Hart · May payroll',         when: '2m ago',  ico: 'wallet',     tone: 'pos' },
  { id: 2, who: 'You',           av: 'av-a', what: 'Booked day off',   detail: 'Olivia Bennett · 22 May · full day',         when: '14m ago', ico: 'calendar',   tone: 'info' },
  { id: 3, who: 'System',        av: 'av-f', what: 'Contract expiring',detail: 'Theo Mensah · 30 Oct 2025 · 168 days',       when: '1h ago',  ico: 'alert',      tone: 'warn' },
  { id: 4, who: 'You',           av: 'av-a', what: 'New hotel expense',detail: 'CFO Dubai · AED 96,000 · partial',           when: '3h ago',  ico: 'hotel',      tone: 'info' },
  { id: 5, who: 'You',           av: 'av-a', what: 'Adjustment',       detail: '+30 min · Henry Okoye · "approved overtime"',when: '5h ago',  ico: 'edit',       tone: 'pos' },
  { id: 6, who: 'System',        av: 'av-f', what: 'Allowance breach', detail: 'Olivia Bennett · 21/20 days · £76.92 deduct',when: '1d ago',  ico: 'alert',      tone: 'neg' },
];

const REMINDERS = [
  { who: 'Amelia Hart',    av: 'av-a', monthsBehind: 0, amount: 5400, due: 5400, status: 'on_track' },
  { who: 'Marcus Chen',    av: 'av-b', monthsBehind: 0, amount: 6000, due: 6000, status: 'on_track' },
  { who: 'Olivia Bennett', av: 'av-e', monthsBehind: 1, amount: 0,    due: 3923, status: 'unpaid' },
  { who: 'Theo Mensah',    av: 'av-c', monthsBehind: 2, amount: 0,    due: 11333,status: 'overdue' },
];

window.MOCK = { EMPLOYEES, HOTEL_EXPENSES, RECORDS, SALARY_DATA, CAL_EVENTS, ACTIVITY, REMINDERS };

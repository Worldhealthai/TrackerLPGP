/* App root + modals + tweaks wiring */

const PAGE_META = {
  dashboard: { title: 'Dashboard',      crumb: 'WORKSPACE / DASHBOARD' },
  tracking:  { title: 'Daily Tracking', crumb: 'WORKSPACE / TRACKING' },
  calendar:  { title: 'Calendar',       crumb: 'WORKSPACE / CALENDAR' },
  salary:    { title: 'Salary',         crumb: 'FINANCE / SALARY' },
  employees: { title: 'Employees',      crumb: 'FINANCE / EMPLOYEES' },
  hotels:    { title: 'Hotel Expenses', crumb: 'FINANCE / HOTELS' },
  reports:   { title: 'Reports',        crumb: 'ADMIN / REPORTS' },
  admins:    { title: 'Admin Users',    crumb: 'ADMIN / ACCESS' },
};

const PALETTES = {
  '#6ee7d4': { name: 'midnight', accent: '#6ee7d4', bg: '#0a0d14', bg2: '#0f131c', surface: '#11151e', surface2: '#161b27', surface3: '#1c2230', border: '#1f2533', borderBright: '#2a3142', text: '#e6e8ee' },
  '#b8e25b': { name: 'carbon',   accent: '#b8e25b', bg: '#0c0d0f', bg2: '#111315', surface: '#15181c', surface2: '#1b1f24', surface3: '#23282f', border: '#23282f', borderBright: '#2d333c', text: '#e8e8e8' },
  '#ff8a4c': { name: 'ember',    accent: '#ff8a4c', bg: '#0d0a0a', bg2: '#15110f', surface: '#1a1513', surface2: '#221b18', surface3: '#2b221e', border: '#2a221e', borderBright: '#3a2e28', text: '#eee2d6' },
  '#a78bfa': { name: 'violet',   accent: '#a78bfa', bg: '#0c0a14', bg2: '#11101b', surface: '#171423', surface2: '#1f1c2e', surface3: '#28253b', border: '#26233a', borderBright: '#322f4a', text: '#e7e3f0' },
};
const PALETTE_OPTIONS = [
  ['#6ee7d4','#0a0d14','#161b27'],
  ['#b8e25b','#0c0d0f','#1b1f24'],
  ['#ff8a4c','#0d0a0a','#221b18'],
  ['#a78bfa','#0c0a14','#1f1c2e'],
];

const FONTS = {
  inter_jet:    { sans: "'Inter', system-ui, sans-serif",        mono: "'JetBrains Mono', ui-monospace, monospace" },
  geist_geist:  { sans: "'Geist', system-ui, sans-serif",        mono: "'Geist Mono', ui-monospace, monospace" },
  ibm_ibm:      { sans: "'IBM Plex Sans', system-ui, sans-serif",mono: "'IBM Plex Mono', ui-monospace, monospace" },
  inter_jb:     { sans: "'Inter', system-ui, sans-serif",        mono: "'JetBrains Mono', ui-monospace, monospace" },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#6ee7d4","#0a0d14","#161b27"],
  "density": "balanced",
  "sidebar": "dark",
  "layout": "table",
  "fontPair": "inter_jet"
}/*EDITMODE-END*/;

const App = () => {
  const [page, setPage] = React.useState('dashboard');
  const [modal, setModal] = React.useState(null);
  const [toast, setToast] = React.useState('');
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply palette
  React.useEffect(() => {
    const hero = Array.isArray(tweaks.palette) ? tweaks.palette[0] : tweaks.palette;
    const p = PALETTES[hero] || PALETTES['#6ee7d4'];
    const r = document.documentElement.style;
    r.setProperty('--accent', p.accent);
    r.setProperty('--accent-soft', hexAlpha(p.accent, 0.12));
    r.setProperty('--accent-line', hexAlpha(p.accent, 0.32));
    r.setProperty('--bg', p.bg);
    r.setProperty('--bg-2', p.bg2);
    r.setProperty('--surface', p.surface);
    r.setProperty('--surface-2', p.surface2);
    r.setProperty('--surface-3', p.surface3);
    r.setProperty('--border', p.border);
    r.setProperty('--border-bright', p.borderBright);
    r.setProperty('--text', p.text);
    r.setProperty('--line', p.surface2);
  }, [tweaks.palette]);

  // Apply font pair
  React.useEffect(() => {
    const f = FONTS[tweaks.fontPair] || FONTS.inter_jet;
    document.documentElement.style.setProperty('--font-sans', f.sans);
    document.documentElement.style.setProperty('--font-mono', f.mono);
  }, [tweaks.fontPair]);

  const densityClass = tweaks.density === 'compact' ? 'density-compact' : tweaks.density === 'comfortable' ? 'density-comfortable' : '';

  const meta = PAGE_META[page];
  const openModal = (kind) => setModal(kind);
  const closeModal = () => setModal(null);
  const saveModal = (msg) => { setToast(msg); setModal(null); };

  return (
    <div className={`app-shell ${densityClass}`}>
      <Sidebar page={page} onNav={setPage} mode={tweaks.sidebar} />
      <div className="main">
        <Topbar title={meta.title} crumb={meta.crumb} />
        <div className="content">
          <div className="content-inner">
            {page === 'dashboard' && <PageDashboard openModal={openModal} />}
            {page === 'tracking'  && <PageTracking openModal={openModal} />}
            {page === 'calendar'  && <PageCalendar openModal={openModal} />}
            {page === 'salary'    && <PageSalary openModal={openModal} />}
            {page === 'employees' && <PageEmployees openModal={openModal} layout={tweaks.layout} />}
            {page === 'hotels'    && <PageHotels openModal={openModal} />}
            {page === 'reports'   && <PageReports />}
            {page === 'admins'    && <PageAdmins openModal={openModal} />}
          </div>
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Palette">
          <TweakColor
            value={tweaks.palette}
            onChange={v => setTweak('palette', v)}
            options={PALETTE_OPTIONS}
          />
        </TweakSection>
        <TweakRadio
          label="Density"
          value={tweaks.density}
          onChange={v => setTweak('density', v)}
          options={[
            { value: 'compact',     label: 'Compact' },
            { value: 'balanced',    label: 'Balanced' },
            { value: 'comfortable', label: 'Roomy' },
          ]}
        />
        <TweakRadio
          label="Sidebar"
          value={tweaks.sidebar}
          onChange={v => setTweak('sidebar', v)}
          options={[
            { value: 'dark',  label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'icons', label: 'Icons' },
          ]}
        />
        <TweakRadio
          label="Employees"
          value={tweaks.layout}
          onChange={v => setTweak('layout', v)}
          options={[
            { value: 'table', label: 'Table' },
            { value: 'cards', label: 'Cards' },
          ]}
        />
        <TweakSelect
          label="Font pair"
          value={tweaks.fontPair}
          onChange={v => setTweak('fontPair', v)}
          options={[
            { value: 'inter_jet',   label: 'Inter × JetBrains Mono' },
            { value: 'geist_geist', label: 'Geist × Geist Mono' },
            { value: 'ibm_ibm',     label: 'IBM Plex Sans × Mono' },
          ]}
        />
      </TweaksPanel>

      <Modals which={modal} close={closeModal} save={saveModal} />
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  );
};

const hexAlpha = (hex, a) => {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16);
  const g = parseInt(h.substr(2,2),16);
  const b = parseInt(h.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
};

/* ───────── MODALS ───────── */
const Modals = ({ which, close, save }) => (
  <>
    <Modal open={which === 'record'} title="Add daily record" icon="clock" onClose={close} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Record saved · 15 May 2026')}>Save record</Btn></>
    }>
      <div className="modal-row">
        <div className="field"><label>Employee</label><select><option>Amelia Hart</option></select></div>
        <div className="field"><label>Date</label><input type="date" defaultValue="2026-05-15" /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Day off</label><select><option>No — Working day</option><option>Half day off</option><option>Full day off</option></select></div>
        <div className="field"><label>Break (min)</label><input type="number" defaultValue={40} /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Phone (min)</label><input type="number" defaultValue={0} /></div>
        <div className="field"><label>Wasted (min)</label><input type="number" defaultValue={0} /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Late (min)</label><input type="number" defaultValue={0} /></div>
        <div className="field"><label>Manual adj</label><input type="number" defaultValue={0} placeholder="+/- min" /></div>
      </div>
      <div className="field"><label>Notes</label><textarea rows="2" placeholder="Optional context…" /></div>
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>
        <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:0.8,marginBottom:6}}>Live preview</div>
        <div style={{display:'flex',justifyContent:'space-between',gap:14}}>
          <div><div style={{fontSize:10,color:'var(--muted)'}}>REF. MINS</div><div className="num" style={{fontSize:18,color:'var(--text)',fontWeight:600}}>0</div></div>
          <div><div style={{fontSize:10,color:'var(--muted)'}}>REF. AMOUNT</div><div className="num" style={{fontSize:18,color:'var(--text)',fontWeight:600}}>£0.00</div></div>
          <div><div style={{fontSize:10,color:'var(--muted)'}}>DAYS OFF (YR)</div><div className="num" style={{fontSize:18,color:'var(--text)',fontWeight:600}}>4.5 / 20</div></div>
        </div>
      </div>
    </Modal>

    <Modal open={which === 'employee'} title="Edit employee" icon="users" onClose={close} width={620} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Employee saved')}>Save employee</Btn></>
    }>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginBottom:-4}}>// Identity</div>
      <div className="modal-row">
        <div className="field"><label>Full name</label><input defaultValue="Amelia Hart" /></div>
        <div className="field"><label>Start date</label><input type="date" defaultValue="2022-03-14" /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Job title</label><input defaultValue="Senior Operations Lead" /></div>
        <div className="field"><label>Department</label><input defaultValue="Operations" /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Phone</label><input defaultValue="+44 7700 902182" /></div>
        <div className="field"><label>Email</label><input defaultValue="amelia@lpgp.io" /></div>
      </div>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginTop:6,marginBottom:-4}}>// Contract</div>
      <div className="modal-row">
        <div className="field"><label>Type</label><select><option>Payroll (20 d/yr)</option><option>Self-employed (5 d/yr)</option></select></div>
        <div className="field"><label>Contract end</label><input type="date" /></div>
      </div>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginTop:6,marginBottom:-4}}>// Compensation</div>
      <div className="modal-row three">
        <div className="field"><label>Currency</label><select><option>£ GBP</option><option>AED</option></select></div>
        <div className="field"><label>Annual salary</label><input type="number" defaultValue={64800} /></div>
        <div className="field"><label>Pension %</label><input type="number" defaultValue={5} /></div>
      </div>
    </Modal>

    <Modal open={which === 'payment'} title="Log payment" icon="wallet" onClose={close} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Payment logged · £5,400')}>Save payment</Btn></>
    }>
      <div className="modal-row">
        <div className="field"><label>Employee</label><select><option>Amelia Hart</option></select></div>
        <div className="field"><label>Year</label><input type="number" defaultValue={2026} /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Month</label><select><option>May</option></select></div>
        <div className="field"><label>Amount (£)</label><input type="number" defaultValue={5400} /></div>
      </div>
      <div className="field"><label>Notes (optional)</label><input placeholder="e.g. May salary payment" /></div>
    </Modal>

    <Modal open={which === 'hotel'} title="Hotel expense" icon="hotel" onClose={close} width={620} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Hotel expense saved')}>Save</Btn></>
    }>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginBottom:-4}}>// Event details</div>
      <div className="modal-row">
        <div className="field"><label>Event</label><input defaultValue="CFO Miami" /></div>
        <div className="field"><label>Hotel</label><input defaultValue="Fontainebleau" /></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Cost (display)</label><input defaultValue="$184,000 ++" /></div>
        <div className="field"><label>Status</label><select><option>Partial</option><option>Pending</option><option>Paid</option></select></div>
      </div>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginTop:6,marginBottom:-4}}>// AV & payments</div>
      <div className="modal-row three">
        <div className="field"><label>AV currency</label><select><option>USD</option></select></div>
        <div className="field"><label>AV amount</label><input type="number" defaultValue={12500} /></div>
        <div className="field"><label>Billing</label><select><option>Separate</option><option>Included</option></select></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Paid currency</label><select><option>USD</option></select></div>
        <div className="field"><label>Paid amount</label><input type="number" defaultValue={92000} /></div>
      </div>
      <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginTop:6,marginBottom:-4}}>// Additional</div>
      <div className="modal-row three">
        <div className="field"><label>Staff hotel</label><input type="number" defaultValue={4200} /></div>
        <div className="field"><label>Flights</label><input type="number" defaultValue={6800} /></div>
        <div className="field"><label>Printing</label><input type="number" defaultValue={1200} /></div>
      </div>
    </Modal>

    <Modal open={which === 'admin'} title="Add manager" icon="shield" onClose={close} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Manager account created')}>Create account</Btn></>
    }>
      <div className="modal-row">
        <div className="field"><label>Username</label><input placeholder="firstname.lastname" /></div>
        <div className="field"><label>Password</label><input type="password" placeholder="••••••••" /></div>
      </div>
      <div className="field"><label>Role</label><select><option>Manager</option><option>Admin (full access)</option></select></div>
    </Modal>

    <Modal open={which === 'reminder'} title="Add expense reminder" icon="bell" onClose={close} foot={
      <><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn kind="primary" icon="check" onClick={() => save('Reminder saved')}>Save reminder</Btn></>
    }>
      <div className="modal-row">
        <div className="field"><label>Title</label><input placeholder="e.g. Office rent" /></div>
        <div className="field"><label>Category</label><select><option>Rent</option><option>Subscription</option><option>Deposit</option><option>Utility</option><option>Other</option></select></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Date</label><input type="date" /></div>
        <div className="field"><label>Recurrence</label><select><option>One-time</option><option>Monthly</option><option>Yearly</option></select></div>
      </div>
      <div className="modal-row">
        <div className="field"><label>Amount</label><input type="number" /></div>
        <div className="field"><label>Currency</label><select><option>GBP</option><option>USD</option></select></div>
      </div>
    </Modal>

    <Modal open={which === 'day'} title="Day · 15 May 2026" icon="calendar" onClose={close} foot={
      <><Btn kind="ghost" onClick={close}>Close</Btn><Btn kind="primary" icon="plus">Book day off</Btn></>
    }>
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:8,padding:14}}>
        <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.8,textTransform:'uppercase',marginBottom:8}}>Bookings on this date</div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:24,height:24,borderRadius:5,background:'var(--info-soft)',color:'var(--info)',display:'grid',placeItems:'center'}}>
            <Icon name="calendar" size={12} />
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:12.5,color:'var(--text)',fontWeight:500}}>Office rent due</div>
            <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>£8,400 · monthly recurring</div>
          </div>
          <Btn sm icon="check">Mark paid</Btn>
        </div>
      </div>
    </Modal>
  </>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

/* Calendar + Reports + Admins pages */

/* ═══════════════════════════════════════════ CALENDAR ═══════════════════════════════════════════ */
const PageCalendar = ({ openModal }) => {
  const { CAL_EVENTS } = window.MOCK;
  const [month, setMonth] = useS(4); // May = 4
  const [year, setYear] = useS(2026);

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // start with Monday
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const cells = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ day: prevMonthDays - startWeekday + i + 1, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, key, events: CAL_EVENTS[key] || [], today: d === 15 });
  }
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - daysInMonth - startWeekday + 1, muted: true });

  const monthName = firstOfMonth.toLocaleDateString('en-GB',{month:'long',year:'numeric'});

  const totalFull = Object.values(CAL_EVENTS).flat().filter(e => e.type === 'full').length;
  const totalHalf = Object.values(CAL_EVENTS).flat().filter(e => e.type === 'half').length;
  const totalReminders = Object.values(CAL_EVENTS).flat().filter(e => e.type === 'reminder').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">// {monthName.toUpperCase()} · {totalFull + totalHalf} days off booked · {totalReminders} expense reminders</div>
        </div>
        <div className="actions">
          <Btn icon="plus" kind="primary" onClick={() => openModal('reminder')}>Add reminder</Btn>
        </div>
      </div>

      <FilterBar actions={<>
        <Btn icon="chevron_left" sm onClick={() => { if (month === 0) { setMonth(11); setYear(year-1); } else setMonth(month-1); }}>Prev</Btn>
        <div style={{fontSize:13,fontWeight:600,color:'var(--text)',padding:'0 8px',minWidth:140,textAlign:'center'}}>{monthName}</div>
        <Btn icon="chevron_right" sm onClick={() => { if (month === 11) { setMonth(0); setYear(year+1); } else setMonth(month+1); }}>Next</Btn>
      </>}>
        <div className="field" style={{minWidth:160}}>
          <label>Employee</label>
          <select><option>All employees</option>{window.MOCK.EMPLOYEES.map(e => <option key={e.id}>{e.name}</option>)}</select>
        </div>
        <div style={{display:'flex',gap:14,alignItems:'flex-end',marginBottom:6,marginLeft:8,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>
            <span className="cal-tag" style={{background:'var(--info-soft)',color:'var(--info)'}}>FULL</span> full day
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>
            <span className="cal-tag" style={{background:'var(--warning-soft)',color:'var(--warning)'}}>HALF</span> half day
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>
            <span style={{width:8,height:8,borderRadius:50,background:'var(--accent)',display:'inline-block'}} /> reminder
          </div>
        </div>
      </FilterBar>

      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-hd">{d}</div>)}
        {cells.map((c, i) => (
          <div key={i} className={`cal-cell ${c.muted ? 'muted' : ''} ${c.today ? 'today' : ''}`} onClick={() => c.events && c.events.length > 0 && openModal('day')}>
            <div className="d">{String(c.day).padStart(2,'0')}</div>
            {!c.muted && c.events && c.events.map((ev, j) => {
              if (ev.type === 'full') return <span key={j} className="cal-tag" style={{background:'var(--info-soft)',color:'var(--info)'}}>{ev.emp}</span>;
              if (ev.type === 'half') return <span key={j} className="cal-tag" style={{background:'var(--warning-soft)',color:'var(--warning)'}}>½ {ev.emp}</span>;
              if (ev.type === 'reminder') return <span key={j} className="cal-tag" style={{background:'var(--accent-soft)',color:'var(--accent)'}}>● {ev.label}</span>;
              return null;
            })}
          </div>
        ))}
      </div>

      <div className="dash-3col" style={{marginTop:'var(--gap)'}}>
        <StatTile label="Full days off" icon="calendar" value={totalFull} unit="this mo" delta="+1 vs Apr" deltaDir="neg" />
        <StatTile label="Half days"      icon="clock"    value={totalHalf} unit="this mo" delta="stable" deltaDir="pos" />
        <StatTile label="Expense reminders" icon="bell"  value={totalReminders} unit="next 30d" delta="£9,360 total" deltaDir="pos" />
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ REPORTS ═══════════════════════════════════════════ */
const PageReports = () => {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub">// Filter, build, export · CSV / PDF</div>
        </div>
      </div>

      <FilterBar actions={<><Btn icon="download" sm>PDF</Btn><Btn icon="download" sm>CSV</Btn><Btn icon="zap" kind="primary">Generate</Btn></>}>
        <div className="field"><label>Report</label><select><option>Payroll summary</option><option>Days off ledger</option><option>Hotel commitments</option><option>Reference minutes</option></select></div>
        <div className="field"><label>From</label><input type="date" defaultValue="2026-01-01" /></div>
        <div className="field"><label>To</label><input type="date" defaultValue="2026-05-15" /></div>
        <div className="field"><label>Employee</label><select><option>All employees</option></select></div>
      </FilterBar>

      <div className="stat-grid">
        <StatTile label="Period"         icon="calendar"   value="135 d" delta="Jan 01 → May 15" deltaDir="pos" />
        <StatTile label="Total payroll"  icon="banknote"   value="£278.2k" delta="paid" deltaDir="pos" />
        <StatTile label="Total deduct."  icon="trend_down" value="£1,196" delta="0.4% of gross" deltaDir="neg" />
        <StatTile label="Active records" icon="report"     value="2,184" delta="across 12 staff" deltaDir="pos" />
      </div>

      <div className="dash-2col">
        <div className="card">
          <div className="card-head">
            <h3><Icon name="trend_up" size={14} />Payroll trend</h3>
            <span className="sub">monthly · £k</span>
          </div>
          <div className="card-body">
            <BarChart data={[
              { m: 'Jan', v: 54.8 }, { m: 'Feb', v: 55.2 }, { m: 'Mar', v: 56.1 },
              { m: 'Apr', v: 56.0 }, { m: 'May', v: 56.1 },
            ]} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3><Icon name="trend_down" size={14} />Deductions breakdown</h3>
            <span className="sub">YTD</span>
          </div>
          <div className="card-body">
            {[
              { lbl: 'Late arrivals',     v: 412, pct: 34, tone: 'neg' },
              { lbl: 'Phone time',        v: 318, pct: 27, tone: 'warn' },
              { lbl: 'Day-off overage',   v: 280, pct: 23, tone: 'neg' },
              { lbl: 'Wasted time',       v: 124, pct: 10, tone: 'warn' },
              { lbl: 'Manual adjust.',    v: 62,  pct: 5,  tone: '' },
            ].map(r => (
              <div key={r.lbl} style={{marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5,fontSize:11.5}}>
                  <span style={{color:'var(--text-2)'}}>{r.lbl}</span>
                  <span className="num" style={{color:'var(--text)'}}>£{r.v} <span style={{color:'var(--muted)'}}>· {r.pct}%</span></span>
                </div>
                <Bar pct={r.pct} tone={r.tone} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3><Icon name="report" size={14} />Payroll ledger · YTD</h3>
          <span className="sub">all employees</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th className="right">Jan</th>
                <th className="right">Feb</th>
                <th className="right">Mar</th>
                <th className="right">Apr</th>
                <th className="right">May</th>
                <th className="right">YTD total</th>
              </tr>
            </thead>
            <tbody>
              {window.MOCK.SALARY_DATA.slice(0, 8).map(e => (
                <tr key={e.id}>
                  <td><EmpCell emp={e} /></td>
                  <td><Pill tone={e.type === 'payroll' ? 'info' : 'muted'} dot>{e.type === 'payroll' ? 'PR' : 'SE'}</Pill></td>
                  <td className="num">£{e.monthly.toLocaleString()}</td>
                  <td className="num">£{e.monthly.toLocaleString()}</td>
                  <td className="num">£{e.monthly.toLocaleString()}</td>
                  <td className="num" style={e.paidMonths < 4 ? {color:'var(--negative)'} : null}>{e.paidMonths < 4 ? '—' : `£${e.monthly.toLocaleString()}`}</td>
                  <td className="num" style={e.paidMonths < 5 ? {color:'var(--negative)'} : null}>{e.paidMonths < 5 ? '—' : `£${e.monthly.toLocaleString()}`}</td>
                  <td className="num"><span className="strong">£{e.paid.toLocaleString()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const BarChart = ({ data }) => {
  const max = Math.max(...data.map(d => d.v));
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:14,height:180,paddingTop:10}}>
      {data.map((d,i) => {
        const h = (d.v / max) * 150;
        return (
          <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
            <div className="num" style={{fontSize:11,color:'var(--text)',fontWeight:600}}>{d.v}</div>
            <div style={{
              width:'100%', height:h,
              background: 'linear-gradient(180deg, var(--accent) 0%, rgba(110,231,212,0.3) 100%)',
              borderRadius:'4px 4px 0 0',
              borderTop:'2px solid var(--accent)',
              boxShadow: '0 0 16px rgba(110,231,212,0.25)',
            }} />
            <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.6,textTransform:'uppercase'}}>{d.m}</div>
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════ ADMINS ═══════════════════════════════════════════ */
const PageAdmins = ({ openModal }) => {
  const admins = [
    { id: 1, user: 'sara.r',     role: 'admin',   created: '2023-01-12', last: '2m ago',    av: 'av-a', init: 'SR' },
    { id: 2, user: 'm.chen',     role: 'manager', created: '2023-08-04', last: '1h ago',    av: 'av-b', init: 'MC' },
    { id: 3, user: 'p.raman',    role: 'manager', created: '2024-02-22', last: '3d ago',    av: 'av-c', init: 'PR' },
    { id: 4, user: 'h.okoye',    role: 'manager', created: '2024-09-15', last: '12d ago',   av: 'av-d', init: 'HO' },
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Admin Users</h1>
          <div className="sub">// {admins.length} accounts · 1 admin · {admins.length - 1} managers</div>
        </div>
        <div className="actions">
          <Btn icon="user_plus" kind="primary" onClick={() => openModal('admin')}>Add manager</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3><Icon name="shield" size={14} />Access</h3>
          <span className="sub">{admins.length} accounts</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>User</th><th>Role</th><th>Created</th><th>Last seen</th><th></th></tr>
            </thead>
            <tbody>
              {admins.map(a => (
                <tr key={a.id}>
                  <td><EmpCell emp={{name: a.user, title: 'login', av: a.av, init: a.init}} /></td>
                  <td>{a.role === 'admin' ? <Pill tone="accent" dot>admin</Pill> : <Pill tone="info" dot>manager</Pill>}</td>
                  <td className="num" style={{color:'var(--muted)'}}>{a.created}</td>
                  <td style={{color:'var(--text-2)',fontFamily:'var(--font-mono)',fontSize:11}}>{a.last}</td>
                  <td>
                    <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                      <div className="btn btn-icon btn-ghost"><Icon name="edit" size={13} /></div>
                      <div className="btn btn-icon btn-ghost"><Icon name="trash" size={13} /></div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dash-2col" style={{marginTop:'var(--gap)'}}>
        <div className="card">
          <div className="card-head">
            <h3><Icon name="info" size={14} />Roles</h3>
          </div>
          <div className="card-body">
            <div style={{marginBottom:14}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Pill tone="accent" dot>admin</Pill>
                <span style={{fontSize:12.5,color:'var(--text)',fontWeight:500}}>Full access</span>
              </div>
              <div style={{fontSize:11.5,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>Manage admins, delete records, terminate employees, all exports.</div>
            </div>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <Pill tone="info" dot>manager</Pill>
                <span style={{fontSize:12.5,color:'var(--text)',fontWeight:500}}>Day-to-day</span>
              </div>
              <div style={{fontSize:11.5,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>Add records, log payments, edit employees · no admin or termination.</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3><Icon name="zap" size={14} />Recent sign-ins</h3>
            <span className="sub">last 7 days</span>
          </div>
          <div className="card-body" style={{padding:0}}>
            {[
              { who: 'sara.r',    ip: '82.41.220.18',  time: '2m ago',  city: 'London, UK'    },
              { who: 'm.chen',    ip: '193.105.4.92',  time: '1h ago',  city: 'Manchester, UK' },
              { who: 'sara.r',    ip: '82.41.220.18',  time: '8h ago',  city: 'London, UK'    },
              { who: 'p.raman',   ip: '198.71.1.4',    time: '3d ago',  city: 'Bristol, UK'   },
            ].map((s,i) => (
              <div key={i} style={{display:'flex',gap:12,padding:'11px 16px',borderBottom:'1px solid var(--line)',alignItems:'center',fontSize:12}}>
                <div style={{width:6,height:6,borderRadius:50,background:'var(--positive)'}} />
                <span style={{color:'var(--text)',fontFamily:'var(--font-mono)',fontWeight:600,minWidth:80}}>{s.who}</span>
                <span style={{color:'var(--muted)',fontFamily:'var(--font-mono)',fontSize:11}}>{s.ip}</span>
                <span style={{flex:1,color:'var(--muted)',fontSize:11}}>{s.city}</span>
                <span style={{color:'var(--dim)',fontFamily:'var(--font-mono)',fontSize:10.5}}>{s.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PageCalendar, PageReports, PageAdmins });

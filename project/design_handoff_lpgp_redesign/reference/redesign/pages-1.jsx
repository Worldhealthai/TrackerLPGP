/* All page views */
const { useState: useS, useMemo: useM } = React;

/* ═══════════════════════════════════════════ DASHBOARD ═══════════════════════════════════════════ */
const PageDashboard = ({ openModal }) => {
  const { EMPLOYEES, ACTIVITY } = window.MOCK;
  const totalEmp = EMPLOYEES.length;
  const payroll  = EMPLOYEES.filter(e => e.type === 'payroll').length;
  const selfEmp  = EMPLOYEES.filter(e => e.type === 'self_employed').length;
  const totalDeduct = EMPLOYEES.reduce((s,e) => s + e.totalDeduct, 0);
  const flagged = EMPLOYEES.filter(e => e.flagged).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard <span className="tag">May 2026</span></h1>
          <div className="sub">// Operations overview · live · {totalEmp} active employees</div>
        </div>
        <div className="actions">
          <Btn icon="download">Export</Btn>
          <Btn icon="plus" kind="primary" onClick={() => openModal('record')}>New record</Btn>
        </div>
      </div>

      {/* stat tiles */}
      <div className="stat-grid">
        <StatTile label="Headcount"        icon="users"    value={totalEmp.toString().padStart(2,'0')} delta="+1 this mo" deltaDir="pos" spark={[10,10,11,11,11,11,12,12]} />
        <StatTile label="Payroll · Self-emp" icon="briefcase" value={`${payroll}·${selfEmp}`} delta="stable" deltaDir="pos" />
        <StatTile label="Total deductions" icon="trend_down" value={`£${totalDeduct.toFixed(2)}`} delta="+£124 vs Apr" deltaDir="neg" spark={[820,890,840,910,1020,980,1100,1196]} />
        <StatTile label="Flagged employees" icon="alert"    value={flagged.toString().padStart(2,'0')} delta="2 over allowance" deltaDir="neg" />
      </div>

      <div className="dash-2col">
        {/* employee summary */}
        <div className="card">
          <div className="card-head">
            <h3><Icon name="users" size={14} />Employee summary</h3>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className="sub">{totalEmp} rows</span>
              <Btn sm icon="filter">Filter</Btn>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Dept</th>
                  <th>Type</th>
                  <th className="right">Days off</th>
                  <th className="right">Ref. mins</th>
                  <th className="right">Deduction</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {EMPLOYEES.slice(0, 8).map(e => (
                  <tr key={e.id} className={e.flagged ? 'row-flag' : ''}>
                    <td><EmpCell emp={e} /></td>
                    <td>{e.dept}</td>
                    <td>
                      <Pill tone={e.type === 'payroll' ? 'info' : 'muted'} dot>
                        {e.type === 'payroll' ? 'payroll' : 'self-emp'}
                      </Pill>
                    </td>
                    <td className="num">
                      <span className={e.daysOff > e.allowance ? 'strong' : ''} style={e.daysOff > e.allowance ? {color:'var(--negative)'} : null}>
                        {e.daysOff}
                      </span>
                      <span style={{color:'var(--muted)'}}> / {e.allowance}</span>
                    </td>
                    <td className="num">{e.refMins}</td>
                    <td className="num">
                      <span className={e.totalDeduct > 0 ? 'strong' : ''} style={e.totalDeduct > 0 ? {color:'var(--negative)'} : null}>
                        £{e.totalDeduct.toFixed(2)}
                      </span>
                    </td>
                    <td><div className="btn btn-icon btn-ghost"><Icon name="more" size={14} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* activity */}
        <div className="card">
          <div className="card-head">
            <h3><Icon name="zap" size={14} />Activity</h3>
            <span className="sub">last 24h</span>
          </div>
          <div className="card-body" style={{padding:0}}>
            {ACTIVITY.map(a => (
              <div key={a.id} style={{display:'flex',gap:10,padding:'13px 16px',borderBottom:'1px solid var(--line)'}}>
                <div style={{
                  width:28, height:28, borderRadius:6,
                  background:'var(--surface-2)',
                  border:'1px solid var(--border)',
                  display:'grid', placeItems:'center',
                  color: a.tone === 'pos' ? 'var(--positive)' : a.tone === 'neg' ? 'var(--negative)' : a.tone === 'warn' ? 'var(--warning)' : 'var(--info)',
                  flexShrink:0,
                }}>
                  <Icon name={a.ico} size={13} />
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:12.5, color:'var(--text)', fontWeight:500}}>{a.what}</div>
                  <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)', marginTop:2}}>{a.detail}</div>
                </div>
                <div style={{fontSize:10.5, color:'var(--dim)', fontFamily:'var(--font-mono)', whiteSpace:'nowrap'}}>{a.when}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-3col">
        {/* contract expiry */}
        <div className="card">
          <div className="card-head">
            <h3><Icon name="alert" size={14} />Contract expiry</h3>
            <span className="sub">next 12 mo</span>
          </div>
          <div className="card-body" style={{padding:'4px 0'}}>
            {EMPLOYEES.filter(e => e.contractEnd).sort((a,b) => a.contractEnd.localeCompare(b.contractEnd)).map(e => {
              const days = Math.floor((new Date(e.contractEnd) - new Date('2026-05-15')) / 86400000);
              const tone = days < 90 ? 'neg' : days < 180 ? 'warn' : 'pos';
              return (
                <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderBottom:'1px solid var(--line)'}}>
                  <div className={`av ${e.av}`} style={{width:24,height:24,borderRadius:5,display:'grid',placeItems:'center',fontFamily:'var(--font-mono)',fontSize:9,fontWeight:600}}>{e.init}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:12, color:'var(--text)', fontWeight:500}}>{e.name}</div>
                    <div style={{fontSize:10.5, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{e.contractEnd}</div>
                  </div>
                  <Pill tone={tone}>{days}d</Pill>
                </div>
              );
            })}
            {EMPLOYEES.filter(e => e.contractEnd).length === 0 && (
              <div className="empty"><Icon name="check" size={20}/>No contracts expiring</div>
            )}
          </div>
        </div>

        {/* headcount by dept */}
        <div className="card">
          <div className="card-head">
            <h3><Icon name="building" size={14} />Headcount by dept</h3>
            <span className="sub">12 total</span>
          </div>
          <div className="card-body">
            {Array.from(new Set(EMPLOYEES.map(e => e.dept))).map(dept => {
              const n = EMPLOYEES.filter(e => e.dept === dept).length;
              const pct = (n / EMPLOYEES.length) * 100;
              return (
                <div key={dept} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,fontSize:11}}>
                    <span style={{color:'var(--text-2)',fontWeight:500}}>{dept}</span>
                    <span className="num" style={{color:'var(--muted)'}}>{n.toString().padStart(2,'0')} <span style={{color:'var(--dim)'}}>· {pct.toFixed(0)}%</span></span>
                  </div>
                  <Bar pct={pct} />
                </div>
              );
            })}
          </div>
        </div>

        {/* upcoming reminders */}
        <div className="card">
          <div className="card-head">
            <h3><Icon name="bell" size={14} />Upcoming reminders</h3>
            <span className="sub">next 30d</span>
          </div>
          <div className="card-body" style={{padding:0}}>
            {[
              { d: '15', m: 'MAY', t: 'Office rent', a: '£8,400',  cat: 'rent' },
              { d: '26', m: 'MAY', t: 'Notion (annual)', a: '$960', cat: 'subscription' },
              { d: '01', m: 'JUN', t: 'Quarterly tax',   a: '£18,200', cat: 'utility' },
              { d: '10', m: 'JUN', t: 'AWS invoice',     a: '$2,840', cat: 'subscription' },
            ].map((r,i) => (
              <div key={i} style={{display:'flex',gap:12,padding:'12px 16px',borderBottom:'1px solid var(--line)',alignItems:'center'}}>
                <div style={{
                  width:36, padding:'4px 0', textAlign:'center',
                  background:'var(--surface-2)', border:'1px solid var(--border)',
                  borderRadius:6, fontFamily:'var(--font-mono)',
                }}>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--text)',lineHeight:1}}>{r.d}</div>
                  <div style={{fontSize:9,color:'var(--muted)',marginTop:2,letterSpacing:0.5}}>{r.m}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12, color:'var(--text)', fontWeight:500}}>{r.t}</div>
                  <div style={{fontSize:10.5, color:'var(--muted)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:0.4}}>{r.cat}</div>
                </div>
                <div className="num" style={{color:'var(--text)',fontWeight:600,fontSize:12.5}}>{r.a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ DAILY TRACKING ═══════════════════════════════════════════ */
const PageTracking = ({ openModal }) => {
  const { EMPLOYEES, RECORDS } = window.MOCK;
  const [empId, setEmpId] = useS(1);
  const emp = EMPLOYEES.find(e => e.id === empId);
  const recs = RECORDS.filter(r => r.empId === empId);
  const totalRef = recs.reduce((s,r) => s + r.refMins, 0);
  const totalAmt = recs.reduce((s,r) => s + r.refAmount, 0);
  const totalDayOff = recs.reduce((s,r) => s + r.dayOff, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Daily Tracking</h1>
          <div className="sub">// {emp.name} · May 2026 · {recs.length} records</div>
        </div>
        <div className="actions">
          <Btn icon="download" sm>Export CSV</Btn>
          <Btn icon="plus" kind="primary" onClick={() => openModal('record')}>Add record</Btn>
        </div>
      </div>

      <FilterBar actions={<><Btn icon="filter">Filters</Btn></>}>
        <div className="field">
          <label>Employee</label>
          <select value={empId} onChange={e => setEmpId(+e.target.value)}>
            {EMPLOYEES.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Month</label>
          <input type="month" defaultValue="2026-05" />
        </div>
        <div className="field">
          <label>Type</label>
          <select><option>All entries</option><option>Working days</option><option>Days off</option></select>
        </div>
      </FilterBar>

      <div className="stat-grid" style={{gridTemplateColumns:'repeat(4, minmax(0,1fr))'}}>
        <StatTile label="Reference mins" icon="clock" value={totalRef} unit="min" delta="-22 vs Apr" deltaDir="pos" spark={[40,55,30,42,38,25,33,28]} />
        <StatTile label="Reference £"    icon="banknote" value={`£${totalAmt.toFixed(2)}`} delta="−£24.18" deltaDir="pos" />
        <StatTile label="Days off"       icon="calendar" value={totalDayOff} unit={`/ ${emp.allowance}`} delta={`${emp.allowance - emp.daysOff} remaining`} deltaDir="pos" />
        <StatTile label="Adjustments"    icon="edit" value={recs.reduce((s,r)=>s+r.adj,0)} unit="min" delta="−10 manual" deltaDir="pos" />
      </div>

      <div className="card" style={{marginBottom:'var(--gap)'}}>
        <div className="card-head">
          <h3><Icon name="clock" size={14} />Daily records</h3>
          <div style={{display:'flex',gap:6}}>
            <span className="pill pill-muted"><span className="dot" />{recs.length} entries</span>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th className="right">Break</th>
                <th className="right">Phone</th>
                <th className="right">Wasted</th>
                <th className="right">Late</th>
                <th>Day off</th>
                <th className="right">Adj</th>
                <th className="right">Ref. mins</th>
                <th className="right">Ref. £</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recs.map(r => {
                const dt = new Date(r.date);
                const weekday = dt.toLocaleDateString('en-GB',{weekday:'short'}).toUpperCase();
                const day = dt.getDate();
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                        <span className="num" style={{color:'var(--text)',fontWeight:600}}>{day}</span>
                        <span style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{weekday}</span>
                      </div>
                    </td>
                    <td className="num">{r.dayOff > 0 ? '—' : `${r.break}m`}</td>
                    <td className="num">{r.dayOff > 0 ? '—' : `${r.phone}m`}</td>
                    <td className="num">{r.dayOff > 0 ? '—' : `${r.wasted}m`}</td>
                    <td className="num">{r.dayOff > 0 ? '—' : `${r.late}m`}</td>
                    <td>
                      {r.dayOff === 1 ? <Pill tone="info" dot>full day</Pill>
                        : r.dayOff === 0.5 ? <Pill tone="warn" dot>half day</Pill>
                        : <span style={{color:'var(--dim)'}}>—</span>}
                    </td>
                    <td className="num" style={r.adj !== 0 ? {color: r.adj < 0 ? 'var(--positive)' : 'var(--negative)'} : null}>{r.adj === 0 ? '—' : (r.adj > 0 ? '+' : '') + r.adj}</td>
                    <td className="num"><span className="strong">{r.refMins}</span></td>
                    <td className="num"><span className="strong" style={r.refAmount > 0 ? {color:'var(--negative)'} : null}>£{r.refAmount.toFixed(2)}</span></td>
                    <td style={{color:'var(--muted)',fontSize:11.5,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.notes || <span style={{color:'var(--dim)'}}>—</span>}</td>
                    <td><div className="btn btn-icon btn-ghost"><Icon name="more" size={13} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PageDashboard, PageTracking });

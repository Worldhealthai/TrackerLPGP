/* Salary + Employees + Hotels pages */

/* ═══════════════════════════════════════════ SALARY ═══════════════════════════════════════════ */
const PageSalary = ({ openModal }) => {
  const { SALARY_DATA, REMINDERS } = window.MOCK;
  const [tab, setTab] = useS('all');
  const filtered = tab === 'all' ? SALARY_DATA : tab === 'terminated' ? [] : SALARY_DATA.filter(e => e.type === tab);

  const totalPaid = SALARY_DATA.reduce((s,e) => s+e.paid, 0);
  const totalDue  = SALARY_DATA.reduce((s,e) => s+e.due, 0);
  const totalOutstanding = SALARY_DATA.reduce((s,e) => s+e.outstanding, 0);
  const totalBonus = SALARY_DATA.reduce((s,e) => s+e.bonus, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Salary <span className="tag">2026</span></h1>
          <div className="sub">// Payroll YTD · {SALARY_DATA.length} accounts · {REMINDERS.filter(r => r.status !== 'on_track').length} flagged</div>
        </div>
        <div className="actions">
          <Btn icon="download" sm>Export CSV</Btn>
          <Btn icon="plus" kind="primary" onClick={() => openModal('payment')}>Log payment</Btn>
        </div>
      </div>

      {/* alert */}
      <div className="card" style={{marginBottom:'var(--gap)', borderColor:'rgba(245,184,96,0.3)', background:'rgba(245,184,96,0.04)'}}>
        <div style={{display:'flex',gap:12,padding:'14px 18px',alignItems:'flex-start'}}>
          <div style={{color:'var(--warning)',marginTop:1}}><Icon name="bell" size={16} /></div>
          <div style={{flex:1}}>
            <div style={{fontSize:12.5,fontWeight:600,color:'var(--text)',marginBottom:6}}>
              {REMINDERS.filter(r => r.status !== 'on_track').length} unpaid this month
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {REMINDERS.filter(r => r.status !== 'on_track').map(r => (
                <div key={r.who} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6}}>
                  <div className={`av ${r.av}`} style={{width:18,height:18,borderRadius:4,display:'grid',placeItems:'center',fontFamily:'var(--font-mono)',fontSize:8,fontWeight:600}}>{r.who.split(' ').map(s=>s[0]).join('')}</div>
                  <span style={{fontSize:11.5,color:'var(--text)'}}>{r.who}</span>
                  <span className="num" style={{fontSize:11,color:'var(--negative)'}}>£{r.due.toLocaleString()}</span>
                  {r.monthsBehind > 1 && <Pill tone="neg">{r.monthsBehind} mo</Pill>}
                </div>
              ))}
            </div>
          </div>
          <div className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}}><Icon name="x" size={12} /></div>
        </div>
      </div>

      <FilterBar actions={<>
        <div className="tabs">
          {[['all','All',SALARY_DATA.length], ['payroll','Payroll',SALARY_DATA.filter(e=>e.type==='payroll').length], ['self_employed','Self-emp',SALARY_DATA.filter(e=>e.type==='self_employed').length], ['terminated','Terminated',0]].map(([k,l,n]) => (
            <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}<span className="count">{n}</span></div>
          ))}
        </div>
      </>}>
        <div className="field"><label>Year</label><select><option>2026</option><option>2025</option><option>2024</option></select></div>
        <div className="field"><label>Search</label><input placeholder="Filter by name…" /></div>
      </FilterBar>

      <div className="stat-grid">
        <StatTile label="Paid YTD"   icon="check"      value={`£${(totalPaid/1000).toFixed(1)}k`}        delta="42% of due" deltaDir="pos" />
        <StatTile label="Due YTD"    icon="banknote"   value={`£${(totalDue/1000).toFixed(1)}k`}         delta="May closed" deltaDir="pos" />
        <StatTile label="Outstanding" icon="trend_down" value={`£${(totalOutstanding/1000).toFixed(1)}k`} delta={`${REMINDERS.filter(r=>r.status!=='on_track').length} accounts`} deltaDir="neg" />
        <StatTile label="Bonuses YTD" icon="zap"        value={`£${(totalBonus/1000).toFixed(1)}k`}      delta="2 bonuses" deltaDir="pos" />
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:'var(--gap)'}}>
        {filtered.map(e => {
          const pct = (e.paid / e.due) * 100;
          return (
            <div key={e.id} className="card">
              <div className="card-head" style={{background:'transparent',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div className={`av ${e.av}`} style={{width:30,height:30,borderRadius:7,display:'grid',placeItems:'center',fontFamily:'var(--font-mono)',fontSize:11,fontWeight:600}}>{e.init}</div>
                  <div>
                    <div style={{fontSize:13,color:'var(--text)',fontWeight:600}}>{e.name}</div>
                    <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:0.4}}>{e.title.toUpperCase()}</div>
                  </div>
                </div>
                <Pill tone={e.type === 'payroll' ? 'info' : 'muted'} dot>{e.type === 'payroll' ? 'payroll' : 'self-emp'}</Pill>
              </div>
              <div className="card-body" style={{padding:14}}>
                <div className="kv"><span className="k">Annual</span><span className="v">£{e.salary.toLocaleString()}</span></div>
                <div className="kv"><span className="k">Monthly</span><span className="v">£{e.monthly.toLocaleString()}</span></div>
                <div className="kv"><span className="k">Paid YTD</span><span className="v pos">£{e.paid.toLocaleString()}</span></div>
                <div className="kv"><span className="k">Due YTD</span><span className="v">£{e.due.toLocaleString()}</span></div>
                <div className="kv"><span className="k">Deductions</span><span className="v neg">−£{e.totalDeduct.toFixed(2)}</span></div>
                <div className="kv" style={{borderBottom:'none',paddingTop:10}}>
                  <span className="k">Outstanding</span>
                  <span className="v" style={{fontSize:14,color: e.outstanding > 0 ? 'var(--negative)' : 'var(--positive)'}}>£{e.outstanding.toLocaleString()}</span>
                </div>
                <div style={{marginTop:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',marginBottom:5}}>
                    <span>{e.paidMonths} / {e.monthsElapsed} MONTHS PAID</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                  <Bar pct={pct} tone={pct >= 100 ? 'pos' : pct < 60 ? 'neg' : ''} />
                </div>
                <div style={{display:'flex',gap:6,marginTop:14}}>
                  <Btn sm icon="plus" kind="primary" onClick={() => openModal('payment')}>Pay</Btn>
                  <Btn sm icon="receipt">History</Btn>
                  <Btn sm icon="more" kind="ghost"></Btn>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="empty" style={{gridColumn:'1/-1'}}><Icon name="users" size={24} />No employees in this view</div>}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ EMPLOYEES ═══════════════════════════════════════════ */
const PageEmployees = ({ openModal, layout }) => {
  const { EMPLOYEES } = window.MOCK;
  const [query, setQuery] = useS('');
  const filtered = EMPLOYEES.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) || e.dept.toLowerCase().includes(query.toLowerCase()));

  if (layout === 'cards') {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>Employees <span className="tag">{filtered.length}</span></h1>
            <div className="sub">// Active workforce · {EMPLOYEES.filter(e=>e.type==='payroll').length} payroll · {EMPLOYEES.filter(e=>e.type==='self_employed').length} self-employed</div>
          </div>
          <div className="actions">
            <Btn icon="upload" sm>Import</Btn>
            <Btn icon="user_plus" kind="primary" onClick={() => openModal('employee')}>Add employee</Btn>
          </div>
        </div>
        <FilterBar>
          <div className="field" style={{flex:1,maxWidth:320}}><label>Search</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or department…" /></div>
          <div className="field"><label>Department</label><select><option>All</option></select></div>
          <div className="field"><label>Type</label><select><option>All</option><option>Payroll</option><option>Self-employed</option></select></div>
        </FilterBar>
        <div className="emp-card-grid">
          {filtered.map(e => (
            <div key={e.id} className="emp-card" onClick={() => openModal('employee')}>
              <div className="top">
                <div className={`av ${e.av}`}>{e.init}</div>
                <div className="info">
                  <div className="nm">{e.name}</div>
                  <div className="ti">{e.title.toUpperCase()}</div>
                </div>
                <Pill tone={e.type === 'payroll' ? 'info' : 'muted'} dot>{e.type === 'payroll' ? 'PR' : 'SE'}</Pill>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <div className="row"><span className="k">DEPT</span><span className="v">{e.dept}</span></div>
                <div className="row"><span className="k">SALARY</span><span className="v">£{e.salary.toLocaleString()}</span></div>
                <div className="row"><span className="k">START</span><span className="v">{e.start}</span></div>
                <div className="row"><span className="k">DAYS OFF</span><span className="v" style={e.daysOff > e.allowance ? {color:'var(--negative)'} : null}>{e.daysOff} / {e.allowance}</span></div>
              </div>
              <div className="foot">
                <Pill tone="pos" dot>active</Pill>
                <div style={{display:'flex',gap:4}}>
                  <div className="btn btn-icon btn-ghost"><Icon name="edit" size={12} /></div>
                  <div className="btn btn-icon btn-ghost"><Icon name="more" size={12} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Employees <span className="tag">{filtered.length}</span></h1>
          <div className="sub">// Active workforce · {EMPLOYEES.filter(e=>e.type==='payroll').length} payroll · {EMPLOYEES.filter(e=>e.type==='self_employed').length} self-employed</div>
        </div>
        <div className="actions">
          <Btn icon="upload" sm>Import</Btn>
          <Btn icon="user_plus" kind="primary" onClick={() => openModal('employee')}>Add employee</Btn>
        </div>
      </div>
      <FilterBar>
        <div className="field" style={{flex:1,maxWidth:320}}><label>Search</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or department…" /></div>
        <div className="field"><label>Department</label><select><option>All</option></select></div>
        <div className="field"><label>Type</label><select><option>All</option></select></div>
      </FilterBar>
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Dept</th>
                <th>Type</th>
                <th className="right">Salary</th>
                <th>Start</th>
                <th>Contract end</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} onClick={() => openModal('employee')} style={{cursor:'pointer'}}>
                  <td><EmpCell emp={e} /></td>
                  <td>{e.dept}</td>
                  <td><Pill tone={e.type === 'payroll' ? 'info' : 'muted'} dot>{e.type === 'payroll' ? 'payroll' : 'self-emp'}</Pill></td>
                  <td className="num"><span className="strong">£{e.salary.toLocaleString()}</span></td>
                  <td className="num" style={{color:'var(--muted)'}}>{e.start}</td>
                  <td className="num" style={{color: e.contractEnd ? 'var(--warning)' : 'var(--dim)'}}>{e.contractEnd || '—'}</td>
                  <td><Pill tone="pos" dot>active</Pill></td>
                  <td><div className="btn btn-icon btn-ghost"><Icon name="more" size={14} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ HOTELS ═══════════════════════════════════════════ */
const PageHotels = ({ openModal }) => {
  const { HOTEL_EXPENSES } = window.MOCK;
  const [filter, setFilter] = useS('all');
  const filtered = filter === 'all' ? HOTEL_EXPENSES : HOTEL_EXPENSES.filter(h => h.status === filter);

  const counts = {
    all: HOTEL_EXPENSES.length,
    pending: HOTEL_EXPENSES.filter(h => h.status === 'pending').length,
    partial: HOTEL_EXPENSES.filter(h => h.status === 'partial').length,
    paid: HOTEL_EXPENSES.filter(h => h.status === 'paid').length,
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hotel Expenses <span className="tag">FY26</span></h1>
          <div className="sub">// {HOTEL_EXPENSES.length} events · 4 currencies · multi-leg payments</div>
        </div>
        <div className="actions">
          <Btn icon="download" sm>Export</Btn>
          <Btn icon="plus" kind="primary" onClick={() => openModal('hotel')}>Add event</Btn>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile label="Total commitments" icon="banknote" value="$614k" delta="+$96k vs FY25" deltaDir="neg" spark={[120,180,240,310,420,510,560,614]} />
        <StatTile label="Paid so far"       icon="check"    value="$259k" delta="42% paid"  deltaDir="pos" />
        <StatTile label="Pending"           icon="clock"    value="$355k" delta={`${counts.pending+counts.partial} events`} deltaDir="neg" />
        <StatTile label="AV totals"         icon="zap"      value="$55.7k" delta="across 6 events" deltaDir="pos" />
      </div>

      <FilterBar actions={<>
        <div className="tabs">
          {[['all','All',counts.all],['pending','Pending',counts.pending],['partial','Partial',counts.partial],['paid','Paid',counts.paid]].map(([k,l,n]) => (
            <div key={k} className={`tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}<span className="count">{n}</span></div>
          ))}
        </div>
      </>}>
        <div className="field" style={{flex:1,maxWidth:320}}><label>Search</label><input placeholder="Search events or hotels…" /></div>
        <div className="field"><label>Currency</label><select><option>All</option><option>USD</option><option>GBP</option><option>EUR</option><option>CHF</option><option>AED</option></select></div>
      </FilterBar>

      <div className="card">
        <div className="card-head">
          <h3><Icon name="hotel" size={14} />Events & venues</h3>
          <span className="sub">{filtered.length} of {HOTEL_EXPENSES.length}</span>
        </div>
        <div className="card-body flush">
          <div style={{display:'grid',gridTemplateColumns:'1.5fr 1.4fr 1fr 0.9fr 1.1fr 1fr 0.5fr',gap:14,padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'var(--bg-2)',fontFamily:'var(--font-mono)',fontSize:10,fontWeight:600,color:'var(--muted)',letterSpacing:0.8,textTransform:'uppercase'}}>
            <div>Event</div>
            <div>Hotel</div>
            <div style={{textAlign:'right'}}>Cost</div>
            <div style={{textAlign:'right'}}>AV</div>
            <div style={{textAlign:'right'}}>Paid</div>
            <div>Status</div>
            <div></div>
          </div>
          {filtered.map(h => {
            return (
              <div key={h.id} onClick={() => openModal('hotel')} style={{display:'grid',gridTemplateColumns:'1.5fr 1.4fr 1fr 0.9fr 1.1fr 1fr 0.5fr',gap:14,padding:'14px 16px',borderBottom:'1px solid var(--line)',alignItems:'center',cursor:'pointer',fontSize:12.5,transition:'background .12s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                <div>
                  <div style={{color:'var(--text)',fontWeight:600,marginBottom:2}}>{h.event}</div>
                  <div style={{fontSize:10.5,color:'var(--muted)',fontFamily:'var(--font-mono)',display:'flex',alignItems:'center',gap:4}}>
                    <Icon name="pin" size={10} />
                    {h.location.toUpperCase()}
                  </div>
                </div>
                <div style={{color:'var(--text-2)',fontSize:12.5}}>{h.hotel}</div>
                <div className="num" style={{textAlign:'right'}}>
                  <div style={{color:'var(--text)',fontWeight:600}}>{h.cost}</div>
                  {h.costSub && <div style={{fontSize:10,color:'var(--muted)'}}>{h.costSub}</div>}
                </div>
                <div className="num" style={{textAlign:'right'}}>
                  {h.av > 0 ? (
                    <>
                      <div style={{color:'var(--text-2)'}}>{h.avCur} {h.av.toLocaleString()}</div>
                      <div style={{fontSize:10,color: h.avBilling === 'separate' ? 'var(--warning)' : 'var(--muted)'}}>{h.avBilling}</div>
                    </>
                  ) : <span style={{color:'var(--dim)'}}>—</span>}
                </div>
                <div className="num" style={{textAlign:'right'}}>
                  <div style={{color: h.paid > 0 ? 'var(--positive)' : 'var(--dim)', fontWeight:600}}>{h.paid > 0 ? `${h.paidCur} ${h.paid.toLocaleString()}` : '0'}</div>
                </div>
                <div>
                  {h.status === 'paid' && <Pill tone="pos" dot>paid</Pill>}
                  {h.status === 'partial' && <Pill tone="warn" dot>partial</Pill>}
                  {h.status === 'pending' && <Pill tone="neg" dot>pending</Pill>}
                </div>
                <div style={{textAlign:'right'}}><div className="btn btn-icon btn-ghost"><Icon name="more" size={13} /></div></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PageSalary, PageEmployees, PageHotels });

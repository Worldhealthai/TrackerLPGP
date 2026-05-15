/* Shell + shared components */
const { useState, useEffect, useRef, useMemo } = React;

/* ───────── SIDEBAR ───────── */
const NAV = [
  { group: 'Workspace', items: [
    { id: 'dashboard', label: 'Dashboard',      icon: 'dashboard' },
    { id: 'tracking',  label: 'Daily Tracking', icon: 'clock' },
    { id: 'calendar',  label: 'Calendar',       icon: 'calendar' },
  ]},
  { group: 'Finance',   items: [
    { id: 'salary',   label: 'Salary',         icon: 'wallet', badge: '2' },
    { id: 'employees',label: 'Employees',      icon: 'users' },
    { id: 'hotels',   label: 'Hotel Expenses', icon: 'hotel' },
  ]},
  { group: 'Admin',     items: [
    { id: 'reports',  label: 'Reports',        icon: 'report' },
    { id: 'admins',   label: 'Admin Users',    icon: 'shield' },
  ]},
];

const Sidebar = ({ page, onNav, mode }) => {
  const collapsed = mode === 'icons';
  const light = mode === 'light';
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-icons' : ''} ${light ? 'sidebar-light-mode' : ''}`}>
      <div className="sb-brand">
        <div className="sb-mark">L</div>
        {!collapsed && (
          <div className="sb-name">
            LPGP <small>Tracker · ops</small>
          </div>
        )}
      </div>
      <nav className="sb-nav">
        {NAV.map(g => (
          <div key={g.group}>
            <div className="sb-section">{g.group}</div>
            {g.items.map(it => (
              <div
                key={it.id}
                className={`sb-item ${page === it.id ? 'active' : ''}`}
                onClick={() => onNav(it.id)}
                title={collapsed ? it.label : undefined}
              >
                <Icon name={it.icon} size={16} />
                {!collapsed && <span className="lbl">{it.label}</span>}
                {!collapsed && it.badge && <span className="badge">{it.badge}</span>}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div className="sb-foot">
        {!collapsed && (
          <>
            <div className="sb-foot-row"><span>Shift</span><span>8h · 40m brk</span></div>
            <div className="sb-foot-row"><span>Payroll</span><span>20 d/yr</span></div>
            <div className="sb-foot-row"><span>Self-emp</span><span>5 d/yr</span></div>
          </>
        )}
        <button>
          <Icon name="logout" size={13} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
};

/* ───────── TOPBAR ───────── */
const Topbar = ({ title, crumb }) => {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const dateStr = time.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <header className="topbar">
      <div style={{display:'flex',flexDirection:'column',gap:1}}>
        <div className="tb-crumb">{crumb}</div>
        <div className="tb-title">{title}</div>
      </div>
      <div className="tb-spacer" />
      <div className="tb-search">
        <Icon name="search" size={13} />
        <input placeholder="Search employees, events, payments…" />
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-date">
        <span className="pulse" />
        {dateStr} · {timeStr}
      </div>
      <button className="tb-tool" title="Notifications">
        <Icon name="bell" size={14} />
      </button>
      <div className="tb-user">
        <div className="avatar">SR</div>
        <div style={{display:'flex',flexDirection:'column'}}>
          <span className="nm">Sara R.</span>
          <span className="ro">admin</span>
        </div>
        <Icon name="chevron_down" size={13} style={{color:'var(--muted)'}} />
      </div>
    </header>
  );
};

/* ───────── STAT TILE ───────── */
const StatTile = ({ label, icon, value, unit, delta, deltaDir = 'pos', spark }) => (
  <div className="stat">
    <div className="lbl">
      {icon && <Icon name={icon} size={11} />}
      {label}
    </div>
    <div className="val">
      <span>{value}</span>
      {unit && <span className="unit">{unit}</span>}
    </div>
    {delta && (
      <div className={`delta ${deltaDir === 'pos' ? 'pos' : 'neg'}`}>
        <Icon name={deltaDir === 'pos' ? 'arrow_up' : 'arrow_down'} size={11} />
        {delta}
      </div>
    )}
    {spark && <Sparkline data={spark} dir={deltaDir} />}
  </div>
);

/* tiny sparkline */
const Sparkline = ({ data, dir = 'pos', w = 70, h = 28 }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const fillD = `${d} L${w},${h} L0,${h} Z`;
  const color = dir === 'pos' ? 'var(--positive)' : dir === 'neg' ? 'var(--negative)' : 'var(--accent)';
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={fillD} fill={color} opacity="0.12" />
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
};

/* ───────── PILL ───────── */
const Pill = ({ tone, children, dot }) => (
  <span className={`pill pill-${tone}`}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

/* ───────── EMPLOYEE CELL ───────── */
const EmpCell = ({ emp }) => (
  <div className="cell-emp">
    <div className={`av ${emp.av}`}>{emp.init}</div>
    <div>
      <div className="em-name">{emp.name}</div>
      <div className="em-sub">{emp.title}</div>
    </div>
  </div>
);

/* ───────── PROGRESS ───────── */
const Bar = ({ pct, tone }) => (
  <div className={`bar ${tone || ''}`}><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
);

/* ───────── BUTTON ───────── */
const Btn = ({ children, kind = '', icon, sm, onClick, ...rest }) => (
  <button className={`btn ${kind ? 'btn-' + kind : ''} ${sm ? 'btn-sm' : ''}`} onClick={onClick} {...rest}>
    {icon && <Icon name={icon} size={sm ? 12 : 14} />}
    {children}
  </button>
);

/* ───────── MODAL ───────── */
const Modal = ({ open, title, icon, children, foot, onClose, width }) => {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={width ? { width } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{icon && <Icon name={icon} size={15} />}{title}</h2>
          <div className="close" onClick={onClose}><Icon name="x" size={14} /></div>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
};

/* ───────── TOAST ───────── */
const Toast = ({ msg, onDone }) => {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return <div className="toast"><Icon name="check" size={13} />{msg}</div>;
};

/* ───────── FILTER BAR ───────── */
const FilterBar = ({ children, actions }) => (
  <div className="filterbar">
    {children}
    {actions && <div className="actions">{actions}</div>}
  </div>
);

Object.assign(window, { Sidebar, Topbar, StatTile, Sparkline, Pill, EmpCell, Bar, Btn, Modal, Toast, FilterBar, NAV });

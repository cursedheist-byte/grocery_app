import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, ShoppingBag, Users, Package, Settings, Bell, CreditCard,
  Menu, LogOut, Search, Plus, Pencil, Trash2, CheckCircle2, Clock3,
  XCircle, Truck, ChevronRight, RefreshCw, Store, Send, Tag, UserCheck,
  AlertCircle, X, Save, Power, CircleDollarSign, Ban, Image as ImageIcon,
  MapPin, MessageSquare, MessageCircleReply, PackagePlus, Eye, EyeOff,
  Sun, Moon
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { api } from './api/client';
import SiteImages from './pages/SiteImages';
import './styles.css';

type Tab = 'dashboard'|'orders'|'products'|'customers'|'credits'|'notifications'|'categories'|'settings'|'site-images'|'offline'|'requests';

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('admin_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('admin_theme', theme);
  }, [theme]);
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))];
}

function ThemeToggle({ theme, onToggle, large }: { theme: Theme; onToggle: () => void; large?: boolean }) {
  return (
    <button
      className={`theme-toggle ${large ? 'large' : ''}`}
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      <Sun size={18} className="sun-icon" />
      <Moon size={18} className="moon-icon" />
    </button>
  );
}

const NAV = [
  ['dashboard', LayoutDashboard, 'Dashboard'],
  ['orders', ShoppingBag, 'Orders'],
  ['products', Package, 'Products'],
  ['customers', Users, 'Customers'],
  ['credits', CreditCard, 'Credits'],
  ['notifications', Bell, 'Notifications'],
  ['categories', Tag, 'Categories'],
  ['site-images', ImageIcon, 'Site Images'],
  ['offline', ShoppingBag, 'Offline Sales'],
  ['requests', PackagePlus, 'Item Requests'],
  ['settings', Settings, 'Shop Settings'],
] as const;

const ORDER_STATUSES = ['PLACED','ACCEPTED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','REJECTED','CANCELLED'];

function playSfx(type: 'success' | 'error') {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(type === 'success' ? 560 : 210, now);
  oscillator.frequency.setValueAtTime(type === 'success' ? 780 : 155, now + .08);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(.05, now + .01);
  gain.gain.exponentialRampToValueAtTime(.0001, now + .2);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + .21);
}

function playSiren() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.setValueAtTime(.35, context.currentTime);
  gain.gain.setValueAtTime(.35, context.currentTime + 2.8);
  gain.gain.linearRampToValueAtTime(.0001, context.currentTime + 3);
  gain.connect(context.destination);
  for (let i = 0; i < 6; i++) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    const t = context.currentTime + i * .5;
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.linearRampToValueAtTime(950, t + .24);
    osc.frequency.linearRampToValueAtTime(420, t + .5);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + .5);
  }
  window.setTimeout(() => context.close(), 3400);
}

function fireAdminNotification(title: string, body: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, tag: 'admin-new-activity' } as NotificationOptions & { renotify: boolean }); } catch { /* ignore */ }
  }
}

function requestAdminNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function App() {
  const [logged, setLogged] = useState(!!sessionStorage.getItem('admin_token'));
  const [tab, setTab] = useState<Tab>('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [login, setLogin] = useState({ phone: '9999999999', password: 'ChangeMe123!' });
  const [toast, setToast] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [theme, toggleTheme] = useTheme();

  const notify = (message: string) => {
    setToast(message);
    playSfx(/could not|failed|enter |required|invalid|error/i.test(message) ? 'error' : 'success');
    window.setTimeout(() => setToast(''), 2500);
  };

  // Siren watcher: poll orders + item requests, blare siren on new arrivals
  const seenRef = useRef<{ orders: Set<number>; requests: Set<number>; ready: boolean }>({ orders: new Set(), requests: new Set(), ready: false });

  useEffect(() => {
    if (!logged) return;
    let stop = false;
    const check = async () => {
      try {
        const [orders, requests] = await Promise.all([
          api('/orders/admin').catch(() => [] as any[]),
          api('/item-requests/admin').catch(() => [] as any[]),
        ]);
        if (stop) return;
        const seen = seenRef.current;
        const newOrders = orders.filter((o: any) => !seen.orders.has(o.id));
        const newRequests = requests.filter((r: any) => !seen.requests.has(r.id));
        orders.forEach((o: any) => seen.orders.add(o.id));
        requests.forEach((r: any) => seen.requests.add(r.id));
        if (!seen.ready) { seen.ready = true; return; }
        if (newOrders.length || newRequests.length) {
          playSiren();
          const bits = [
            newOrders.length ? `${newOrders.length} new order(s): ${newOrders.map((o: any) => '#' + o.id).join(', ')}` : '',
            newRequests.length ? `${newRequests.length} new item request(s)` : '',
          ].filter(Boolean);
          setToast('🚨 ' + bits.join(' · '));
          window.setTimeout(() => setToast(''), 5000);
          const count = newOrders.length + newRequests.length;
          document.title = `🚨 (${count}) NEW — Store Admin`;
          window.setTimeout(() => { document.title = 'Store Admin'; }, 10000);
          fireAdminNotification('🚨 New store activity', bits.join(' · '));
        }
      } catch { /* ignore */ }
    };
    check();
    const id = window.setInterval(check, 15000);
    return () => { stop = true; window.clearInterval(id); };
  }, [logged]);

  const signOut = () => {
    sessionStorage.clear();
    setLogged(false);
    setMobileNav(false);
  };

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const r = await api('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify(login),
      });
      sessionStorage.setItem('admin_token', r.access_token);
      requestAdminNotificationPermission();
      setLogged(true);
    } catch (e: any) {
      setLoginError(e?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoggingIn(false);
    }
  };

  if (!logged) {
    return (
      <Login
        login={login}
        setLogin={setLogin}
        error={loginError}
        loading={loggingIn}
        onSubmit={doLogin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const activeLabel = NAV.find(([key]) => key === tab)?.[2] || 'Dashboard';

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">🛒</span>
          <div>
            <b>Store Admin</b>
            <small>Management Console</small>
          </div>
          <button className="sidebar-close" aria-label="Close menu" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="sidebar-nav">
          {NAV.map(([key, Icon, label]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => { setTab(key); setMobileNav(false); }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'orders' && <span className="nav-hint">Manage</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-status">
          <span className="status-pulse" />
          <div>
            <b>Admin session active</b>
            <small>Secure dashboard</small>
          </div>
        </div>

        <button className="logout-button" onClick={signOut}>
          <LogOut size={17} />
          <span>Logout</span>
        </button>
      </aside>

      {mobileNav && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <section className="admin-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" aria-label="Open menu" onClick={() => setMobileNav(true)}>
              <Menu size={21} />
            </button>
            <div>
              <small>STORE MANAGEMENT</small>
              <b>{activeLabel}</b>
            </div>
          </div>

          <div className="topbar-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <button className="top-icon" aria-label="Notifications" onClick={() => setTab('notifications')}>
              <Bell size={18} />
            </button>
            <div className="admin-avatar">A</div>
          </div>
        </header>

        <main className="content">
          {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
          {tab === 'orders' && <Orders notify={notify} />}
          {tab === 'products' && <Products notify={notify} />}
          {tab === 'customers' && <Customers notify={notify} />}
          {tab === 'credits' && <Credits notify={notify} />}
          {tab === 'notifications' && <Notifications notify={notify} />}
          {tab === 'categories' && <Categories notify={notify} />}
          {tab === 'site-images' && <SiteImages />}
          {tab === 'offline' && <OfflineSales notify={notify} />}
          {tab === 'requests' && <ItemRequests notify={notify} />}
          {tab === 'settings' && <SettingsPage notify={notify} />}
        </main>

        <nav className="bottom-nav" aria-label="Quick navigation">
          {([['dashboard', LayoutDashboard], ['orders', ShoppingBag], ['products', Package], ['requests', PackagePlus], ['more', Menu]] as [string, typeof LayoutDashboard][]).map(([key, Icon]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              aria-label={key === 'more' ? 'Open full menu' : key}
              onClick={() => key === 'more' ? setMobileNav(true) : setTab(key as Tab)}
            >
              <Icon size={19} />
              <span>{key === 'more' ? 'More' : NAV.find(([k]) => k === key)?.[2]}</span>
            </button>
          ))}
        </nav>
      </section>

      {toast && (
        <div className="admin-toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({
  login, setLogin, error, loading, onSubmit, theme, onToggleTheme
}: {
  login: { phone: string; password: string };
  setLogin: React.Dispatch<React.SetStateAction<{ phone: string; password: string }>>;
  error: string;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <div className="login-page">
      <div className="login-theme-float">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} large />
      </div>
      <div className="login-shape shape-a" />
      <div className="login-shape shape-b" />
      <div className="login-grid-pattern" />

      <div className="login-layout">
        <div className="login-intro">
          <div className="login-brand">
            <span className="brand-mark large">🛒</span>
            <div>
              <b>Store Admin</b>
              <small>Management Console</small>
            </div>
          </div>
          <span className="eyebrow">CONTROL YOUR STORE</span>
          <h1>Everything your store needs, in one place.</h1>
          <p>Manage orders, products, customers, credits and shop settings from a focused workspace built for speed.</p>
          <div className="login-features">
            <span><CheckCircle2 size={15} /> Real-time store controls</span>
            <span><CheckCircle2 size={15} /> Simple order management</span>
            <span><CheckCircle2 size={15} /> Customer & credit tools</span>
          </div>
        </div>

        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-card-icon"><Store size={22} /></div>
          <span className="eyebrow">ADMIN ACCESS</span>
          <h2>Welcome back</h2>
          <p>Sign in to continue to your store dashboard.</p>

          {error && (
            <div className="inline-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <label>
            Phone
            <input
              autoComplete="username"
              inputMode="tel"
              value={login.phone}
              onChange={e => setLogin({ ...login, phone: e.target.value })}
              placeholder="Phone number"
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={login.password}
              onChange={e => setLogin({ ...login, password: e.target.value })}
              placeholder="Password"
            />
          </label>

          <button className="primary-button login-submit" disabled={loading}>
            {loading ? <Spinner /> : <>Sign in <ChevronRight size={17} /></>}
          </button>

          <small className="login-secure"><CheckCircle2 size={13} /> Authorized admin access only</small>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [d, setD] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api('/admin/dashboard').then(setD).catch(() => setD({})).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const metrics = [
    { label: 'Store status', value: d.shop_open ? 'OPEN' : 'CLOSED', icon: Store, tone: d.shop_open ? 'green' : 'orange', action: () => onNavigate('settings') },
    { label: 'Home delivery', value: d.home_delivery_enabled ? 'ON' : 'OFF', icon: Truck, tone: d.home_delivery_enabled ? 'green' : 'orange', action: () => onNavigate('settings') },
    { label: 'Pending customers', value: d.pending_customers ?? '—', icon: UserCheck, tone: 'purple', action: () => onNavigate('customers') },
    { label: 'New orders', value: d.new_orders ?? '—', icon: ShoppingBag, tone: 'orange', action: () => onNavigate('orders') },
    { label: 'Products', value: d.products ?? '—', icon: Package, tone: 'blue', action: () => onNavigate('products') },
    { label: 'Customers', value: d.customers ?? '—', icon: Users, tone: 'teal', action: () => onNavigate('customers') },
    { label: "Today's total sales", value: d.today_sales != null ? `₹${d.today_sales}` : '—', icon: CircleDollarSign, tone: 'green', action: () => onNavigate('offline') },
  ];

  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title="Good to see you."
        subtitle="Here is what is happening across your store."
        action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>}
      />

      <div className="metric-grid">
        {metrics.map(({ label, value, icon: Icon, tone, action }, index) => (
          <button className={`metric-card ${tone}`} key={label} onClick={action} style={{ animationDelay: `${index * 45}ms` }}>
            <span className="metric-icon"><Icon size={19} /></span>
            <span className="metric-label">{label}</span>
            <strong>{loading ? <span className="metric-skeleton" /> : value}</strong>
            <ChevronRight className="metric-arrow" size={16} />
          </button>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="surface-card quick-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">QUICK ACTIONS</span>
              <h2>Run the store</h2>
            </div>
          </div>
          <div className="quick-actions">
            <QuickAction icon={<ShoppingBag size={19} />} title="Manage orders" text="Review and update orders" onClick={() => onNavigate('orders')} />
            <QuickAction icon={<Package size={19} />} title="Add product" text="Put a new item in stock" onClick={() => onNavigate('products')} />
            <QuickAction icon={<Users size={19} />} title="Customers" text="Verify customer accounts" onClick={() => onNavigate('customers')} />
            <QuickAction icon={<Settings size={19} />} title="Shop settings" text="Control store availability" onClick={() => onNavigate('settings')} />
          </div>
        </section>

        <section className="surface-card status-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">STORE HEALTH</span>
              <h2>Live controls</h2>
            </div>
            <span className="live-badge"><span /> LIVE</span>
          </div>
          <StatusRow label="Store" value={d.shop_open ? 'Open' : 'Closed'} good={!!d.shop_open} />
          <StatusRow label="Home delivery" value={d.home_delivery_enabled ? 'Enabled' : 'Disabled'} good={!!d.home_delivery_enabled} />
          <StatusRow label="Customer approvals" value={d.pending_customers ? `${d.pending_customers} pending` : 'All clear'} good={!d.pending_customers} />
          <button className="text-button" onClick={() => onNavigate('settings')}>Open shop settings <ChevronRight size={15} /></button>
        </section>
      </div>
    </>
  );
}

function Orders({ notify }: { notify: (m: string) => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');

  const load = () => {
    setLoading(true);
    api('/orders/admin').then(setOrders).catch(() => setOrders([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const sendReply = async (id: number) => {
    if (!replyText.trim()) return;
    try {
      const updated = await api(`/orders/${id}/reply`, { method: 'PATCH', body: JSON.stringify({ message: replyText.trim() }) });
      setOrders(current => current.map(o => o.id === id ? updated : o));
      setReplyFor(null); setReplyText('');
      notify(`Reply sent for order #${id}`);
    } catch (e: any) {
      notify(e?.message || 'Could not send reply');
    }
  };

  const filtered = useMemo(() => orders.filter(o => {
    const matchesStatus = filter === 'ALL' || o.status === filter;
    const q = query.toLowerCase().trim();
    const matchesQuery = !q || String(o.id).includes(q) || String(o.customer_name || '').toLowerCase().includes(q) || String(o.phone || '').includes(q);
    return matchesStatus && matchesQuery;
  }), [orders, filter, query]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setOrders(current => current.map(o => o.id === id ? { ...o, status } : o));
      notify(`Order #${id} updated`);
    } catch (e: any) {
      notify(e?.message || 'Could not update order');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="FULFILLMENT"
        title="Orders"
        subtitle={`${orders.length} total orders in your store.`}
        action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>}
      />

      <div className="toolbar">
        <div className="admin-search">
          <Search size={17} />
          <input placeholder="Search by order, customer or phone..." value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')}><X size={15} /></button>}
        </div>
        <div className="filter-scroll">
          {['ALL', 'PLACED', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED'].map(s => (
            <button key={s} className={filter === s ? 'filter-active' : ''} onClick={() => setFilter(s)}>
              {formatStatus(s)}
            </button>
          ))}
        </div>
      </div>

      <section className="surface-card table-card">
        <div className="table-head">
          <span>ORDER</span><span>CUSTOMER</span><span>ADDRESS</span><span>ITEMS</span><span>TOTAL</span><span>STATUS</span><span>ACTION</span>
        </div>

        {loading ? (
          <div className="table-loading"><Spinner /><span>Loading orders...</span></div>
        ) : filtered.length ? (
          filtered.map((o, i) => (
            <div className="order-row" key={o.id} style={{ animationDelay: `${i * 25}ms` }}>
              <div className="order-id"><span className="row-icon"><ShoppingBag size={16} /></span><b>#{o.id}</b></div>
              <div className="customer-cell"><b>{o.customer_name}</b><small>{o.phone}</small></div>
              <div className="address-cell">
                <small className="row-sub"><MapPin size={12} /> {o.address_snapshot || '—'}</small>
                {o.special_request && <small className="special-request-cell" title={o.special_request}>📝 {o.special_request}</small>}
              </div>
              <div className="items-cell"><b>{o.items.length} item(s)</b><small>{o.items.slice(0, 2).map((i: any) => `${i.product_name} × ${i.quantity}`).join(', ')}{o.items.length > 2 ? '…' : ''}</small></div>
              <strong className="total-cell">₹{o.total}</strong>
              <StatusBadge status={o.status} />
              <div className="order-actions-cell">
                {replyFor === o.id ? (
                  <div className="reply-box">
                    <input autoFocus value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Reply to customer..." maxLength={1000} />
                    <button className="ghost-button" onClick={() => sendReply(o.id)}>Send</button>
                    <button className="ghost-button" onClick={() => { setReplyFor(null); setReplyText(''); }}>✕</button>
                  </div>
                ) : (
                  <>
                    <button className="ghost-button" title={o.owner_reply ? `Reply sent: ${o.owner_reply}` : 'Reply to customer'} onClick={() => { setReplyFor(o.id); setReplyText(o.owner_reply || ''); }}>
                      {o.owner_reply ? <MessageCircleReply size={15} /> : <MessageSquare size={15} />} Reply
                    </button>
                    <select className="status-select" value={o.status} onChange={e => updateStatus(o.id, e.target.value)}>
                      {ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <Empty icon={<ShoppingBag size={26} />} title="No orders found" text={query || filter !== 'ALL' ? 'Try changing your search or status filter.' : 'New orders will appear here.'} />
        )}
      </section>

      <div className="mobile-order-list">
        {filtered.map(o => (
          <div className="mobile-order-card" key={o.id}>
            <div className="mobile-order-top">
              <div><span className="row-icon"><ShoppingBag size={15} /></span><b>#{o.id}</b></div>
              <StatusBadge status={o.status} />
            </div>
            <b>{o.customer_name}</b>
            <small>{o.phone}</small>
            <small className="row-sub"><MapPin size={12} /> {o.address_snapshot || '—'}</small>
            {o.special_request && <small className="special-request-cell">📝 {o.special_request}</small>}
            {o.owner_reply && <small className="owner-reply-cell">🏪 {o.owner_reply}</small>}
            <p>{o.items.map((i: any) => `${i.product_name} × ${i.quantity}`).join(', ')}</p>
            {replyFor === o.id ? (
              <div className="reply-box">
                <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Reply to customer..." maxLength={1000} />
                <button className="ghost-button" onClick={() => sendReply(o.id)}>Send</button>
                <button className="ghost-button" onClick={() => { setReplyFor(null); setReplyText(''); }}>✕</button>
              </div>
            ) : (
              <button className="ghost-button" onClick={() => { setReplyFor(o.id); setReplyText(o.owner_reply || ''); }}>
                <MessageSquare size={14} /> {o.owner_reply ? 'Edit reply' : 'Reply'}
              </button>
            )}
            <div className="mobile-order-bottom">
              <strong>₹{o.total}</strong>
              <select className="status-select" value={o.status} onChange={e => updateStatus(o.id, e.target.value)}>
                {ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ItemRequests({ notify }: { notify: (m: string) => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceFor, setPriceFor] = useState<number | null>(null);
  const [adminPrice, setAdminPrice] = useState('');

  const load = () => {
    setLoading(true);
    api('/item-requests/admin').then(setRequests).catch(() => setRequests([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const respond = async (id: number, action: 'ARRIVED' | 'NOT_FOUND' | 'TOO_HEAVY' | 'SEEN' | 'PRICE_RANGE', price?: string) => {
    try {
      const updated = await api(`/item-requests/${id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ action, admin_price: action === 'ARRIVED' ? Number(price) : null }),
      });
      setRequests(current => current.map(r => r.id === id ? updated : r));
      setPriceFor(null); setAdminPrice('');
      notify(`Response sent for request #${id}`);
    } catch (e: any) {
      notify(e?.message || 'Could not respond to request');
    }
  };

  const remove = async (r: any) => {
    if (!window.confirm(`Delete request "${r.item_name}"?`)) return;
    try { await api(`/item-requests/${r.id}`, { method: 'DELETE' }); setRequests(current => current.filter(x => x.id !== r.id)); notify('Request deleted'); }
    catch (e: any) { notify(e?.message || 'Could not delete request'); }
  };

  const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
    PENDING: { label: 'PENDING', cls: 'pending' },
    SEEN: { label: 'SEEN', cls: 'seen' },
    ARRIVED: { label: 'ARRIVED', cls: 'arrived' },
    NOT_FOUND: { label: 'NOT FOUND', cls: 'notfound' },
    PRICE_RANGE: { label: 'OVER PRICE', cls: 'pricerange' },
    TOO_HEAVY: { label: 'TOO HEAVY', cls: 'tooheavy' },
  };

  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER REQUESTS"
        title="Item Requests"
        subtitle={`${requests.length} request(s) from customers.`}
        action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>}
      />

      <section className="surface-card table-card">
        <div className="table-head"><span>REQUEST</span><span>DETAILS</span><span>STATUS</span><span>ACTION</span></div>
        {loading ? (
          <div className="table-loading"><Spinner /><span>Loading requests...</span></div>
        ) : requests.length ? requests.map((r, i) => {
          const badge = STATUS_BADGES[r.status] || STATUS_BADGES.PENDING;
          return (
            <div className="order-row request-row" key={r.id} style={{ animationDelay: `${i * 25}ms` }}>
              <div className="order-id"><span className="row-icon"><PackagePlus size={16} /></span><b>{r.item_name}</b></div>
              <div className="customer-cell">
                <b>Qty: {r.quantity} · Max: ₹{r.max_price}</b>
                <small>{new Date(r.created_at).toLocaleString()}</small>
                {r.admin_price && <small>Shop price: ₹{r.admin_price}</small>}
              </div>
              <span className={`request-badge ${badge.cls}`}>{badge.label}</span>
              <div className="order-actions-cell">
                {priceFor === r.id ? (
                  <div className="reply-box">
                    <input autoFocus inputMode="decimal" value={adminPrice} onChange={e => setAdminPrice(e.target.value)} placeholder="Admin price ₹" />
                    <button className="ghost-button" onClick={() => respond(r.id, 'ARRIVED', adminPrice)}>Send</button>
                    <button className="ghost-button" onClick={() => { setPriceFor(null); setAdminPrice(''); }}>✕</button>
                  </div>
                ) : (
                  <div className="request-actions">
                    <button className="ghost-button" title="Item arrived — set price" onClick={() => { setPriceFor(r.id); setAdminPrice(''); }}>✅ Arrived (price)</button>
                    <button className="ghost-button" title="Not found in market" onClick={() => respond(r.id, 'NOT_FOUND')}>❌ Not found</button>
                    <button className="ghost-button" title="Can't find under customer's price range" onClick={() => respond(r.id, 'PRICE_RANGE')}>💸 Over price</button>
                    <button className="ghost-button" title="Too heavy" onClick={() => respond(r.id, 'TOO_HEAVY')}>🏋️ Too heavy</button>
                    <button className="ghost-button" title="Mark as seen" onClick={() => respond(r.id, 'SEEN')}>👀 Seen (1-2 days)</button>
                    <button className="close-soft" aria-label="Delete request" onClick={() => remove(r)}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        }) : (
          <Empty icon={<PackagePlus size={26} />} title="No item requests" text="Customer requests for unavailable items will appear here." />
        )}
      </section>

      <div className="mobile-request-list">
        {requests.length ? requests.map(r => {
          const badge = STATUS_BADGES[r.status] || STATUS_BADGES.PENDING;
          return (
            <div className="mobile-request-card" key={r.id}>
              <div className="mobile-order-top">
                <div><span className="row-icon"><PackagePlus size={15} /></span><b>{r.item_name}</b></div>
                <span className={`request-badge ${badge.cls}`}>{badge.label}</span>
              </div>
              <small className="row-sub">Qty: {r.quantity} · Max: ₹{r.max_price}</small>
              <small className="row-sub">{new Date(r.created_at).toLocaleString()}</small>
              {r.admin_price && <small className="row-sub">Shop price: ₹{r.admin_price}</small>}
              {priceFor === r.id ? (
                <div className="reply-box">
                  <input inputMode="decimal" value={adminPrice} onChange={e => setAdminPrice(e.target.value)} placeholder="Admin price ₹" />
                  <button className="ghost-button" onClick={() => respond(r.id, 'ARRIVED', adminPrice)}>Send</button>
                  <button className="ghost-button" onClick={() => { setPriceFor(null); setAdminPrice(''); }}>✕</button>
                </div>
              ) : (
                <div className="request-actions">
                  <button className="ghost-button" onClick={() => { setPriceFor(r.id); setAdminPrice(''); }}>✅ Arrived</button>
                  <button className="ghost-button" onClick={() => respond(r.id, 'NOT_FOUND')}>❌ Not found</button>
                  <button className="ghost-button" onClick={() => respond(r.id, 'PRICE_RANGE')}>💸 Over price</button>
                  <button className="ghost-button" onClick={() => respond(r.id, 'TOO_HEAVY')}>🏋️ Too heavy</button>
                  <button className="ghost-button" onClick={() => respond(r.id, 'SEEN')}>👀 Seen</button>
                  <button className="close-soft" aria-label="Delete request" onClick={() => remove(r)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        }) : (
          <Empty icon={<PackagePlus size={26} />} title="No item requests" text="Customer requests for unavailable items will appear here." />
        )}
      </div>
    </>
  );
}

function OfflineSales({ notify }: { notify: (m: string) => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api('/products/admin'), api('/admin/sales/today')])
      .then(([p, s]) => { setProducts(p); setSales(s); })
      .catch(() => notify('Could not load offline sales'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const adjust = async (x: any, delta: number) => {
    setBusyId(x.id);
    try {
      const updated = await api(`/products/${x.id}/stock`, { method: 'PATCH', body: JSON.stringify({ delta }) });
      setProducts(current => current.map(p => p.id === x.id ? { ...p, stock_quantity: updated.stock_quantity, in_stock: updated.in_stock } : p));
      api('/admin/sales/today').then(setSales).catch(() => {});
      notify(delta < 0 ? `${x.name}: offline sale of ${-delta} recorded` : `${x.name}: +${delta} stock added`);
    } catch (e: any) {
      notify(e?.message || 'Could not update stock');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = products.filter(x => x.name.toLowerCase().includes(query.toLowerCase().trim()));

  return (
    <>
      <PageHeader
        eyebrow="COUNTER SALES"
        title="Offline Sales"
        subtitle="Tap − for each item sold at the counter (stock reduces instantly and the sale is recorded). Tap + to add stock back."
        action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>}
      />

      <div className="metric-grid offline-metrics">
        <div className="metric-card green">
          <span className="metric-icon"><CircleDollarSign size={19} /></span>
          <span className="metric-label">Today — online (delivered)</span>
          <strong>₹{sales?.online_delivered_total ?? '—'} <small className="metric-sub">({sales?.online_delivered_count ?? 0} orders)</small></strong>
        </div>
        <div className="metric-card orange">
          <span className="metric-icon"><CircleDollarSign size={19} /></span>
          <span className="metric-label">Today — online (in progress)</span>
          <strong>₹{sales?.online_pending_total ?? '—'} <small className="metric-sub">({sales?.online_pending_count ?? 0} orders)</small></strong>
        </div>
        <div className="metric-card purple">
          <span className="metric-icon"><CircleDollarSign size={19} /></span>
          <span className="metric-label">Today — offline (counter)</span>
          <strong>₹{sales?.offline_total ?? '—'} <small className="metric-sub">({sales?.offline_count ?? 0} sales)</small></strong>
        </div>
        <div className="metric-card teal">
          <span className="metric-icon"><CircleDollarSign size={19} /></span>
          <span className="metric-label">Today — GRAND TOTAL</span>
          <strong>₹{sales?.grand_total ?? '—'}</strong>
        </div>
      </div>

      {sales?.offline_sales?.length > 0 && (
        <section className="surface-card table-card offline-log">
          <div className="table-head"><span>TIME</span><span>PRODUCT</span><span>QTY</span><span>AMOUNT</span></div>
          {sales.offline_sales.map((s: any) => (
            <div className="order-row offline-log-row" key={s.id}>
              <div>{new Date(s.created_at).toLocaleTimeString()}</div>
              <div>{s.product_name}</div>
              <div>× {s.quantity}</div>
              <strong className="total-cell">₹{s.total}</strong>
            </div>
          ))}
        </section>
      )}

      {sales?.offline_sales?.length > 0 && (
        <section className="surface-card table-card mobile-sales-log">
          <div className="section-head" style={{ padding: '12px 14px 0' }}><div><span className="eyebrow">TODAY</span><h2>Counter sales log</h2></div></div>
          {sales.offline_sales.map((s: any) => (
            <div className="mobile-log-card" key={s.id}>
              <div className="mobile-order-top"><b>{s.product_name}</b><strong>₹{s.total}</strong></div>
              <small className="row-sub">× {s.quantity} · {new Date(s.created_at).toLocaleTimeString()}</small>
            </div>
          ))}
        </section>
      )}

      <div className="toolbar simple-toolbar">
        <div className="admin-search"><Search size={17} /><input placeholder="Search products..." value={query} onChange={e => setQuery(e.target.value)} /></div>
        <span className="toolbar-count">{filtered.length} products · stock updates instantly</span>
      </div>

      <section className="surface-card table-card">
        <div className="table-head"><span>PRODUCT</span><span>PRICE</span><span>STOCK</span><span>SELL / RESTOCK (+/−)</span></div>
        {loading ? (
          <div className="table-loading"><Spinner /><span>Loading products...</span></div>
        ) : filtered.length ? filtered.map(x => (
          <div className="order-row" key={x.id}>
            <div className="customer-cell"><b>{x.name}</b><small>{x.unit}</small></div>
            <strong className="total-cell">₹{x.price}</strong>
            <div><b>{x.stock_quantity}</b> <small>{x.stock_quantity > 0 ? 'in stock' : 'out'}</small></div>
            <div className="order-actions-cell">
              <div className="stock-stepper">
                <button className="ghost-button" title="Sell 1 (offline sale)" disabled={busyId === x.id || x.stock_quantity < 1} onClick={() => adjust(x, -1)}>−</button>
                <b>{x.stock_quantity}</b>
                <button className="ghost-button" title="Add 1 stock" disabled={busyId === x.id} onClick={() => adjust(x, 1)}>+</button>
              </div>
            </div>
          </div>
        )) : <Empty icon={<Package size={26} />} title="No products" text="Add products first." />}
      </section>

      <div className="mobile-sales-list">
        {loading ? (
          <div className="table-loading"><Spinner /><span>Loading products...</span></div>
        ) : filtered.length ? filtered.map(x => (
          <div className="mobile-sale-card" key={x.id}>
            <div className="mobile-order-top">
              <div><b>{x.name}</b><small className="row-sub">{x.unit}</small></div>
              <strong>₹{x.price}</strong>
            </div>
            <div className="mobile-order-bottom">
              <small><b>{x.stock_quantity}</b> {x.stock_quantity > 0 ? 'in stock' : 'out'}</small>
              <div className="stock-stepper">
                <button className="ghost-button" title="Sell 1 (offline sale)" disabled={busyId === x.id || x.stock_quantity < 1} onClick={() => adjust(x, -1)}>−</button>
                <b>{x.stock_quantity}</b>
                <button className="ghost-button" title="Add 1 stock" disabled={busyId === x.id} onClick={() => adjust(x, 1)}>+</button>
              </div>
            </div>
          </div>
        )) : <Empty icon={<Package size={26} />} title="No products" text="Add products first." />}
      </div>
    </>
  );
}

function Products({ notify }: { notify: (m: string) => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    name: '', price: '', unit: '1 piece', category_id: null, description: '',
    image_url: '', is_available: true, in_stock: true, stock_quantity: 10
  });
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saleMode, setSaleMode] = useState(false);
  const [editFor, setEditFor] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({ name: '', price: '', normal_price: '', stock: '' });

  const load = () => Promise.all([
    api('/products/admin').then(setProducts).catch(() => setProducts([])),
    api('/shop').then((s: any) => setSaleMode(!!s.sale_mode)).catch(() => {}),
  ]);
  useEffect(() => { load(); api('/categories').then(setCategories).catch(() => setCategories([])); }, []);

  const photo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current: any) => ({ ...current, image_url: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.name.trim() || form.price === '') {
      notify('Product name and price are required');
      return;
    }
    setSaving(true);
    try {
      const quantity = Math.max(0, Number(form.stock_quantity) || 0);
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          price: String(form.price),
          category_id: form.category_id ? Number(form.category_id) : null,
          stock_quantity: quantity,
          in_stock: quantity > 0
        })
      });
      setForm({ ...form, name: '', price: '', image_url: '', stock_quantity: 10 });
      setShowAdd(false);
      load();
      notify('Product added');
    } catch (e: any) {
      notify(e?.message || 'Could not add product');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (x: any) => {
    setEditFor(x);
    setEditForm({ name: x.name, price: String(x.price), normal_price: String(x.original_price ?? ''), stock: String(x.stock_quantity ?? (x.in_stock ? 10 : 0)) });
  };

  const saveEdit = async () => {
    const x = editFor;
    if (!x || !editForm.name?.trim() || editForm.price === '') { notify('Name and price are required'); return; }
    try {
      const quantity = Math.max(0, Number(editForm.stock) || 0);
      await api(`/products/${x.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...x, name: editForm.name.trim(), price: String(editForm.price),
          original_price: editForm.normal_price === '' ? null : String(editForm.normal_price),
          category_id: x.category_id || null, stock_quantity: quantity, in_stock: quantity > 0
        })
      });
      setEditFor(null);
      load();
      notify(saleMode && Number(editForm.price) < Number(x.price) ? `Sale price saved — ${x.name} is now ₹${editForm.price}` : 'Product updated');
    } catch (e: any) {
      notify(e?.message || 'Could not update product');
    }
  };

  const editDiscount = (() => {
    if (!editFor) return null;
    const base = Number(editFor.original_price ?? editFor.price);
    const now = Number(editForm.price);
    if (!Number.isFinite(base) || !Number.isFinite(now) || now <= 0 || now >= base) return null;
    return Math.round((base - now) / base * 100);
  })();

  const remove = async (x: any) => {
    if (!window.confirm(`Delete "${x.name}"?`)) return;
    try {
      await api(`/products/${x.id}`, { method: 'DELETE' });
      load();
      notify('Product deleted');
    } catch (e: any) {
      notify(e?.message || 'Could not delete product');
    }
  };

  const filtered = products.filter(x => {
    const matchesQuery = x.name.toLowerCase().includes(query.toLowerCase().trim());
    const matchesStock = stockFilter === 'ALL' || (stockFilter === 'LOW' ? x.stock_quantity > 0 && x.stock_quantity <= 5 : x.stock_quantity === 0);
    return matchesQuery && matchesStock;
  });

  return (
    <>
      <PageHeader
        eyebrow="CATALOG"
        title="Products"
        subtitle={`${products.length} products in your catalog.${saleMode ? ' 🔥 SALE MODE ON — prices you edit become discounted prices.' : ''}`}
        action={
          <div className="page-header-actions">
            <button className={saleMode ? 'primary-button sale-toggle' : 'ghost-button'} onClick={async () => {
              const next = !saleMode;
              try {
                const s = await api('/shop');
                await api('/shop', { method: 'PUT', body: JSON.stringify({ ...s, sale_mode: next }) });
                setSaleMode(next);
                notify(next ? '🔥 Sale mode ON — edit prices to create discounts' : 'Sale mode OFF — all prices restored to normal');
                if (!next) load();
              } catch (e: any) { notify(e?.message || 'Could not toggle sale mode'); }
            }}>
              {saleMode ? '🔥 Sale is ON — tap to end' : 'Start sale mode'}
            </button>
            <button className="primary-button" onClick={() => setShowAdd(v => !v)}><Plus size={17} /> Add product</button>
          </div>
        }
      />

      {showAdd && (
        <section className="surface-card add-product-panel">
          <div className="section-head">
            <div><span className="eyebrow">NEW PRODUCT</span><h2>Add a product</h2></div>
            <button className="close-soft" onClick={() => setShowAdd(false)}><X size={17} /></button>
          </div>
          <div className="product-form-grid">
            <label>Product name<input placeholder="e.g. Fresh milk" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label>Price<input inputMode="decimal" placeholder="₹0.00" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></label>
            <label>Unit<input placeholder="1 piece" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
            <label>Category<select value={form.category_id || ''} onChange={e => setForm({ ...form, category_id: e.target.value })}><option value="">No category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Stock quantity<input type="number" min="0" value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} /></label>
            <label className="file-upload">Product photo<input type="file" accept="image/*" capture="environment" onChange={photo} /><span>📷 Choose or take a photo</span></label>
            <label className="full">Description<textarea placeholder="Optional product description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          {form.image_url && <img className="image-preview" src={form.image_url} alt="Product preview" />}
          <div className="form-actions"><button className="ghost-button" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-button" disabled={saving} onClick={save}>{saving ? <Spinner /> : <><Save size={16} /> Save product</>}</button></div>
        </section>
      )}

      <div className="toolbar simple-toolbar">
        <div className="admin-search"><Search size={17} /><input placeholder="Search products..." value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="filter-scroll product-filters"><button className={stockFilter === 'ALL' ? 'filter-active' : ''} onClick={() => setStockFilter('ALL')}>All</button><button className={stockFilter === 'LOW' ? 'filter-active' : ''} onClick={() => setStockFilter('LOW')}>Low stock</button><button className={stockFilter === 'OUT' ? 'filter-active' : ''} onClick={() => setStockFilter('OUT')}>Out</button><span className="toolbar-count">{filtered.length} shown</span></div>
      </div>

      <div className="product-admin-grid">
        {filtered.length ? filtered.map((x, i) => (
          <article className="admin-product-card" key={x.id} style={{ animationDelay: `${i * 30}ms` }}>
            <div className="admin-product-image">
              {x.image_url ? <img src={x.image_url} alt={x.name} /> : <Package size={34} />}
              <span className={x.stock_quantity > 0 ? 'stock-badge' : 'stock-badge out'}>{x.stock_quantity > 0 ? 'In stock' : 'Out of stock'}</span>
            </div>
            <div className="admin-product-info">
              <div className="product-category">{categories.find(c => c.id === x.category_id)?.name || 'Uncategorized'}</div>
              <h3>{x.name}</h3>
              <p>{x.unit}</p>
              <div className="admin-product-bottom sale-price-row">
                <span className="sale-prices">
                  {x.original_price != null && Number(x.original_price) > Number(x.price) && (
                    <s className="old-price">₹{x.original_price}</s>
                  )}
                  <strong>₹{x.price}</strong>
                  {x.discount_percent != null && x.discount_percent > 0 && (
                    <span className="discount-badge">{x.discount_percent}% OFF</span>
                  )}
                </span>
                <span>{x.stock_quantity || 0} units</span>
              </div>
              <div className="card-actions">
                <button className="edit-action" onClick={() => openEdit(x)}><Pencil size={14} /> Edit</button>
                <button className="delete-action" onClick={() => remove(x)}><Trash2 size={14} /></button>
              </div>
            </div>
          </article>
        )) : <Empty icon={<Package size={26} />} title="No products found" text="Add a product or change your search." />}
      </div>

      {editFor && (
        <section className="surface-card add-product-panel edit-product-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">EDIT PRODUCT</span>
              <h2>{editFor.name}</h2>
              {saleMode && <span className="sale-mode-note">🔥 Sale mode is ON — a lower price becomes a discounted price</span>}
            </div>
            <button className="close-soft" onClick={() => setEditFor(null)}><X size={17} /></button>
          </div>
          <div className="product-form-grid">
            <label>Product name<input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></label>
            <label>
              {saleMode && editFor.original_price != null ? `Sale price (was ₹${editFor.original_price})` : 'Price'}
              <input inputMode="decimal" placeholder="₹0.00" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} />
            </label>
            <label>Normal price (optional)
              <input inputMode="decimal" placeholder="₹0.00" value={editForm.normal_price} onChange={e => setEditForm({ ...editForm, normal_price: e.target.value })} />
            </label>
            <label>Stock quantity<input type="number" min="0" value={editForm.stock} onChange={e => setEditForm({ ...editForm, stock: e.target.value })} /></label>
          </div>
          {saleMode && (
            <div className="sale-preview">
              <span>Normal price: <b>₹{editFor.original_price ?? editFor.price}</b></span>
              <span>Sale price: <b>₹{editForm.price || '—'}</b></span>
              {editDiscount != null && <span className="discount-badge">{editDiscount}% OFF for customers</span>}
            </div>
          )}
          <div className="form-actions">
            <button className="ghost-button" onClick={() => setEditFor(null)}>Cancel</button>
            <button className="primary-button" onClick={saveEdit}><Save size={16} /> Save changes</button>
          </div>
        </section>
      )}
    </>
  );
}

function Customers({ notify }: { notify: (m: string) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api('/customers/admin').then(setCustomers).catch(() => setCustomers([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = customers.filter(x => {
    const q = query.toLowerCase().trim();
    const matchesQuery = !q || String(x.name).toLowerCase().includes(q) || String(x.phone).includes(q);
    return matchesQuery && !!x.is_hidden === showHidden && (statusFilter === 'ALL' || x.verification_status === statusFilter);
  });

  const toggle = async (x: any) => {
    try {
      const status = x.verification_status === 'verified' ? 'unverified' : 'verified';
      await api(`/customers/${x.id}/verification?status=${status}`, { method: 'PATCH' });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, verification_status: status } : c));
      notify(status === 'verified' ? 'Customer verified' : 'Customer unverified');
    } catch (e: any) {
      notify(e?.message || 'Could not update customer');
    }
  };

  const toggleBan = async (x: any) => {
    const banned = x.is_active !== false;
    const reason = banned ? window.prompt('Reason for banning this customer:')?.trim() : '';
    if (banned && !reason) return;
    try {
      const updated = await api(`/customers/${x.id}/ban`, {
        method: 'PATCH',
        body: JSON.stringify({ banned, reason: reason || null }),
      });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, ...updated } : c));
      notify(banned ? 'Customer banned' : 'Customer unbanned');
    } catch (e: any) {
      notify(e?.message || 'Could not update customer ban status');
    }
  };

  const toggleHidden = async (x: any) => {
    try {
      const updated = await api(`/customers/${x.id}/hidden`, { method: 'PATCH', body: JSON.stringify({ hidden: !x.is_hidden }) });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, ...updated } : c));
      notify(updated.is_hidden ? `${x.name} moved to service customers` : `${x.name} restored to customers`);
    } catch (e: any) {
      notify(e?.message || 'Could not update customer');
    }
  };

  return (
    <>
      <PageHeader eyebrow="CUSTOMER MANAGEMENT" title="Customers" subtitle={`${customers.length} registered customers.`} action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>} />
      <div className="toolbar simple-toolbar">
        <div className="admin-search"><Search size={17} /><input placeholder="Search name or phone..." value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="filter-scroll customer-filters">
          <button className={showHidden ? 'filter-active' : ''} onClick={() => setShowHidden(v => !v)}><EyeOff size={14} /> {showHidden ? 'Service customers' : 'Hide service customers'}</button>
          <button className={statusFilter === 'ALL' ? 'filter-active' : ''} onClick={() => setStatusFilter('ALL')}>All</button><button className={statusFilter === 'pending' ? 'filter-active' : ''} onClick={() => setStatusFilter('pending')}>Pending</button><button className={statusFilter === 'verified' ? 'filter-active' : ''} onClick={() => setStatusFilter('verified')}>Verified</button><span className="toolbar-count">{filtered.length} customers</span></div>
      </div>
      <section className="customer-grid">
        {loading ? <div className="surface-card loading-panel"><Spinner /> Loading customers...</div> :
          filtered.length ? filtered.map((x, i) => (
            <article className="customer-card" key={x.id} style={{ animationDelay: `${i * 25}ms` }}>
              <div className="customer-top">
                <div className="customer-avatar">{String(x.name || 'U').charAt(0).toUpperCase()}</div>
                <div className="customer-heading"><h3>{x.name}</h3><span>{x.phone}</span></div>
                <span className={`verification-badge ${x.verification_status === 'verified' ? 'verified' : ''}`}>
                  {x.verification_status === 'verified' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                  {x.verification_status}
                </span>
                {x.is_active === false && <span className="verification-badge">BANNED</span>}
                {x.is_hidden && <span className="verification-badge"><EyeOff size={13} /> SERVICE</span>}
              </div>
              <div className="customer-meta">
                <div><small>VERIFICATION CODE</small><b>{x.verification_code || '—'}</b></div>
                <div><small>CREDIT BALANCE</small><b>₹{x.credit_balance}</b></div>
              </div>
              {x.is_active === false && <div className="customer-ban-reason"><small>BAN REASON</small><span>{x.ban_reason || 'No reason provided.'}</span></div>}
              <button className={x.verification_status === 'verified' ? 'secondary-button' : 'primary-button'} onClick={() => toggle(x)}>
                {x.verification_status === 'verified' ? 'Mark unverified' : <><UserCheck size={16} /> Verify customer</>}
              </button>
              <button className="secondary-button" onClick={() => toggleBan(x)}>
                {x.is_active === false ? <><Power size={16} /> Unban customer</> : <><Ban size={16} /> Ban customer</>}
              </button>
              <button className="secondary-button" onClick={() => toggleHidden(x)}>
                {x.is_hidden ? <><Eye size={16} /> Restore to customers</> : <><EyeOff size={16} /> Move to service customers</>}
              </button>
              <button className="secondary-button danger-button" onClick={async () => {
                if (!window.confirm(`Delete ${x.name} permanently? This removes their orders and account.`)) return;
                try { await api(`/customers/${x.id}`, { method: 'DELETE' }); setCustomers(current => current.filter(c => c.id !== x.id)); notify('Customer deleted'); }
                catch (e: any) { notify(e?.message || 'Could not delete customer'); }
              }}><Trash2 size={16} /> Delete customer</button>
            </article>
          )) : <Empty icon={<Users size={26} />} title="No customers found" text="Try a different search." />}
      </section>
    </>
  );
}

function Credits({ notify }: { notify: (m: string) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [exactBalances, setExactBalances] = useState<Record<number, string>>({});
  const [debts, setDebts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api('/customers/admin').then(setCustomers).catch(() => setCustomers([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const adjust = async (x: any) => {
    const amount = Number(amounts[x.id]);
    if (!Number.isFinite(amount) || amount === 0) {
      notify('Enter a non-zero amount');
      return;
    }
    try {
      const updated = await api(`/customers/${x.id}/credit/change`, {
        method: 'POST',
        body: JSON.stringify({ amount, note: 'Admin adjustment' })
      });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, credit_balance: updated.credit_balance, debt_balance: updated.debt_balance } : c));
      setAmounts(current => ({ ...current, [x.id]: '' }));
      notify('Credit balance updated');
    } catch (e: any) {
      notify(e?.message || 'Could not update credit');
    }
  };

  const setExact = async (x: any) => {
    const balance = Number(exactBalances[x.id]);
    if (!Number.isFinite(balance) || balance < 0) { notify('Enter a valid balance'); return; }
    try {
      const updated = await api(`/customers/${x.id}/credit/set`, { method: 'POST', body: JSON.stringify({ balance, note: 'Exact balance set by admin' }) });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, credit_balance: updated.credit_balance, debt_balance: updated.debt_balance } : c));
      setExactBalances(current => ({ ...current, [x.id]: '' }));
      notify('Exact credit balance saved');
    } catch (e: any) { notify(e?.message || 'Could not set credit'); }
  };

  const changeDebt = async (x: any) => {
    const amount = Number(debts[x.id]);
    if (!Number.isFinite(amount) || amount === 0) { notify('Enter a non-zero debt amount'); return; }
    try {
      const updated = await api(`/customers/${x.id}/debt/change`, { method: 'POST', body: JSON.stringify({ amount, note: 'Admin debt adjustment' }) });
      setCustomers(current => current.map(c => c.id === x.id ? { ...c, credit_balance: updated.credit_balance, debt_balance: updated.debt_balance } : c));
      setDebts(current => ({ ...current, [x.id]: '' }));
      notify(amount > 0 ? 'Debt added' : 'Debt payment recorded');
    } catch (e: any) { notify(e?.message || 'Could not update debt'); }
  };

  return (
    <>
      <PageHeader eyebrow="FINANCE" title="Credits" subtitle="Adjust customer credit balances securely." action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Refresh</button>} />
      <section className="customer-grid credit-grid">
        {loading ? <div className="surface-card loading-panel"><Spinner /> Loading balances...</div> :
          customers.length ? customers.map((x, i) => (
            <article className="credit-card" key={x.id} style={{ animationDelay: `${i * 25}ms` }}>
              <div className="credit-head">
                <div className="customer-avatar"><CircleDollarSign size={20} /></div>
                <div><h3>{x.name}</h3><small>{x.phone}</small></div>
              </div>
              <span className="eyebrow">CURRENT CREDIT</span>
              <strong className="credit-value">₹{x.credit_balance}</strong>
              <span className="debt-value">Outstanding debt: ₹{x.debt_balance || 0}</span>
              <div className="credit-adjust">
                <input
                  inputMode="decimal"
                  placeholder="+ / − amount"
                  value={amounts[x.id] || ''}
                  onChange={e => setAmounts({ ...amounts, [x.id]: e.target.value })}
                />
                <button className="primary-button" onClick={() => adjust(x)}>Adjust</button>
              </div>
              <div className="credit-adjust exact-credit"><input inputMode="decimal" placeholder="Set exact balance" value={exactBalances[x.id] || ''} onChange={e => setExactBalances({ ...exactBalances, [x.id]: e.target.value })} /><button className="secondary-button" onClick={() => setExact(x)}>Set</button></div>
              <div className="credit-adjust debt-adjust"><input inputMode="decimal" placeholder="Debt + / payment -" value={debts[x.id] || ''} onChange={e => setDebts({ ...debts, [x.id]: e.target.value })} /><button className="secondary-button" onClick={() => changeDebt(x)}>Update debt</button></div>
              <small className="credit-help">Use a positive value to add credit, negative to deduct.</small>
            </article>
          )) : <Empty icon={<CreditCard size={26} />} title="No customers" text="Customer credit balances will appear here." />}
      </section>
    </>
  );
}

function Notifications({ notify }: { notify: (m: string) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({ customer_id: '', title: 'Credit Update', message: '' });
  const [sending, setSending] = useState(false);
  const loadCustomers = () => api('/customers/admin').then(setCustomers).catch(() => setCustomers([]));

  useEffect(() => { loadCustomers(); }, []);

  const send = async () => {
    if (!form.customer_id || !form.message.trim()) {
      notify('Select a customer and enter a message');
      return;
    }
    setSending(true);
    try {
      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify({ ...form, customer_id: Number(form.customer_id), message: form.message.trim() })
      });
      setForm({ ...form, message: '' });
      notify('Notification sent');
    } catch (e: any) {
      notify(e?.message || 'Could not send notification');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="CUSTOMER COMMUNICATION" title="Notifications" subtitle="Send a direct update to a customer." action={<button className="ghost-button" onClick={loadCustomers}><RefreshCw size={15} /> Refresh recipients</button>} />
      <div className="notification-layout">
        <section className="surface-card notification-compose">
          <div className="section-head"><div><span className="eyebrow">COMPOSE</span><h2>New notification</h2></div><Send size={21} /></div>
          <label>Customer<select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}><option value="">Select customer</option>{customers.map(x => <option key={x.id} value={x.id}>{x.name} · {x.phone}</option>)}</select></label>
          <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Message<textarea placeholder="Write your message..." value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} /></label>
          <button className="primary-button" disabled={sending} onClick={send}>{sending ? <Spinner /> : <><Send size={16} /> Send notification</>}</button>
        </section>
        <section className="surface-card communication-tip">
          <div className="tip-icon"><Bell size={19} /></div>
          <span className="eyebrow">GOOD TO KNOW</span>
          <h2>Keep customers informed.</h2>
          <p>Use notifications for important account, credit or order-related updates. Keep the message short and actionable.</p>
        </section>
      </div>
    </>
  );
}

function Categories({ notify }: { notify: (m: string) => void }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api('/categories/admin').then(setCategories).catch(() => setCategories([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api('/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setName('');
      load();
      notify('Category added');
    } catch (e: any) { notify(e?.message || 'Could not add category'); }
  };

  return (
    <>
      <PageHeader eyebrow="CATALOG ORGANIZATION" title="Categories" subtitle="Organize the customer catalog into clear groups." />
      <section className="surface-card category-create">
        <div className="category-create-copy"><span className="category-create-icon"><Tag size={18} /></span><div><b>Add category</b><small>Create a new catalog category.</small></div></div>
        <div className="inline-create"><input placeholder="Category name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} /><button className="primary-button" onClick={add}><Plus size={16} /> Add</button></div>
      </section>
      <section className="category-admin-grid">
        {loading ? <div className="surface-card loading-panel"><Spinner /> Loading categories...</div> :
          categories.length ? categories.map((x, i) => (
            <article className="category-admin-card" key={x.id} style={{ animationDelay: `${i * 30}ms` }}>
              <span className="category-number">{String(i + 1).padStart(2, '0')}</span>
              <div><h3>{x.name}</h3><small>Category #{x.id}</small></div>
              <div className="category-actions">
                <button onClick={async () => {
                  const n = window.prompt('New name', x.name);
                  if (n && n.trim()) { try { await api(`/categories/${x.id}`, { method: 'PUT', body: JSON.stringify({ ...x, name: n.trim() }) }); load(); notify('Category updated'); } catch (e: any) { notify(e?.message || 'Could not update category'); } }
                }}><Pencil size={14} /></button>
                <button className="danger-icon" onClick={async () => {
                  if (!window.confirm(`Disable "${x.name}"?`)) return;
                  try { await api(`/categories/${x.id}`, { method: 'DELETE' }); load(); notify('Category disabled'); } catch (e: any) { notify(e?.message || 'Could not disable category'); }
                }}><Trash2 size={14} /></button>
              </div>
            </article>
          )) : <Empty icon={<Tag size={26} />} title="No categories" text="Create your first catalog category above." />}
      </section>
    </>
  );
}

function SettingsPage({ notify }: { notify: (m: string) => void }) {
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api('/shop').then(setS).catch((e: any) => { setS(null); setError(e?.message || 'Could not load shop settings.'); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading-panel surface-card"><Spinner /> Loading shop settings...</div>;
  if (!s) return <div className="surface-card loading-panel"><div><b>Shop settings could not be loaded.</b><p>{error}</p><button className="ghost-button" onClick={load}><RefreshCw size={15} /> Retry</button></div></div>;

  const save = async () => {
    setSaving(true);
    try {
      await api('/shop', { method: 'PUT', body: JSON.stringify(s) });
      notify('Shop settings saved');
    } catch (e: any) {
      notify(e?.message || 'Could not save settings');
    } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader eyebrow="STORE CONTROL" title="Shop settings" subtitle="Control how your store appears and operates." action={<button className="ghost-button" onClick={load}><RefreshCw size={15} /> Reload</button>} />
      <div className="settings-layout">
        <section className="surface-card settings-card">
          <div className="section-head"><div><span className="eyebrow">GENERAL</span><h2>Store profile</h2></div><Store size={21} /></div>
          <label>Shop name<input value={s.shop_name || ''} onChange={e => setS({ ...s, shop_name: e.target.value })} /></label>
          <label>Expected opening time<input placeholder="e.g. 09:00 AM" value={s.reopening_time || ''} onChange={e => setS({ ...s, reopening_time: e.target.value })} /></label>
          <label>Announcement<textarea placeholder="Optional announcement" value={s.announcements || ''} onChange={e => setS({ ...s, announcements: e.target.value })} /></label>
        </section>

        <section className="surface-card settings-card">
          <div className="section-head"><div><span className="eyebrow">AVAILABILITY</span><h2>Store controls</h2></div><Power size={21} /></div>
          <ToggleRow title="Shop open" text={s.is_open ? 'Customers can currently shop.' : 'Customers will see the store as closed.'} checked={!!s.is_open} onChange={v => setS({ ...s, is_open: v })} />
          <ToggleRow title="Home delivery" text={s.home_delivery_enabled ? 'Delivery orders are enabled.' : 'Delivery orders are disabled.'} checked={!!s.home_delivery_enabled} onChange={v => setS({ ...s, home_delivery_enabled: v })} />
          <ToggleRow title="Sale mode" text={s.sale_mode ? 'SALE IS ON — price edits become discounted prices. Customers see the old price cut with a % off badge.' : 'Off — everything is at normal prices. Turn on to run a sale.'} checked={!!s.sale_mode} onChange={v => setS({ ...s, sale_mode: v })} />
          <label>Minimum amount for home delivery<input type="number" min="0" step="0.01" value={s.minimum_home_delivery_amount ?? 0} onChange={e => setS({ ...s, minimum_home_delivery_amount: e.target.value })} /></label>
          <div className="settings-save"><button className="primary-button" disabled={saving} onClick={save}>{saving ? <Spinner /> : <><Save size={16} /> Save changes</>}</button></div>
        </section>
      </div>
    </>
  );
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
      {action}
    </div>
  );
}

function QuickAction({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{text}</small></div><ChevronRight size={16} /></button>;
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="status-row"><span>{label}</span><b className={good ? 'good' : 'warn'}><i />{value}</b></div>;
}

function ToggleRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="toggle-row"><div><b>{title}</b><small>{text}</small></div><button className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><i />{formatStatus(status)}</span>;
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>;
}

function Spinner() { return <span className="spinner" aria-label="Loading" />; }

function formatStatus(value: string) {
  return value.split('_').join(' ');
}

createRoot(document.getElementById('root')!).render(<App />);

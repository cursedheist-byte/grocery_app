import React, { useEffect, useMemo, useState } from 'react';
import {
  Home,
  ShoppingCart,
  ClipboardList,
  UserRound,
  Search,
  Plus,
  Minus,
  Bell,
  MapPin,
  X,
  ChevronRight,
  Package,
  Clock3,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Heart,
  Trash2,
  SlidersHorizontal,
  MessageCircle,
  ListChecks,
  PackagePlus,
  Save,
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api } from './api/client';
import { enablePushNotifications } from './push';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: { theme: string; size: string; width: number }) => void;
        };
      };
    };
  }
}

type Product = {
  id: number;
  name: string;
  price: string;
  unit: string;
  image_url?: string;
  category_id?: number;
  stock_quantity: number;
  in_stock: boolean;
  original_price?: string | null;
  discount_percent?: number | null;
};

type Cart = {
  items: {
    product_id: number;
    product_name: string;
    quantity: number;
    price: string;
    line_total: string;
  }[];
  subtotal: string;
};

type ShopImageSlots = {
  loading_image_url?: string | null;
  home_hero_image_url?: string | null;
  cart_empty_image_url?: string | null;
  orders_empty_image_url?: string | null;
  debt_image_url?: string | null;
  support_avatar_image_url?: string | null;
  lists_page_image_url?: string | null;
  requests_page_image_url?: string | null;
  image_styles?: Record<string, ImageStyle> | null;
};

type ImageStyle = {
  fit?: 'contain' | 'cover';
  zoom?: number;
  x?: number;
  y?: number;
  rotation?: number;
  aspect?: '1:1' | '4:3' | '16:9' | '3:2' | '9:16' | 'custom';
  aspectRatio?: number;
};

function imagePresentation(style?: ImageStyle | null): React.CSSProperties {
  const x = Number(style?.x) || 0;
  const y = Number(style?.y) || 0;
  const zoom = Math.max(1, Number(style?.zoom) || 1);
  return {
    objectFit: style?.fit === 'cover' ? 'cover' : 'contain',
    objectPosition: `${50 + x / 2}% ${50 + y / 2}%`,
    transform: `translate(${x / 2}%, ${y / 2}%) scale(${zoom}) rotate(${Number(style?.rotation) || 0}deg)`,
  };
}

function imageFrame(style?: ImageStyle | null): React.CSSProperties {
  const aspectRatio = Number(style?.aspectRatio) || 0;
  const ratio = aspectRatio > 0 ? aspectRatio :
    style?.aspect === '9:16' ? 9 / 16 :
    style?.aspect === '16:9' ? 16 / 9 :
    style?.aspect === '4:3' ? 4 / 3 :
    style?.aspect === '3:2' ? 3 / 2 :
    style?.aspect === '1:1' ? 1 : undefined;
  return ratio ? { aspectRatio: ratio, height: 'auto' } : {};
}

const emptyCart: Cart = { items: [], subtotal: '0' };
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '1036431438018-ntbgharbt6juho50d4ohra63gg49q4l3.apps.googleusercontent.com';

function playSfx(type: 'success' | 'error' | 'click') {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const frequencies = type === 'success' ? [520, 740] : type === 'error' ? [220, 165] : [380];
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequencies[0], now);
  if (frequencies[1]) oscillator.frequency.setValueAtTime(frequencies[1], now + .08);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(type === 'click' ? .025 : .055, now + .01);
  gain.gain.exponentialRampToValueAtTime(.0001, now + (type === 'click' ? .07 : .18));
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (type === 'click' ? .08 : .2));
}

function App() {
  document.documentElement.dataset.theme = 'dark';
  const [me, setMe] = useState<any>(() => { try { return JSON.parse(localStorage.getItem('customer_profile') || 'null'); } catch { return null; } });
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [shop, setShop] = useState<any>(null);
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [tab, setTab] = useState('home');
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<any[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleCredential, setGoogleCredential] = useState('');
  const [realName, setRealName] = useState('');
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<number[]>(() => JSON.parse(localStorage.getItem('grocery_favorites') || '[]'));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    playSfx(/could not|unable|failed|unavailable|insufficient|empty/i.test(message) ? 'error' : 'success');
    window.setTimeout(() => setToast(''), 2600);
  };

  const load = async () => {
    try {
      setError('');
      const s = await api('/shop');
      setShop(s);
      setCats(await api('/categories'));
      setProducts(await api('/products'));

      if (localStorage.getItem('customer_token')) {
        const customer = await api('/customers/me');
        setMe(customer);
        localStorage.setItem('customer_profile', JSON.stringify(customer));

        if (customer.verification_status === 'verified') {
          setCart(await api('/cart'));
        }

        setNotice(await api('/notifications/me'));

        // Register this device for real push notifications (FCM).
        enablePushNotifications(
          async (token) => {
            await api('/notifications/register-token', {
              method: 'POST',
              body: JSON.stringify({ token, platform: 'web' }),
            });
          },
          (title, body) => {
            showToast(`${title}${body ? ' — ' + body : ''}`);
            api('/notifications/me').then(setNotice).catch(() => {});
          },
        );
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load the store right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-box input')?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    const goHome = () => setTab('home');
    window.addEventListener('customer-home', goHome);
    return () => { window.removeEventListener('customer-home', goHome); window.removeEventListener('keydown', onShortcut); };
  }, []);

  const toggleFavorite = (id: number) => {
    setFavorites(current => {
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      localStorage.setItem('grocery_favorites', JSON.stringify(next));
      return next;
    });
  };

  const loginWithGoogle = async () => {
    setGoogleLoading(true);
    try {
      const r = await api('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: googleCredential, real_name: realName.trim() }),
      });
      localStorage.setItem('customer_token', r.access_token);
      if (r.name) {
        localStorage.setItem('customer_profile', JSON.stringify(r));
      }
      setMe(r);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Google login failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleCredential = (credential: string) => {
    setError('');
    setGoogleCredential(credential);
  };

  useEffect(() => {
    if (me) return;
    const renderGoogleButton = () => {
      const target = document.getElementById('google-login-button');
      if (!target || !window.google) return false;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: ({ credential }) => handleGoogleCredential(credential) });
      window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', width: 340 });
      return true;
    };
    if (renderGoogleButton()) return;
    const timer = window.setInterval(() => { if (renderGoogleButton()) window.clearInterval(timer); }, 200);
    return () => window.clearInterval(timer);
  }, [me]);

  const add = async (id: number) => {
    setActionId(id);
    try {
      setCart(
        await api('/cart/items', {
          method: 'POST',
          body: JSON.stringify({ product_id: id, quantity: 1 }),
        }),
      );
      showToast('Added to cart');
    } catch (e: any) {
      showToast(e?.message || 'Could not add this item.');
    } finally {
      setActionId(null);
    }
  };

  const change = async (id: number, qty: number) => {
    setActionId(id);
    try {
      setCart(
        qty < 1
          ? await api(`/cart/items/${id}`, { method: 'DELETE' })
          : await api(`/cart/items/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ product_id: id, quantity: qty }),
            }),
      );
    } catch (e: any) {
      showToast(e?.message || 'Could not update the cart.');
    } finally {
      setActionId(null);
    }
  };

  const brands = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const brand = p.name.split(/\s+(?:\d)/)[0].trim();
      if (brand) set.add(brand);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 12);
  }, [products]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return products.filter((p) => {
      const matchesSearch = !query || p.name.toLowerCase().includes(query);
      const matchesCategory =
        selectedCategory === null || p.category_id === selectedCategory;
      const matchesFavorites = !favoritesOnly || favorites.includes(p.id);
      const matchesBrand = !selectedBrand || p.name.toLowerCase().startsWith(selectedBrand.toLowerCase());
      return matchesSearch && matchesCategory && matchesFavorites && matchesBrand;
    });
  }, [products, q, selectedCategory, favoritesOnly, favorites, selectedBrand]);

  const cartCount = cart.items.reduce((total, item) => total + item.quantity, 0);

  if (loading) {
    return <LoadingScreen shopName={shop?.shop_name} imageUrl={shop?.loading_image_url} imageStyle={shop?.image_styles?.loading_image_url} />;
  }

  if (!me) {
    return (
      <div className="auth-shell">
        <div className="auth-decoration auth-decoration-one" />
        <div className="auth-decoration auth-decoration-two" />

        <div className="auth-content">
          <div className="auth-brand">
            <span className="brand-mark">🛒</span>
            <span>{shop?.shop_name || 'Local Store'}</span>
          </div>

          <div className="auth-card">
            <div className="eyebrow">LOCAL SHOPPING, MADE SIMPLE</div>
            <h1>Everything you need, closer to home.</h1>
            <p>Sign in securely with Google, then enter the name you want to use for your orders.</p>

            {error && <ErrorBanner message={error} onRetry={load} />}

            <div className="auth-form">
              {!googleCredential ? (
                <div id="google-login-button" />
              ) : (
                <form onSubmit={(event) => { event.preventDefault(); loginWithGoogle(); }}>
                  <label>
                    Real name
                    <input
                      autoFocus
                      required
                      minLength={2}
                      maxLength={120}
                      value={realName}
                      onChange={(event) => setRealName(event.target.value)}
                      placeholder="Enter your real name"
                    />
                  </label>
                  <button className="primary-button" disabled={googleLoading || realName.trim().length < 2}>
                    {googleLoading ? <Spinner /> : 'Continue'}
                  </button>
                </form>
              )}
              {googleLoading && <Spinner />}
            </div>
          </div>

          <div className="auth-note">
            <CheckCircle2 size={16} />
            Fast, local and designed for everyday shopping.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-page-theme={tab}>
      <header className="site-header">
        <div className="header-inner">
          <button className="brand-button" onClick={() => { setTab('home'); setQ(''); setSelectedCategory(null); }}>
            <span className="brand-mark small">🛒</span>
            <span className="brand-copy">
              <b>{shop?.shop_name || 'Local Store'}</b>
              <small>
                <span className={shop?.is_open ? 'status-dot open' : 'status-dot'} />
                {shop?.is_open ? 'Open now' : 'Currently closed'}
              </small>
            </span>
          </button>

          <div className="desktop-location">
            <MapPin size={17} />
            <div>
              <small>DELIVERY TO</small>
              <b>My saved address</b>
            </div>
          </div>

          <div className="header-actions">
            <button
              className="header-icon-button"
              aria-label="Open notifications"
              onClick={() => setTab('account')}
            >
              <Bell size={19} />
              {notice.length > 0 && <span className="notification-dot" />}
            </button>
            <button className="header-icon-button" aria-label="Open customer support" onClick={() => setTab('support')}>
              <MessageCircle size={19} />
            </button>
            <button
              className="account-chip"
              aria-label="Open account"
              onClick={() => setTab('account')}
            >
              <span><UserRound size={17} /></span>
              <b>{me.name?.split(' ')[0] || 'Account'}</b>
            </button>
            <button
              className="cart-chip"
              onClick={() => setTab('cart')}
              aria-label={`Open cart, ${cartCount} items`}
            >
              <ShoppingCart size={18} />
              <b>Cart</b>
              {cartCount > 0 && <em>{cartCount}</em>}
            </button>
          </div>
        </div>
      </header>

      {me.verification_status !== 'verified' && me.verification_code && (
        <div className="notice-banner verification-banner">
          <div className="notice-icon"><AlertCircle size={19} /></div>
          <div>
            <b>Your account verification code: {me.verification_code}</b>
            <span>Share this code with the store administrator to verify your account.</span>
          </div>
        </div>
      )}

      {!shop?.is_open && (
        <div className="notice-banner closed-banner">
          <div className="notice-icon"><Clock3 size={19} /></div>
          <div>
            <b>Store is currently unavailable</b>
            <span>Expected opening: {shop?.reopening_time || 'not set'}</span>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} compact />}

      {tab === 'home' && (
        <main>
          <section className={`home-hero ${shop?.home_hero_image_url ? 'hero-has-image' : ''}`} style={imageFrame(shop?.image_styles?.home_hero_image_url)}>{/* Blank board — admin image slot */}
            <div className="hero-visual" aria-hidden="true">
              {shop?.home_hero_image_url ? (
                <img className="hero-illustration" src={shop.home_hero_image_url} alt="" loading="eager" style={imagePresentation({ ...shop?.image_styles?.home_hero_image_url, fit: shop?.image_styles?.home_hero_image_url?.fit ?? 'cover' })} />
              ) : null}
            </div>
          </section>

          {(() => {
            const discounted = products.filter(p => p.discount_percent != null && p.discount_percent > 0);
            if (!shop?.sale_mode || !discounted.length) return null;
            const maxOff = Math.max(...discounted.map(p => p.discount_percent!));
            return (
              <div className="sale-banner" role="banner">
                <span className="sale-banner-tag">🔥 SALE</span>
                <b>UP TO {maxOff}% OFF</b>
                <small>{discounted.length} item{discounted.length > 1 ? 's' : ''} on sale — grab them fast!</small>
              </div>
            );
          })()}

          <section className="search-section">
            <div className="search-box">
              <Search size={21} />
              <input
                aria-label="Search products"
                placeholder="Search for products..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button className="clear-search" aria-label="Clear search" onClick={() => setQ('')}>
                  <X size={17} />
                </button>
              )}
              <kbd>⌘ K</kbd>
            </div>
          </section>

          <section className="category-section">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">BROWSE</span>
                <h2>Shop by category</h2>
              </div>
            </div>

            <div className="category-row">
              <button
                className={`category-card ${selectedCategory === null ? 'selected' : ''}`}
                onClick={() => { setSelectedCategory(null); setQ(''); }}
              >
                <span className="category-icon">✨</span>
                <b>All</b>
              </button>

              {cats.map((c) => (
                <button
                  className={`category-card ${selectedCategory === c.id ? 'selected' : ''}`}
                  key={c.id}
                  onClick={() => { setSelectedCategory(c.id); setQ(''); }}
                >
                  <span className="category-icon">{categoryEmoji(c.name)}</span>
                  <b>{c.name}</b>
                </button>
              ))}
            </div>
            <div className="browse-tools">
              <button className={`filter-chip ${favoritesOnly ? 'active' : ''}`} onClick={() => setFavoritesOnly(value => !value)}>
                <Heart size={15} fill={favoritesOnly ? 'currentColor' : 'none'} /> Favorites ({favorites.length})
              </button>
              {brands.length > 0 && (
                <select
                  className="brand-select"
                  value={selectedBrand ?? ''}
                  onChange={(e) => { setSelectedBrand(e.target.value || null); setQ(''); }}
                >
                  <option value="">All Brands</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              {(selectedCategory !== null || favoritesOnly || selectedBrand) && <button className="clear-filter" onClick={() => { setSelectedCategory(null); setFavoritesOnly(false); setSelectedBrand(null); }}>Clear filters</button>}
            </div>
          </section>

          <section className="products-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">IN STOCK NOW</span>
                <h2>{q || selectedCategory !== null ? 'Your results' : 'Fresh picks'}</h2>
              </div>
              <span className="result-count">{filtered.length} items</span>
            </div>

            {filtered.length > 0 ? (
              <div className="product-grid">
                {filtered.map((p, index) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    cartItem={cart.items.find((item) => item.product_id === p.id)}
                    actionId={actionId}
                    index={index}
                    onAdd={add}
                    onChange={change}
                    favorite={favorites.includes(p.id)}
                    onFavorite={toggleFavorite}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Search size={28} />}
                title="No products found"
                text={q ? `Nothing matched “${q}”. Try another search.` : 'There are no products in this category yet.'}
                action={q ? <button className="secondary-button" onClick={() => setQ('')}>Clear search</button> : undefined}
              />
            )}
          </section>
        </main>
      )}

      {tab === 'cart' && (
        <CartView
          cart={cart}
          shop={shop}
          actionId={actionId}
          onChange={change}
          onCheckout={() => setTab('orders')}
          showToast={showToast}
        />
      )}

      {tab === 'requests' && <Requests showToast={showToast} shop={shop} />}

      {tab === 'orders' && <Orders shop={shop} showToast={showToast} />}

      {tab === 'lists' && <ListsPage products={products} showToast={showToast} shop={shop} />}

      {tab === 'account' && <Account me={me} notices={notice} shop={shop} />}

      {tab === 'support' && <Support shop={shop} />}

      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}

      <nav
        className="bottom-nav"
        aria-label="Main navigation"
        style={{
          '--nav-index': ['home', 'cart', 'orders', 'requests', 'lists', 'support', 'account'].indexOf(tab),
        } as React.CSSProperties}
      >
        <div className="dynamic-island" aria-hidden="true" />
        {[
          [Home, 'home', 'Home'],
          [ShoppingCart, 'cart', 'Cart'],
          [ClipboardList, 'orders', 'Orders'],
          [PackagePlus, 'requests', 'Request'],
          [ListChecks, 'lists', 'Lists'],
          [MessageCircle, 'support', 'Support'],
          [UserRound, 'account', 'Account'],
        ].map(([I, t, label]: any) => (
          <button
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
            key={t}
            aria-label={label}
          >
            <span className="nav-icon">
              <I size={20} />
              {t === 'cart' && cartCount > 0 ? <em>{cartCount}</em> : null}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Support({ shop }: { shop: any }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; content: string }[]>([
    { role: 'model', content: 'Namaste! 👋 Main aapki grocery shopping aur account support mein help karne ke liye yahin hoon. Kya chahiye? 😊' },
  ]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setText('');
    setError('');
    setSending(true);
    try {
      const result = await api('/support/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: nextMessages.slice(1) }),
      });
      setMessages([...nextMessages, { role: 'model', content: result.reply }]);
    } catch (e: any) {
      setError(e?.message || 'Support is temporarily unavailable.');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="inner-page support-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">HELP DESK</span>
          <h1>Customer support</h1>
        </div>
        <MessageCircle size={30} />
      </div>
      <section className="support-card">
        {shop?.support_avatar_image_url ? (
          <div className="support-banner" style={imageFrame(shop?.image_styles?.support_avatar_image_url)}>
            <img src={shop.support_avatar_image_url} alt="" style={imagePresentation({ ...shop?.image_styles?.support_avatar_image_url, fit: shop?.image_styles?.support_avatar_image_url?.fit ?? 'cover' })} />
          </div>
        ) : null}
        <div className="support-head">
          <div className="support-avatar">
            <AnimeMascot variant="support" src={shop?.support_avatar_image_url || undefined} alt="" emoji="⚡" imageStyle={shop?.image_styles?.support_avatar_image_url} />
          </div>
          <div><b>Store assistant</b><small>Powered by Gemma 4 31B IT</small></div>
          <span className="support-online"><i /> Online</span>
        </div>
        <div className="support-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div className={`support-message ${message.role}`} key={`${message.role}-${index}`}>
              {message.content}
            </div>
          ))}
          {sending && <div className="support-message model support-typing">Thinking...</div>}
        </div>
        {error && <div className="support-error"><AlertCircle size={15} />{error}</div>}
        <form className="support-form" onSubmit={send}>
          <input
            aria-label="Support message"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="Ask about orders, delivery or your account..."
            maxLength={2000}
          />
          <button className="primary-button" disabled={sending || !text.trim()} aria-label="Send support message">
            <MessageCircle size={17} />
          </button>
        </form>
      </section>
    </main>
  );
}

function ProductCard({
  product: p,
  cartItem,
  actionId,
  index,
  onAdd,
  onChange,
  favorite,
  onFavorite,
}: {
  product: Product;
  cartItem?: Cart['items'][number];
  actionId: number | null;
  index: number;
  onAdd: (id: number) => void;
  onChange: (id: number, qty: number) => void;
  favorite: boolean;
  onFavorite: (id: number) => void;
}) {
  const available = p.in_stock && p.stock_quantity > 0;
  const quantity = cartItem?.quantity || 0;

  return (
    <article className="product-card" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <div className="product-image-wrap">
        <button className={`favorite-button ${favorite ? 'active' : ''}`} aria-label={`${favorite ? 'Remove' : 'Add'} ${p.name} ${favorite ? 'from' : 'to'} favourites`} onClick={() => onFavorite(p.id)}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <div className="product-image">
          {p.image_url ? (
            <img
              src={p.image_url}
              alt={p.name}
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.classList.add('image-failed');
              }}
            />
          ) : (
            <span>{categoryEmoji(p.name)}</span>
          )}
        </div>
        <span className={`availability-pill ${available ? '' : 'unavailable'}`}>
          {available ? 'In stock' : 'Out of stock'}
        </span>
        {p.discount_percent != null && p.discount_percent > 0 && (
          <span className="discount-pill">{p.discount_percent}% OFF</span>
        )}
      </div>

      <div className="product-info">
        <h3>{p.name}</h3>
        <small>{p.unit}</small>
        <div className="product-bottom">
          <div className="product-price-box">
            {p.original_price != null && Number(p.original_price) > Number(p.price) && (
              <s className="product-old-price">₹{p.original_price}</s>
            )}
            <strong>₹{p.price}</strong>
            {available && p.stock_quantity <= 5 && (
              <span className="low-stock">{p.stock_quantity} left</span>
            )}
          </div>

          {quantity > 0 ? (
            <div className="card-qty" aria-label={`${quantity} ${p.name} in cart`}>
              <button
                aria-label={`Decrease ${p.name} quantity`}
                disabled={actionId === p.id}
                onClick={() => onChange(p.id, quantity - 1)}
              >
                <Minus size={15} />
              </button>
              <b>{quantity}</b>
              <button
                aria-label={`Increase ${p.name} quantity`}
                disabled={actionId === p.id || !available}
                onClick={() => onChange(p.id, quantity + 1)}
              >
                <Plus size={15} />
              </button>
            </div>
          ) : (
            <button
              className="add-button"
              disabled={!available || actionId === p.id}
              onClick={() => onAdd(p.id)}
            >
              {actionId === p.id ? <Spinner /> : <><Plus size={16} /> Add</>}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function CartView({
  cart,
  shop,
  actionId,
  onChange,
  onCheckout,
  showToast,
}: {
  cart: Cart;
  shop: any;
  actionId: number | null;
  onChange: (id: number, qty: number) => void;
  onCheckout: () => void;
  showToast: (message: string) => void;
}) {
  const [placing, setPlacing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [specialRequest, setSpecialRequest] = useState('');

  const clearCart = async () => {
    setClearing(true);
    try { await api('/cart', { method: 'DELETE' }); window.location.reload(); }
    catch (e: any) { showToast(e?.message || 'Could not clear cart.'); }
    finally { setClearing(false); }
  };

  const placeOrder = async () => {
    const a = await api('/customers/me/addresses');
    if (!a.length) {
      showToast('Add a delivery address in Account first.');
      return;
    }

    setPlacing(true);
    try {
      await api('/orders', {
        method: 'POST',
        body: JSON.stringify({ address_id: a[0].id, special_request: specialRequest.trim() || null }),
      });
      showToast('Order placed successfully');
      onCheckout();
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e: any) {
      showToast(e?.message || 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <main className="inner-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">READY TO CHECK OUT?</span>
          <h1>Your cart</h1>
        </div>
        <div className="cart-heading-actions"><span className="page-count">{cart.items.length} products</span>{cart.items.length > 0 && <button className="text-button danger-text" disabled={clearing} onClick={clearCart}><Trash2 size={14} /> Clear cart</button>}</div>
      </div>

      {cart.items.length === 0 ? (
        <EmptyState
          tall
          icon={<ShoppingCart size={30} />}
          image={shop?.cart_empty_image_url}
          imageStyle={shop?.image_styles?.cart_empty_image_url}
          title="Your cart is empty"
          text="Add a few essentials from the home page and they will show up here."
          action={<button className="primary-button" onClick={() => window.dispatchEvent(new CustomEvent('customer-home'))}>Continue shopping</button>}
        />
      ) : (
        <div className="cart-layout">
          <div className="cart-items">
            {cart.items.map((i) => (
              <div className="cart-item" key={i.product_id}>
                <div className="cart-item-icon"><Package size={20} /></div>
                <div className="cart-item-main">
                  <b>{i.product_name}</b>
                  <small>₹{i.price} each</small>
                </div>
                <div className="card-qty">
                  <button
                    aria-label={`Decrease ${i.product_name}`}
                    disabled={actionId === i.product_id}
                    onClick={() => onChange(i.product_id, i.quantity - 1)}
                  >
                    <Minus size={15} />
                  </button>
                  <b>{i.quantity}</b>
                  <button
                    aria-label={`Increase ${i.product_name}`}
                    disabled={actionId === i.product_id}
                    onClick={() => onChange(i.product_id, i.quantity + 1)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <strong>₹{i.line_total}</strong>
              </div>
            ))}
          </div>

          <aside className="checkout-card">
            <div className="checkout-row">
              <span>Subtotal</span>
              <b>₹{cart.subtotal}</b>
            </div>
            <div className="checkout-row muted">
              <span>Delivery</span>
              <span>{shop?.home_delivery_enabled && Number(cart.subtotal) >= Number(shop?.minimum_home_delivery_amount || 0) ? 'Available' : 'Unavailable'}</span>
            </div>
            <div className="checkout-total">
              <span>Total</span>
              <b>₹{cart.subtotal}</b>
            </div>
            <label className="special-request">
              <span>SPECIAL REQUEST (OPTIONAL)</span>
              <textarea
                placeholder="Kuch kehna hai store ko? Jaise 'kam mirchi wala' ya 'bell bajana'..."
                maxLength={1000}
                rows={3}
                value={specialRequest}
                onChange={(e) => setSpecialRequest(e.target.value)}
              />
            </label>
            <button
              className="primary-button checkout-button"
              disabled={!shop?.home_delivery_enabled || !shop?.is_open || Number(cart.subtotal) < Number(shop?.minimum_home_delivery_amount || 0) || placing}
              onClick={placeOrder}
            >
              {placing ? <><Spinner /> Placing order...</> : <>Place delivery order <ChevronRight size={18} /></>}
            </button>
            {!shop?.home_delivery_enabled && (
              <p className="checkout-warning">Home delivery is currently unavailable.</p>
            )}
            {shop?.home_delivery_enabled && Number(cart.subtotal) < Number(shop?.minimum_home_delivery_amount || 0) && (
              <p className="checkout-warning">Minimum amount for home delivery is ₹{shop.minimum_home_delivery_amount}. Please add more items or direct pickup from shop.</p>
            )}
            {!shop?.is_open && (
              <p className="checkout-warning">The store is closed right now.</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

const REQUEST_STATUS_INFO: Record<string, { label: string; icon: string; className: string }> = {
  PENDING: { label: 'Waiting for shop owner', icon: '⏳', className: 'pending' },
  SEEN: { label: 'Seen by shop owner — update in 1-2 days', icon: '👀', className: 'seen' },
  ARRIVED: { label: 'Arrived at shop — pick it up', icon: '✅', className: 'arrived' },
  NOT_FOUND: { label: 'Sorry, not found in market', icon: '❌', className: 'notfound' },
  PRICE_RANGE: { label: 'Not found under your price range', icon: '💸', className: 'pricerange' },
  TOO_HEAVY: { label: "That's too heavy for us", icon: '🏋️', className: 'tooheavy' },
};

function Requests({ showToast, shop }: { showToast: (m: string) => void; shop: any }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ item_name: '', brand: '', quantity: '1', max_price: '' });

  const load = () => { setLoading(true); api('/item-requests/me').then(setRequests).catch(() => setRequests([])).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.item_name.trim();
    const qty = Number(form.quantity);
    const price = Number(form.max_price);
    if (!name) { showToast('Enter the item name'); return; }
    if (!Number.isFinite(qty) || qty < 1) { showToast('Enter a valid quantity'); return; }
    if (!Number.isFinite(price) || price <= 0) { showToast('Enter the maximum price you can pay'); return; }
    setSaving(true);
    try {
      await api('/item-requests', { method: 'POST', body: JSON.stringify({ item_name: name, brand: form.brand.trim() || null, quantity: qty, max_price: price }) });
      setForm({ item_name: '', brand: '', quantity: '1', max_price: '' });
      showToast('Request sent to the shop! 🎉');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Could not send your request.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this request?')) return;
    try { await api(`/item-requests/${id}`, { method: 'DELETE' }); setRequests(current => current.filter(r => r.id !== id)); showToast('Request deleted'); }
    catch (e: any) { showToast(e?.message || 'Could not delete request'); }
  };

  return (
    <main className="inner-page requests-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">NOT IN SHOP? NO PROBLEM</span>
          <h1>Request an item</h1>
        </div>
        <button className="secondary-button refresh-button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>

      {shop?.requests_page_image_url && (
        <div className="page-banner" style={imageFrame(shop?.image_styles?.requests_page_image_url)}>
          <img src={shop.requests_page_image_url} alt="" loading="lazy" style={imagePresentation({ ...shop?.image_styles?.requests_page_image_url, fit: shop?.image_styles?.requests_page_image_url?.fit ?? 'contain' })} />
        </div>
      )}

      <section className="surface-card request-create-card">
        <div className="section-head"><div><span className="eyebrow">NEW REQUEST</span><h2>Can't find what you need?</h2></div><PackagePlus size={21} /></div>
        <p className="empty-small">Tell us the item, how much you need, and the maximum price you're willing to pay. The shop owner will update you.</p>
        <form className="request-form" onSubmit={submit}>
          <label className="full">
            Item name
            <input required maxLength={180} placeholder="e.g. Organic jaggery powder" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} />
          </label>
          <label className="full">
            Brand (optional)
            <input maxLength={120} placeholder="e.g. Amul, Tata (leave blank if any brand works)" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
          </label>
          <label>
            Quantity
            <input required type="number" min={1} max={1000} placeholder="How many?" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
          </label>
          <label>
            Maximum price (₹)
            <input required inputMode="decimal" placeholder="₹ you can pay" value={form.max_price} onChange={e => setForm({ ...form, max_price: e.target.value })} />
          </label>
          <button className="primary-button request-submit" disabled={saving}>
            {saving ? <Spinner /> : <><PackagePlus size={16} /> Send request</>}
          </button>
        </form>
      </section>

      <div className="section-heading"><div><span className="eyebrow">TRACKING</span><h2>My requests</h2></div><span className="result-count">{requests.length} request(s)</span></div>

      {loading ? (
        <div className="orders-list"><SkeletonLine /><SkeletonLine /></div>
      ) : requests.length ? (
        <div className="orders-list">
          {requests.map((r) => {
            const info = REQUEST_STATUS_INFO[r.status] || REQUEST_STATUS_INFO.PENDING;
            return (
              <div className="order-card request-card" key={r.id}>
                <div className="order-icon"><PackagePlus size={20} /></div>
                <div className="order-main">
                  <div className="order-top">
                    <b>{r.item_name}{r.brand ? ` · ${r.brand}` : ''}</b>
                    <span className={`request-status ${info.className}`}>{info.icon} {info.label}</span>
                  </div>
                  <p>Qty: {r.quantity} · Max price: ₹{r.max_price}{r.status === 'ARRIVED' && r.admin_price ? ` · Shop price: ₹${r.admin_price}` : ''}</p>
                  <small className="request-date">Requested on {new Date(r.created_at + (String(r.created_at).endsWith('Z') ? '' : 'Z')).toLocaleString()}</small>
                </div>
                <button className="close-soft" aria-label="Delete request" onClick={() => remove(r.id)}><X size={15} /></button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<PackagePlus size={30} />} title="No requests yet" text="Use the form above to request any item that is not available in the shop." />
      )}
    </main>
  );
}

function Orders({ shop, showToast }: { shop: any; showToast: (m: string) => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => { setLoading(true); api('/orders/me').then(setOrders).catch(() => setOrders([])).finally(() => setLoading(false)); };

  useEffect(() => {
    load();
  }, []);

  const cancelOrder = async (id: number) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return;
    setBusyId(id);
    try {
      await api(`/orders/${id}/cancel`, { method: 'PATCH' });
      showToast('Order cancelled successfully');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Could not cancel the order.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="inner-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">YOUR SHOPPING HISTORY</span>
          <h1>Orders</h1>
        </div>
        <button className="secondary-button refresh-button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>

      {loading ? (
        <div className="orders-list">
          <SkeletonLine />
          <SkeletonLine />
          <SkeletonLine />
        </div>
      ) : orders.length ? (
        <div className="orders-list">
          {orders.map((o) => (
            <div className="order-card" key={o.id}>
              <div className="order-icon"><Package size={20} /></div>
              <div className="order-main">
                <div className="order-top">
                  <b>Order #{o.id}</b>
                  <span className="order-status">{o.status}</span>
                </div>
                <p>₹{o.total} · {o.items.length} item(s)</p>
                {o.special_request && <p className="order-note">📝 Your request: {o.special_request}</p>}
                {o.owner_reply && <p className="order-reply">🏪 Store reply: {o.owner_reply}</p>}
                <div className="order-actions">
                  {o.status === 'PLACED' && (
                    <button className="secondary-button" disabled={busyId === o.id} onClick={() => cancelOrder(o.id)}>
                      <X size={14} /> {busyId === o.id ? 'Cancelling...' : 'Cancel order'}
                    </button>
                  )}
                  {o.status === 'DELIVERED' && (
                    <button className="secondary-button" onClick={() => downloadBill(o, shop)}>
                      <ClipboardList size={14} /> Download bill
                    </button>
                  )}
                </div>
              </div>
              <ChevronRight className="order-chevron" size={18} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          tall
          icon={<ClipboardList size={30} />}
          image={shop?.orders_empty_image_url}
          imageStyle={shop?.image_styles?.orders_empty_image_url}
          title="No orders yet"
          text="Your completed orders will appear here."
        />
      )}
    </main>
  );
}

function ListsPage({ products, showToast, shop }: { products: Product[]; showToast: (m: string) => void; shop: any }) {
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => { setLoading(true); api('/lists').then(setLists).catch(() => setLists([])).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const productById = (id: number) => products.find(p => p.id === id);

  const saveFromCart = async () => {
    try {
      const c = await api('/cart');
      if (!c.items?.length) { showToast('Cart is empty'); return; }
      if (!name.trim()) { showToast('Enter a list name first'); return; }
      setBusy(true);
      await api('/lists', { method: 'POST', body: JSON.stringify({ name: name.trim(), items: c.items.map((i: any) => ({ product_id: i.product_id, quantity: i.quantity })) }) });
      setName('');
      showToast('List saved');
      load();
    } catch (e: any) { showToast(e?.message || 'Could not save list'); }
    finally { setBusy(false); }
  };

  const saveEmpty = async () => {
    if (!name.trim()) { showToast('Enter a list name first'); return; }
    setBusy(true);
    try {
      await api('/lists', { method: 'POST', body: JSON.stringify({ name: name.trim(), items: [] }) });
      setName('');
      showToast('List created — add items below');
      load();
    } catch (e: any) { showToast(e?.message || 'Could not create list'); }
    finally { setBusy(false); }
  };

  const orderWholeList = async (list: any) => {
    if (!window.confirm(`Order the whole list "${list.name}" now?`)) return;
    setBusy(true);
    try {
      await api(`/lists/${list.id}/order`, { method: 'POST' });
      showToast('Whole list ordered successfully!');
      load();
    } catch (e: any) { showToast(e?.message || 'Could not order this list'); }
    finally { setBusy(false); }
  };

  const canOrderWhole = (list: any) => list.items.length > 0 && list.items.every((i: any) => {
    const p = productById(i.product_id);
    return p && p.in_stock && p.stock_quantity >= i.quantity;
  });

  const addToList = async (list: any, productId: number, qty: number) => {
    const existing = list.items.find((i: any) => i.product_id === productId);
    const items = existing
      ? list.items.map((i: any) => i.product_id === productId ? { ...i, quantity: i.quantity + qty } : i)
      : [...list.items, { product_id: productId, quantity: qty }];
    setBusy(true);
    try {
      const updated = await api(`/lists/${list.id}`, { method: 'PUT', body: JSON.stringify({ items }) });
      setLists(current => current.map(l => l.id === list.id ? updated : l));
      showToast('Added to list');
    } catch (e: any) { showToast(e?.message || 'Could not update list'); }
    finally { setBusy(false); }
  };

  const removeFromList = async (list: any, productId: number) => {
    const items = list.items.filter((i: any) => i.product_id !== productId);
    setBusy(true);
    try {
      const updated = await api(`/lists/${list.id}`, { method: 'PUT', body: JSON.stringify({ items }) });
      setLists(current => current.map(l => l.id === list.id ? updated : l));
    } catch (e: any) { showToast(e?.message || 'Could not update list'); }
    finally { setBusy(false); }
  };

  const deleteList = async (list: any) => {
    if (!window.confirm(`Delete list "${list.name}"?`)) return;
    try { await api(`/lists/${list.id}`, { method: 'DELETE' }); setLists(current => current.filter(l => l.id !== list.id)); showToast('List deleted'); }
    catch (e: any) { showToast(e?.message || 'Could not delete list'); }
  };

  const addToCart = async (productId: number, qty: number) => {
    try {
      await api('/cart/items', { method: 'POST', body: JSON.stringify({ product_id: productId, quantity: qty }) });
      showToast('Added to cart — place your order from the cart');
    } catch (e: any) { showToast(e?.message || 'Could not add to cart'); }
  };

  const addToCartWhole = async (list: any) => {
    setBusy(true);
    try {
      for (const i of list.items) {
        await api('/cart/items', { method: 'POST', body: JSON.stringify({ product_id: i.product_id, quantity: i.quantity }) });
      }
      showToast('Whole list added to cart — review and place your order');
    } catch (e: any) { showToast(e?.message || 'Could not add list to cart'); }
    finally { setBusy(false); }
  };

  return (
    <main className="inner-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">SHOP QUICKER</span>
          <h1>My Lists</h1>
        </div>
        <button className="secondary-button refresh-button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>

      {shop?.lists_page_image_url && (
        <div className="page-banner" style={imageFrame(shop?.image_styles?.lists_page_image_url)}>
          <img src={shop.lists_page_image_url} alt="" loading="lazy" style={imagePresentation({ ...shop?.image_styles?.lists_page_image_url, fit: shop?.image_styles?.lists_page_image_url?.fit ?? 'contain' })} />
        </div>
      )}

      <section className="surface-card list-create-card">
        <div className="section-head"><div><span className="eyebrow">NEW LIST</span><h2>Create a shopping list</h2></div><ListChecks size={21} /></div>
        <div className="inline-create">
          <input placeholder="List name (e.g. Weekly items)" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
          <button className="primary-button" disabled={busy} onClick={saveFromCart}><Save size={15} /> Save from cart</button>
          <button className="secondary-button" disabled={busy} onClick={saveEmpty}>Create empty</button>
        </div>
      </section>

      {loading ? (
        <div className="orders-list"><SkeletonLine /><SkeletonLine /></div>
      ) : lists.length ? (
        lists.map((list) => (
          <section className="surface-card list-card" key={list.id}>
            <div className="section-head">
              <div><span className="eyebrow">SAVED LIST</span><h2>{list.name}</h2></div>
              <button className="close-soft" aria-label="Delete list" onClick={() => deleteList(list)}><Trash2 size={16} /></button>
            </div>
            {list.items.length === 0 && <p className="empty-small">This list is empty. Add products below.</p>}
            {list.items.map((i: any) => {
              const p = productById(i.product_id);
              const available = p && p.in_stock && p.stock_quantity >= i.quantity;
              return (
                <div className="list-item-row" key={i.product_id}>
                  <div className="list-item-main">
                    <b>{p?.name || `Product #${i.product_id}`}</b>
                    <small>Qty {i.quantity}{p ? ` · ₹${p.price} each` : ''}{!available ? ' · ⚠ out of stock / low stock' : ''}</small>
                  </div>
                  <button className="secondary-button" disabled={!available || busy} onClick={() => addToCart(i.product_id, i.quantity)}>Order</button>
                  <button className="close-soft" aria-label="Remove from list" onClick={() => removeFromList(list, i.product_id)}><X size={15} /></button>
                </div>
              );
            })}
            {list.items.length > 0 && (
              <div className="list-actions">
                <button className="primary-button" disabled={!canOrderWhole(list) || busy} onClick={() => orderWholeList(list)}>
                  {canOrderWhole(list) ? 'Order whole list' : 'Whole list not in stock'}
                </button>
                <button className="secondary-button" disabled={busy} onClick={() => addToCartWhole(list)}>Add whole list to cart</button>
              </div>
            )}
            <div className="list-add-row">
              <select defaultValue="" onChange={(e) => { if (e.target.value) { addToList(list, Number(e.target.value), 1); e.target.value = ''; } }}>
                <option value="">+ Add a product to this list…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} · ₹{p.price}</option>)}
              </select>
            </div>
          </section>
        ))
      ) : (
        <EmptyState tall icon={<ListChecks size={30} />} title="No lists yet" text="Create a shopping list and order everything on it in one tap." />
      )}
    </main>
  );
}

function downloadBill(order: any, shop: any) {
  const date = new Date(order.created_at + (String(order.created_at).endsWith('Z') ? '' : 'Z'));
  const rows = order.items.map((i: any) =>
    `<tr><td>${i.product_name}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">₹${i.price_at_order}</td><td style="text-align:right">₹${(Number(i.price_at_order) * i.quantity).toFixed(2)}</td></tr>`
  ).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill - Order #${order.id}</title>
  <style>body{font-family:Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1a1a1a}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #ddd;font-size:14px}th{text-align:left}.total{font-size:18px;font-weight:bold;text-align:right;margin-top:12px}.muted{color:#666;font-size:13px}</style>
  </head><body onload="window.print()">
  <h1>${shop?.shop_name || 'Local Store'} 🛒</h1>
  <p class="muted">Bill / Invoice</p>
  <p><b>Order #${order.id}</b><br/>Date: ${date.toLocaleString()}<br/>Customer: ${order.customer_name}<br/>Phone: ${order.phone}<br/>Address: ${order.address_snapshot || '—'}</p>
  <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="total">Total: ₹${Number(order.total).toFixed(2)}</p>
  <p class="muted">Status: ${order.status} · Thank you for shopping with us!</p>
  </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bill-order-${order.id}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  window.open(url, '_blank');
}

function Account({ me, notices, shop }: { me: any; notices: any[]; shop: any }) {
  const [address, setAddress] = useState({ house_no: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api('/customers/me/addresses').then((items: any[]) => { if (items[0]) setAddress(items[0]); }).catch(() => {}); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/customers/me/addresses', {
        method: 'POST',
        body: JSON.stringify(address),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert(e?.message || 'Could not save address.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="inner-page account-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>Account</h1>
        </div>
      </div>

      <div className="account-grid">
        <section className={`profile-card ${shop?.debt_image_url ? 'profile-card-has-debt' : ''}`}>
          <div className="profile-avatar">{(me.name || 'U').charAt(0).toUpperCase()}</div>
          <div className="profile-copy">
            <h2>{me.name}</h2>
            <p>{me.phone}</p>
            <span className="verified-status">
              <CheckCircle2 size={14} />
              {me.verification_status}
            </span>
          </div>
          <div className="credit-box">
            <small>REMAINING CREDIT</small>
            <strong>₹{me.credit_balance}</strong>
          </div>
          <div className={`debt-box ${shop?.debt_image_url ? 'debt-has-banner' : ''}`}>
            {shop?.debt_image_url ? (
              <div className="debt-banner" style={imageFrame(shop?.image_styles?.debt_image_url)}>
                <img src={shop.debt_image_url} alt="" loading="lazy" style={imagePresentation({ ...shop?.image_styles?.debt_image_url, fit: shop?.image_styles?.debt_image_url?.fit ?? 'cover' })} />
              </div>
            ) : (
              <div className="debt-mascot-wrap">
                <AnimeMascot variant="debt" alt="" emoji="📓" />
              </div>
            )}
            <div className="debt-copy">
              <small>OUTSTANDING DEBT</small>
              <strong>₹{me.debt_balance || 0}</strong>
            </div>
          </div>
        </section>

        {me.verification_status === 'verified' && (
          <section className="account-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">DELIVERY</span>
                <h2>Delivery address</h2>
              </div>
              <MapPin size={21} />
            </div>

            <form onSubmit={save} className="address-form">
              <label className="full">
                  House number
                  <input
                    required
                    maxLength={200}
                    placeholder="Enter house number"
                    value={address.house_no}
                    onChange={(e) => setAddress({ house_no: e.target.value })}
                  />
              </label>
              <button className="primary-button" disabled={saving}>
                {saving ? <Spinner /> : saved ? <><CheckCircle2 size={17} /> Saved</> : 'Save address'}
              </button>
            </form>
          </section>
        )}
      </div>

      <section className="notifications-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">UPDATES</span>
            <h2>Notifications</h2>
          </div>
        </div>

        {notices.length ? (
          <div className="notifications-list">
            {notices.map((n) => (
              <div className="notification-card" key={n.id}>
                <div className="notification-icon"><Bell size={17} /></div>
                <div>
                  <b>{n.title}</b>
                  <p>{n.message}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-small">No new notifications.</div>
        )}
      </section>

      <a
        className="subscribe-dev-card"
        href="https://www.youtube.com/@NYXOPLAYZ/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg className="yt-logo" viewBox="0 0 28 20" aria-hidden="true">
          <path
            fill="#FF0000"
            d="M27.4 3.1a3.5 3.5 0 0 0-2.46-2.48C22.75 0 14 0 14 0S5.25 0 3.06.62A3.5 3.5 0 0 0 .6 3.1 36.6 36.6 0 0 0 0 10c0 2.32.2 4.63.6 6.9a3.5 3.5 0 0 0 2.46 2.48C5.25 20 14 20 14 20s8.75 0 10.94-.62a3.5 3.5 0 0 0 2.46-2.48c.4-2.27.6-4.58.6-6.9s-.2-4.63-.6-6.9Z"
          />
          <path fill="#FFFFFF" d="M11.2 14.29 18.48 10l-7.28-4.29v8.58Z" />
        </svg>
        <span className="subscribe-dev-copy">
          <small>DEVELOPER</small>
          <b>Subscribe to Developer</b>
        </span>
        <span className="subscribe-dev-arrow">→</span>
      </a>
    </main>
  );
}


function AnimeMascot({
  variant,
  src,
  alt,
  emoji,
  imageStyle,
}: {
  variant: 'loading' | 'goku' | 'debt' | 'support';
  src?: string;
  alt: string;
  emoji: string;
  imageStyle?: ImageStyle | null;
}) {
  return (
    <div className={`anime-mascot anime-mascot-${variant}`} aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="eager"
          style={imagePresentation(imageStyle)}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
            event.currentTarget.parentElement?.classList.add('mascot-fallback');
          }}
        />
      ) : null}
      <span className="mascot-fallback-emoji">{emoji}</span>
      <span className="mascot-glow" />
    </div>
  );
}

function LoadingScreen({ shopName, imageUrl, imageStyle }: { shopName?: string; imageUrl?: string | null; imageStyle?: ImageStyle | null }) {
  // When a splash image is configured it IS the whole loading screen — no text, logo, spinner or buttons.
  const aspectRatio = Number(imageStyle?.aspectRatio) || 0;
  const portraitMode = (aspectRatio > 0 && aspectRatio < 1) || imageStyle?.aspect === '9:16';
  if (imageUrl) {
    return (
      <div className="splash-screen" data-portrait={portraitMode ? 'true' : 'false'}>
        <img src={imageUrl} alt="" style={imagePresentation({ ...imageStyle, fit: imageStyle?.fit ?? 'cover' })} />
      </div>
    );
  }
  return (
    <div className="loading-screen">
      <AnimeMascot
        variant="loading"
        src={imageUrl || undefined}
        alt=""
        emoji="🍥"
        imageStyle={imageStyle}
      />
      <div className="loading-logo">🛒</div>
      <b>{shopName || 'Local Store'}</b>
      <div className="loading-bar"><span /></div>
      <small className="loading-caption">Loading your world...</small>
    </div>
  );
}

function EmptyState({
  icon,
  image,
  title,
  text,
  action,
  imageStyle,
  tall = false,
}: {
  icon: React.ReactNode;
  image?: string | null;
  title: string;
  text: string;
  action?: React.ReactNode;
  imageStyle?: ImageStyle | null;
  tall?: boolean;
}) {
  return (
    <div className={`empty-state ${tall ? 'empty-state-tall' : ''}`}>
      {/* Large blank slot above the text — admin can place any image here */}
      <div className="empty-image-slot" style={imageFrame(imageStyle)}>
        {image ? <img src={image} alt="" loading="lazy" style={imagePresentation(imageStyle)} /> : null}
      </div>
      {!image && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`error-banner ${compact ? 'compact' : ''}`}>
      <AlertCircle size={18} />
      <span>{message}</span>
      <button onClick={onRetry} aria-label="Retry">
        <RefreshCw size={16} />
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

function SkeletonLine() {
  return (
    <div className="skeleton-order">
      <span />
      <div><i /><i /></div>
    </div>
  );
}

function categoryEmoji(name: string) {
  const value = name.toLowerCase();
  if (value.includes('fruit')) return '🍎';
  if (value.includes('vegetable') || value.includes('veg')) return '🥬';
  if (value.includes('milk') || value.includes('dairy')) return '🥛';
  if (value.includes('snack')) return '🍿';
  if (value.includes('drink') || value.includes('beverage')) return '🥤';
  if (value.includes('bread') || value.includes('bakery')) return '🍞';
  if (value.includes('personal')) return '🧴';
  if (value.includes('clean')) return '🧹';
  if (value.includes('rice') || value.includes('grocery')) return '🛒';
  return '🛍️';
}

createRoot(document.getElementById('root')!).render(<App />);

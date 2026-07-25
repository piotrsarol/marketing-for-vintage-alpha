import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'

type View = 'overview' | 'trends' | 'content' | 'queue' | 'leads'
type Trend = { topic: string; category: string; score: number; delta: string; source: string; sourceType: 'Google Trends' | 'Pinterest' | 'Reddit' | 'RSS'; audience: string; status: 'Approved' | 'Review' }
type LiveCampaign = { id: string; provider: 'openai' | 'mock'; trend: { topic: string }; content: Record<string, unknown> }

const trends: Trend[] = [
  { topic: 'Adidas Samba OG', category: 'Sneakers', score: 94, delta: '+28%', source: 'Google Trends', sourceType: 'Google Trends', audience: 'Sneaker resellers', status: 'Approved' },
  { topic: 'Brown suede jackets', category: 'Outerwear', score: 89, delta: '+22%', source: 'Pinterest Trends', sourceType: 'Pinterest', audience: 'Vintage sellers', status: 'Approved' },
  { topic: 'Lace-trim camisoles', category: 'Y2K', score: 82, delta: '+17%', source: 'r/Vinted', sourceType: 'Reddit', audience: 'Fashion flippers', status: 'Approved' },
  { topic: 'Rugby shirts', category: 'Preppy', score: 76, delta: '+11%', source: 'The Zoe Report', sourceType: 'RSS', audience: 'Side hustlers', status: 'Review' },
]
const queue = [
  { platform: 'LinkedIn', icon: 'in', title: 'The 3 signals behind the Samba comeback', time: 'Today · 09:00', status: 'Scheduled', color: 'blue' },
  { platform: 'Instagram', icon: '◎', title: 'Brown suede is having a moment', time: 'Today · 12:00', status: 'Scheduled', color: 'pink' },
  { platform: 'TikTok', icon: '♪', title: 'Spot this trend before it peaks', time: 'Today · 15:00', status: 'Draft', color: 'dark' },
  { platform: 'Pinterest', icon: 'p', title: 'Vintage outerwear trend report', time: 'Today · 18:00', status: 'Scheduled', color: 'red' },
]

function App() {
  const [view, setView] = useState<View>('overview')
  const [notice, setNotice] = useState('')
  const [running, setRunning] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [campaigns, setCampaigns] = useState<LiveCampaign[]>([])
  const [trendFilter, setTrendFilter] = useState('All sources')
  const filteredTrends = useMemo(() => trendFilter === 'All sources' ? trends : trends.filter((trend) => trend.sourceType === trendFilter), [trendFilter])
  async function loadLatestCampaigns() {
    const response = await fetch('/api/campaigns/latest', { credentials: 'same-origin' })
    if (!response.ok) return
    const result = await response.json() as { campaigns?: LiveCampaign[] }
    setCampaigns(result.campaigns || [])
  }
  useEffect(() => {
    void fetch('/api/admin/session', { credentials: 'same-origin' }).then((response) => response.json()).then((result: { authenticated?: boolean }) => {
      if (result.authenticated) {
        setAuthenticated(true)
        void loadLatestCampaigns()
      }
    }).catch(() => undefined).finally(() => setAuthLoading(false))
  }, [])
  async function runLiveCampaign() {
    setRunning(true)
    try {
      const response = await fetch('/api/campaigns/run', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const result = await response.json() as { approved?: number; campaigns?: LiveCampaign[]; error?: string }
      if (!response.ok) throw new Error(result.error || 'Campaign run failed')
      setCampaigns(result.campaigns || [])
      setNotice(`Campaign run complete: ${result.approved ?? 0} approved campaigns saved.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campaign run failed. Start the API server first.')
    } finally {
      setRunning(false)
    }
  }
  async function loginAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAdminError('')
    const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) })
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string }
      setAdminError(result.error || 'Invalid email or password.')
      return
    }
    setAdminPassword('')
    setAuthenticated(true)
    await loadLatestCampaigns()
  }
  async function logoutAdmin() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthenticated(false)
    setCampaigns([])
  }
  if (authLoading) return <div className="auth-shell"><p>Checking operator session…</p></div>
  if (!authenticated) return <div className="auth-shell"><AdminLogin email={adminEmail} password={adminPassword} error={adminError} onEmailChange={setAdminEmail} onPasswordChange={setAdminPassword} onSubmit={loginAdmin} /></div>
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">VS</div><div><strong>Vinted Signal</strong><span>Growth OS</span></div></div>
      <div className="workspace-switcher"><span className="avatar">PV</span><span><b>Vintage Alpha</b><small>Workspace</small></span><span className="chevron">⌄</span></div>
      <nav><p className="nav-label">Workspace</p><NavItem icon="⌂" label="Overview" active={view === 'overview'} onClick={() => setView('overview')} /><NavItem icon="✦" label="Trend radar" active={view === 'trends'} onClick={() => setView('trends')} /><NavItem icon="▣" label="Content studio" active={view === 'content'} onClick={() => setView('content')} /><NavItem icon="◷" label="Publishing queue" active={view === 'queue'} onClick={() => setView('queue')} badge="4" /><NavItem icon="♧" label="Waitlist" active={view === 'leads'} onClick={() => setView('leads')} /><p className="nav-label">System</p><NavItem icon="⚙" label="Automation settings" /><NavItem icon="?" label="Help & docs" /></nav>
      <div className="sidebar-footer"><div className="status-dot" /> All systems operational <span>↗</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{view === 'overview' ? 'Overview' : view === 'trends' ? 'Trend radar' : view === 'content' ? 'Content studio' : view === 'queue' ? 'Publishing queue' : 'Waitlist'}</b></div><div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button" aria-label="Notifications">♢<i /></button><div className="user-menu"><span className="avatar small">PS</span><span>Piotr Sarol</span><span>⌄</span></div></div></header>
      {view === 'overview' && <Overview onExplore={() => setView('trends')} />}
      {view === 'trends' && <section className="page-section"><PageIntro eyebrow="DEMAND VALIDATION" title="Trend radar" description="Every signal is scored for momentum, commercial intent, and relevance to Vinted sellers." action={<button className="primary-button" onClick={() => setNotice('Discovery run queued for the next available worker.')}>Run discovery <span>↗</span></button>} /><div className="filter-row"><div className="tabs"><button className="active">All signals <span>24</span></button><button>Approved <span>18</span></button><button>Needs review <span>6</span></button></div><select value={trendFilter} onChange={(event) => setTrendFilter(event.target.value)}><option>All sources</option><option>Google Trends</option><option>Pinterest</option><option>Reddit</option><option>RSS</option></select></div><TrendTable data={filteredTrends} /></section>}
      {view === 'content' && <section className="page-section"><PageIntro eyebrow="AI CONTENT ENGINE" title="Content studio" description="Run the AI campaign engine from this authenticated dashboard." action={<><button className="secondary-button" onClick={logoutAdmin}>Sign out</button><button className="primary-button" onClick={runLiveCampaign} disabled={running}>{running ? 'Running…' : 'Run real campaign'} <span>✦</span></button></>} /><LiveCampaigns campaigns={campaigns} /></section>}
      {view === 'queue' && <section className="page-section"><PageIntro eyebrow="DISTRIBUTION" title="Publishing queue" description="Your approved content is queued across channels with built-in retry handling." action={<button className="secondary-button" onClick={() => setNotice('Queue exported as CSV.')}>Export queue</button>} /><div className="queue-list">{queue.map((item) => <div className="queue-item" key={item.title}><div className={`social-icon ${item.color}`}>{item.icon}</div><div className="queue-copy"><b>{item.title}</b><span>{item.platform} · {item.time}</span></div><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span><button className="more">•••</button></div>)}</div></section>}
      {view === 'leads' && <section className="page-section"><PageIntro eyebrow="DEMAND SIGNAL" title="Waitlist" description="Capture early interest before launch and understand which content turns into qualified demand." action={<button className="secondary-button" onClick={() => setNotice('CSV export prepared.')}>Export leads</button>} /><div className="lead-layout"><div className="lead-card"><span className="eyebrow">TOTAL SIGNUPS</span><strong>248</strong><span className="positive">↑ 24% this week</span><div className="sparkline">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div></div><div className="lead-card"><span className="eyebrow">CONVERSION RATE</span><strong>6.8%</strong><span className="positive">↑ 1.2 pts this week</span><div className="conversion-bar"><span /></div><small>Landing page visitors · 3,647</small></div></div><div className="lead-table"><div className="table-heading"><span>Recent signups</span><span>Source</span><span>Joined</span></div>{['anna@vintageclub.co', 'milo.resells@gmail.com', 'hello@retro-room.com', 'kasia.thrift@gmail.com'].map((lead, index) => <div className="table-row" key={lead}><b>{lead}</b><span>{['Instagram', 'Google', 'TikTok', 'Pinterest'][index]}</span><span>Today, {['14:32', '12:08', '10:41', '09:16'][index]}</span></div>)}</div></section>}
      {notice && <button className="toast" onClick={() => setNotice('')}>{notice} <span>×</span></button>}
    </main>
  </div>
}

function AdminLogin({ email, password, error, onEmailChange, onPasswordChange, onSubmit }: { email: string; password: string; error: string; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="studio-preview"><div><span className="eyebrow">OPERATOR ACCESS</span><h2>Sign in to run campaigns</h2><p>Use your Supabase account. The dashboard keeps the session in a secure HttpOnly cookie; no API token is needed.</p><form onSubmit={onSubmit}><input aria-label="Admin email" type="email" placeholder="Email address" value={email} onChange={(event) => onEmailChange(event.target.value)} required /><input aria-label="Admin password" type="password" placeholder="Password" value={password} onChange={(event) => onPasswordChange(event.target.value)} required /><button className="primary-button" type="submit">Sign in <span>↗</span></button></form>{error && <small>{error}</small>}</div></div>
}

function LiveCampaigns({ campaigns }: { campaigns: LiveCampaign[] }) {
  if (!campaigns.length) return <div className="studio-preview"><div><span className="eyebrow">READY</span><h2>No campaigns yet</h2><p>Run the campaign engine to discover a signal, generate content with the configured provider, and save the result to Supabase.</p></div></div>
  return <div className="live-campaigns">{campaigns.map((campaign) => {
    const tracking = campaign.content.tracking as { links?: Record<string, string> } | undefined
    return <article className="studio-preview" key={campaign.id}><div><span className="eyebrow">CAMPAIGN · {campaign.provider.toUpperCase()}</span><h2>{campaign.trend.topic}</h2><pre>{JSON.stringify(campaign.content, null, 2)}</pre>{tracking?.links && <div className="asset-pills">{Object.entries(tracking.links).map(([channel, link]) => <a href={link} key={channel} target="_blank" rel="noreferrer">{channel} ↗</a>)}</div>}</div></article>
  })}</div>
}

function NavItem({ icon, label, active, badge, onClick }: { icon: string; label: string; active?: boolean; badge?: string; onClick?: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}{badge && <b>{badge}</b>}</button> }
function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action: ReactNode }) { return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div> }
function Overview({ onExplore }: { onExplore: () => void }) {
  return <section className="page-section"><PageIntro eyebrow="SATURDAY, JULY 25, 2026" title="Good afternoon, Piotr." description="Your demand validation engine found a few signals worth acting on." action={<button className="primary-button" onClick={onExplore}>Explore signals <span>↗</span></button>} /><div className="metrics"><Metric label="New trends" value="24" change="+18%" note="vs last week" icon="✦" /><Metric label="Content generated" value="86" change="+32%" note="this month" icon="▣" /><Metric label="Waitlist signups" value="248" change="+24%" note="this month" icon="♧" /><Metric label="Conversion rate" value="6.8%" change="+1.2 pts" note="vs last week" icon="↗" /></div><div className="dashboard-grid"><div className="panel trend-panel"><div className="panel-heading"><div><span className="eyebrow">TOP SIGNALS</span><h2>Trends gaining momentum</h2></div><button className="text-button" onClick={onExplore}>View all ↗</button></div>{trends.slice(0, 3).map((trend, index) => <div className="trend-row" key={trend.topic}><div className={`rank rank-${index + 1}`}>0{index + 1}</div><div className="trend-info"><b>{trend.topic}</b><span>{trend.category} · {trend.source}</span></div><div className="trend-score"><strong>{trend.score}</strong><small>score</small></div><span className="trend-delta">{trend.delta}</span></div>)}</div><div className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">THIS WEEK</span><h2>Waitlist growth</h2></div><button className="text-button">•••</button></div><div className="chart-label"><strong>248</strong><span>signups <em>↑ 24%</em></span></div><div className="area-chart"><div className="chart-grid"><span /><span /><span /><span /></div><svg viewBox="0 0 480 150" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9b7cff" stopOpacity=".28" /><stop offset="100%" stopColor="#9b7cff" stopOpacity="0" /></linearGradient></defs><path d="M0 125 C35 112, 46 120, 75 105 S118 118, 145 91 S190 99, 215 72 S250 84, 280 70 S320 78, 350 44 S396 62, 420 29 S455 42, 480 14 L480 150 L0 150 Z" fill="url(#fill)" /><path d="M0 125 C35 112, 46 120, 75 105 S118 118, 145 91 S190 99, 215 72 S250 84, 280 70 S320 78, 350 44 S396 62, 420 29 S455 42, 480 14" fill="none" stroke="#9b7cff" strokeWidth="3" /></svg></div><div className="chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div></div><div className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h2>Publishing queue</h2></div><button className="text-button" onClick={onExplore}>View queue ↗</button></div><div className="queue-preview">{queue.slice(0, 3).map((item) => <div className="queue-item compact" key={item.title}><div className={`social-icon ${item.color}`}>{item.icon}</div><div className="queue-copy"><b>{item.title}</b><span>{item.platform} · {item.time}</span></div><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div>)}</div></div><div className="panel funnel-panel"><div className="panel-heading"><div><span className="eyebrow">FUNNEL SNAPSHOT</span><h2>From signal to signup</h2></div><button className="text-button">Details ↗</button></div><div className="funnel"><div style={{ width: '100%' }}><span>Landing page visits <b>3,647</b></span></div><div style={{ width: '73%' }}><span>Engaged visitors <b>2,661</b></span></div><div style={{ width: '42%' }}><span>Waitlist signups <b>248</b></span></div></div></div></section>
}
function Metric({ label, value, change, note, icon }: { label: string; value: string; change: string; note: string; icon: string }) { return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><div><em>{change}</em><small>{note}</small></div></div> }
function TrendTable({ data }: { data: Trend[] }) { return <div className="data-table"><div className="table-heading"><span>Trend</span><span>Source</span><span>Audience</span><span>Score</span><span>Status</span></div>{data.map((trend) => <div className="table-row" key={trend.topic}><div className="trend-info"><b>{trend.topic}</b><span>{trend.category} · {trend.delta}</span></div><span>{trend.source}</span><span>{trend.audience}</span><strong className="score">{trend.score}</strong><span className={`status ${trend.status.toLowerCase().replace(' ', '-')}`}>{trend.status}</span></div>)}</div> }
export default App

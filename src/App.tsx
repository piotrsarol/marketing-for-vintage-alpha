import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'

type View = 'overview' | 'trends' | 'content' | 'queue' | 'leads' | 'settings'
type Trend = { id: string; topic: string; category: string; score: number; source: string; sourceType: string; audience: string; status: string; delta: string }
type LiveCampaign = { id: string; provider: 'openai' | 'mock'; trend: { topic: string }; strategy?: { objective: string; hypothesis: string; angle: string; primaryChannel: string }; content: Record<string, unknown> }
type DashboardData = {
  trends: Array<{ id: string; topic: string; category: string; score: number; source: string; keywords: string[]; targetAudience: string[]; status: string }>
  campaigns: LiveCampaign[]
  queue: Array<{ id: string; platform: string; scheduledFor: string; status: string }>
  leads: Array<{ email: string; source?: string; createdAt: string }>
  funnel: { pageViews: number; signups: number; campaigns: Array<{ campaign: string; pageViews: number; signups: number }> }
}
type SettingsData = { product: { name: string; url: string; description: string; country: string; language: string; audience: string[]; callToAction: string; searchQuery?: string }; ai: { provider: string; model: string }; publishing: { provider: string; configured: boolean }; storage: string; automation: { dailyWorkflow: boolean; workflowFile: string }; updatedAt?: string }
const trends: Trend[] = []
const queue: Array<{ platform: string; icon: string; title: string; time: string; status: string; color: string }> = []

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
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [trendFilter, setTrendFilter] = useState('All sources')
  const trends: Trend[] = (dashboard?.trends || []).map((trend) => ({ ...trend, sourceType: trend.source, audience: trend.targetAudience.join(', '), delta: '—' }))
  const filteredTrends = useMemo(() => trendFilter === 'All sources' ? trends : trends.filter((trend) => trend.sourceType === trendFilter), [trendFilter, trends])
  async function loadDashboard() {
    const response = await fetch('/api/dashboard', { credentials: 'same-origin' })
    if (!response.ok) return
    setDashboard(await response.json() as DashboardData)
  }
  async function loadSettings() {
    const response = await fetch('/api/settings', { credentials: 'same-origin' })
    if (!response.ok) return
    setSettings(await response.json() as SettingsData)
  }
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
        void Promise.all([loadLatestCampaigns(), loadDashboard(), loadSettings()])
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
      await loadDashboard()
      setNotice(`Campaign run complete: ${result.approved ?? 0} approved campaigns saved.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campaign run failed. Start the API server first.')
    } finally {
      setRunning(false)
    }
  }
  async function publishQueueItem(queueId: string) {
    const response = await fetch('/api/publishing/publish', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId }) })
    const result = await response.json() as { results?: Array<{ status?: string; error?: string }> }
    const outcome = result.results?.[0]
    setNotice(outcome?.status === 'published' ? 'Asset published.' : outcome?.error || 'Publishing failed.')
    await loadDashboard()
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
    await Promise.all([loadLatestCampaigns(), loadDashboard(), loadSettings()])
  }
  async function logoutAdmin() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthenticated(false)
    setCampaigns([])
    setDashboard(null)
    setSettings(null)
  }
  if (authLoading) return <div className="auth-shell"><p>Checking operator session…</p></div>
  if (!authenticated) return <div className="auth-shell"><AdminLogin email={adminEmail} password={adminPassword} error={adminError} onEmailChange={setAdminEmail} onPasswordChange={setAdminPassword} onSubmit={loginAdmin} /></div>
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">VS</div><div><strong>Vinted Signal</strong><span>Growth OS</span></div></div>
      <div className="workspace-switcher"><span className="avatar">PV</span><span><b>Vintage Alpha</b><small>Workspace</small></span><span className="chevron">⌄</span></div>
      <nav><p className="nav-label">Workspace</p><NavItem icon="⌂" label="Overview" active={view === 'overview'} onClick={() => setView('overview')} /><NavItem icon="✦" label="Trend radar" active={view === 'trends'} onClick={() => setView('trends')} /><NavItem icon="▣" label="Content studio" active={view === 'content'} onClick={() => setView('content')} /><NavItem icon="◷" label="Publishing queue" active={view === 'queue'} onClick={() => setView('queue')} badge={String(dashboard?.queue.filter((item) => item.status === 'queued').length || 0)} /><NavItem icon="♧" label="Waitlist" active={view === 'leads'} onClick={() => setView('leads')} /><p className="nav-label">System</p><NavItem icon="⚙" label="Automation settings" active={view === 'settings'} onClick={() => setView('settings')} /><NavItem icon="?" label="Help & docs" /></nav>
      <div className="sidebar-footer"><div className="status-dot" /> All systems operational <span>↗</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{view === 'overview' ? 'Overview' : view === 'trends' ? 'Trend radar' : view === 'content' ? 'Content studio' : view === 'queue' ? 'Publishing queue' : view === 'settings' ? 'Automation settings' : 'Waitlist'}</b></div><div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button" aria-label="Notifications">♢<i /></button><div className="user-menu"><span className="avatar small">PS</span><span>Piotr Sarol</span><button className="logout-button" onClick={() => void logoutAdmin()}>Log out</button></div></div></header>
      {view === 'overview' && <Overview data={dashboard} onExplore={() => setView('trends')} onQueue={() => setView('queue')} />}
      {view === 'trends' && <section className="page-section"><PageIntro eyebrow="DEMAND VALIDATION" title="Trend radar" description="Every signal is scored for momentum, commercial intent, and relevance to Vinted sellers." action={<button className="primary-button" onClick={() => void runLiveCampaign()} disabled={running}>{running ? 'Running…' : 'Discover + analyse'} <span>↗</span></button>} /><div className="filter-row"><div className="tabs"><button className="active">All signals <span>{trends.length}</span></button><button>Approved <span>{trends.filter((trend) => trend.status === 'approved').length}</span></button><button>Needs review <span>{trends.filter((trend) => trend.status === 'review').length}</span></button></div><select value={trendFilter} onChange={(event) => setTrendFilter(event.target.value)}><option>All sources</option>{[...new Set(trends.map((trend) => trend.sourceType))].map((source) => <option key={source}>{source}</option>)}</select></div><TrendTable data={filteredTrends} /></section>}
      {view === 'content' && <section className="page-section"><PageIntro eyebrow="AI CONTENT ENGINE" title="Content studio" description="Run the AI campaign engine from this authenticated dashboard." action={<><button className="secondary-button" onClick={logoutAdmin}>Sign out</button><button className="primary-button" onClick={runLiveCampaign} disabled={running}>{running ? 'Running…' : 'Run real campaign'} <span>✦</span></button></>} /><LiveCampaigns campaigns={campaigns} /></section>}
      {view === 'queue' && <section className="page-section"><PageIntro eyebrow="DISTRIBUTION" title="Publishing queue" description="Approved content waiting for a configured publishing provider." action={<button className="secondary-button" onClick={() => setNotice('Queue export is not configured yet.')}>Export queue</button>} /><div className="queue-list">{(dashboard?.queue || []).map((item) => <div className="queue-item" key={item.id}><div className="social-icon dark">{item.platform.slice(0, 2)}</div><div className="queue-copy"><b>{item.platform} campaign asset</b><span>{new Date(item.scheduledFor).toLocaleString()}</span></div><span className={`status ${item.status}`}>{item.status}</span>{item.status === 'queued' && <button className="more" onClick={() => void publishQueueItem(item.id)}>Publish</button>}</div>)}{!dashboard?.queue.length && <EmptyState title="No publishing jobs yet" description="Generate a campaign to create the first queue items." />}</div></section>}
      {view === 'leads' && <section className="page-section"><PageIntro eyebrow="DEMAND SIGNAL" title="Waitlist" description="Real leads and funnel events collected from the connected landing page." action={<button className="secondary-button" onClick={() => setNotice('Lead export is not configured yet.')}>Export leads</button>} /><div className="lead-layout"><div className="lead-card"><span className="eyebrow">TOTAL SIGNUPS</span><strong>{dashboard?.funnel.signups || 0}</strong><span className="positive">from tracked funnel events</span></div><div className="lead-card"><span className="eyebrow">CONVERSION RATE</span><strong>{dashboard?.funnel.pageViews ? `${((dashboard.funnel.signups / dashboard.funnel.pageViews) * 100).toFixed(1)}%` : '—'}</strong><small>Landing page visits · {dashboard?.funnel.pageViews || 0}</small></div></div><div className="lead-table"><div className="table-heading"><span>Email</span><span>Source</span><span>Joined</span></div>{(dashboard?.leads || []).map((lead) => <div className="table-row" key={lead.email}><b>{lead.email}</b><span>{lead.source || 'direct'}</span><span>{new Date(lead.createdAt).toLocaleString()}</span></div>)}{!dashboard?.leads.length && <EmptyState title="No leads recorded" description="Connect the landing page to the public waitlist endpoint to see signups here." />}</div></section>}
      {view === 'settings' && <Settings key={settings?.updatedAt || 'loading'} data={settings} onSaved={(value) => setSettings(value)} />}
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
    return <article className="studio-preview" key={campaign.id}><div><span className="eyebrow">CAMPAIGN · {campaign.provider.toUpperCase()}</span><h2>{campaign.trend.topic}</h2>{campaign.strategy && <div className="campaign-strategy"><span className="eyebrow">WHY THIS CAMPAIGN</span><p>{campaign.strategy.hypothesis}</p><small>Angle: {campaign.strategy.angle} · Primary channel: {campaign.strategy.primaryChannel}</small></div>}<pre>{JSON.stringify(campaign.content, null, 2)}</pre>{tracking?.links && <div className="asset-pills">{Object.entries(tracking.links).map(([channel, link]) => <a href={link} key={channel} target="_blank" rel="noreferrer">{channel} ↗</a>)}</div>}</div></article>
  })}</div>
}

function NavItem({ icon, label, active, badge, onClick }: { icon: string; label: string; active?: boolean; badge?: string; onClick?: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}{badge && <b>{badge}</b>}</button> }
function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action: ReactNode }) { return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div> }
function Overview({ data, onExplore, onQueue }: { data: DashboardData | null; onExplore: () => void; onQueue: () => void }) {
  const latestTrends = data?.trends.slice(0, 3) || []
  const queued = data?.queue.slice(0, 3) || []
  const conversion = data?.funnel.pageViews ? ((data.funnel.signups / data.funnel.pageViews) * 100).toFixed(1) : '—'
  const topCampaign = data?.funnel.campaigns[0]
  const optimisation = topCampaign ? `${topCampaign.campaign} leads with ${topCampaign.signups} signup${topCampaign.signups === 1 ? '' : 's'}. Reuse its angle and channel.` : 'Collect campaign-attributed visits and signups to unlock optimisation recommendations.'
  return <section className="page-section"><PageIntro eyebrow="CAMPAIGN CONTROL CENTER" title="Marketing engine" description="Discover signals, generate campaigns, queue distribution, and measure demand from one authenticated workspace." action={<button className="primary-button" onClick={onExplore}>Open trend radar <span>↗</span></button>} /><div className="metrics"><Metric label="Signals discovered" value={String(data?.trends.length || 0)} change="live" note="stored signals" icon="✦" /><Metric label="Campaigns generated" value={String(data?.campaigns.length || 0)} change="live" note="saved campaigns" icon="▣" /><Metric label="Queued assets" value={String(data?.queue.length || 0)} change="live" note="awaiting publisher" icon="◷" /><Metric label="Landing conversion" value={`${conversion}%`} change="live" note={`${data?.funnel.signups || 0} signups`} icon="↗" /></div><div className="dashboard-grid"><div className="panel trend-panel"><div className="panel-heading"><div><span className="eyebrow">LATEST SIGNALS</span><h2>Discovered and scored</h2></div><button className="text-button" onClick={onExplore}>View all ↗</button></div>{latestTrends.map((trend, index) => <div className="trend-row" key={trend.id}><div className="rank">{String(index + 1).padStart(2, '0')}</div><div className="trend-info"><b>{trend.topic}</b><span>{trend.category} · {trend.source}</span></div><div className="trend-score"><strong>{trend.score}</strong><small>score</small></div><span className="trend-delta">{trend.status}</span></div>)}{!latestTrends.length && <EmptyState title="No signals yet" description="Run the campaign engine to discover and score the first trend." />}</div><div className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">FUNNEL</span><h2>Demand captured</h2></div></div><div className="chart-label"><strong>{data?.funnel.signups || 0}</strong><span>signups</span></div><p className="empty-copy">{data?.funnel.pageViews || 0} tracked landing visits · {conversion}% conversion</p><div className="optimisation-note"><span className="eyebrow">OPTIMISATION SIGNAL</span><p>{optimisation}</p></div></div></div><div className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">DISTRIBUTION</span><h2>Publishing queue</h2></div><button className="text-button" onClick={onQueue}>View queue ↗</button></div>{queued.map((item) => <div className="queue-item compact" key={item.id}><div className="social-icon dark">{item.platform.slice(0, 2)}</div><div className="queue-copy"><b>{item.platform} asset</b><span>{new Date(item.scheduledFor).toLocaleString()}</span></div><span className={`status ${item.status}`}>{item.status}</span></div>)}{!queued.length && <EmptyState title="Queue is empty" description="Generated content will appear here once a publisher is configured." />}</div></section>
}
export function DemoOverview({ onExplore }: { onExplore: () => void }) {
  return <section className="page-section"><PageIntro eyebrow="SATURDAY, JULY 25, 2026" title="Good afternoon, Piotr." description="Your demand validation engine found a few signals worth acting on." action={<button className="primary-button" onClick={onExplore}>Explore signals <span>↗</span></button>} /><div className="metrics"><Metric label="New trends" value="24" change="+18%" note="vs last week" icon="✦" /><Metric label="Content generated" value="86" change="+32%" note="this month" icon="▣" /><Metric label="Waitlist signups" value="248" change="+24%" note="this month" icon="♧" /><Metric label="Conversion rate" value="6.8%" change="+1.2 pts" note="vs last week" icon="↗" /></div><div className="dashboard-grid"><div className="panel trend-panel"><div className="panel-heading"><div><span className="eyebrow">TOP SIGNALS</span><h2>Trends gaining momentum</h2></div><button className="text-button" onClick={onExplore}>View all ↗</button></div>{trends.slice(0, 3).map((trend, index) => <div className="trend-row" key={trend.topic}><div className={`rank rank-${index + 1}`}>0{index + 1}</div><div className="trend-info"><b>{trend.topic}</b><span>{trend.category} · {trend.source}</span></div><div className="trend-score"><strong>{trend.score}</strong><small>score</small></div><span className="trend-delta">{trend.delta}</span></div>)}</div><div className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">THIS WEEK</span><h2>Waitlist growth</h2></div><button className="text-button">•••</button></div><div className="chart-label"><strong>248</strong><span>signups <em>↑ 24%</em></span></div><div className="area-chart"><div className="chart-grid"><span /><span /><span /><span /></div><svg viewBox="0 0 480 150" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9b7cff" stopOpacity=".28" /><stop offset="100%" stopColor="#9b7cff" stopOpacity="0" /></linearGradient></defs><path d="M0 125 C35 112, 46 120, 75 105 S118 118, 145 91 S190 99, 215 72 S250 84, 280 70 S320 78, 350 44 S396 62, 420 29 S455 42, 480 14 L480 150 L0 150 Z" fill="url(#fill)" /><path d="M0 125 C35 112, 46 120, 75 105 S118 118, 145 91 S190 99, 215 72 S250 84, 280 70 S320 78, 350 44 S396 62, 420 29 S455 42, 480 14" fill="none" stroke="#9b7cff" strokeWidth="3" /></svg></div><div className="chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div></div><div className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h2>Publishing queue</h2></div><button className="text-button" onClick={onExplore}>View queue ↗</button></div><div className="queue-preview">{queue.slice(0, 3).map((item) => <div className="queue-item compact" key={item.title}><div className={`social-icon ${item.color}`}>{item.icon}</div><div className="queue-copy"><b>{item.title}</b><span>{item.platform} · {item.time}</span></div><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div>)}</div></div><div className="panel funnel-panel"><div className="panel-heading"><div><span className="eyebrow">FUNNEL SNAPSHOT</span><h2>From signal to signup</h2></div><button className="text-button">Details ↗</button></div><div className="funnel"><div style={{ width: '100%' }}><span>Landing page visits <b>3,647</b></span></div><div style={{ width: '73%' }}><span>Engaged visitors <b>2,661</b></span></div><div style={{ width: '42%' }}><span>Waitlist signups <b>248</b></span></div></div></div></section>
}
function Metric({ label, value, change, note, icon }: { label: string; value: string; change: string; note: string; icon: string }) { return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><div><em>{change}</em><small>{note}</small></div></div> }
function EmptyState({ title, description }: { title: string; description: string }) { return <div className="empty-state"><strong>{title}</strong><span>{description}</span></div> }
function Settings({ data, onSaved }: { data: SettingsData | null; onSaved: (value: SettingsData) => void }) {
  const [draft, setDraft] = useState<SettingsData['product'] | null>(data?.product || null)
  const [saving, setSaving] = useState(false)
  if (!data) return <section className="page-section"><EmptyState title="Settings unavailable" description="The authenticated settings endpoint did not return data." /></section>
  if (!draft) return null
  const currentData = data
  async function save() {
    setSaving(true)
    const response = await fetch('/api/settings', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: draft }) })
    if (response.ok) {
      const saved = await response.json() as { product: SettingsData['product']; updatedAt: string }
      onSaved({ product: saved.product, ai: currentData.ai, publishing: currentData.publishing, storage: currentData.storage, automation: currentData.automation, updatedAt: saved.updatedAt })
    }
    setSaving(false)
  }
  return <section className="page-section"><PageIntro eyebrow="SYSTEM" title="Automation settings" description="Product and campaign strategy settings live here. Secrets stay in server-side environment variables." action={<button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save settings'} <span>↗</span></button>} /><div className="settings-grid"><div className="panel settings-form"><span className="eyebrow">CAMPAIGN PROFILE</span><label>Product name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Landing page URL<input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label><label>Audience<input value={draft.audience.join(', ')} onChange={(event) => setDraft({ ...draft, audience: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label><label>Campaign language<select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })}><option value="pl">Polski</option><option value="en">English</option></select></label><label>CTA<input value={draft.callToAction} onChange={(event) => setDraft({ ...draft, callToAction: event.target.value })} /></label><label>Search query<input value={draft.searchQuery || ''} onChange={(event) => setDraft({ ...draft, searchQuery: event.target.value })} /></label></div><div className="panel"><span className="eyebrow">AI PROVIDER</span><h2>{data.ai.provider}</h2><p>Model: {data.ai.model}</p><span className="eyebrow">PUBLISHING</span><h2>{data.publishing.provider}</h2><p>{data.publishing.configured ? 'Queue processing can send assets to the configured webhook.' : 'The n8n dispatcher is not connected yet.'}</p><span className="eyebrow">AUTOMATION</span><h2>{data.automation.dailyWorkflow ? 'Daily workflow enabled' : 'Manual only'}</h2><p>{data.automation.workflowFile}</p></div></div></section>
}
function TrendTable({ data }: { data: Trend[] }) { return <div className="data-table"><div className="table-heading"><span>Trend</span><span>Source</span><span>Audience</span><span>Score</span><span>Status</span></div>{data.map((trend) => <div className="table-row" key={trend.id}><div className="trend-info"><b>{trend.topic}</b><span>{trend.category} · {trend.delta}</span></div><span>{trend.source}</span><span>{trend.audience || '—'}</span><strong className="score">{trend.score}</strong><span className={`status ${trend.status.toLowerCase().replace(' ', '-')}`}>{trend.status}</span></div>)}{!data.length && <EmptyState title="No signals recorded" description="Run discovery to collect and score current market signals." />}</div> }
export default App

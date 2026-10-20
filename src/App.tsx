import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, CalendarDays, Check,
  CircleAlert, Download, LogOut, Plus, RefreshCw, ShieldCheck, Users, Wallet,
  X
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import GroupChat from './components/GroupChat'
import type { FundTransaction, Profile, TransactionType } from './types'

const money = (pesewas: number) => new Intl.NumberFormat('en-GH', {
  style: 'currency', currency: 'GHS', minimumFractionDigits: 2,
}).format(pesewas / 100)

const today = () => new Date().toISOString().slice(0, 10)

type Tab = 'overview' | 'transactions' | 'members' | 'audit' | 'chat' | 'chat'

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<'signin' | 'forgot'>('signin')
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [transactions, setTransactions] = useState<FundTransaction[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [audit, setAudit] = useState<any[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [showAdd, setShowAdd] = useState(false)
  const [txType, setTxType] = useState<TransactionType>('contribution')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('General')
  const [txDate, setTxDate] = useState(today())
  const [contributorId, setContributorId] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('profiles')
      .select('id, full_name, role, is_approved, must_change_password, created_at')
      .eq('id', userId).maybeSingle()
    if (e) throw e
    setProfile(data as Profile | null)
  }, [])

  const loadData = useCallback(async () => {
    if (!supabase || !session?.user?.id || !profile?.is_approved) return
    const { data, error: e } = await supabase.from('transactions')
      .select('id,type,amount_pesewas,description,transaction_date,contributor_id,category,reference,created_by,created_at,contributor:profiles!transactions_contributor_id_fkey(full_name)')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (e) throw e
    setTransactions((data ?? []) as unknown as FundTransaction[])

    if (profile.role !== 'member') {
      const { data: people, error: pe } = await supabase.from('profiles')
        .select('id,full_name,role,is_approved,must_change_password,created_at').order('created_at', { ascending: false })
      if (pe) throw pe
      setMembers((people ?? []) as Profile[])
      const { data: logs, error: le } = await supabase.from('audit_logs')
        .select('id,action,table_name,record_id,actor_id,details,created_at')
        .order('created_at', { ascending: false }).limit(100)
      if (le) throw le
      setAudit(logs ?? [])
    }
  }, [session, profile])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (data.session?.user?.id) {
        try { await loadProfile(data.session.user.id) } catch (e) { setError(message(e)) }
      }
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(nextSession)
      if (!nextSession) { setProfile(null); setTransactions([]); setMembers([]); setAudit([]) }
      else {
        // Defer Supabase queries until the auth callback has completed.
        window.setTimeout(() => loadProfile(nextSession.user.id).catch(e => setError(message(e))), 0)
      }
    })
    return () => { alive = false; listener.subscription.unsubscribe() }
  }, [loadProfile])

  useEffect(() => {
    if (session && profile?.is_approved) {
      loadData().catch(e => setError(message(e)))
    }
  }, [session, profile, loadData])

  const totals = useMemo(() => {
    let income = 0, expenses = 0, adjustments = 0
    for (const tx of transactions) {
      if (tx.type === 'contribution') income += tx.amount_pesewas
      else if (tx.type === 'expense') expenses += tx.amount_pesewas
      else adjustments += tx.amount_pesewas
    }
    return { income, expenses, adjustments, balance: income - expenses + adjustments }
  }, [transactions])

  const filtered = useMemo(() => transactions.filter(tx => filter === 'all' || tx.type === filter), [transactions, filter])

  async function handleAuth(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!supabase) return
    setLoading(true)
    try {
      if (authMode === 'forgot') {
        const { error: e1 } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        })
        if (e1) throw e1
        setNotice('If an account exists for that email, a password-reset link will be sent. Open it on this device to set a new password.')
      } else {
        const { error: e1 } = await supabase.auth.signInWithPassword({ email, password })
        if (e1) throw e1
      }
    } catch (e) { setError(message(e)) }
    finally { setLoading(false) }
  }

  async function updatePassword(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!supabase || !session?.user?.id) return
    if (newPassword.length < 12) { setError('Choose a password with at least 12 characters.'); return }
    if (newPassword !== confirmPassword) { setError('The passwords do not match.'); return }
    setSaving(true)
    try {
      const { data, error: e1 } = await supabase.functions.invoke('change-own-password', {
        body: { new_password: newPassword },
      })
      if (e1) throw e1
      if (data?.error) throw new Error(data.error)
      setPasswordRecovery(false)
      setNewPassword(''); setConfirmPassword('')
      setNotice(data?.message || 'Password updated.')
      await loadProfile(session.user.id)
    } catch (e) { setError(message(e)) }
    finally { setSaving(false) }
  }

  async function handleSignOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setPasswordRecovery(false)
    setProfile(null); setSession(null)
  }

  async function addTransaction(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!supabase || !profile || profile.role === 'member') return
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || (txType === 'adjustment' ? parsed === 0 : parsed <= 0)) {
      setError(txType === 'adjustment' ? 'Enter a non-zero adjustment amount. Use a negative amount to reduce the balance.' : 'Enter an amount greater than zero.')
      return
    }
    const amountPesewas = Math.round(parsed * 100)
    if (Math.abs(parsed * 100 - amountPesewas) > 0.000001) { setError('Amount must have no more than two decimal places.'); return }
    if (!description.trim()) { setError('Add a description.'); return }
    if (txType === 'adjustment' && amountPesewas === 0) { setError('Adjustment cannot be zero.'); return }
    setSaving(true)
    try {
      const { error: e1 } = await supabase.from('transactions').insert({
        type: txType,
        amount_pesewas: amountPesewas,
        description: description.trim(),
        category,
        transaction_date: txDate,
        contributor_id: txType === 'contribution' ? (contributorId || null) : null,
        reference: reference.trim() || null,
        created_by: session.user.id,
      })
      if (e1) throw e1
      setNotice('Transaction recorded.')
      setShowAdd(false); setAmount(''); setDescription(''); setReference(''); setContributorId('')
      await loadData()
    } catch (e) { setError(message(e)) }
    finally { setSaving(false) }
  }

  async function approveMember(member: Profile, approved: boolean) {
    if (!supabase || profile?.role === 'member') return
    setError(''); setNotice('')
    const { error: e1 } = await supabase.from('profiles').update({ is_approved: approved }).eq('id', member.id)
    if (e1) { setError(message(e1)); return }
    setNotice(`${member.full_name} ${approved ? 'approved' : 'suspended'}.`)
    await loadData()
  }

  function exportCsv() {
    const rows = [
      ['Date', 'Type', 'Description', 'Category', 'Contributor', 'Amount (GHS)', 'Reference'],
      ...filtered.map(tx => [
        tx.transaction_date, tx.type, tx.description, tx.category,
        tx.contributor?.full_name ?? '',
        (tx.amount_pesewas / 100).toFixed(2), tx.reference ?? '',
      ]),
    ]
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `engine-room-transactions-${today()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!isSupabaseConfigured || !supabase) return <SetupScreen />
  if (loading) return <div className="center-screen"><div className="loader" /><p>Loading The Engine Room…</p></div>

  if (!session) return (
    <main className="auth-shell">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">PRAYER TEAM FINANCE</p>
        <h1>{authMode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h1>
        <p className="muted">{authMode === 'forgot' ? 'Enter the email address linked to your account.' : 'Sign in to view your team’s financial records.'}</p>
        <form onSubmit={handleAuth} className="stack">
          <label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          {authMode === 'signin' && <label>Password<input required type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>}
          {error && <Notice kind="error">{error}</Notice>}
          {notice && <Notice kind="success">{notice}</Notice>}
          <button className="primary full" disabled={loading}>{loading ? 'Please wait…' : authMode === 'forgot' ? 'Send reset link' : 'Sign in'}</button>
        </form>
        <button className="text-button" onClick={() => { setAuthMode(authMode === 'signin' ? 'forgot' : 'signin'); setError(''); setNotice('') }}>
          {authMode === 'signin' ? 'Forgot password?' : 'Back to sign in'}
        </button>
        <p className="muted auth-help">New accounts are created by an administrator.</p>
      </section>
    </main>
  )

  if (!profile) return <main className="center-screen"><Notice kind="error">Your profile could not be loaded. Contact the administrator.</Notice><button className="secondary" onClick={handleSignOut}>Sign out</button></main>
  if (!profile.is_approved) return (
    <main className="center-screen">
      <div className="pending-icon"><ShieldCheck size={32} /></div>
      <h1>Awaiting approval</h1>
      <p className="muted">Your account exists, but an administrator must approve your membership before you can access financial records.</p>
      <button className="secondary" onClick={handleSignOut}><LogOut size={16} /> Sign out</button>
    </main>
  )

  if (passwordRecovery || profile.must_change_password) return (
    <main className="auth-shell">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>{passwordRecovery ? 'Choose a new password' : 'Change your temporary password'}</h1>
        <p className="muted">{passwordRecovery ? 'Set a new password to finish account recovery.' : 'For your security, replace the temporary password before entering the app.'}</p>
        <form className="stack" onSubmit={updatePassword}>
          <label>New password<input required type="password" minLength={12} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input required type="password" minLength={12} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
          <p className="form-hint">Use at least 12 characters. Do not reuse your temporary password.</p>
          {error && <Notice kind="error">{error}</Notice>}
          {notice && <Notice kind="success">{notice}</Notice>}
          <button className="primary full" disabled={saving}>{saving ? 'Updating…' : 'Save new password'}</button>
          <button type="button" className="text-button" onClick={handleSignOut}>Sign out</button>
        </form>
      </section>
    </main>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">WORKSPACE</div>
        <nav>
          <NavButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Wallet size={18} />}>Overview</NavButton>
          <NavButton active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={<Banknote size={18} />}>Transactions</NavButton>
          <NavButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<Users size={18} />}>Group Chat</NavButton>
          {profile.role !== 'member' && <>
            <NavButton active={tab === 'members'} onClick={() => setTab('members')} icon={<Users size={18} />}>Members</NavButton>
            <NavButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={<ShieldCheck size={18} />}>Audit history</NavButton>
          </>}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip"><div className="avatar">{profile.full_name?.charAt(0)?.toUpperCase() || 'E'}</div><div className="user-meta"><strong>{profile.full_name}</strong><span>{profile.role === 'super_admin' ? 'Super administrator' : profile.role === 'admin' ? 'Administrator' : 'Team member'}</span></div></div>
          <button className="logout-button" onClick={handleSignOut}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div><p className="eyebrow">THE ENGINE ROOM</p><h1>{tabTitle(tab)}</h1></div>
          <div className="top-actions">
            <span className="secure-label"><ShieldCheck size={15} /> Private team space</span>
            <button className="icon-button" title="Refresh data" onClick={() => loadData().catch(e => setError(message(e)))}><RefreshCw size={17} /></button>
          </div>
        </header>

        {error && <Notice kind="error">{error}<button className="notice-close" onClick={() => setError('')}><X size={14} /></button></Notice>}
        {notice && <Notice kind="success">{notice}<button className="notice-close" onClick={() => setNotice('')}><X size={14} /></button></Notice>}

        {tab === 'overview' && <Overview totals={totals} transactions={transactions.slice(0, 5)} onViewAll={() => setTab('transactions')} />}
        {tab === 'transactions' && <Transactions transactions={filtered} filter={filter} setFilter={setFilter} onExport={exportCsv} isAdmin={profile.role !== 'member'} onAdd={() => setShowAdd(true)} />}
        {tab === 'members' && profile.role !== 'member' && <Members members={members} onApprove={approveMember} onCreated={() => loadData().catch(e => setError(message(e)))} />}
        {tab === 'audit' && profile.role !== 'member' && <Audit logs={audit} />}

        {tab === 'chat' && <div className="page-content"><GroupChat userId={session.user.id} isAdmin={profile.role !== 'member'} /></div>}
      </main>

      <nav className="mobile-nav">
        <NavButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Wallet size={18} />}>Home</NavButton>
        <NavButton active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={<Banknote size={18} />}>Activity</NavButton>
        <NavButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<Users size={18} />}>Chat</NavButton>
        {profile.role !== 'member' && <NavButton active={tab === 'members'} onClick={() => setTab('members')} icon={<Users size={18} />}>Members</NavButton>}
      </nav>

      {showAdd && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowAdd(false) }}>
        <section className="modal">
          <div className="modal-head"><div><p className="eyebrow">ADMINISTRATION</p><h2>Record transaction</h2></div><button className="icon-button" onClick={() => setShowAdd(false)}><X size={18}/></button></div>
          <form className="stack" onSubmit={addTransaction}>
            <label>Transaction type<select value={txType} onChange={e => setTxType(e.target.value as TransactionType)}><option value="contribution">Contribution / income</option><option value="expense">Expense</option><option value="adjustment">Balance adjustment</option></select></label>
            <label>Amount in GHS<input required type="number" min={txType === 'adjustment' ? undefined : '0.01'} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder={txType === 'adjustment' ? '-10.00 or 10.00' : '0.00'}/></label>
            {txType === 'contribution' && <label>Contributor<select value={contributorId} onChange={e => setContributorId(e.target.value)}><option value="">Unassigned / group contribution</option>{members.filter(m => m.is_approved).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>}
            <label>Description<input required value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Weekly prayer meeting contribution"/></label>
            <div className="form-grid"><label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{['General','Offering','Pledge','Donation','Prayer meeting','Outreach','Transport','Food','Welfare','Administration','Other'].map(x => <option key={x}>{x}</option>)}</select></label><label>Date<input required type="date" value={txDate} max={today()} onChange={e => setTxDate(e.target.value)}/></label></div>
            <label>Mobile money reference (optional)<input value={reference} onChange={e => setReference(e.target.value)} placeholder="Transaction ID / reference"/></label>
            <p className="form-hint">Record only completed transactions. Do not enter mobile money PINs or wallet passwords. Corrections should be made through a traceable adjustment.</p>
            <button className="primary full" disabled={saving}>{saving ? 'Saving…' : 'Save transaction'}</button>
          </form>
        </section>
      </div>}
    </div>
  )
}

function SetupScreen() {
  return <main className="center-screen"><div className="brand-mark"><Wallet size={26}/></div><p className="eyebrow">THE ENGINE ROOM</p><h1>Connect your Supabase project</h1><p className="muted setup-copy">Create a <code>.env.local</code> file in the project root. Copy the two values from <strong>Supabase → Project Settings → API</strong>, using the project URL and publishable/anon key only.</p><pre className="code-sample">VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY</pre><p className="warning-copy"><CircleAlert size={16}/> Never use a service-role key in a browser app.</p></main>
}

function Brand() {
  return (
    <div className="brand">
      <img
        src={`${import.meta.env.BASE_URL}ministry-logo.jfif`}
        alt="Edumfa Heavenly Ministries International"
        style={{
          width: 52,
          height: 52,
          objectFit: 'contain',
          borderRadius: '50%',
          background: '#ffffff',
          flexShrink: 0
        }}
      />
      <div>
        <strong>The Engine Room</strong>
        <span>Edumfa Heavenly Ministries International</span>
      </div>
    </div>
  )
}
function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{children}</span></button> }
function Notice({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) { return <div className={`notice ${kind}`}>{kind === 'error' ? <CircleAlert size={17}/> : <Check size={17}/>}<div>{children}</div></div> }
function Metric({ title, value, icon, tone, subtitle }: { title: string; value: string; icon: ReactNode; tone: string; subtitle: string }) { return <section className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><p>{title}</p><strong>{value}</strong><span>{subtitle}</span></section> }
function Overview({ totals, transactions, onViewAll }: { totals: { income: number; expenses: number; adjustments: number; balance: number }; transactions: FundTransaction[]; onViewAll: () => void }) {
  return <div className="page-content">
    <section className="welcome-banner"><div><span className="welcome-pill"><BadgeCheck size={14}/> MEMBER-ONLY DASHBOARD</span><h2>Faithful stewardship.<br/>Clear accountability.</h2><p>One place to follow the funds supporting our prayer team.</p></div><div className="banner-art"><Wallet size={68}/></div></section>
    <div className="metrics-grid">
      <Metric title="Available balance" value={money(totals.balance)} icon={<Wallet size={19}/>} tone="gold" subtitle="Calculated from recorded transactions"/>
      <Metric title="Total contributions" value={money(totals.income)} icon={<ArrowDownLeft size={19}/>} tone="green" subtitle="All recorded income"/>
      <Metric title="Total expenses" value={money(totals.expenses)} icon={<ArrowUpRight size={19}/>} tone="red" subtitle="All recorded expenditure"/>
      <Metric title="Net adjustments" value={money(totals.adjustments)} icon={<RefreshCw size={19}/>} tone="blue" subtitle="Traceable balance corrections"/>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Recent transactions</h2><p>Latest recorded activity</p></div><button className="secondary small" onClick={onViewAll}>View all</button></div><TransactionTable transactions={transactions}/></section>
    <p className="footnote"><ShieldCheck size={15}/> Records are visible to approved members. Only the designated administrator can record financial activity.</p>
  </div>
}
function Transactions({ transactions, filter, setFilter, onExport, isAdmin, onAdd }: { transactions: FundTransaction[]; filter: string; setFilter: (v: string) => void; onExport: () => void; isAdmin: boolean; onAdd: () => void }) {
  return <div className="page-content"><section className="panel"><div className="panel-heading"><div><h2>All transactions</h2><p>Searchable financial activity and references</p></div><div className="panel-actions"><button className="secondary small" onClick={onExport}><Download size={15}/> Export CSV</button>{isAdmin && <button className="primary small" onClick={onAdd}><Plus size={15}/> Add record</button>}</div></div><div className="filter-row"><label>Transaction type<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All transactions</option><option value="contribution">Contributions</option><option value="expense">Expenses</option><option value="adjustment">Adjustments</option></select></label></div><TransactionTable transactions={transactions}/></section></div>
}
function TransactionTable({ transactions }: { transactions: FundTransaction[] }) {
  if (!transactions.length) return <div className="empty-state"><CalendarDays size={28}/><strong>No transactions yet</strong><span>Recorded financial activity will appear here.</span></div>
  return <div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Date</th><th>Contributor</th><th>Reference</th><th className="align-right">Amount</th></tr></thead><tbody>{transactions.map(tx => <tr key={tx.id}><td><div className="transaction-name"><span className={`tx-icon ${tx.type}`} >{tx.type === 'expense' ? <ArrowUpRight size={16}/> : tx.type === 'contribution' ? <ArrowDownLeft size={16}/> : <RefreshCw size={16}/>}</span><div><strong>{tx.description}</strong><small>{tx.category} · {tx.type}</small></div></div></td><td>{new Date(`${tx.transaction_date}T12:00:00`).toLocaleDateString('en-GH',{day:'2-digit',month:'short',year:'numeric'})}</td><td>{tx.contributor?.full_name || '—'}</td><td>{tx.reference || '—'}</td><td className={`align-right amount ${tx.type}`}>{tx.type === 'expense' ? '−' : tx.type === 'contribution' ? '+' : ''}{money(Math.abs(tx.amount_pesewas))}</td></tr>)}</tbody></table></div>
}
function Members({ members, onApprove, onCreated }: { members: Profile[]; onApprove: (member: Profile, approved: boolean) => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [formNotice, setFormNotice] = useState('')

  async function createMember(e: FormEvent) {
    e.preventDefault()
    setFormError(''); setFormNotice('')
    if (!supabase) return
    if (temporaryPassword.length < 12) { setFormError('Use a temporary password with at least 12 characters.'); return }
    setCreating(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('create-member', {
        body: { full_name: fullName.trim(), email: email.trim(), temporary_password: temporaryPassword },
      })
      if (invokeError) throw invokeError
      if (data?.error) throw new Error(data.error)
      setFormNotice(`Account created for ${data.full_name} (${data.email}). Share the temporary password privately; they must change it at first sign-in.`)
      setFullName(''); setEmail(''); setTemporaryPassword('')
      onCreated()
    } catch (e) {
      setFormError(message(e))
    } finally {
      setCreating(false)
    }
  }

  return <div className="page-content">
    <section className="panel">
      <div className="panel-heading"><div><h2>Create member account</h2><p>Accounts are created by an administrator; public registration is disabled.</p></div></div>
      <form className="stack" onSubmit={createMember}>
        <div className="form-grid">
          <label>Member's full name<input required minLength={2} maxLength={100} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" /></label>
          <label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        </div>
        <label>Temporary password<input required type="text" minLength={12} value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} autoComplete="off" /></label>
        <p className="form-hint">Use at least 12 characters. Share it privately, never in the group chat. The member must change it before viewing records.</p>
        {formError && <Notice kind="error">{formError}</Notice>}
        {formNotice && <Notice kind="success">{formNotice}</Notice>}
        <div><button className="primary small" disabled={creating}>{creating ? 'Creating account…' : 'Create member account'}</button></div>
      </form>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Team members</h2><p>Approve or suspend access to financial records</p></div><span className="count-pill">{members.length} accounts</span></div>
      <div className="member-list">{members.map(m => <div className="member-row" key={m.id}>
        <div className="avatar">{m.full_name?.charAt(0)?.toUpperCase() || 'E'}</div>
        <div className="member-details"><strong>{m.full_name}</strong><span>{m.role === 'super_admin' ? 'Super administrator' : m.role === 'admin' ? 'Administrator' : 'Member'} · Joined {new Date(m.created_at).toLocaleDateString('en-GH')}</span></div>
        <span className={`status ${m.is_approved ? 'approved' : 'pending'}`}>{m.is_approved ? 'Approved' : 'Pending'}</span>
        {m.role === 'member' && <button className={m.is_approved ? 'secondary small' : 'primary small'} onClick={() => onApprove(m, !m.is_approved)}>{m.is_approved ? 'Suspend' : 'Approve'}</button>}
      </div>)}</div>
    </section>
    <p className="form-hint">Administrator role assignment remains restricted to a trusted setup procedure, not a browser control.</p>
  </div>
}
function Audit({ logs }: { logs: any[] }) {
  return <div className="page-content"><section className="panel"><div className="panel-heading"><div><h2>Audit history</h2><p>Recent recorded changes</p></div></div>{!logs.length ? <div className="empty-state"><ShieldCheck size={28}/><strong>No audit entries yet</strong><span>Financial record activity will be listed here.</span></div> : <div className="audit-list">{logs.map(log => <div className="audit-row" key={log.id}><div className="audit-dot"/><div><strong>{log.action} · {log.table_name}</strong><p>{log.details?.description || log.details?.type || 'Record changed'} · {log.record_id}</p><span>{new Date(log.created_at).toLocaleString('en-GH')}</span></div></div>)}</div>}</section></div>
}
function tabTitle(tab: Tab) { return ({ overview: 'Overview', transactions: 'Transactions', members: 'Team members', audit: 'Audit history', chat: 'Group Chat' })[tab] }
function message(e: unknown) { return e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as {message: unknown}).message) : 'Something went wrong. Please try again.' }

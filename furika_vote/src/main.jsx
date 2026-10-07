import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  History,
  Layers3,
  LockKeyhole,
  LogOut,
  Mail,
  Map,
  MapPin,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  TrendingUp,
  Trash2,
  UserRound,
  Waves,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';
import './workflow.css';
import './underwriter.css';
import './modes.css';
import './minimalist.css';
import './chat-first.css';
import './workflow-canvas.css';
import './stage-inspector.css';
import './recent-chats.css';
import PortfolioScreen from './PortfolioScreen.jsx';

const TIERS = [
  { id: 'common', label: 'Common', range: '0.0–0.2', color: '#38bdf8', loss: 68.4, ratio: 1.4 },
  { id: 'occasional', label: 'Occasional', range: '0.2–0.4', color: '#10b981', loss: 184.2, ratio: 3.8 },
  { id: 'moderate', label: 'Moderate', range: '0.4–0.6', color: '#f59e0b', loss: 412.0, ratio: 8.5 },
  { id: 'severe', label: 'Severe', range: '0.6–0.8', color: '#ea580c', loss: 895.5, ratio: 18.6 },
  { id: 'extreme', label: 'Extreme', range: '0.8–1.0', color: '#e11d48', loss: 1642.0, ratio: 34.1 },
];

const HOTSPOTS = [
  { id: 'mathare', name: 'Mathare 4A Basin', lat: -1.2584, lng: 36.8554, score: 0.91, status: 'Proxy detected', tier: 'extreme' },
  { id: 'kibera', name: 'Kibera · Lindi / Makina', lat: -1.3133, lng: 36.7872, score: 0.74, status: 'Drainage-linked miss', tier: 'severe' },
  { id: 'south-c', name: 'South C · Popo Road', lat: -1.3172, lng: 36.8252, score: 0.68, status: 'Proxy detected', tier: 'severe' },
  { id: 'mukuru', name: 'Mukuru kwa Njenga', lat: -1.3247, lng: 36.8787, score: 0.86, status: 'Proxy detected', tier: 'extreme' },
  { id: 'gikomba', name: 'Gikomba Fluvial Plain', lat: -1.2833, lng: 36.8421, score: 0.79, status: 'Documented hotspot', tier: 'severe' },
];

const ASSETS = [
  { id: 'NRB-218', name: 'South C · Popo Rd', lat: -1.3172, lng: 36.8252, type: 'Residential masonry', value: 48.5, hazard: 0.74, mdr: 38.2, loss: 18.527, tier: 'severe' },
  { id: 'NRB-091', name: 'Mathare North Warehouse', lat: -1.2568, lng: 36.8581, type: 'Commercial masonry', value: 72.0, hazard: 0.88, mdr: 46.8, loss: 33.696, tier: 'extreme' },
  { id: 'NRB-337', name: 'Kibera Lindi Housing', lat: -1.3121, lng: 36.7893, type: 'Informal settlement', value: 12.8, hazard: 0.71, mdr: 72.0, loss: 9.216, tier: 'severe' },
  { id: 'NRB-504', name: 'Industrial Area Plant', lat: -1.3044, lng: 36.8622, type: 'Engineered concrete', value: 105.0, hazard: 0.53, mdr: 14.0, loss: 14.7, tier: 'moderate' },
];

const MODEL_FACTS = {
  exposure: 4.82,
  assetCount: 600,
  hotspotsValidated: 12,
  hotspotsTotal: 24,
};

let mapsPromise;
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.furikaMaps = 'true';
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('Map load failed'));
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><div className="brand-mark"><Waves size={19} /></div>{!compact && <div><strong>Furika AI</strong><span>Nairobi Catastrophe Risk Intelligence</span></div>}</div>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('amina@furika.ai');
  const [password, setPassword] = useState('catmodel');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = (event) => {
    event.preventDefault();
    setBusy(true);
    window.setTimeout(() => onLogin({ name: 'Dr. A. Omondi', email }), 650);
  };
  return <main className="login-page">
    <header className="login-header"><Brand /><span><ShieldCheck size={14} /> MODEL WORKSPACE · TEAM A</span></header>
    <section className="login-stage">
      <div className="login-grid" />
      <div className="login-card">
        <div className="login-symbol"><Waves size={27} /></div>
        <div className="login-copy"><span>FURIKA AI</span><h1>Catastrophe modelling workspace</h1><p>Sign in to analyse Nairobi flood susceptibility and portfolio loss.</p></div>
        <form onSubmit={submit}>
          <label>WORK EMAIL</label><div className="field"><Mail size={16} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="label-row"><label>PASSWORD</label><button type="button">Forgot password?</button></div>
          <div className="field"><LockKeyhole size={16} /><input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /><button type="button" onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          <label className="remember"><input type="checkbox" defaultChecked /> Remember this workstation</label>
          <button className="login-submit" disabled={busy}>{busy ? 'Verifying model access…' : <>Open workspace <ArrowRight size={16} /></>}</button>
        </form>
        <div className="login-caveat"><AlertTriangle size={15} /><p><strong>Research prototype.</strong> Results use synthetic exposure and a terrain susceptibility proxy—not measured flood depth.</p></div>
      </div>
    </section>
  </main>;
}

function MiniEpCurve() {
  return <div className="ep-card">
    <div className="card-title"><div><strong>Exceedance probability vs. loss</strong><span>KES M · assumed tier mapping</span></div><TrendingUp size={17} /></div>
    <svg viewBox="0 0 380 145" role="img" aria-label="Increasing loss curve from common to extreme scenario">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0891b2" stopOpacity=".24"/><stop offset="1" stopColor="#0891b2" stopOpacity="0"/></linearGradient></defs>
      {[24, 64, 104].map((y) => <line key={y} x1="38" y1={y} x2="365" y2={y} stroke="#dbe4ea" strokeDasharray="3 4" />)}
      <path d="M42 116 C85 114, 106 108, 130 101 S183 90, 210 78 S267 56, 292 35 S336 22, 360 18 L360 121 L42 121Z" fill="url(#area)" />
      <path d="M42 116 C85 114, 106 108, 130 101 S183 90, 210 78 S267 56, 292 35 S336 22, 360 18" fill="none" stroke="#087f8c" strokeWidth="3" />
      {[[42,116,'#38bdf8'],[130,101,'#10b981'],[210,78,'#f59e0b'],[292,35,'#ea580c'],[360,18,'#e11d48']].map(([x,y,c]) => <circle key={x} cx={x} cy={y} r="4" fill={c} />)}
      <text x="5" y="28">1,600</text><text x="13" y="68">800</text><text x="22" y="108">200</text>
      <text x="34" y="138">Common</text><text x="176" y="138">Moderate</text><text x="325" y="138">Extreme</text>
    </svg>
  </div>;
}

function ModelSummary() {
  return <div className="model-answer">
    <p>Across the <strong>600 synthetic assets</strong>, total insured exposure is <strong>KES 4.82B</strong>. Loss rises monotonically across the five proxy scenarios.</p>
    <div className="pipeline"><span>Hazard proxy</span><i>→</i><span>Vulnerability</span><i>→</i><span>Exposure</span><i>→</i><span>Loss</span></div>
    <div className="summary-metrics"><div><span>TOTAL EXPOSURE</span><strong>KES 4.82B</strong><small>600 synthetic assets</small></div><div><span>EXTREME SCENARIO</span><strong className="danger">KES 1.642B</strong><small>34.1% mean loss ratio</small></div></div>
    <div className="loss-table"><div className="table-head"><span>SCENARIO</span><span>LOSS</span><span>RATIO</span></div>{TIERS.map((tier) => <div key={tier.id}><span><i style={{background:tier.color}} />{tier.label}</span><strong>KES {tier.loss >= 1000 ? `${(tier.loss/1000).toFixed(3)}B` : `${tier.loss.toFixed(1)}M`}</strong><em>{tier.ratio}%</em></div>)}</div>
    <MiniEpCurve />
    <div className="housing-card"><div className="card-title"><div><strong>Vulnerability by structural class</strong><span>Severe proxy tier · model assumption</span></div></div>
      {[['Informal / corrugated sheet',72,'#e11d48'],['Unreinforced masonry',41,'#ea580c'],['Engineered reinforced concrete',14,'#0891b2']].map(([label,value,color]) => <div className="housing-row" key={label}><span>{label}</span><div><i style={{width:`${value}%`,background:color}} /></div><strong>{value}% MDR</strong></div>)}
    </div>
    <div className="citation"><FileText size={14} /><span><strong>Sources:</strong> exposure_nairobi_with_hazard.csv; 30m DEM TWI/HAND proxy; JRC/Huizinga reference vulnerability curves. Calculations: loss = MDR × insured value.</span></div>
  </div>;
}

function parseProperty(text) {
  const amountMatch = text.match(/(?:kes\s*)?(\d+(?:\.\d+)?)\s*(m|million|b|billion)?/i);
  let value = amountMatch ? Number(amountMatch[1]) : 25;
  if (amountMatch?.[2]?.toLowerCase().startsWith('b')) value *= 1000;
  const lower = text.toLowerCase();
  const location = ['Mathare', 'Kibera', 'South C', 'Mukuru', 'Gikomba', 'Kilimani'].find((x) => lower.includes(x.toLowerCase())) || 'Nairobi';
  const type = lower.includes('warehouse') ? 'Commercial warehouse' : lower.includes('informal') ? 'Informal settlement' : lower.includes('concrete') || lower.includes('apartment') ? 'Engineered concrete' : 'Residential masonry';
  const hazard = location === 'Mathare' ? .88 : location === 'Mukuru' ? .84 : location === 'Kibera' ? .71 : .58;
  const mdr = type === 'Informal settlement' ? 72 : type === 'Engineered concrete' ? 14 : type === 'Commercial warehouse' ? 41 : 38;
  return { id: `AI-${Date.now().toString().slice(-5)}`, name: `${location} · Proposed asset`, location, type, value, hazard, mdr, loss: value * mdr / 100, lat: -1.2921, lng: 36.8219 };
}

function ExposurePreview({ asset, onConfirm, onCancel }) {
  return <div className="exposure-preview"><div className="preview-head"><div><Sparkles size={15} /><strong>AI-structured exposure</strong></div><span>REVIEW REQUIRED</span></div>
    <div className="preview-grid"><div><span>LOCATION</span><strong>{asset.location}</strong></div><div><span>OCCUPANCY</span><strong>{asset.type}</strong></div><div><span>INSURED VALUE</span><strong>KES {asset.value.toFixed(1)}M</strong></div><div><span>PROXY SCORE</span><strong>{asset.hazard.toFixed(2)} · assumed</strong></div><div><span>DAMAGE RATIO</span><strong>{asset.mdr}%</strong></div><div><span>MODELLED LOSS</span><strong className="danger">KES {asset.loss.toFixed(2)}M</strong></div></div>
    <p><AlertTriangle size={13} /> Coordinates and hazard score require confirmation. No figures have been added to the portfolio yet.</p>
    <div className="preview-actions"><button onClick={onCancel}>Discard</button><button onClick={onConfirm}><Check size={14} /> Confirm & recalculate</button></div>
  </div>;
}

const THINKING_STAGES = [
  { title: 'Understanding the request', detail: 'Classifying the underwriting question' },
  { title: 'Retrieving model evidence', detail: 'Loading approved sources and portfolio context' },
  { title: 'Running model checks', detail: 'Validating assumptions, units and monotonicity' },
  { title: 'Preparing the response', detail: 'Formatting evidence for an underwriter' },
];

const INITIAL_CHAT_MESSAGE = { role: 'assistant', content: 'Welcome to the Furika AI Cat Analyst. Start the controlled workflow to produce an underwriter report, or ask me about the modelling approach and data sources.' };

function ThinkingTrace({ activeStep, onOpenWorkflow }) {
  return <div className="thinking-trace"><header><div><span className="thinking-orb"><Sparkles size={14}/></span><span><strong>Furika AI is working</strong><small>Auditable activity · no hidden reasoning shown</small></span></div><button onClick={() => onOpenWorkflow('workflow', true)}><Workflow size={13}/> See activity</button></header><div className="thinking-stages">{THINKING_STAGES.map((stage,index)=>{const state=index<activeStep?'done':index===activeStep?'active':'waiting';return <div className={state} key={stage.title}><i>{state==='done'?<Check size={11}/>:state==='active'?<span/>:index+1}</i><span><strong>{stage.title}</strong><small>{stage.detail}</small></span></div>})}</div></div>;
}

function ResponseActions({ reportReady, onOpenView }) {
  return <div className="response-actions">{reportReady && <span><CheckCircle2 size={13}/> Report ready</span>}<button onClick={()=>onOpenView('workflow', !reportReady)}><Workflow size={13}/> View workflow</button><button onClick={()=>onOpenView('map')}><Map size={13}/> Open map</button></div>;
}

function ChatPanel({ selectedLocation, addedAssets, onAddAsset, onOpenView, reportReady }) {
  const [messages, setMessages] = useState([INITIAL_CHAT_MESSAGE]);
  const [activeChatId, setActiveChatId] = useState(() => `chat-${Date.now()}`);
  const [recentChats, setRecentChats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('furika-recent-chats') || '[]'); } catch { return []; }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(-1);
  const [preview, setPreview] = useState(null);
  const thread = useRef(null);
  const reportDelivered = useRef(false);
  const thinkingTimer = useRef(null);

  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }); }, [messages, preview, busy]);
  useEffect(() => () => window.clearInterval(thinkingTimer.current), []);

  useEffect(() => {
    const firstQuestion = messages.find((message) => message.role === 'user');
    if (!firstQuestion) return;
    const entry = { id: activeChatId, title: firstQuestion.content.slice(0, 52), updatedAt: Date.now(), messages };
    setRecentChats((current) => {
      const next = [entry, ...current.filter((chat) => chat.id !== activeChatId)].slice(0, 12);
      localStorage.setItem('furika-recent-chats', JSON.stringify(next));
      return next;
    });
  }, [messages, activeChatId]);

  useEffect(() => {
    if (!reportReady) {
      reportDelivered.current = false;
      setMessages((current) => current.filter((message) => !message.summary));
      return;
    }
    if (reportDelivered.current) return;
    reportDelivered.current = true;
    setMessages((current) => [...current, { role: 'assistant', content: 'The workflow passed human review. Your underwriter report is now ready.', summary: true, source: 'Approved workflow run · SYN-PORT-142', actions: true }]);
  }, [reportReady]);

  useEffect(() => {
    if (!selectedLocation) return;
    setMessages((current) => [...current, { role: 'user', content: `Explain the modelled risk at ${selectedLocation.name}.` }, { role: 'assistant', content: `${selectedLocation.name} has a proxy susceptibility score of ${selectedLocation.score?.toFixed(2) ?? selectedLocation.hazard.toFixed(2)}. This is a terrain-and-river proximity signal, not measured flood depth. ${selectedLocation.status === 'Drainage-linked miss' ? 'It is also a documented example of drainage-driven flooding that the terrain proxy can understate.' : 'The location is flagged in the supplied hotspot or synthetic exposure context.'}`, source: 'Map selection · Team A hazard proxy' }]);
  }, [selectedLocation]);

  const fallbackAnswer = (text) => {
    const q = text.toLowerCase();
    if (q.includes('limitation') || q.includes('proxy')) return 'The 0–1 values measure relative susceptibility, not observed water depth. The terrain proxy correctly flags 12 of 24 geocoded government hotspots; drainage-driven locations such as Kibera and Westlands can be missed. Results must therefore be labelled proxy, synthetic, or assumed.';
    if (q.includes('return') || q.includes('ep curve')) return 'The five supplied tiers do not include official return periods. The EP curve uses an explicit scenario mapping assumption and confirms that modelled loss increases with rarity. A 1-in-100-year loss means about 1% annual exceedance probability—not an event occurring exactly once each century.';
    if (q.includes('vulnerab') || q.includes('damage')) return 'Vulnerability converts proxy severity into a mean damage ratio by structural class. Informal structures are assumed most vulnerable, followed by unreinforced masonry, while engineered reinforced concrete has the lowest severe-tier MDR. Parameters are adapted from JRC/Huizinga reference curves and are not Kenya-calibrated.';
    return 'The model follows Hazard → Vulnerability → Exposure → Financial Loss. Current results use 600 synthetic assets with KES 4.82B total exposure. Under the extreme proxy scenario, gross modelled loss is KES 1.642B (34.1%). These are prototype estimates, not observed claims.';
  };

  const submit = async (value = input) => {
    const text = value.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setBusy(true);
    setThinkingStep(0);
    const startedAt = Date.now();
    window.clearInterval(thinkingTimer.current);
    thinkingTimer.current = window.setInterval(() => setThinkingStep((step) => Math.min(step + 1, THINKING_STAGES.length - 1)), 650);
    const completeThinking = async () => {
      const remaining = Math.max(0, 2500 - (Date.now() - startedAt));
      if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      window.clearInterval(thinkingTimer.current);
      setThinkingStep(-1);
      setBusy(false);
    };
    if (!reportReady && /\b(report|result|loss|exposure|aal|ep curve|return period|summary)\b/i.test(text)) {
      await completeThinking();
      setMessages((current) => [...current, { role: 'assistant', content: 'The numeric report is not available yet. Run the agent workflow and approve the model review first; this prevents draft or unreviewed losses from reaching an underwriting decision.', source: 'Model governance control', actions: true }]);
      return;
    }
    if (/\b(add|create|include|model)\b/i.test(text) && /\b(property|warehouse|building|apartment|asset|portfolio)\b/i.test(text)) {
      let parsed = parseProperty(text);
      try {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, mode: 'exposure' }) });
        if (response.ok) { const data = await response.json(); if (data.asset) parsed = { ...parsed, ...data.asset, id: parsed.id }; }
      } catch { /* deterministic preview remains available */ }
      await completeThinking(); setPreview(parsed); return;
    }
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, mode: 'analysis' }) });
      if (!response.ok) throw new Error('AI unavailable');
      const data = await response.json();
      await completeThinking();
      setMessages((current) => [...current, { role: 'assistant', content: data.answer, source: data.source || 'Furika model context', actions: true }]);
    } catch {
      await completeThinking();
      setMessages((current) => [...current, { role: 'assistant', content: fallbackAnswer(text), source: 'Team A brief · local verified model context', actions: true }]);
    }
  };

  const confirmAsset = () => {
    onAddAsset(preview);
    setMessages((current) => [...current, { role: 'assistant', content: `${preview.name} was added as synthetic exposure. Portfolio insured value increased by KES ${preview.value.toFixed(1)}M and its severe-scenario modelled loss contribution is KES ${preview.loss.toFixed(2)}M.`, source: 'AI-derived exposure · confirmed by user' }]);
    setPreview(null);
  };

  const startNewChat = () => {
    setActiveChatId(`chat-${Date.now()}`);
    setMessages([INITIAL_CHAT_MESSAGE]);
    setPreview(null);
    setHistoryOpen(false);
  };

  const openRecentChat = (chat) => {
    setActiveChatId(chat.id);
    setMessages(chat.messages?.length ? chat.messages : [INITIAL_CHAT_MESSAGE]);
    setPreview(null);
    setHistoryOpen(false);
  };

  const removeRecentChat = (event, id) => {
    event.stopPropagation();
    const next = recentChats.filter((chat) => chat.id !== id);
    setRecentChats(next);
    localStorage.setItem('furika-recent-chats', JSON.stringify(next));
    if (id === activeChatId) startNewChat();
  };

  return <section className="chat-panel">
    <header className="panel-header"><div className="panel-title"><div><Bot size={19} /></div><span><strong>Furika AI Cat Analyst <i /></strong><small>Hazard → Vulnerability → Exposure → Loss</small></span></div><div className="chat-header-actions"><button className={historyOpen?'active':''} title="Recent chats" onClick={()=>setHistoryOpen(!historyOpen)}><History size={16}/><span>Recent</span></button><button title="New conversation" onClick={startNewChat}><Plus size={16}/></button></div></header>
    {historyOpen && <aside className="recent-chats"><div className="recent-chats-head"><div><History size={15}/><strong>Recent chats</strong></div><button onClick={()=>setHistoryOpen(false)}><X size={15}/></button></div><button className="new-chat-button" onClick={startNewChat}><Plus size={14}/> New analysis</button><div className="recent-chat-list">{recentChats.length?recentChats.map((chat)=><button key={chat.id} className={chat.id===activeChatId?'active':''} onClick={()=>openRecentChat(chat)}><MessageSquareText size={14}/><span><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleDateString('en-KE',{month:'short',day:'numeric'})} · {new Date(chat.updatedAt).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</small></span><i onClick={(event)=>removeRecentChat(event,chat.id)} title="Delete chat"><Trash2 size={13}/></i></button>):<div className="no-recent-chats"><MessageSquareText size={20}/><strong>No recent chats</strong><span>Your completed conversations will appear here.</span></div>}</div></aside>}
    <div className="chat-thread" ref={thread}>
      <div className="analyst-banner"><Sparkles size={15} /><div><strong>Model run SYN-PORT-142 is active</strong><span>Ask a question or describe a synthetic property to add.</span></div></div>
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
        <div className="message-meta">{message.role === 'assistant' ? 'FURIKA CAT MODELLING ENGINE' : 'DR. A. OMONDI'} <span>· just now</span></div>
        <div className="message-bubble"><p>{message.content}</p>{message.summary && <ModelSummary />}{message.source && <small className="message-source"><FileText size={11} /> {message.source}</small>}{message.actions && <ResponseActions reportReady={reportReady} onOpenView={onOpenView}/>}</div>
      </div>)}
      {preview && <ExposurePreview asset={preview} onConfirm={confirmAsset} onCancel={() => setPreview(null)} />}
      {busy && <ThinkingTrace activeStep={thinkingStep} onOpenWorkflow={onOpenView}/>} 
      {!!addedAssets.length && <div className="portfolio-update"><Database size={14} /> {addedAssets.length} AI-derived synthetic {addedAssets.length === 1 ? 'asset' : 'assets'} added this session</div>}
    </div>
    <div className="quick-prompts"><span>QUICK QUERIES</span>{['Explain the EP curve','Compare Kibera and Mathare','Show model limitations'].map((q) => <button key={q} onClick={() => submit(q)}>{q}</button>)}</div>
    <div className="chat-composer"><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="Ask Furika AI or describe a synthetic property, e.g. ‘Add a KES 35M warehouse in Mathare’…" /><div><span><Plus size={14} /> Add context</span><small>Shift+Enter for new line</small><button onClick={() => submit()} disabled={!input.trim() || busy}>Analyse <Send size={14} /></button></div></div>
  </section>;
}

const WORKFLOW_NODES = [
  { id: 'hazard', step: '01', title: 'Data validation', subtitle: 'Schema + ordering checks', icon: Database, x: 9, y: 41, type: 'data', detail: 'Validate coordinates, structural classes, insured values and all five 0–1 scores before any modelling. Invalid rows stop the run instead of being guessed.', source: 'exposure_nairobi_with_hazard.csv' },
  { id: 'quality', step: '02', title: 'Hazard modelling', subtitle: 'Proxy depth + diagnostics', icon: Waves, x: 25, y: 15, type: 'agent', detail: 'Convert the supplied susceptibility footprint into scenario depth using documented assumptions, then test the proxy against 24 geocoded hotspots.', source: 'Terrain proxy rasters · assumptions config' },
  { id: 'vulnerability', step: '03', title: 'Vulnerability mapping', subtitle: 'MDR by structural class', icon: TrendingUp, x: 25, y: 66, type: 'model', detail: 'Apply documented, adapted damage functions by construction class. Parameters are assumptions informed by JRC/Huizinga curves.', source: 'JRC/Huizinga reference curves' },
  { id: 'exposure', step: '04', title: 'Exposure join', subtitle: '600 synthetic assets', icon: TableProperties, x: 44, y: 41, type: 'data', detail: 'Join hazard scores and structural vulnerability to the supplied synthetic Nairobi portfolio. No real policy data is used.', source: 'exposure_nairobi_with_hazard.csv' },
  { id: 'loss', step: '05', title: 'Financial loss engine', subtitle: 'MDR × insured value', icon: BarChart3, x: 61, y: 41, type: 'model', detail: 'Calculate loss for every property and aggregate by scenario. Validate that losses increase monotonically with severity.', source: 'Deterministic model calculation' },
  { id: 'intelligence', step: '06', title: 'AI intelligence', subtitle: 'Briefing + exposure parser', icon: Sparkles, x: 77, y: 17, type: 'ai', detail: 'Ground the AI in model outputs and documentation. It explains risk and converts free-text exposure descriptions into reviewable records.', source: 'OpenAI Responses API · grounded context' },
  { id: 'review', step: '07', title: 'Human review gate', subtitle: 'Approval required', icon: UserRound, x: 77, y: 66, type: 'human', detail: 'A catastrophe modeller reviews sources, assumptions, synthetic records and drainage limitations before approving the run.', source: 'Human-in-the-loop control' },
  { id: 'publish', step: '08', title: 'Approved model run', subtitle: 'Underwriter-ready output', icon: CheckCircle2, x: 92, y: 41, type: 'output', detail: 'Release the approved loss table, EP curve and risk briefing. Unapproved runs remain drafts and cannot be exported.', source: 'Controlled model output' },
];

const WORKFLOW_LINKS = [
  ['hazard','quality'], ['hazard','vulnerability'], ['quality','exposure'], ['vulnerability','exposure'], ['exposure','loss'], ['loss','intelligence'], ['loss','review'], ['intelligence','review'], ['review','publish'],
];

const WORKFLOW_STAGE_DURATION = 5000;

function NodeOutputPreview({ node, state }) {
  if (state === 'waiting') return <div className="output-empty"><Clock3 size={16}/><strong>Output pending</strong><span>This stage will generate evidence when the workflow reaches it.</span></div>;
  if (node.id === 'hazard') return <div className="stage-output"><div className="output-heading"><span>VALIDATION OUTPUT</span><em>REAL + SYNTHETIC</em></div><div className="validation-list"><span><Check size={12}/> 600 rows passed schema</span><span><Check size={12}/> Coordinates inside Nairobi bounds</span><span><Check size={12}/> Hazard scores within 0–1</span><span><AlertTriangle size={12}/> Tier ordering diagnostic required</span></div></div>;
  if (node.id === 'quality') return <div className="stage-output"><div className="output-heading"><span>HAZARD DIAGNOSTIC</span><em>PROXY</em></div><div className="hit-rate"><div className="radial-half"><strong>12/24</strong><span>detected</span></div><div><strong>50% hotspot hit-rate</strong><p>Terrain proxy can miss drainage-driven flooding.</p></div></div></div>;
  if (node.id === 'vulnerability') return <div className="stage-output"><div className="output-heading"><span>DAMAGE RATIO CURVES</span><em>ASSUMED</em></div><div className="mini-curves"><svg viewBox="0 0 180 72"><path d="M4 66 C35 62 42 32 82 18 S145 7 176 5"/><path d="M4 68 C42 67 59 52 93 32 S148 16 176 12"/><path d="M4 69 C50 69 72 63 105 48 S153 35 176 28"/></svg><div><span><i/> Informal</span><span><i/> Semi-permanent</span><span><i/> Masonry</span></div></div></div>;
  if (node.id === 'exposure') return <div className="stage-output"><div className="output-heading"><span>PORTFOLIO PROFILE</span><em>SYNTHETIC</em></div><div className="output-kpis"><div><strong>600</strong><span>BUILDINGS</span></div><div><strong>KES 4.82B</strong><span>TOTAL TIV</span></div></div><div className="stacked"><i/><i/><i/></div><small className="output-note">Exposure grouped by structural class for accumulation analysis.</small></div>;
  if (node.id === 'loss') return <div className="stage-output"><div className="output-heading"><span>SCENARIO LOSS CHECK</span><em>MODELLED</em></div><div className="mini-bars">{[['Common',4,'68.4M'],['Occasional',11,'184M'],['Moderate',25,'412M'],['Severe',55,'896M'],['Extreme',100,'1.64B']].map(([label,width,value])=><div key={label}><span>{label}</span><i><b style={{width:`${width}%`}}/></i><strong>{value}</strong></div>)}</div><small className="output-note">Loss increases monotonically with scenario severity.</small></div>;
  if (node.id === 'intelligence') return <div className="stage-output"><div className="output-heading"><span>AI EFFECT EVIDENCE</span><em>AI-DERIVED</em></div><div className="ai-compare"><div><span>BASE PROXY</span><strong>12 / 24</strong><small>hotspots detected</small></div><ArrowRight size={15}/><div className="pending-value"><span>ADJUSTED</span><strong>Validation due</strong><small>hold-out test required</small></div></div><p className="ai-warning"><AlertTriangle size={12}/> No uplift is promoted until human-checked evidence passes validation.</p></div>;
  if (node.id === 'review') return <div className="stage-output"><div className="output-heading"><span>REVIEW CHECKLIST</span><em>HUMAN CONTROL</em></div><div className="review-checks"><span><CheckCircle2 size={13}/> Sources and provenance visible</span><span><CheckCircle2 size={13}/> Loss monotonicity passed</span><span><CircleHelp size={13}/> AI uplift evidence needs decision</span><span><CheckCircle2 size={13}/> Limitations disclosed</span></div></div>;
  return <div className="stage-output"><div className="output-heading"><span>APPROVED DELIVERABLE</span><em>CONTROLLED</em></div><div className="publish-output"><CheckCircle2 size={25}/><div><strong>Underwriter report ready</strong><span>Loss summary · EP curve · assumptions · audit trail</span></div></div></div>;
}

function WorkflowWorkspace({ onApproved, onRunStart, autoRunSignal = 0 }) {
  const [selectedId, setSelectedId] = useState('hazard');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState([]);
  const [current, setCurrent] = useState(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [logs, setLogs] = useState([{ time: '10:42:01', tone: 'info', text: 'Workflow SYN-PORT-142 loaded in draft mode.' }]);
  const timer = useRef(null);
  const nodeRefs = useRef({});
  const selectedNode = WORKFLOW_NODES.find((node) => node.id === selectedId);
  const selectedIndex = WORKFLOW_NODES.findIndex((node) => node.id === selectedId);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const addLog = (tone, text) => setLogs((items) => [...items, { time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone, text }]);

  const runStep = (index) => {
    if (index >= WORKFLOW_NODES.length) {
      setRunning(false); setCurrent(null); addLog('success', 'Workflow completed and outputs are ready.'); return;
    }
    const node = WORKFLOW_NODES[index];
    if (node.id === 'review') {
      setCurrent('review'); setRunning(false); setAwaitingApproval(true); setSelectedId('review');
      addLog('warning', 'Execution paused: human review and approval required.'); return;
    }
    setCurrent(node.id); setSelectedId(node.id); addLog('running', `${node.title} started.`);
    timer.current = window.setTimeout(() => {
      setCompleted((items) => [...new Set([...items, node.id])]);
      addLog('success', `${node.title} completed.`);
      runStep(index + 1);
    }, WORKFLOW_STAGE_DURATION);
  };

  const startRun = () => {
    onRunStart();
    window.clearTimeout(timer.current); setCompleted([]); setAwaitingApproval(false); setRunning(true);
    setLogs([{ time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone: 'info', text: 'New workflow run started by Dr. A. Omondi.' }]);
    runStep(0);
  };

  useEffect(() => {
    if (!autoRunSignal) return;
    startRun();
  }, [autoRunSignal]);

  useEffect(() => {
    if (!current) return;
    nodeRefs.current[current]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current]);

  const approve = () => {
    setAwaitingApproval(false); setCompleted((items) => [...new Set([...items, 'review'])]); setCurrent('publish'); setSelectedId('publish');
    addLog('success', 'Human review approved by Dr. A. Omondi.');
    timer.current = window.setTimeout(() => { setCompleted((items) => [...new Set([...items, 'publish'])]); setCurrent(null); addLog('success', 'Approved model run published to the workspace.'); onApproved(); }, WORKFLOW_STAGE_DURATION);
  };

  const pause = () => { window.clearTimeout(timer.current); setRunning(false); addLog('warning', 'Workflow paused manually. Start a new run to resume from source.'); };

  const nodeState = (id) => completed.includes(id) ? 'complete' : current === id ? (id === 'review' ? 'review' : 'running') : 'waiting';

  return <section className="workflow-workspace">
    <header className="workflow-toolbar"><div><Network size={17}/><span><strong>Agentic CAT workflow</strong><small>{current && current !== 'review' ? `${WORKFLOW_NODES.find((node) => node.id === current)?.title} · 5 second simulation` : 'SYN-PORT-142 · controlled execution'}</small></span></div><div className="workflow-actions"><span className={awaitingApproval ? 'review-status' : running ? 'run-status' : ''}><i/>{awaitingApproval ? 'HUMAN REVIEW' : running ? `STAGE ${WORKFLOW_NODES.find((node) => node.id === current)?.step || '01'} RUNNING` : completed.includes('publish') ? 'APPROVED' : 'DRAFT'}</span>{running ? <button onClick={pause}><Pause size={14}/> Pause</button> : <button className="run-workflow" onClick={startRun}><Play size={14}/> Run workflow</button>}</div></header>
    <div className={`workflow-layout ${inspectorOpen?'inspector-open':''}`}>
      <div className="workflow-canvas">
       <div className="workflow-surface">
        <div className="workflow-grid"/>
        <svg className="workflow-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {WORKFLOW_LINKS.map(([from,to]) => { const a=WORKFLOW_NODES.find(n=>n.id===from); const b=WORKFLOW_NODES.find(n=>n.id===to); const active=completed.includes(from)&&(completed.includes(to)||current===to); return <path key={`${from}-${to}`} className={active?'active':''} d={`M ${a.x} ${a.y} C ${(a.x+b.x)/2} ${a.y}, ${(a.x+b.x)/2} ${b.y}, ${b.x} ${b.y}`}/>; })}
          {awaitingApproval && <path className="feedback" d="M 84 72 C 70 94, 28 94, 27 73"/>}
        </svg>
        {WORKFLOW_NODES.map((node) => { const Icon=node.icon; const state=nodeState(node.id); return <button ref={(element)=>{nodeRefs.current[node.id]=element}} key={node.id} className={`workflow-node ${node.type} ${state} ${selectedId===node.id?'selected':''}`} style={{left:`${node.x}%`,top:`${node.y}%`}} onClick={()=>{setSelectedId(node.id);setInspectorOpen(true)}}><span className="node-step">{node.step}</span><div className="node-icon"><Icon size={16}/></div><div><strong>{node.title}</strong><small>{node.subtitle}</small>{state==='running' && <span className="node-run-label">Processing stage · 5 sec</span>}</div><em>{state==='complete'?<Check size={11}/>:state==='running'?<span className="node-spinner"/>:state==='review'?<UserRound size={11}/>:<Clock3 size={11}/>}</em>{state==='running' && <span className="node-run-progress" aria-hidden="true"/>}</button>; })}
        <div className="feedback-label"><UserRound size={12}/> Human feedback can return assumptions for revision</div>
        {awaitingApproval && <div className="approval-card"><div><ShieldCheck size={18}/><span><strong>Human decision required</strong><small>Review the model evidence before publishing.</small></span></div><div><button onClick={() => { setAwaitingApproval(false); setCurrent(null); addLog('warning','Run returned for assumption revision.'); }}>Return for revision</button><button onClick={approve}><Check size={13}/> Approve run</button></div></div>}
       </div>
      </div>
      {inspectorOpen && <aside className="workflow-inspector"><div className="inspector-head"><span>STAGE DETAILS</span><div><em className={nodeState(selectedNode.id)}>{nodeState(selectedNode.id)}</em><button className="close-stage-inspector" onClick={()=>setInspectorOpen(false)} title="Close stage details"><X size={14}/></button></div></div><div className="stage-number">{selectedNode.step}</div><div className={`inspector-node-icon ${selectedNode.type}`}>{React.createElement(selectedNode.icon,{size:20})}</div><span className="inspector-step">WHAT IS HAPPENING</span><h3>{selectedNode.title}</h3><p>{selectedNode.detail}</p><NodeOutputPreview node={selectedNode} state={nodeState(selectedNode.id)}/><div className="stage-navigation"><button disabled={selectedIndex===0} onClick={()=>setSelectedId(WORKFLOW_NODES[selectedIndex-1].id)}><ChevronLeft size={13}/> Previous</button><span>{selectedIndex+1} of {WORKFLOW_NODES.length}</span><button disabled={selectedIndex===WORKFLOW_NODES.length-1} onClick={()=>setSelectedId(WORKFLOW_NODES[selectedIndex+1].id)}>Next <ChevronRight size={13}/></button></div><div className="node-source"><FileText size={13}/><div><span>INPUT / PROVENANCE</span><strong>{selectedNode.source}</strong></div></div><div className="control-tags"><span>{selectedNode.type === 'human' ? 'MANUAL CONTROL' : 'AGENT EXECUTION'}</span><span>{selectedNode.id === 'review' || selectedNode.id === 'publish' ? 'BLOCKING GATE' : 'AUDIT LOGGED'}</span></div></aside>}
    </div>
  </section>;
}

function MapWorkspace({ activeTier, setActiveTier, selected, setSelected, addedAssets }) {
  const node = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapStatus, setMapStatus] = useState('loading');
  const [layers, setLayers] = useState({ hotspots: true, rivers: true, assets: true });
  const [layerMenu, setLayerMenu] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const allAssets = useMemo(() => [...ASSETS, ...addedAssets], [addedAssets]);

  useEffect(() => {
    if (!apiKey) { setMapStatus('missing'); return undefined; }
    let cancelled = false;
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !node.current) return;
      const map = new maps.Map(node.current, { center: { lat: -1.2921, lng: 36.8219 }, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, styles: [{ featureType:'poi', elementType:'labels', stylers:[{visibility:'off'}] },{featureType:'water',elementType:'geometry',stylers:[{color:'#b8e1ea'}]}] });
      mapRef.current = map; setMapStatus('ready');
    }).catch(() => setMapStatus('error'));
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    markersRef.current.forEach((marker) => marker.setMap(null));
    const tierIndex = TIERS.findIndex((tier) => tier.id === activeTier);
    const visibleHotspots = layers.hotspots ? HOTSPOTS.filter((spot) => TIERS.findIndex((tier) => tier.id === spot.tier) >= Math.max(0, tierIndex - 1)) : [];
    const points = [...visibleHotspots.map((x) => ({...x, kind:'hotspot'})), ...(layers.assets ? allAssets.map((x) => ({...x, kind:'asset'})) : [])];
    markersRef.current = points.map((point) => {
      const tier = TIERS.find((item) => item.id === point.tier) || TIERS[tierIndex];
      const marker = new window.google.maps.Marker({ map: mapRef.current, position: { lat: point.lat, lng: point.lng }, title: point.name, icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: point.kind === 'asset' ? 6 : 10, fillColor: point.kind === 'asset' ? '#087f8c' : tier.color, fillOpacity: .92, strokeColor: '#fff', strokeWeight: 2 } });
      marker.addListener('click', () => setSelected(point)); return marker;
    });
  }, [mapStatus, activeTier, layers, allAssets, setSelected]);

  const currentTier = TIERS.find((tier) => tier.id === activeTier);
  return <section className="map-workspace">
    <header className="map-toolbar"><div className="map-search"><Search size={15} /><input placeholder="Search Nairobi location or synthetic asset" /><span>⌘ K</span></div><button className={layerMenu ? 'active' : ''} onClick={() => setLayerMenu(!layerMenu)}><Layers3 size={16} /> Layers <ChevronDown size={13} /></button><button><Download size={16} /> Export</button></header>
    <div className="map-canvas">
      <div ref={node} className="google-map" />
      {mapStatus !== 'ready' && <div className="map-fallback"><div className="map-grid" /><svg viewBox="0 0 900 600"><path d="M20 430 C170 380 210 485 370 410 S600 300 880 350"/><path d="M110 40 C250 160 250 250 410 315 S690 415 800 590"/><path d="M0 230 C180 245 300 160 470 195 S710 280 900 170"/></svg>{HOTSPOTS.map((spot, i) => <button key={spot.id} className={`fallback-pin pin-${i}`} style={{'--pin':TIERS.find(t=>t.id===spot.tier).color}} onClick={() => setSelected(spot)}><MapPin size={22}/><span>{spot.name}</span></button>)}<div className="map-setup"><Map size={22}/><strong>{mapStatus === 'missing' ? 'Add your Google Maps key for the live basemap' : mapStatus === 'error' ? 'Google Maps could not load' : 'Loading Nairobi map…'}</strong>{mapStatus === 'missing' && <span>VITE_GOOGLE_MAPS_API_KEY</span>}</div></div>}
      <div className="model-run"><span><i /> ACTIVE RUN: SYN-PORT-142</span><small>KES {(MODEL_FACTS.exposure + addedAssets.reduce((sum,x)=>sum+x.value/1000,0)).toFixed(3)}B TIV</small></div>
      <div className="tier-control"><div><span>HAZARD SUSCEPTIBILITY TIER</span><small>Proxy score · not flood depth</small></div><div className="tier-buttons">{TIERS.map((tier) => <button key={tier.id} className={activeTier === tier.id ? 'active' : ''} style={{'--tier':tier.color}} onClick={() => setActiveTier(tier.id)}><i />{tier.label}<span>{tier.range}</span></button>)}</div></div>
      <div className="map-legend"><span>TERRAIN HAZARD PROXY (TWI / HAND)</span><div className="legend-scale" /><div><small>0.0 · LOW HILL</small><small>1.0 · VALLEY PLAIN</small></div></div>
      {layerMenu && <div className="layer-menu"><strong>MAP LAYERS</strong>{[['hotspots','Documented hotspots'],['rivers','Rivers & drainage'],['assets','Synthetic properties']].map(([key,label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => setLayers({...layers,[key]:!layers[key]})}/><span>{label}</span></label>)}<small>Hazard raster: {currentTier.label} ({currentTier.range})</small></div>}
      {selected && <div className="asset-inspector"><button className="close" onClick={() => setSelected(null)}><X size={15}/></button><span className="inspector-type">{selected.kind === 'asset' || selected.value ? 'SYNTHETIC PROPERTY' : 'DOCUMENTED HOTSPOT'}</span><h3>{selected.name}</h3><p><MapPin size={12}/> {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</p><div className="inspector-grid"><div><span>PROXY SCORE</span><strong>{(selected.score ?? selected.hazard).toFixed(2)}</strong></div><div><span>ACTIVE TIER</span><strong style={{color:currentTier.color}}>{currentTier.label}</strong></div>{selected.value && <><div><span>REPLACEMENT VALUE</span><strong>KES {selected.value.toFixed(1)}M</strong></div><div><span>MODELLED LOSS</span><strong className="danger">KES {selected.loss.toFixed(2)}M</strong></div></>}</div><div className="inspector-caveat"><AlertTriangle size={13}/>{selected.status || 'Synthetic exposure · assumed vulnerability'}</div><button className="ask-location" onClick={() => setSelected({...selected, ask:true})}><Bot size={15}/> Ask AI about this location <MessageSquareText size={13}/></button></div>}
    </div>
    <footer className="coordinates">LAT: -1.2921° S <i/> LON: 36.8219° E <i/> DEM: 1,680m ASL <i/> CATCHMENT: Nairobi–Athi <span>GOOGLE MAPS · PROXY OVERLAY</span></footer>
  </section>;
}

function Workspace({ onLogout }) {
  const [activeScreen, setActiveScreen] = useState('workspace');
  const [tier, setTier] = useState('severe');
  const [selected, setSelected] = useState(null);
  const [chatContext, setChatContext] = useState(null);
  const [assets, setAssets] = useState([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [rightView, setRightView] = useState('workflow');
  const [reportReady, setReportReady] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [workflowRunSignal, setWorkflowRunSignal] = useState(0);
  useEffect(() => { if (selected?.ask) { setChatContext({...selected}); setSelected({...selected, ask:false}); } }, [selected]);
  const askAboutProperty = (property) => {
    setChatContext({ ...property, score: property.hazard, status: property.ai ? 'Drainage-linked evidence requires review' : 'Synthetic exposure · assumed vulnerability' });
    setActiveScreen('workspace');
    setChatOpen(true);
    setRightOpen(false);
  };
  return <main className={`workspace ${chatOpen ? '' : 'chat-collapsed'}`}>
    <header className="app-header minimal"><Brand /><div className="header-actions"><button className="profile-button"><span className="header-avatar">AO</span><span>Dr. A. Omondi</span></button><button onClick={onLogout} title="Sign out"><LogOut size={16}/></button></div></header>
    <div className="app-body"><nav className={`tool-rail ${navExpanded?'expanded':''}`}><button className="rail-toggle" onClick={()=>setNavExpanded(!navExpanded)} title={navExpanded?'Collapse navigation':'Expand navigation'}><Menu size={19}/><strong>{navExpanded?'Collapse':'Menu'}</strong></button><button className={activeScreen==='workspace'?'active':''} onClick={()=>setActiveScreen('workspace')}><Map size={19}/><strong>Workspace</strong></button><button className={activeScreen==='portfolio'?'active':''} onClick={()=>setActiveScreen('portfolio')}><Building2 size={19}/><strong>Portfolio</strong></button><button><Layers3 size={19}/><strong>Data layers</strong></button><button><BarChart3 size={19}/><strong>Model results</strong></button><button><Database size={19}/><strong>Data sources</strong></button><span/><button><SlidersHorizontal size={19}/><strong>Assumptions</strong></button><button><Settings2 size={19}/><strong>Settings</strong></button></nav>
      {activeScreen==='portfolio' ? <PortfolioScreen onAskProperty={askAboutProperty}/> : <div className={`split-view ${rightOpen?'':'right-collapsed'}`}>{chatOpen && <ChatPanel selectedLocation={chatContext} addedAssets={assets} onAddAsset={(asset) => setAssets([...assets, asset])} onOpenView={(view,autoRun=false)=>{setRightView(view);setRightOpen(true);if(view==='workflow'&&autoRun)setWorkflowRunSignal((signal)=>signal+1)}} reportReady={reportReady}/>} {rightOpen && <button className="collapse-chat" onClick={() => setChatOpen(!chatOpen)} title={chatOpen ? 'Collapse analyst' : 'Open analyst'}>{chatOpen ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}</button>}{rightOpen && <div className="right-pane"><div className="right-view-tabs"><button className={rightView==='map'?'active':''} onClick={()=>setRightView('map')}><Map size={15}/> Map</button><button className={rightView==='workflow'?'active':''} onClick={()=>setRightView('workflow')}><Workflow size={15}/> Workflow <span>HITL</span></button><div><i className={reportReady?'approved-dot':''}/> {reportReady?'APPROVED':'DRAFT'}</div><button className="collapse-right" onClick={()=>{if(!chatOpen)setChatOpen(true);setRightOpen(false)}} title="Cancel and close side panel"><X size={16}/></button></div><div className="right-view-content"><div className={`right-mode ${rightView==='map'?'active':''}`}><MapWorkspace activeTier={tier} setActiveTier={setTier} selected={selected} setSelected={setSelected} addedAssets={assets}/></div><div className={`right-mode ${rightView==='workflow'?'active':''}`}><WorkflowWorkspace autoRunSignal={workflowRunSignal} onRunStart={()=>setReportReady(false)} onApproved={()=>setReportReady(true)}/></div></div></div>}</div>}
    </div>
  </main>;
}

function App() {
  const [session, setSession] = useState(() => localStorage.getItem('furika-cat-session'));
  const login = (user) => { localStorage.setItem('furika-cat-session', JSON.stringify(user)); setSession(user); };
  const logout = () => { localStorage.removeItem('furika-cat-session'); setSession(null); };
  return session ? <Workspace onLogout={logout}/> : <Login onLogin={login}/>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

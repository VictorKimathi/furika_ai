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
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
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
  Upload,
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
import './data-sources.css';
import './readability.css';
import './brand.css';
import kenyaReLogo from './assets/kenya-re-logo.png';
import PortfolioScreen from './PortfolioScreen.jsx';
import { API_BASE_URL as BACKEND_URL, PORTFOLIO_ID, apiGet, apiRequest } from './api.js';
import FormattedText from './FormattedText.jsx';
import StageDrawer from './StageMetrics.jsx';

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

// Data sources and their contents live in Flask.
const ATTESTATION_STORAGE_KEY = 'furika-upload-attestation';
const PROCESSING_STATUSES = ['received', 'queued', 'extracting', 'validating'];
const SOURCE_STATUS = {
  received: ['Received', 'processing'], queued: ['Queued', 'processing'], extracting: ['Extracting', 'processing'], validating: ['Validating', 'processing'],
  done: ['Ready', 'ready'], stored: ['Stored', 'stored'], rejected: ['Rejected', 'error'], failed: ['Failed', 'error'], extraction_failed: ['Extraction failed', 'error'],
};

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: keep working in memory */ }
}

function describeUpload(upload) {
  const summary = upload.summary || {};
  if (PROCESSING_STATUSES.includes(upload.status)) return upload.extractor === 'csv' || upload.extractor === 'excel' ? 'Validating rows…' : 'Extracting with Claude…';
  if (upload.extractor === 'none') return 'Stored only · not parsed';
  if (upload.extractor === 'csv' || upload.extractor === 'excel') {
    if (summary.rows == null) return 'No rows read';
    const review = summary.byStatus?.needs_review || 0;
    const rejected = summary.byStatus?.rejected || 0;
    return [`${summary.rows} rows`, `${summary.promoted || 0} added to portfolio`, review && `${review} need review`, rejected && `${rejected} rejected`].filter(Boolean).join(' · ');
  }
  return [summary.documentType || 'Document', summary.pages && `${summary.pages} page${summary.pages > 1 ? 's' : ''}`, `${summary.buildings || 0} building${summary.buildings === 1 ? '' : 's'}`, `${summary.facts || 0} facts`, `${summary.findings || 0} findings`].filter(Boolean).join(' · ');
}

function toSource(upload) {
  const extension = upload.filename.includes('.') ? upload.filename.split('.').pop().toUpperCase() : 'FILE';
  const [status, tone] = SOURCE_STATUS[upload.status] || [upload.status, 'stored'];
  return { id: upload.id, name: upload.filename, extension, size: upload.sizeBytes, uploadedAt: upload.createdAt, status, tone, processing: PROCESSING_STATUSES.includes(upload.status), records: describeUpload(upload), issueCounts: upload.issueCounts || {}, upload };
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceIcon(extension, size = 18) {
  if (['CSV', 'XLS', 'XLSX'].includes(extension)) return <FileSpreadsheet size={size}/>;
  if (['PDF', 'DOCX', 'DOC', 'TXT', 'MD'].includes(extension)) return <FileText size={size}/>;
  if (['ZIP', 'TIF', 'TIFF'].includes(extension)) return <FileArchive size={size}/>;
  return <FileText size={size}/>;
}

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
  return <div className={`brand ${compact ? 'compact' : ''}`}><img className="brand-logo" src={kenyaReLogo} alt="Kenya Re"/>{!compact && <div><strong>Furika AI</strong><span>Nairobi Catastrophe Risk Intelligence</span></div>}</div>;
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
        <img className="login-logo" src={kenyaReLogo} alt="Kenya Re"/>
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
      <path d="M42 116 C85 114, 106 108, 130 101 S183 90, 210 78 S267 56, 292 35 S336 22, 360 18" fill="none" stroke="#041c39" strokeWidth="3" />
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

const INITIAL_CHAT_MESSAGE = { role: 'assistant', content: 'Welcome to Furika AI. Select an uploaded data source with Add context, or ask about a portfolio property or workflow run.' };

function ThinkingTrace({ activeStep, onOpenWorkflow }) {
  return <div className="thinking-trace"><header><div><span className="thinking-orb"><Sparkles size={14}/></span><span><strong>Furika AI is working</strong><small>Auditable activity · no hidden reasoning shown</small></span></div><button onClick={() => onOpenWorkflow('workflow', true)}><Workflow size={13}/> See activity</button></header><div className="thinking-stages">{THINKING_STAGES.map((stage,index)=>{const state=index<activeStep?'done':index===activeStep?'active':'waiting';return <div className={state} key={stage.title}><i>{state==='done'?<Check size={11}/>:state==='active'?<span/>:index+1}</i><span><strong>{stage.title}</strong><small>{stage.detail}</small></span></div>})}</div></div>;
}

function citationLabel(citation) {
  const name = citation.filename || citation.propertyId || citation.runId || citation.name || citation.portfolioId;
  if (citation.page) return `${name} p.${citation.page}`;
  if (citation.rowRef) return /^\d/.test(citation.rowRef) ? `${name} row ${citation.rowRef}` : `${name} · ${citation.rowRef}`;
  return name;
}

function ResponseActions({ reportReady, onOpenView, workflow, onReviewRun }) {
  const pending = workflow?.status === 'review';
  return <div className="response-actions">{reportReady && <span><CheckCircle2 size={13}/> Report ready</span>}{pending ? <button className="review-run" onClick={() => onReviewRun(workflow)}><ShieldCheck size={13}/> Review & approve {workflow.runId}</button> : <button onClick={()=>onOpenView('workflow', !reportReady)}><Workflow size={13}/> View workflow</button>}<button onClick={()=>onOpenView('map')}><Map size={13}/> Open map</button></div>;
}

function ChatPanel({ selectedLocation, addedAssets, onAddAsset, onOpenView, onWorkflowPending, reportReady, portfolioSummary, dataSources, onUploadFiles, attested, setAttested }) {
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
  const [contextOpen, setContextOpen] = useState(false);
  const [attachedSourceIds, setAttachedSourceIds] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const thread = useRef(null);
  const contextFileInput = useRef(null);
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
    setMessages((current) => [...current, { role: 'assistant', content: `The model run passed human review. ${portfolioSummary?.propertyCount ?? 0} portfolio properties are available with approved results. Total insured value: KES ${((portfolioSummary?.totalInsuredValueKes || 0) / 1e9).toFixed(3)}B. Central annual loss: KES ${((portfolioSummary?.portfolioAalKes || 0) / 1e6).toFixed(2)}M.`, summary: true, source: `Approved workflow · ${PORTFOLIO_ID}`, actions: true }]);
  }, [reportReady, portfolioSummary]);

  useEffect(() => {
    if (!selectedLocation) return;
    submit(`Explain the risk for ${selectedLocation.kind === 'hotspot' ? 'reference hotspot' : 'property'} ${selectedLocation.name || selectedLocation.id}.`, selectedLocation);
  }, [selectedLocation]);

  const fallbackAnswer = (text) => {
    const q = text.toLowerCase();
    if (q.includes('limitation') || q.includes('proxy')) return 'The 0–1 values measure relative susceptibility, not observed water depth. The terrain proxy correctly flags 12 of 24 geocoded government hotspots; drainage-driven locations such as Kibera and Westlands can be missed. Results must therefore be labelled proxy, synthetic, or assumed.';
    if (q.includes('return') || q.includes('ep curve')) return 'The five supplied tiers do not include official return periods. The EP curve uses an explicit scenario mapping assumption and confirms that modelled loss increases with rarity. A 1-in-100-year loss means about 1% annual exceedance probability—not an event occurring exactly once each century.';
    if (q.includes('vulnerab') || q.includes('damage')) return 'Vulnerability converts proxy severity into a mean damage ratio by structural class. Informal structures are assumed most vulnerable, followed by unreinforced masonry, while engineered reinforced concrete has the lowest severe-tier MDR. Parameters are adapted from JRC/Huizinga reference curves and are not Kenya-calibrated.';
    return 'The model follows Hazard → Vulnerability → Exposure → Financial Loss. Current results use 600 synthetic assets with KES 4.82B total exposure. Under the extreme proxy scenario, gross modelled loss is KES 1.642B (34.1%). These are prototype estimates, not observed claims.';
  };

  const submit = async (value = input, location = null) => {
    const text = value.trim();
    if (!text || busy || dataSources.some((source) => attachedSourceIds.includes(source.id) && source.processing)) return;
    const selectedSources = dataSources.filter((source) => attachedSourceIds.includes(source.id));
    const context = { portfolioId: PORTFOLIO_ID, uploadIds: selectedSources.map((source) => source.id) };
    if (location?.kind === 'hotspot') context.hotspotId = location.id;
    else if (location?.id) context.propertyId = location.id;
    setInput('');
    setAttachedSourceIds([]);
    setContextOpen(false);
    setMessages((current) => [...current, { role: 'user', content: text, attachments: selectedSources.map((source) => source.name) }]);
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
    try {
      const data = await apiRequest('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, mode: 'analysis', context }) });
      await completeThinking();
      setMessages((current) => [...current, { role: 'assistant', content: data.answer, source: data.source || 'Furika model context', citations: data.citations || [], workflow: data.workflow || null, provider: data.provider, actions: true }]);
      if (data.workflow?.status === 'review') onWorkflowPending(data.workflow);
    } catch (error) {
      await completeThinking();
      setMessages((current) => [...current, { role: 'assistant', content: error.message, source: 'Flask backend' }]);
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

  const uploadChatFiles = async (event) => {
    const { added, errors } = await onUploadFiles(event.target.files);
    setAttachedSourceIds((current) => [...new Set([...current, ...added.map((source) => source.id)])].slice(0, 5));
    setUploadError(errors?.map((item) => `${item.name}: ${item.message}`).join(' ') || '');
    if (added.length) setContextOpen(false);
    event.target.value = '';
  };

  const toggleAttachedSource = (sourceId) => {
    setAttachedSourceIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : current.length < 5 ? [...current, sourceId] : current);
  };
  const selectedSourceProcessing = dataSources.some((source) => attachedSourceIds.includes(source.id) && source.processing);

  return <section className="chat-panel">
    <header className="panel-header"><div className="panel-title"><div><Bot size={19} /></div><span><strong>Furika AI Cat Analyst <i /></strong><small>Hazard → Vulnerability → Exposure → Loss</small></span></div><div className="chat-header-actions"><button className={historyOpen?'active':''} title="Recent chats" onClick={()=>setHistoryOpen(!historyOpen)}><History size={16}/><span>Recent</span></button><button title="New conversation" onClick={startNewChat}><Plus size={16}/></button></div></header>
    {historyOpen && <aside className="recent-chats"><div className="recent-chats-head"><div><History size={15}/><strong>Recent chats</strong></div><button onClick={()=>setHistoryOpen(false)}><X size={15}/></button></div><button className="new-chat-button" onClick={startNewChat}><Plus size={14}/> New analysis</button><div className="recent-chat-list">{recentChats.length?recentChats.map((chat)=><button key={chat.id} className={chat.id===activeChatId?'active':''} onClick={()=>openRecentChat(chat)}><MessageSquareText size={14}/><span><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleDateString('en-KE',{month:'short',day:'numeric'})} · {new Date(chat.updatedAt).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</small></span><i onClick={(event)=>removeRecentChat(event,chat.id)} title="Delete chat"><Trash2 size={13}/></i></button>):<div className="no-recent-chats"><MessageSquareText size={20}/><strong>No recent chats</strong><span>Your completed conversations will appear here.</span></div>}</div></aside>}
    <div className="chat-thread" ref={thread}>
      <div className="analyst-banner"><Sparkles size={15} /><div><strong>{portfolioSummary?.status === 'approved' ? 'Approved portfolio results available' : 'Dataset-grounded analyst'}</strong><span>Select a data source to ask about its uploaded contents.</span></div></div>
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
        <div className="message-meta">{message.role === 'assistant' ? 'FURIKA CAT MODELLING ENGINE' : 'DR. A. OMONDI'} <span>· just now</span></div>
        <div className="message-bubble">{message.role === 'assistant' ? <FormattedText text={message.content}/> : <p>{message.content}</p>}{message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((name) => <span key={name}><FileText size={11}/>{name}</span>)}</div>}{message.source && <small className="message-source"><FileText size={11} /> {message.source}{message.citations?.length > 0 && ` · ${[...new Set(message.citations.map(citationLabel))].filter((label) => label !== message.source).slice(0, 4).join(', ')}`}</small>}{message.actions && <ResponseActions reportReady={reportReady} onOpenView={onOpenView} workflow={message.workflow} onReviewRun={onWorkflowPending}/>}</div>
      </div>)}
      {preview && <ExposurePreview asset={preview} onConfirm={confirmAsset} onCancel={() => setPreview(null)} />}
      {busy && <ThinkingTrace activeStep={thinkingStep} onOpenWorkflow={onOpenView}/>} 
      {!!addedAssets.length && <div className="portfolio-update"><Database size={14} /> {addedAssets.length} AI-derived synthetic {addedAssets.length === 1 ? 'asset' : 'assets'} added this session</div>}
    </div>
    <div className="quick-prompts"><span>QUICK QUERIES</span>{['Explain the EP curve','Compare Kibera and Mathare','Show model limitations'].map((q) => <button key={q} onClick={() => submit(q)}>{q}</button>)}</div>
    <div className="chat-composer">
      {attachedSourceIds.length > 0 && <div className="attached-sources">{dataSources.filter((source) => attachedSourceIds.includes(source.id)).map((source) => <span key={source.id}>{sourceIcon(source.extension, 12)}<strong>{source.name}</strong><button title={`Remove ${source.name}`} onClick={() => toggleAttachedSource(source.id)}><X size={11}/></button></span>)}</div>}
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="Ask about an uploaded dataset, portfolio property, or workflow result…" />
      <div className="composer-actions"><button className={contextOpen ? 'context-trigger active' : 'context-trigger'} onClick={() => setContextOpen(!contextOpen)}><Plus size={14}/> Add context</button><small>{selectedSourceProcessing ? 'Waiting for file processing…' : 'Shift+Enter for new line'}</small><button className="analyse-button" onClick={() => submit()} disabled={!input.trim() || busy || selectedSourceProcessing}>Analyse <Send size={14}/></button></div>
      <input ref={contextFileInput} className="hidden-file-input" type="file" multiple onChange={uploadChatFiles}/>
      {contextOpen && <div className="context-picker"><header><div><Database size={15}/><span><strong>Add data source</strong><small>Choose up to five uploaded files</small></span></div><button onClick={() => setContextOpen(false)}><X size={14}/></button></header><div className="context-attestation"><span>New files contain only:</span><button className={attested === 'synthetic' ? 'active' : ''} onClick={() => setAttested('synthetic')}>Synthetic data</button><button className={attested === 'redacted' ? 'active' : ''} onClick={() => setAttested('redacted')}>Redacted data</button></div><button className="upload-context" disabled={!attested} onClick={() => contextFileInput.current?.click()}><FileUp size={17}/><span><strong>Upload from this device</strong><small>{attested ? 'PDF, Word, CSV, Excel, text, or any other file' : 'Select synthetic or redacted above first'}</small></span><ChevronRight size={14}/></button>{uploadError && <p className="context-upload-error">{uploadError}</p>}<div className="context-library-title"><span>UPLOADED SOURCES</span><em>{dataSources.length}</em></div><div className="context-library">{dataSources.length ? dataSources.map((source) => <button key={source.id} className={attachedSourceIds.includes(source.id) ? 'selected' : ''} onClick={() => toggleAttachedSource(source.id)}><i>{sourceIcon(source.extension, 15)}</i><span><strong>{source.name}</strong><small>{source.extension} · {formatFileSize(source.size)}</small></span><em>{attachedSourceIds.includes(source.id) ? <Check size={12}/> : <Plus size={12}/>}</em></button>) : <p>No uploaded sources yet.</p>}</div></div>}
    </div>
  </section>;
}

const WORKFLOW_NODES = [
  { id: 'hazard', step: '01', title: 'Data validation', subtitle: 'Schema + ordering checks', icon: Database, x: 9, y: 41, type: 'data', detail: 'Validate coordinates, structural classes, insured values and all five 0–1 scores before any modelling. Invalid rows stop the run instead of being guessed.', source: 'Confirmed uploaded portfolio rows' },
  { id: 'quality', step: '02', title: 'Hazard modelling', subtitle: 'Proxy depth + diagnostics', icon: Waves, x: 25, y: 15, type: 'agent', detail: 'Convert the supplied susceptibility scores into scenario depth using documented model assumptions.', source: 'Uploaded hazard scores · model assumptions' },
  { id: 'vulnerability', step: '03', title: 'Vulnerability mapping', subtitle: 'MDR by structural class', icon: TrendingUp, x: 25, y: 66, type: 'model', detail: 'Apply documented, adapted damage functions by construction class. Parameters are assumptions informed by JRC/Huizinga curves.', source: 'JRC/Huizinga reference curves' },
  { id: 'exposure', step: '04', title: 'Exposure join', subtitle: 'Confirmed portfolio assets', icon: TableProperties, x: 44, y: 41, type: 'data', detail: 'Join uploaded hazard scores and structural vulnerability to confirmed portfolio properties.', source: 'Portfolio database' },
  { id: 'loss', step: '05', title: 'Financial loss engine', subtitle: 'MDR × insured value', icon: BarChart3, x: 61, y: 41, type: 'model', detail: 'Calculate loss for every property and aggregate by scenario. Validate that losses increase monotonically with severity.', source: 'Deterministic model calculation' },
  { id: 'intelligence', step: '06', title: 'AI intelligence', subtitle: 'Source-grounded briefing', icon: Sparkles, x: 77, y: 17, type: 'ai', detail: 'The chatbot can explain selected uploaded sources and approved portfolio outputs through the backend.', source: 'Flask chat · Gemini or Claude' },
  { id: 'review', step: '07', title: 'Human review gate', subtitle: 'Approval required', icon: UserRound, x: 77, y: 66, type: 'human', detail: 'A catastrophe modeller reviews sources, assumptions, synthetic records and drainage limitations before approving the run.', source: 'Human-in-the-loop control' },
  { id: 'publish', step: '08', title: 'Approved model run', subtitle: 'Underwriter-ready output', icon: CheckCircle2, x: 92, y: 41, type: 'output', detail: 'Release the approved loss table, EP curve and risk briefing. Unapproved runs remain drafts and cannot be exported.', source: 'Controlled model output' },
];

const WORKFLOW_LINKS = [
  ['hazard','quality'], ['hazard','vulnerability'], ['quality','exposure'], ['vulnerability','exposure'], ['exposure','loss'], ['loss','intelligence'], ['loss','review'], ['intelligence','review'], ['review','publish'],
];

const WORKFLOW_STAGE_DURATION = 5000;

function WorkflowWorkspace({ onApproved, onRunStart, autoRunSignal = 0, reloadSignal = 0 }) {
  const [selectedId, setSelectedId] = useState('hazard');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState([]);
  const [current, setCurrent] = useState(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [logs, setLogs] = useState([{ time: '', tone: 'info', text: 'Run the workflow to calculate from the uploaded portfolio.' }]);
  const [runId, setRunId] = useState(null);
  const [runSummary, setRunSummary] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const nodeRefs = useRef({});
  const selectedNode = WORKFLOW_NODES.find((node) => node.id === selectedId);
  const selectedIndex = WORKFLOW_NODES.findIndex((node) => node.id === selectedId);

  useEffect(() => {
    if (autoRunSignal && !reloadSignal) return undefined;
    let active = true;
    apiGet(`/model-runs?portfolioId=${encodeURIComponent(PORTFOLIO_ID)}`).then((body) => {
      if (!active || !body.items?.length) return;
      const run = body.items[0];
      setRunId(run.id);
      setRunStatus(run.status);
      setRunSummary(run.configuration?.summary || null);
      setCompleted((run.stages || []).filter((stage) => stage.status === 'completed').map((stage) => WORKFLOW_NODES[stage.position - 1]?.id).filter(Boolean));
      setAwaitingApproval(run.status === 'review');
      setCurrent(run.status === 'review' ? 'review' : null);
      if (run.status === 'review') setSelectedId('review');
      setLogs([{ time: '', tone: 'info', text: `Loaded ${run.id} from the Flask backend (${run.status}).` }]);
    }).catch(() => { if (active) setLogs([{ time: '', tone: 'warning', text: 'Could not load saved workflow state from Flask.' }]); });
    return () => { active = false; };
  }, [reloadSignal]);

  const addLog = (tone, text) => setLogs((items) => [...items, { time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone, text }]);
  const startRun = async () => {
    if (running) return;
    onRunStart();
    setCompleted([]); setAwaitingApproval(false); setRunning(true); setCurrent('hazard'); setRunSummary(null);
    setLogs([{ time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone: 'running', text: 'Calculating the uploaded portfolio in Flask…' }]);
    try {
      const run = await apiRequest('/model-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioId: PORTFOLIO_ID }) });
      setRunId(run.id);
      setRunStatus(run.status);
      setRunSummary(run.configuration?.summary || null);
      setCompleted(WORKFLOW_NODES.filter((node) => !['review', 'publish'].includes(node.id)).map((node) => node.id));
      setCurrent('review'); setSelectedId('review'); setAwaitingApproval(true);
      setLogs((items) => [...items, { time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone: 'success', text: `${run.configuration?.summary?.propertyCount || 0} confirmed properties calculated in run ${run.id}.` }, { time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone: 'warning', text: 'Review the calculated summary before approval.' }]);
    } catch (error) {
      setCurrent(null);
      addLog('warning', error.message);
    } finally { setRunning(false); }
  };

  useEffect(() => {
    if (!autoRunSignal) return;
    startRun();
  }, [autoRunSignal]);

  useEffect(() => {
    if (!current) return;
    nodeRefs.current[current]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current]);

  const decide = async (action) => {
    if (!runId) return;
    setRunning(true);
    try {
      await apiRequest(`/model-runs/${runId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      setAwaitingApproval(false); setCurrent(null);
      setRunStatus(action === 'approve' ? 'approved' : 'revision_requested');
      if (action === 'approve') { setCompleted(WORKFLOW_NODES.map((node) => node.id)); onApproved(); addLog('success', `Run ${runId} approved and property results saved.`); }
      else { addLog('warning', `Run ${runId} returned for revision.`); }
    } catch (error) { addLog('warning', error.message); }
    finally { setRunning(false); }
  };

  useEffect(() => {
    if (!inspectorOpen || !runId) return undefined;
    if (metrics?.runId === runId && metrics?.status === runStatus) return undefined;
    let active = true;
    setMetricsLoading(true); setMetricsError('');
    apiGet(`/model-runs/${runId}/metrics`)
      .then((body) => { if (active) setMetrics(body); })
      .catch((error) => { if (active) { setMetrics(null); setMetricsError(error.message); } })
      .finally(() => { if (active) setMetricsLoading(false); });
    return () => { active = false; };
  }, [inspectorOpen, runId, runStatus]);

  const nodeState = (id) => completed.includes(id) ? 'complete' : current === id ? (id === 'review' ? 'review' : 'running') : 'waiting';

  return <section className="workflow-workspace">
    <header className="workflow-toolbar"><div><Network size={17}/><span><strong>Agentic CAT workflow</strong><small>{runId || PORTFOLIO_ID} · Flask calculations</small></span></div><div className="workflow-actions"><span className={awaitingApproval ? 'review-status' : running ? 'run-status' : ''}><i/>{awaitingApproval ? 'HUMAN REVIEW' : running ? 'CALCULATING' : completed.includes('publish') ? 'APPROVED' : 'DRAFT'}</span><button className="run-workflow" disabled={running || awaitingApproval} onClick={startRun}><Play size={14}/> {running ? 'Calculating…' : 'Run workflow'}</button></div></header>
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
        {awaitingApproval && <div className="approval-card"><div><ShieldCheck size={18}/><span><strong>Human decision required</strong><small>{runSummary?.propertyCount} properties · KES {((runSummary?.totalTivKes || 0) / 1e9).toFixed(3)}B TIV · KES {((runSummary?.aalKes || 0) / 1e6).toFixed(2)}M AAL</small></span></div><div><button disabled={running} onClick={() => decide('return')}>Return for revision</button><button disabled={running} onClick={() => decide('approve')}><Check size={13}/> Approve run</button></div></div>}
       </div>
      </div>
      {inspectorOpen && <StageDrawer node={selectedNode} nodes={WORKFLOW_NODES} onSelect={setSelectedId} onClose={()=>setInspectorOpen(false)} runId={runId} runStatus={runStatus} metrics={metrics} loading={metricsLoading} error={metricsError}/>}
    </div>
  </section>;
}

function MapWorkspace({ activeTier, setActiveTier, selected, setSelected, properties, hotspots, portfolioSummary }) {
  const node = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapStatus, setMapStatus] = useState('loading');
  const [layers, setLayers] = useState({ hotspots: true, rivers: true, assets: true });
  const [layerMenu, setLayerMenu] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const allAssets = useMemo(() => properties.map((property) => ({ ...property, lat: property.latitude, lng: property.longitude, value: property.insuredValueKes == null ? null : property.insuredValueKes / 1e6, hazard: property.hazardScores?.[activeTier] ?? property.hazardScore, loss: property.loss100Kes == null ? null : property.loss100Kes / 1e6, tier: property.hazardBand, type: property.housingClass, status: property.reviewStatus === 'unconfirmed' ? 'Unconfirmed property' : 'Portfolio property' })), [properties, activeTier]);

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
    const visibleHotspots = layers.hotspots ? hotspots.map((spot) => ({ ...spot, lat: spot.latitude, lng: spot.longitude, tier: spot.severity || 'moderate', status: 'Reference hotspot' })) : [];
    const points = [...visibleHotspots.map((x) => ({...x, kind:'hotspot'})), ...(layers.assets ? allAssets.filter((x) => x.lat != null && x.lng != null).map((x) => ({...x, kind:'asset'})) : [])];
    markersRef.current = points.map((point) => {
      const tier = TIERS.find((item) => item.id === point.tier) || TIERS[tierIndex];
      const marker = new window.google.maps.Marker({ map: mapRef.current, position: { lat: point.lat, lng: point.lng }, title: point.name, icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: point.kind === 'asset' ? 6 : 10, fillColor: point.kind === 'asset' ? '#041c39' : tier.color, fillOpacity: .92, strokeColor: '#fff', strokeWeight: 2 } });
      marker.addListener('click', () => setSelected(point)); return marker;
    });
  }, [mapStatus, activeTier, layers, allAssets, hotspots, setSelected]);

  const currentTier = TIERS.find((tier) => tier.id === activeTier);
  return <section className="map-workspace">
    <header className="map-toolbar"><div className="map-search"><Search size={15} /><input placeholder="Search Nairobi location or portfolio property" /><span>⌘ K</span></div><button className={layerMenu ? 'active' : ''} onClick={() => setLayerMenu(!layerMenu)}><Layers3 size={16} /> Layers <ChevronDown size={13} /></button><button><Download size={16} /> Export</button></header>
    <div className="map-canvas">
      <div ref={node} className="google-map" />
      {mapStatus !== 'ready' && <div className="map-fallback"><div className="map-grid"/><svg viewBox="0 0 900 600"><path d="M20 430 C170 380 210 485 370 410 S600 300 880 350"/><path d="M110 40 C250 160 250 250 410 315 S690 415 800 590"/></svg>{allAssets.slice(0, 20).map((asset) => <button key={asset.id} className="fallback-pin" style={{left:`${Math.max(5,Math.min(85,(asset.lng-36.6)/.5*100))}%`,top:`${Math.max(10,Math.min(85,(-1.1-asset.lat)/.4*100))}%`,'--pin':'#041d3b'}} onClick={() => setSelected(asset)}><MapPin size={22}/><span>{asset.name}</span></button>)}<div className="map-setup"><Map size={22}/><strong>{mapStatus === 'missing' ? 'Add your Google Maps key for the live basemap' : mapStatus === 'error' ? 'Google Maps could not load' : 'Loading Nairobi map…'}</strong>{mapStatus === 'missing' && <span>VITE_GOOGLE_MAPS_API_KEY</span>}</div></div>}
      <div className="model-run"><span><i/> {portfolioSummary?.status === 'approved' ? 'APPROVED' : 'DRAFT'}: {PORTFOLIO_ID}</span><small>{portfolioSummary ? `KES ${(portfolioSummary.totalInsuredValueKes / 1e9).toFixed(3)}B TIV · ${portfolioSummary.propertyCount} properties` : 'Loading portfolio…'}</small></div>
      <div className="tier-control"><div><span>HAZARD SUSCEPTIBILITY TIER</span><small>Proxy score · not flood depth</small></div><div className="tier-buttons">{TIERS.map((tier) => <button key={tier.id} className={activeTier === tier.id ? 'active' : ''} style={{'--tier':tier.color}} onClick={() => setActiveTier(tier.id)}><i />{tier.label}<span>{tier.range}</span></button>)}</div></div>
      <div className="map-legend"><span>TERRAIN HAZARD PROXY (TWI / HAND)</span><div className="legend-scale" /><div><small>0.0 · LOW HILL</small><small>1.0 · VALLEY PLAIN</small></div></div>
      {layerMenu && <div className="layer-menu"><strong>MAP LAYERS</strong>{[['hotspots','Documented hotspots'],['rivers','Rivers & drainage'],['assets','Portfolio properties']].map(([key,label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => setLayers({...layers,[key]:!layers[key]})}/><span>{label}</span></label>)}<small>Hazard raster: {currentTier.label} ({currentTier.range})</small></div>}
      {selected && <div className="asset-inspector"><button className="close" onClick={() => setSelected(null)}><X size={15}/></button><span className="inspector-type">{selected.kind === 'hotspot' ? 'REFERENCE HOTSPOT' : 'PORTFOLIO PROPERTY'}</span><h3>{selected.name}</h3><p><MapPin size={12}/> {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</p><div className="inspector-grid"><div><span>PROXY SCORE</span><strong>{(selected.hazardScores?.[activeTier] ?? selected.hazard) == null ? 'Pending' : Number(selected.hazardScores?.[activeTier] ?? selected.hazard).toFixed(2)}</strong></div><div><span>ACTIVE TIER</span><strong style={{color:currentTier.color}}>{currentTier.label}</strong></div>{selected.value != null && <><div><span>INSURED VALUE</span><strong>KES {selected.value.toFixed(1)}M</strong></div><div><span>APPROVED 1-IN-100 LOSS</span><strong className="danger">{selected.loss == null ? 'Pending run' : `KES ${selected.loss.toFixed(2)}M`}</strong></div></>}</div><div className="inspector-caveat"><AlertTriangle size={13}/>{selected.status || 'Portfolio source'}</div><button className="ask-location" onClick={() => setSelected({...selected, ask:true})}><Bot size={15}/> Ask AI about this location <MessageSquareText size={13}/></button></div>}
    </div>
    <footer className="coordinates">LAT: -1.2921° S <i/> LON: 36.8219° E <i/> DEM: 1,680m ASL <i/> CATCHMENT: Nairobi–Athi <span>GOOGLE MAPS · PROXY OVERLAY</span></footer>
  </section>;
}

function SourceDetail({ source, onReprocess }) {
  const [issues, setIssues] = useState(null);
  const [facts, setFacts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet(`/uploads/${source.id}/issues`), apiGet(`/uploads/${source.id}/facts`)])
      .then(([issueBody, factBody]) => { if (!cancelled) { setIssues(issueBody.items); setFacts(factBody.items); } })
      .catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [source.id, source.status]);
  const visible = (issues || []).filter((item) => item.severity !== 'info' && item.resolution !== 'superseded');
  const dropped = (issues || []).filter((item) => item.code === 'ai_quote_not_found').length;
  return <div className="source-detail">
    <div className="source-detail-head"><span>{source.records}</span><span className="source-detail-actions"><button onClick={() => onReprocess(source.id)} title="Parse the stored file again, for example after adding Anthropic credit"><Zap size={12}/> Reprocess</button><a href={`${BACKEND_URL}/uploads/${source.id}/original`}><Download size={12}/> Original file</a></span></div>
    {error && <p className="source-detail-error"><AlertTriangle size={13}/> {error}</p>}
    {!issues && !error && <p className="source-detail-muted">Loading details…</p>}
    {issues && <section><h4>Checks <em>{visible.length}</em></h4>{visible.length ? <ul className="source-issues">{visible.slice(0, 60).map((item) => <li key={item.id} className={item.severity}><strong>{item.code.replaceAll('_', ' ')}</strong><span>{item.message}</span>{(item.evidence?.citations || []).map((citation, index) => <q key={index}>{citation.quote}<small>p. {citation.page ?? '–'}</small></q>)}{item.evidence?.quote && <q>{item.evidence.quote}<small>p. {item.evidence.page ?? '–'}</small></q>}</li>)}</ul> : <p className="source-detail-muted">No warnings or errors.</p>}{dropped > 0 && <p className="source-detail-muted">{dropped} AI-extracted value{dropped > 1 ? 's were' : ' was'} dropped because the quote could not be found in the document.</p>}</section>}
    {facts && facts.length > 0 && <section><h4>Extracted facts <em>{facts.length}</em></h4><div className="source-facts">{facts.map((fact) => <div key={fact.id}><span className={`fact-kind ${fact.kind}`}>{fact.kind}</span><strong>{fact.label || fact.key.replaceAll('_', ' ')}</strong><span>{fact.value}</span><q>{fact.quote}<small>p. {fact.page ?? '–'}{fact.verified ? '' : ' · unverified'}</small></q></div>)}</div></section>}
  </div>;
}

function DataSourcesScreen({ dataSources, onUploadFiles, onDeleteSource, onReprocessSource, attested, setAttested, loadState, uploadErrors, onDismissErrors }) {
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const fileInput = useRef(null);
  const filteredSources = useMemo(() => dataSources.filter((source) => source.name.toLowerCase().includes(search.toLowerCase()) || source.extension.toLowerCase().includes(search.toLowerCase())), [dataSources, search]);
  const totalSize = dataSources.reduce((sum, source) => sum + (source.size || 0), 0);
  const documents = dataSources.filter((source) => ['pdf', 'docx', 'text'].includes(source.upload.extractor)).length;
  const attention = dataSources.filter((source) => source.tone === 'error' || source.issueCounts.review || source.issueCounts.error).length;

  const upload = async (files) => {
    if (!files?.length || !attested) return;
    setUploading(true);
    await onUploadFiles(files);
    setUploading(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    upload(event.dataTransfer.files);
  };

  const pickFiles = () => { if (attested) fileInput.current?.click(); };

  return <section className="data-sources-screen">
    <header className="data-sources-header"><div><span className="section-kicker">MODEL INPUTS</span><h1>Data sources</h1><p>Upload exposure spreadsheets and insurance documents. Spreadsheets are validated row by row; PDFs, Word files and text are read by Claude, with every value tied to a quote in the document.</p></div><button disabled={!attested || uploading} onClick={pickFiles}><Upload size={16}/>{uploading ? 'Uploading…' : 'Upload data source'}</button></header>
    <input ref={fileInput} className="hidden-file-input" type="file" multiple onChange={(event) => { upload(event.target.files); event.target.value = ''; }}/>
    <div className="source-summary"><div><span className="summary-icon teal"><Database size={19}/></span><p><strong>{dataSources.length}</strong><small>Total sources</small></p></div><div><span className="summary-icon purple"><FileText size={19}/></span><p><strong>{documents}</strong><small>Documents read by Claude</small></p></div><div><span className="summary-icon amber"><AlertTriangle size={19}/></span><p><strong>{attention}</strong><small>Need attention</small></p></div><div><span className="summary-icon green"><FileArchive size={19}/></span><p><strong>{formatFileSize(totalSize)}</strong><small>Total storage</small></p></div></div>
    <div className={`source-attestation ${attested ? 'checked' : ''}`} role="radiogroup" aria-label="Data confirmation"><ShieldCheck size={15}/><span><strong>Confirm what you are uploading</strong><small>Required. Don't upload real client documents, named contacts or confidential terms.</small></span><div>{[['synthetic', 'Synthetic data'], ['redacted', 'Redacted documents']].map(([value, label]) => <button key={value} role="radio" aria-checked={attested === value} className={attested === value ? 'active' : ''} onClick={() => setAttested(attested === value ? '' : value)}><Check size={12}/>{label}</button>)}</div></div>
    <div className={`source-dropzone ${dragging ? 'dragging' : ''} ${attested ? '' : 'locked'}`} onDragEnter={(event) => { event.preventDefault(); setDragging(attested); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={handleDrop}>
      <span><FileUp size={22}/></span><div><strong>{attested ? 'Drop files here' : 'Choose synthetic or redacted above to upload'}</strong><p>or <button disabled={!attested} onClick={pickFiles}>browse your device</button></p></div><small>PDF · DOCX · CSV · XLSX · TXT · MD are parsed<br/>Any other file is stored · up to 20 MB each</small>
    </div>
    {uploadErrors.length > 0 && <div className="source-upload-errors"><AlertTriangle size={14}/><ul>{uploadErrors.map((item, index) => <li key={index}><strong>{item.name}</strong> {item.message}</li>)}</ul><button onClick={onDismissErrors} title="Dismiss"><X size={13}/></button></div>}
    <div className="source-library">
      <div className="source-library-toolbar"><div><h2>Your sources</h2><span>{filteredSources.length} {filteredSources.length === 1 ? 'file' : 'files'}</span></div><label><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search data sources"/></label></div>
      <div className="source-table"><div className="source-table-head"><span>NAME</span><span>TYPE</span><span>SIZE</span><span>UPLOADED</span><span>STATUS</span><span/></div>{loadState.status === 'error' ? <div className="empty-sources"><AlertTriangle size={27}/><strong>Data sources could not be loaded</strong><span>{loadState.message}. Start the Flask backend (VITE_API_BASE_URL).</span></div> : loadState.status === 'loading' ? <div className="empty-sources"><Clock3 size={27}/><strong>Loading data sources…</strong></div> : filteredSources.length ? filteredSources.map((source) => <React.Fragment key={source.id}><div className={`source-row ${expanded === source.id ? 'expanded' : ''}`} onClick={() => !source.processing && setExpanded(expanded === source.id ? null : source.id)}><div className="source-name"><i>{sourceIcon(source.extension)}</i><span><strong>{source.name}</strong><small>{source.records}</small></span></div><span><em className="file-type">{source.extension}</em></span><span>{formatFileSize(source.size)}</span><span>{new Date(source.uploadedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</span><span><em className={`source-status ${source.tone}`}><i/> {source.status}{source.issueCounts.review ? ` · ${source.issueCounts.review} review` : ''}</em></span>{pendingDelete === source.id ? <span className="delete-confirm" onClick={(event) => event.stopPropagation()}><button onClick={() => { setPendingDelete(null); onDeleteSource(source.id); }}>Delete</button><button onClick={() => setPendingDelete(null)}>Keep</button></span> : <button className="delete-source" disabled={source.processing} title={source.processing ? 'Wait for processing to finish' : `Delete ${source.name}`} onClick={(event) => { event.stopPropagation(); setPendingDelete(source.id); }}><Trash2 size={15}/></button>}</div>{expanded === source.id && <SourceDetail source={source} onReprocess={onReprocessSource}/>}</React.Fragment>) : <div className="empty-sources"><FolderOpen size={27}/><strong>No matching data sources</strong><span>Try a different search or upload a new file.</span></div>}</div>
    </div>
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
  const [workflowReloadSignal, setWorkflowReloadSignal] = useState(0);
  const showPendingRun = () => { setRightView('workflow'); setRightOpen(true); setWorkflowReloadSignal((signal) => signal + 1); };
  const [uploads, setUploads] = useState([]);
  const [sourcesLoad, setSourcesLoad] = useState({ status: 'loading', message: '' });
  const [attested, setAttestedState] = useState(() => { const stored = readStorage(ATTESTATION_STORAGE_KEY, ''); return ['synthetic', 'redacted'].includes(stored) ? stored : ''; });
  const [uploadErrors, setUploadErrors] = useState([]);
  const [mapProperties, setMapProperties] = useState([]);
  const [mapHotspots, setMapHotspots] = useState([]);
  const [portfolioSummary, setPortfolioSummary] = useState(null);
  const dataSources = useMemo(() => uploads.map(toSource), [uploads]);
  const setAttested = (value) => { setAttestedState(value); writeStorage(ATTESTATION_STORAGE_KEY, value); };
  const refreshSources = async () => {
    try {
      const body = await apiGet(`/portfolios/${PORTFOLIO_ID}/uploads`);
      setUploads(body.items);
      setSourcesLoad({ status: 'ready', message: '' });
    } catch (error) {
      setSourcesLoad({ status: 'error', message: error.message });
    }
  };
  useEffect(() => { refreshSources(); }, []);
  const refreshMap = async () => {
    try {
      const [properties, hotspots, summary] = await Promise.all([
        apiGet(`/portfolios/${PORTFOLIO_ID}/properties?limit=2000`),
        apiGet('/locations/hotspots'),
        apiGet(`/portfolios/${PORTFOLIO_ID}/summary`),
      ]);
      setMapProperties(properties.items || []);
      setMapHotspots(hotspots.items || []);
      setPortfolioSummary(summary);
      setReportReady(summary.status === 'approved');
    } catch { setMapProperties([]); setMapHotspots([]); setPortfolioSummary(null); }
  };
  useEffect(() => { refreshMap(); }, []);
  useEffect(() => {
    if (!uploads.some((upload) => PROCESSING_STATUSES.includes(upload.status))) return undefined;
    const timer = window.setTimeout(refreshSources, 3000);
    return () => window.clearTimeout(timer);
  }, [uploads]);
  useEffect(() => { if (selected?.ask) { setChatContext({...selected}); setSelected({...selected, ask:false}); } }, [selected]);
  const uploadDataSources = async (files) => {
    if (!attested) {
      const errors = [{ name: 'Upload blocked', message: 'Choose synthetic or redacted data before uploading.' }];
      setUploadErrors(errors);
      return { added: [], errors };
    }
    const errors = [];
    const added = [];
    for (const file of Array.from(files || [])) {
      const form = new FormData();
      form.append('file', file);
      form.append('attestation', attested);
      try {
        const upload = await apiRequest(`/portfolios/${PORTFOLIO_ID}/uploads`, { method: 'POST', body: form });
        if (upload.duplicate) errors.push({ name: file.name, message: 'was already uploaded; the existing copy is kept.' });
        added.push(upload);
      } catch (error) {
        errors.push({ name: file.name, message: error.message });
      }
    }
    setUploadErrors(errors);
    await refreshSources();
    await refreshMap();
    return { added: added.map(toSource), errors };
  };
  const reprocessDataSource = async (sourceId) => {
    try {
      await apiRequest(`/uploads/${sourceId}/reprocess`, { method: 'POST' });
    } catch (error) {
      setUploadErrors([{ name: 'Reprocess failed', message: error.message }]);
    }
    await refreshSources();
  };
  const deleteDataSource = async (sourceId) => {
    try {
      await apiRequest(`/uploads/${sourceId}`, { method: 'DELETE' });
    } catch (error) {
      setUploadErrors([{ name: 'Delete failed', message: error.message }]);
    }
    await refreshSources();
    await refreshMap();
  };
  const askAboutProperty = (property) => {
    setChatContext({ ...property, score: property.hazard, status: property.ai ? 'Drainage-linked evidence requires review' : 'Synthetic exposure · assumed vulnerability' });
    setActiveScreen('workspace');
    setChatOpen(true);
    setRightOpen(false);
  };
  return <main className={`workspace ${chatOpen ? '' : 'chat-collapsed'} ${navExpanded ? 'nav-expanded' : ''}`}>
    <header className="app-header minimal"><Brand /><div className="header-actions"><button className="profile-button"><span className="header-avatar">AO</span><span>Dr. A. Omondi</span></button><button onClick={onLogout} title="Sign out"><LogOut size={16}/></button></div></header>
    <div className="app-body"><nav className={`tool-rail ${navExpanded?'expanded':''}`}><button className="rail-toggle" onClick={()=>setNavExpanded(!navExpanded)} title={navExpanded?'Collapse navigation':'Expand navigation'}><Menu size={19}/><strong>{navExpanded?'Collapse':'Menu'}</strong></button><div className="rail-items"><button className={activeScreen==='workspace'?'active':''} onClick={()=>setActiveScreen('workspace')}><Map size={19}/><strong>Workspace</strong></button><button className={activeScreen==='portfolio'?'active':''} onClick={()=>setActiveScreen('portfolio')}><Building2 size={19}/><strong>Portfolio</strong></button><button className={activeScreen==='data-sources'?'active':''} onClick={()=>setActiveScreen('data-sources')}><Database size={19}/><strong>Data sources</strong></button><button><SlidersHorizontal size={19}/><strong>Assumptions</strong></button><button><Settings2 size={19}/><strong>Settings</strong></button></div></nav>
      {activeScreen==='portfolio' ? <PortfolioScreen onAskProperty={askAboutProperty}/> : activeScreen==='data-sources' ? <DataSourcesScreen dataSources={dataSources} onUploadFiles={uploadDataSources} onDeleteSource={deleteDataSource} onReprocessSource={reprocessDataSource} attested={attested} setAttested={setAttested} loadState={sourcesLoad} uploadErrors={uploadErrors} onDismissErrors={() => setUploadErrors([])}/> : <div className={`split-view ${rightOpen?'':'right-collapsed'}`}>{chatOpen && <ChatPanel selectedLocation={chatContext} addedAssets={assets} onAddAsset={(asset) => setAssets([...assets, asset])} onOpenView={(view,autoRun=false)=>{setRightView(view);setRightOpen(true);if(view==='workflow'&&autoRun)setWorkflowRunSignal((signal)=>signal+1)}} onWorkflowPending={showPendingRun} reportReady={reportReady} portfolioSummary={portfolioSummary} dataSources={dataSources} onUploadFiles={uploadDataSources} attested={attested} setAttested={setAttested}/>} {rightOpen && <button className="collapse-chat" onClick={() => setChatOpen(!chatOpen)} title={chatOpen ? 'Collapse analyst' : 'Open analyst'}>{chatOpen ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}</button>}{rightOpen && <div className="right-pane"><div className="right-view-tabs"><button className={rightView==='map'?'active':''} onClick={()=>setRightView('map')}><Map size={15}/> Map</button><button className={rightView==='workflow'?'active':''} onClick={()=>setRightView('workflow')}><Workflow size={15}/> Workflow <span>HITL</span></button><div><i className={reportReady?'approved-dot':''}/> {reportReady?'APPROVED':'DRAFT'}</div><button className="collapse-right" onClick={()=>{if(!chatOpen)setChatOpen(true);setRightOpen(false)}} title="Cancel and close side panel"><X size={16}/></button></div><div className="right-view-content"><div className={`right-mode ${rightView==='map'?'active':''}`}><MapWorkspace activeTier={tier} setActiveTier={setTier} selected={selected} setSelected={setSelected} properties={mapProperties} hotspots={mapHotspots} portfolioSummary={portfolioSummary}/></div><div className={`right-mode ${rightView==='workflow'?'active':''}`}><WorkflowWorkspace autoRunSignal={workflowRunSignal} reloadSignal={workflowReloadSignal} onRunStart={()=>setReportReady(false)} onApproved={()=>{setReportReady(true);refreshMap()}}/></div></div></div>}</div>}
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

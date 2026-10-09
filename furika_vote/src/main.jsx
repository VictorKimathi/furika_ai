import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  FastForward,
  RotateCcw,
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
  ShieldCheck,
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
import './chat-simple.css';
import kenyaReLogo from './assets/kenya-re-logo-light.png';
import kenyaReReportLogo from './assets/kenya-re-logo-light.png?inline';
import FurikaMascot from './FurikaMascot.jsx';
import PortfolioScreen from './PortfolioScreen.jsx';
import { API_BASE_URL as BACKEND_URL, PORTFOLIO_ID, apiGet, apiRequest, describeError, log } from './api.js';
import FormattedText from './FormattedText.jsx';
import OfferWorkflowWorkspace from './OfferWorkflowWorkspace.jsx';
import { carriedOfferContext, offerContextAfterResponse } from './chatOfferContext.js';
import { deleteChat, persistActiveChat, restoreChatState, upsertChat, finishChatRequest } from './chatPersistence.js';
import { RAIN_BY_TIER, rainTargets } from './mapRain.js';
import StageDrawer from './StageMetrics.jsx';
import RunStory from './RunStory.jsx';
import { AnswerFooter, NeedFromYou, OfferDecision, RunDecision } from './ChatDecision.jsx';
import Pipeline from './Pipeline.jsx';
import { buildStory } from './runStory.js';

// Rain is an illustrative visual emphasis for the selected susceptibility tier, not a rainfall forecast.
const TIERS = [
  { id: 'common', label: 'Common', range: '1 in 250', color: '#2a78d6', rain: RAIN_BY_TIER.common.intensity, rainLabel: RAIN_BY_TIER.common.label },
  { id: 'occasional', label: 'Occasional', range: '1 in 100', color: '#1baf7a', rain: RAIN_BY_TIER.occasional.intensity, rainLabel: RAIN_BY_TIER.occasional.label },
  { id: 'moderate', label: 'Moderate', range: '1 in 50', color: '#eda100', rain: RAIN_BY_TIER.moderate.intensity, rainLabel: RAIN_BY_TIER.moderate.label },
  { id: 'severe', label: 'Severe', range: '1 in 25', color: '#e34948', rain: RAIN_BY_TIER.severe.intensity, rainLabel: RAIN_BY_TIER.severe.label },
  { id: 'extreme', label: 'Extreme', range: '1 in 10', color: '#a3123f', rain: RAIN_BY_TIER.extreme.intensity, rainLabel: RAIN_BY_TIER.extreme.label },
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

const INITIAL_CHAT_MESSAGE = { role: 'assistant', content: "Hi, I'm **Furi**, the Furika Bot. Ask me about your portfolio, a property's flood risk or losses, or attach a file from the Data store with **Add context**." };

function ChatAnswer({ content }) {
  const [expanded, setExpanded] = useState(false);
  const long = content?.length > 1100;
  return <div className={`chat-answer ${long && !expanded ? 'collapsed' : ''}`}><div className="chat-answer-content"><FormattedText text={content}/></div>{long && <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Read full answer'}</button>}</div>;
}

function ChatWelcome({ hasFiles, hasResults, onPrompt, onAddFile }) {
  const prompts = hasResults
    ? ['Summarise my portfolio results', 'Where is loss concentrated?', 'What needs my review?']
    : hasFiles
    ? ['Summarise my uploaded data', 'Which properties need attention?', 'What should I review first?']
    : ['How do I assess a property?', 'What can I ask about flood risk?', 'What should I upload?'];
  return <div className="chat-welcome"><span className="chat-welcome-icon"><FurikaMascot size={38} animated/></span><h2>What would you like to know?</h2><p>Ask a question about an offer, a property, or your portfolio. Furi will use the information you provide.</p><div className="chat-welcome-prompts">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}<ArrowRight size={15}/></button>)}</div>{!hasFiles && !hasResults && <button className="chat-welcome-upload" type="button" onClick={onAddFile}><FileUp size={16}/> Add a file to ask about</button>}</div>;
}

function ChatSourcePicker({ dataSources, selectedIds, onToggle, onClose, onUploadClick, attested, setAttested, uploadError }) {
  const [tab, setTab] = useState(dataSources.length ? 'saved' : 'device');
  return <div className="context-picker chat-source-picker" role="dialog" aria-label="Add a file to chat"><header><div><FileText size={18}/><span><strong>Add a file</strong><small>Choose what Furi should use for your next question</small></span></div><button type="button" onClick={onClose} aria-label="Close file picker"><X size={17}/></button></header>
    <div className="chat-source-tabs" role="tablist" aria-label="File source"><button type="button" role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>Saved files ({dataSources.length})</button><button type="button" role="tab" aria-selected={tab === 'device'} className={tab === 'device' ? 'active' : ''} onClick={() => setTab('device')}>Upload new</button></div>
    {tab === 'saved' ? <><div className="context-library">{dataSources.length ? dataSources.map((source) => <button type="button" key={source.id} className={selectedIds.includes(source.id) ? 'selected' : ''} onClick={() => onToggle(source.id)} aria-pressed={selectedIds.includes(source.id)}><i>{sourceIcon(source.extension, 16)}</i><span><strong>{source.name}</strong><small>{source.processing ? 'Processing…' : `${source.extension} · ${formatFileSize(source.size)}`}</small></span><em>{selectedIds.includes(source.id) ? <Check size={13}/> : <Plus size={13}/>}</em></button>) : <div className="chat-no-files"><FileText size={23}/><strong>No saved files yet</strong><button type="button" onClick={() => setTab('device')}>Upload your first file</button></div>}</div><footer><span>{selectedIds.length} of 5 selected</span><button type="button" onClick={onClose}>Done</button></footer></> : <div className="chat-upload-choice"><p>For privacy, upload only synthetic or redacted data.</p><div className="context-attestation"><span>My file contains:</span><button type="button" className={attested === 'synthetic' ? 'active' : ''} onClick={() => setAttested('synthetic')}>Synthetic data</button><button type="button" className={attested === 'redacted' ? 'active' : ''} onClick={() => setAttested('redacted')}>Redacted data</button></div><button type="button" className="upload-context" disabled={!attested} onClick={onUploadClick}><FileUp size={18}/><span><strong>Choose files from my device</strong><small>PDF, Word, CSV, Excel, or text</small></span><ChevronRight size={17}/></button>{!attested && <small className="chat-upload-hint">Select a data type above to continue.</small>}{uploadError && <p className="context-upload-error" role="alert">{uploadError}</p>}</div>}
  </div>;
}

function citationLabel(citation) {
  const name = citation.filename || citation.propertyId || citation.runId || citation.name || citation.portfolioId || citation.offer;
  if (citation.page) return `${name} p.${citation.page}`;
  if (citation.rowRef) return /^\d/.test(citation.rowRef) ? `${name} row ${citation.rowRef}` : `${name} · ${citation.rowRef}`;
  return name;
}

// One click from the chat to the portfolio results, whatever state they are in.
function ResultsBanner({ status, onOpen }) {
  const [text, action] = status === 'review' ? ['Portfolio results are waiting for your decision', 'Review'] : status === 'approved' ? ['Portfolio results are ready', 'View results'] : ['No portfolio results yet', 'Calculate'];
  return <div className={`chat-context-banner results-${status}`}>{status === 'review' ? <UserRound size={16}/> : <ShieldCheck size={16}/>}<span>{text}</span><button type="button" onClick={onOpen}>{action} <ArrowRight size={14}/></button></div>;
}

function ChatPanel({ onRunDecided, selectedLocation, addedAssets, onAddAsset, onOpenView, onWorkflowPending, onOfferReview, reportReady, portfolioSummary, latestRun, dataSources, onUploadFiles, attested, setAttested }) {
  const [restoredChat] = useState(() => restoreChatState(localStorage, INITIAL_CHAT_MESSAGE));
  const [messages, setMessages] = useState(restoredChat.messages);
  const [activeChatId, setActiveChatId] = useState(restoredChat.activeChatId);
  const [recentChats, setRecentChats] = useState(restoredChat.recentChats);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [input, setInput] = useState(() => {
    const draft = readStorage('furika-chat-draft', {});
    return draft.chatId === restoredChat.activeChatId && typeof draft.text === 'string' ? draft.text : '';
  });
  const [busy, setBusy] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [attachedSourceIds, setAttachedSourceIds] = useState([]);
  const [activeOffer, setActiveOffer] = useState(restoredChat.offerContext);
  const [uploadError, setUploadError] = useState('');
  const thread = useRef(null);
  const contextFileInput = useRef(null);
  const activeChatIdRef = useRef(activeChatId);

  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  useLayoutEffect(() => {
    activeChatIdRef.current = activeChatId;
    persistActiveChat(localStorage, activeChatId);
  }, [activeChatId]);
  useEffect(() => { writeStorage('furika-chat-draft', { chatId: activeChatId, text: input }); }, [activeChatId, input]);

  useLayoutEffect(() => {
    const firstQuestion = messages.find((message) => message.role === 'user');
    if (!firstQuestion) return;
    const entry = { id: activeChatId, title: firstQuestion.content.slice(0, 52), updatedAt: Date.now(), messages, offerContext: activeOffer };
    setRecentChats(upsertChat(localStorage, entry));
  }, [messages, activeChatId, activeOffer]);

  useEffect(() => {
    if (activeOffer) {
      const lastReview = [...messages].reverse().find((message) => message.offerChecks);
      if (lastReview) onOfferReview?.(lastReview, { restoring: true });
    } else {
      const latestWorkflow = [...messages].reverse().find((message) => message.workflow);
      if (latestWorkflow?.workflow?.status === 'review') onWorkflowPending?.(latestWorkflow.workflow, { restoring: true });
    }
  }, []);

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

  const submit = async (value = input, location = null, retry = null) => {
    const text = value.trim();
    if (!text || busy || (!retry && dataSources.some((source) => attachedSourceIds.includes(source.id) && source.processing))) return;
    const selectedSources = dataSources.filter((source) => (retry?.request?.context?.uploadIds || attachedSourceIds).includes(source.id));
    const context = retry?.request?.context || { portfolioId: PORTFOLIO_ID, uploadIds: selectedSources.map((source) => source.id), ...carriedOfferContext(activeOffer, messages, selectedSources) };
    const request = retry?.request || { message: text, mode: 'analysis', context };
    const requestId = retry?.requestId || (globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random()}`);
    const messageIndex = retry?.messageIndex ?? messages.length;
    const chatId = activeChatId;
    if (selectedSources.length) { setActiveOffer(null); onOfferReview?.(null); }
    if (location?.kind === 'hotspot') context.hotspotId = location.id;
    else if (location?.id) context.propertyId = location.id;
    setInput('');
    setAttachedSourceIds([]);
    setContextOpen(false);
    if (!retry) setMessages((current) => [...current, { role: 'user', content: text, attachments: selectedSources.map((source) => source.name), request, requestId, pending: true, createdAt: new Date().toISOString() }]);
    setBusy(true);
    try {
      const data = await apiRequest('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const nextOffer = offerContextAfterResponse(data, text, selectedSources, messageIndex, activeOffer);
      const responseMessage = { role: 'assistant', content: data.answer, question: text, reportAttachments: selectedSources.map((source) => source.name), createdAt: new Date().toISOString(), source: data.source || 'Furika model context', citations: data.citations || [], workflow: data.workflow || null, decision: data.decision || null, offerChecks: data.offerChecks || null, asset: data.asset || null, provider: data.provider, model: data.model, actions: true };
      const saved = finishChatRequest(localStorage, chatId, requestId, responseMessage, nextOffer);
      if (activeChatIdRef.current === chatId) {
        setActiveOffer(nextOffer);
        setMessages(saved?.messages || ((current) => [...current.map((message) => message.requestId === requestId ? { ...message, pending: false, request: undefined } : message), responseMessage]));
        if (data.workflow?.status === 'review') onWorkflowPending(data.workflow);
        if (data.offerChecks) onOfferReview?.(data);
      }
    } catch (error) {
      const errorMessage = { role: 'assistant', content: error.message, source: 'Flask backend', createdAt: new Date().toISOString(), failed: true, question: text, request, requestId };
      const saved = finishChatRequest(localStorage, chatId, requestId, errorMessage);
      if (activeChatIdRef.current === chatId) setMessages(saved?.messages || ((current) => [...current.map((message) => message.requestId === requestId ? { ...message, pending: false, request: undefined } : message), errorMessage]));
    } finally { setBusy(false); }
  };

  const retryFailed = (index) => {
    const failed = messages[index];
    if (!failed?.request || busy) return;
    setMessages((current) => current.filter((_, i) => i !== index).map((message) => message.role === 'user' && message.requestId === failed.requestId ? { ...message, pending: true, request: failed.request } : message));
    submit(failed.question, null, { request: failed.request, requestId: failed.requestId, messageIndex: index });
  };

  const startNewChat = () => {
    if (busy) return;
    const nextId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeChatIdRef.current = nextId;
    setActiveChatId(nextId);
    setMessages([INITIAL_CHAT_MESSAGE]);
    setActiveOffer(null);
    onOfferReview?.(null);
    setInput('');
    setAttachedSourceIds([]);
    setContextOpen(false);
    setHistoryOpen(false);
    setClearConfirmOpen(false);
  };

  const clearCurrentChat = () => {
    if (busy) return;
    setRecentChats(deleteChat(localStorage, activeChatId));
    setMessages([INITIAL_CHAT_MESSAGE]);
    setActiveOffer(null);
    onOfferReview?.(null);
    setInput('');
    writeStorage('furika-chat-draft', { chatId: activeChatId, text: '' });
    setAttachedSourceIds([]);
    setUploadError('');
    setContextOpen(false);
    setHistoryOpen(false);
    setClearConfirmOpen(false);
  };

  const openRecentChat = (chat) => {
    if (busy) return;
    activeChatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages(chat.messages?.length ? chat.messages : [INITIAL_CHAT_MESSAGE]);
    setActiveOffer(chat.offerContext || null);
    const review = chat.offerContext ? [...(chat.messages || [])].reverse().find((message) => message.offerChecks) : null;
    onOfferReview?.(review || null);
    if (!review) {
      const latestWorkflow = [...(chat.messages || [])].reverse().find((message) => message.workflow);
      if (latestWorkflow?.workflow?.status === 'review') onWorkflowPending?.(latestWorkflow.workflow);
    }
    setInput('');
    setAttachedSourceIds([]);
    setContextOpen(false);
    setHistoryOpen(false);
    setClearConfirmOpen(false);
  };

  const removeRecentChat = (event, id) => {
    event.stopPropagation();
    setRecentChats(deleteChat(localStorage, id));
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
  const hasChatContent = messages.some((message) => message.role === 'user') || Boolean(input || activeOffer || attachedSourceIds.length);

  return <section className="chat-panel">
    <header className="panel-header"><div className="panel-title"><div className="bot-avatar"><FurikaMascot size={34} animated/></div><span><strong>Ask Furi</strong><small>Your flood-risk assistant</small></span></div><div className="chat-header-actions"><button className={historyOpen?'active':''} title="Past chats" onClick={()=>{setHistoryOpen(!historyOpen);setClearConfirmOpen(false);}}><History size={16}/><span>Chats</span></button><button title="Start a new chat" disabled={busy} onClick={startNewChat}><Plus size={16}/><span>New</span></button><button className={clearConfirmOpen?'active clear-chat-trigger':'clear-chat-trigger'} title="Clear current chat" disabled={busy || !hasChatContent} onClick={()=>{setClearConfirmOpen(!clearConfirmOpen);setHistoryOpen(false);}}><Trash2 size={16}/><span>Clear</span></button><button title="Open the map" onClick={() => onOpenView('map')}><Map size={16}/><span>Map</span></button></div></header>
    {clearConfirmOpen && <div className="chat-clear-confirm" role="alertdialog" aria-labelledby="clear-chat-title"><AlertTriangle size={17}/><span><strong id="clear-chat-title">Clear this chat?</strong><small>This removes its messages and draft from recent chats.</small></span><button type="button" onClick={()=>setClearConfirmOpen(false)}>Cancel</button><button type="button" className="confirm" onClick={clearCurrentChat}>Clear</button></div>}
    {historyOpen && <aside className="recent-chats"><div className="recent-chats-head"><div><History size={15}/><strong>Recent chats</strong></div><button onClick={()=>setHistoryOpen(false)}><X size={15}/></button></div><button className="new-chat-button" onClick={startNewChat}><Plus size={14}/> New analysis</button><div className="recent-chat-list">{recentChats.length?recentChats.map((chat)=><button key={chat.id} className={chat.id===activeChatId?'active':''} onClick={()=>openRecentChat(chat)}><MessageSquareText size={14}/><span><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleDateString('en-KE',{month:'short',day:'numeric'})} · {new Date(chat.updatedAt).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</small></span><i onClick={(event)=>removeRecentChat(event,chat.id)} title="Delete chat"><Trash2 size={13}/></i></button>):<div className="no-recent-chats"><MessageSquareText size={20}/><strong>No recent chats</strong><span>Your completed conversations will appear here.</span></div>}</div></aside>}
    <div className="chat-thread" ref={thread}>
      {!activeOffer && <ResultsBanner status={latestRun?.status === 'review' ? 'review' : portfolioSummary?.status === 'approved' ? 'approved' : 'none'} onOpen={() => onOpenView('workflow')}/>}
      {messages.length === 1 && messages[0].role === 'assistant' && messages[0].content === INITIAL_CHAT_MESSAGE.content && <ChatWelcome hasFiles={dataSources.length > 0} hasResults={portfolioSummary?.status === 'approved'} onPrompt={submit} onAddFile={() => setContextOpen(true)}/>}
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role} ${index === 0 && message.content === INITIAL_CHAT_MESSAGE.content ? 'chat-intro-message' : ''}`}>
        <div className="message-meta">{message.role === 'assistant' ? <span className="bot-meta"><FurikaMascot size={16}/> Furi</span> : 'You'}{message.createdAt && <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</time>}</div>
        <div className="message-bubble">{message.role === 'assistant' ? <ChatAnswer content={message.content}/> : <p>{message.content}</p>}{message.pending && !busy && <div className="chat-pending-request"><Clock3 size={13}/><span>The page refreshed before the answer was saved.</span>{message.request && <button type="button" onClick={() => submit(message.content, null, { request: message.request, requestId: message.requestId, messageIndex: index })}>Retry</button>}</div>}{message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((name) => <span key={name}><FileText size={11}/>{name}</span>)}</div>}{message.role === 'assistant' && (() => {
          const reportMessage = { ...message, question: message.question || messages.slice(0, index).reverse().find((item) => item.role === 'user')?.content, reportAttachments: message.reportAttachments || messages[index - 1]?.attachments };
          if (message.failed) return <NeedFromYou message={message} onRetry={() => retryFailed(index)} onAddFile={() => setContextOpen(true)}/>;
          if (message.decision) return <OfferDecision message={message} reportMessage={reportMessage} onOpenView={onOpenView}/>;
          if (message.workflow?.runId) return <RunDecision message={message} reportMessage={reportMessage} onOpenView={onOpenView} onRunDecided={onRunDecided}/>;
          return message.actions ? <AnswerFooter message={message} reportMessage={reportMessage}/> : null;
        })()}</div>
      </div>)}
      {busy && <div className="chat-waiting" role="status"><span className="chat-waiting-dots" aria-hidden="true"><i/><i/><i/></span>Furi is checking your question…</div>}
      {!!addedAssets.length && <div className="portfolio-update"><Database size={14} /> {addedAssets.length} AI-derived synthetic {addedAssets.length === 1 ? 'asset' : 'assets'} added this session</div>}
    </div>
    <div className="chat-composer">
      {activeOffer && <div className="chat-offer-context"><ShieldCheck size={14}/><span>Reviewing one offer: <strong>{activeOffer.kind === 'upload' ? activeOffer.name : 'pasted placement offer'}</strong></span><button type="button" onClick={() => { setActiveOffer(null); onOfferReview?.(null); }}><X size={12}/> Clear</button></div>}
      {attachedSourceIds.length > 0 && <div className="attached-sources">{dataSources.filter((source) => attachedSourceIds.includes(source.id)).map((source) => <span key={source.id}>{sourceIcon(source.extension, 12)}<strong>{source.name}</strong><button title={`Remove ${source.name}`} onClick={() => toggleAttachedSource(source.id)}><X size={11}/></button></span>)}</div>}
      <textarea aria-label="Ask Furi a question" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder={activeOffer ? 'Ask about this offer…' : 'Ask a question about flood risk…'} />
      <div className="composer-actions"><button type="button" className={contextOpen ? 'context-trigger active' : 'context-trigger'} onClick={() => setContextOpen(!contextOpen)}><Plus size={16}/> Add file{attachedSourceIds.length > 0 ? ` (${attachedSourceIds.length})` : ''}</button><small>{selectedSourceProcessing ? 'File is still processing…' : 'Enter to send · Shift+Enter for a new line'}</small><button type="button" className="analyse-button" onClick={() => submit()} disabled={!input.trim() || busy || selectedSourceProcessing}>Send <Send size={15}/></button></div>
      <input ref={contextFileInput} className="hidden-file-input" type="file" multiple onChange={uploadChatFiles}/>
      {contextOpen && <ChatSourcePicker dataSources={dataSources} selectedIds={attachedSourceIds} onToggle={toggleAttachedSource} onClose={() => setContextOpen(false)} onUploadClick={() => contextFileInput.current?.click()} attested={attested} setAttested={setAttested} uploadError={uploadError}/>}
    </div>
  </section>;
}

const WORKFLOW_NODES = [
  { id: 'hazard', step: '01', title: 'Check uploaded data', subtitle: 'Locations and values', icon: Database, x: 9, y: 41, type: 'data', detail: 'Validate coordinates, structural classes, insured values and all five 0–1 scores before any modelling. Invalid rows stop the run instead of being guessed.', source: 'Confirmed uploaded portfolio rows' },
  { id: 'quality', step: '02', title: 'Flood exposure', subtitle: 'Scenario scores', icon: Waves, x: 25, y: 15, type: 'agent', detail: 'Convert the supplied susceptibility scores into scenario depth using documented model assumptions.', source: 'Uploaded hazard scores · model assumptions' },
  { id: 'vulnerability', step: '03', title: 'Building damage', subtitle: 'By construction type', icon: TrendingUp, x: 25, y: 66, type: 'model', detail: 'Apply documented, adapted damage functions by construction class. Parameters are assumptions informed by JRC/Huizinga curves.', source: 'JRC/Huizinga reference curves' },
  { id: 'exposure', step: '04', title: 'Assets in scope', subtitle: 'Confirmed properties', icon: TableProperties, x: 44, y: 41, type: 'data', detail: 'Join uploaded hazard scores and structural vulnerability to confirmed portfolio properties.', source: 'Portfolio database' },
  { id: 'loss', step: '05', title: 'Financial engine', subtitle: 'Ground-up → gross → net', icon: BarChart3, x: 61, y: 41, type: 'model', detail: 'Calculate loss for every property and aggregate by scenario. Validate that losses increase monotonically with severity.', source: 'Deterministic model calculation' },
  { id: 'intelligence', step: '06', title: 'Key insights', subtitle: 'Plain-language briefing', icon: Sparkles, x: 77, y: 17, type: 'ai', detail: 'The chatbot can explain selected uploaded sources and approved portfolio outputs through the backend.', source: 'Flask chat · Gemini or Claude' },
  { id: 'review', step: '07', title: 'Underwriter review', subtitle: 'Decision required', icon: UserRound, x: 77, y: 66, type: 'human', detail: 'A catastrophe modeller reviews sources, assumptions, synthetic records and drainage limitations before approving the run.', source: 'Human-in-the-loop control' },
  { id: 'publish', step: '08', title: 'Final results', subtitle: 'After approval', icon: CheckCircle2, x: 92, y: 41, type: 'output', detail: 'Release the approved loss table, EP curve and risk briefing. Unapproved runs remain drafts and cannot be exported.', source: 'Controlled model output' },
];

// The pipeline plays stage by stage; the backend run happens in the background and stages from the
// loss step on wait for it, so the animation never shows a result the model has not produced.
const WORKFLOW_STAGE_DURATION = 1800;
const WORKFLOW_FAST_DURATION = 120;
const REVIEW_INDEX = WORKFLOW_NODES.findIndex((node) => node.id === 'review');
const RESULT_GATE_INDEX = WORKFLOW_NODES.findIndex((node) => node.id === 'loss');

function WorkflowWorkspace({ onApproved, onRunStart, onRunChange = () => {}, autoRunSignal = 0, reloadSignal = 0 }) {
  const [selectedId, setSelectedId] = useState('hazard');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [view, setView] = useState('story');
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
  const [anim, setAnim] = useState(null);
  const [failed, setFailed] = useState(null);
  const runPending = useRef(false);
  const animIndex = useRef(0);
  const story = useMemo(() => buildStory(metrics), [metrics]);
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
      setCompleted(run.status === 'approved' ? WORKFLOW_NODES.map((node) => node.id) : (run.stages || []).filter((stage) => stage.status === 'completed').map((stage) => WORKFLOW_NODES[stage.position - 1]?.id).filter(Boolean));
      setAwaitingApproval(run.status === 'review');
      setCurrent(run.status === 'review' ? 'review' : null);
      if (run.status === 'review') setSelectedId('review');
      setLogs([{ time: '', tone: 'info', text: `Loaded ${run.id} from the Flask backend (${run.status}).` }]);
    }).catch(() => { if (active) setLogs([{ time: '', tone: 'warning', text: 'Could not load saved workflow state from Flask.' }]); });
    return () => { active = false; };
  }, [reloadSignal]);

  const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  // Backend step trace as log lines: every step with its time, and the failing step with the error.
  const traceLines = (trace) => (trace?.steps || []).map((step) => {
    const detail = Object.entries(step.detail || {}).map(([key, value]) => `${key}=${value}`).join(', ');
    return { time: clock(), tone: step.status === 'ok' ? 'info' : 'warning',
      text: `${step.status === 'ok' ? 'ok' : step.status.toUpperCase()} · ${step.step} · ${step.ms ?? '-'} ms${detail ? ` · ${detail}` : ''}${step.error ? ` · ${step.error}` : ''}` };
  });
  const failureLines = (error, action) => [
    { time: clock(), tone: 'warning', text: `${action} failed${error.step ? ` at step "${error.step}"` : ''}: ${error.message}` },
    ...traceLines(error.trace),
    { time: clock(), tone: 'info', text: `Trace ${error.requestId || 'n/a'}: search the Flask log for this ID; window.furikaLog in the browser console has the full record.` },
  ];
  const addLog = (tone, text) => setLogs((items) => [...items, { time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone, text }]);
  const startRun = async () => {
    if (running || anim) return;
    onRunStart();
    setView('pipeline'); setMetrics(null); setFailed(null);
    setCompleted([]); setAwaitingApproval(false); setRunning(true); setCurrent('hazard'); setRunSummary(null);
    runPending.current = true;
    setAnim({ index: 0, target: REVIEW_INDEX });
    setLogs([{ time: new Date().toLocaleTimeString('en-GB', { hour12: false }), tone: 'running', text: 'Calculating the uploaded portfolio in Flask…' }]);
    try {
      const run = await apiRequest('/model-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioId: PORTFOLIO_ID }) });
      setRunId(run.id);
      setRunStatus(run.status);
      setRunSummary(run.configuration?.summary || null);
      setAwaitingApproval(true);
      runPending.current = false;
      onRunChange();
      setAnim((value) => value && { ...value });
      setLogs((items) => [...items, ...traceLines(run.trace), { time: clock(), tone: 'success', text: `${run.configuration?.summary?.propertyCount || 0} confirmed properties calculated in run ${run.id} (${run.trace?.totalMs ?? '?'} ms, trace ${run.trace?.traceId || 'n/a'}).` }, { time: clock(), tone: 'warning', text: 'Review the calculated summary before approval.' }]);
    } catch (error) {
      runPending.current = false;
      setAnim(null);
      setFailed({ id: WORKFLOW_NODES[animIndex.current]?.id, message: error.message });
      log.error('Workflow run failed', { step: error.step, requestId: error.requestId, message: error.message });
      setLogs((items) => [...items, ...failureLines(error, 'Model run')]);
    } finally { setRunning(false); }
  };

  useEffect(() => {
    if (!autoRunSignal) return;
    startRun();
  }, [autoRunSignal]);

  // Animation: light up one stage at a time, the side panel following it, until the target stage.
  useEffect(() => {
    if (!anim) return undefined;
    const node = WORKFLOW_NODES[anim.index];
    animIndex.current = anim.index;
    if (anim.index >= anim.target) {
      setAnim(null);
      setCurrent(node?.id ?? null);
      if (node) setSelectedId(node.id);
      return undefined;
    }
    setCurrent(node.id); setSelectedId(node.id);
    if (runPending.current && anim.index >= RESULT_GATE_INDEX) return undefined;
    const timer = window.setTimeout(() => {
      setCompleted((items) => [...new Set([...items, node.id])]);
      setAnim((value) => value && { ...value, index: value.index + 1 });
    }, anim.fast ? WORKFLOW_FAST_DURATION : WORKFLOW_STAGE_DURATION);
    return () => window.clearTimeout(timer);
  }, [anim]);

  const replay = () => {
    if (!runId || anim || running) return;
    setFailed(null); setCompleted([]);
    setAnim({ index: 0, target: runStatus === 'approved' ? WORKFLOW_NODES.length : REVIEW_INDEX });
  };
  const skip = () => setAnim((value) => value && { ...value, fast: true });

  const decide = async (action) => {
    if (!runId) return;
    setRunning(true);
    try {
      const decision = await apiRequest(`/model-runs/${runId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      setLogs((items) => [...items, ...traceLines(decision.trace)]);
      setAwaitingApproval(false); setCurrent(null);
      setRunStatus(action === 'approve' ? 'approved' : 'revision_requested');
      onRunChange();
      if (action === 'approve') { setCompleted((items) => [...new Set([...items, 'review'])]); setAnim({ index: WORKFLOW_NODES.length - 1, target: WORKFLOW_NODES.length }); onApproved(); addLog('success', `Run ${runId} approved and property results saved.`); }
      else { addLog('warning', `Run ${runId} returned for revision.`); }
    } catch (error) {
      log.error(`Workflow ${action} failed`, { step: error.step, requestId: error.requestId, message: error.message });
      setLogs((items) => [...items, ...failureLines(error, action === 'approve' ? 'Approval' : 'Return')]);
    }
    finally { setRunning(false); }
  };

  useEffect(() => {
    if (!runId) return undefined;
    if (metrics?.runId === runId && metrics?.status === runStatus) return undefined;
    let active = true;
    setMetricsLoading(true); setMetricsError('');
    apiGet(`/model-runs/${runId}/metrics`)
      .then((body) => { if (active) setMetrics(body); })
      .catch((error) => { if (active) { setMetrics(null); setMetricsError(error.message); } })
      .finally(() => { if (active) setMetricsLoading(false); });
    return () => { active = false; };
  }, [runId, runStatus]);

  const openStage = (id) => { setSelectedId(id); setInspectorOpen(true); };
  const nodeState = (id) => failed?.id === id ? 'failed' : completed.includes(id) ? 'complete' : current === id ? (id === 'review' ? 'review' : 'running') : 'waiting';

  return <section className="workflow-workspace">
    <header className="workflow-toolbar"><div><Network size={17}/><span><strong>Portfolio flood review</strong><small>{runId || PORTFOLIO_ID}</small></span></div><div className="workflow-actions"><div className="workflow-view-switch" role="tablist" aria-label="Workflow view"><button role="tab" aria-selected={view==='story'} className={view==='story'?'active':''} onClick={()=>setView('story')}>Summary</button><button role="tab" aria-selected={view==='pipeline'} className={view==='pipeline'?'active':''} onClick={()=>setView('pipeline')}>Pipeline</button></div><span className={anim || running ? 'run-status' : awaitingApproval ? 'review-status' : ''}><i/>{anim || running ? 'CALCULATING' : awaitingApproval ? 'HUMAN REVIEW' : completed.includes('publish') ? 'APPROVED' : 'DRAFT'}</span>{view==='pipeline' && (anim ? <button className="ghost" onClick={skip}><FastForward size={14}/> Skip</button> : runId && <button className="ghost" disabled={running} onClick={replay}><RotateCcw size={14}/> Replay</button>)}<button className="run-workflow" disabled={running || awaitingApproval || !!anim} onClick={startRun}><Play size={14}/> {running ? 'Calculating…' : 'Calculate portfolio'}</button></div></header>
    {view === 'story' && <div className="workflow-story"><RunStory metrics={metrics} loading={metricsLoading} error={metricsError} runId={runId} runStatus={runStatus} awaitingApproval={awaitingApproval} running={running} onDecide={decide} onOpenStage={openStage} onRun={startRun}/></div>}
    {view === 'pipeline' && <div className="workflow-pipeline" style={{ '--step-ms': `${anim?.fast ? WORKFLOW_FAST_DURATION : WORKFLOW_STAGE_DURATION}ms` }}><Pipeline nodes={WORKFLOW_NODES} stateOf={nodeState} selectedId={selectedId} onSelect={setSelectedId} story={story} loading={metricsLoading || runPending.current} runId={runId} runStatus={runStatus} awaitingApproval={awaitingApproval && !anim} busy={running} onDecide={decide} onOpenDetails={openStage} error={failed?.message || metricsError}/></div>}
    {inspectorOpen && <StageDrawer node={selectedNode} nodes={WORKFLOW_NODES} onSelect={setSelectedId} onClose={()=>setInspectorOpen(false)} runId={runId} runStatus={runStatus} metrics={metrics} loading={metricsLoading} error={metricsError}/>}
  </section>;
}

const LINK_KM = 1.2;
const MAX_LINKS = 3;
const PULSE_COUNT = 40;

const distanceKm = (a, b) => {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const HOUSING_NAMES = { informal_iron_sheet: 'Informal iron sheet', semi_permanent: 'Semi-permanent', permanent_masonry: 'Permanent masonry', concrete_rcc: 'Concrete / RCC' };
const kes = (value) => value == null ? 'n/a' : value >= 1e9 ? `KES ${(value / 1e9).toFixed(2)}B` : `KES ${(value / 1e6).toFixed(1)}M`;
const coord = (lat, lng) => `${Math.abs(lat).toFixed(5)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng).toFixed(5)}°${lng < 0 ? 'W' : 'E'}`;

// Hover card for map markers: exact location plus what the portfolio knows about the point.
function MapTooltip({ hover, tier, assets }) {
  if (!hover) return null;
  const { kind, data, x, y } = hover;
  const rows = [];
  let title = data.name, type = 'PORTFOLIO PROPERTY';
  if (kind === 'asset') {
    title = data.name || data.id;
    if (data.region) rows.push(['Area', data.region]);
    rows.push(['Construction', HOUSING_NAMES[data.type] || data.type || 'n/a'], ['Insured value', kes(data.insuredValueKes)],
      [`${tier.label} score`, data.hazardScores?.[tier.id] == null ? 'n/a' : Number(data.hazardScores[tier.id]).toFixed(2)],
      ['Annual flood chance', data.annualFloodProbability == null ? 'Pending run' : `${(data.annualFloodProbability * 100).toFixed(1)}%`],
      ['1-in-100 loss', data.loss100Kes == null ? 'Pending run' : kes(data.loss100Kes)], ['Average annual loss', data.aalKes == null ? 'Pending run' : kes(data.aalKes)]);
    if (data.nearestHotspotKm != null) rows.push(['Nearest hotspot', `${Number(data.nearestHotspotKm).toFixed(2)} km`]);
    rows.push(['Status', data.reviewStatus === 'unconfirmed' ? 'Unconfirmed' : 'Confirmed' + (data.geocodePrecision ? ` · ${data.geocodePrecision} location` : '')]);
  } else if (kind === 'hotspot') {
    type = 'DOCUMENTED FLOOD HOTSPOT';
    const point = { lat: data.latitude, lng: data.longitude };
    const near = assets.map((asset) => ({ asset, km: distanceKm(point, asset) })).sort((a, b) => a.km - b.km);
    const within = near.filter((item) => item.km <= 1);
    if (data.severity) rows.push(['Severity', data.severity]);
    rows.push(['Properties within 1 km', String(within.length)], ['Insured value within 1 km', kes(within.reduce((sum, item) => sum + (item.asset.insuredValueKes || 0), 0))],
      [`Wet in ${tier.label.toLowerCase()} scenario`, `${within.filter((item) => item.asset.score > 0).length} of ${within.length}`]);
    if (near[0]) rows.push(['Nearest property', `${near[0].asset.name || near[0].asset.id} · ${near[0].km.toFixed(2)} km`]);
  } else if (kind === 'offer') {
    type = 'PASTED PLACEMENT OFFER';
    const near = assets.filter((asset) => distanceKm(data, asset) <= 1);
    rows.push(['Annual flood chance', data.annualFloodProbability == null ? 'n/a' : `${(data.annualFloodProbability * 100).toFixed(1)}%`],
      ['Average annual loss', kes(data.aalKes)], ['1-in-100 loss', kes(data.loss100Kes)]);
    if (data.portfolioComparison) rows.push(['Portfolio within 1 km', `${near.length} properties · ${kes(near.reduce((sum, asset) => sum + (asset.insuredValueKes || 0), 0))}`]);
    (data.flags || []).filter((flag) => flag.severity === 'high').slice(0, 3).forEach((flag, index) => rows.push([index ? '' : 'High findings', flag.title]));
  } else {
    type = 'FLOOD CLUSTER';
    rows.push(['Properties', String(data.count)], ['Insured value', `KES ${data.value.toFixed(1)}M`], [`Mean ${tier.label.toLowerCase()} score`, data.meanScore.toFixed(2)]);
  }
  const lat = kind === 'hotspot' ? data.latitude : data.lat, lng = kind === 'hotspot' ? data.longitude : data.lng;
  const flipX = x > hover.width - 300, flipY = y > hover.height - 260;
  return <div className={`map-tooltip ${kind}`} style={{ left: x, top: y, transform: `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? 'calc(-100% - 10px)' : '10px'})`, '--tier': tier.color }} role="tooltip">
    <span className="map-tooltip-type">{type}</span>
    <strong>{title}</strong>
    <p><MapPin size={12}/> {coord(lat, lng)}</p>
    <dl>{rows.map(([label, value], index) => <React.Fragment key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    <small>{kind === 'offer' ? 'Model view of the offered building · see the chat briefing' : 'Click for details · ask Furika Bot'}</small>
  </div>;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const build = (list) => list.reduce((hull, point) => { while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop(); hull.push(point); return hull; }, []);
  const lower = build(sorted), upper = build([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// Wet properties in the active tier, links between wet neighbours, and connected flood clusters.
function buildFloodMesh(assets) {
  const wet = assets.filter((asset) => asset.score > 0);
  const edges = [];
  const seen = new Set();
  const parent = wet.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  wet.forEach((asset, i) => {
    const near = [];
    wet.forEach((other, j) => { if (i !== j) { const d = distanceKm(asset, other); if (d <= LINK_KM) near.push([d, j]); } });
    near.sort((a, b) => a[0] - b[0]).slice(0, MAX_LINKS).forEach(([, j]) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([wet[i], wet[j]]); }
      parent[find(i)] = find(j);
    });
  });
  const groups = {};
  wet.forEach((asset, index) => { (groups[find(index)] ||= []).push(asset); });
  const clusters = Object.values(groups).filter((members) => members.length >= 4).map((members, index) => ({
    id: `cluster-${index}`, members, hull: convexHull(members),
    lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length, lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
    value: members.reduce((sum, m) => sum + (m.value || 0), 0), meanScore: members.reduce((sum, m) => sum + m.score, 0) / members.length,
  })).sort((a, b) => b.value - a.value);
  return { wet, edges, clusters };
}

// Illustrative rain gets heavier with the selected severity tier. On a live map,
// extra drops gather around wet assets; the fallback map still receives rain.
function useRainLayer({ canvasRef, mapRef, ready, enabled, wet, intensity }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const maps = ready ? window.google?.maps : null;
    const map = ready ? mapRef.current : null;
    const probe = maps && map ? new maps.OverlayView() : null;
    if (probe) { probe.onAdd = () => {}; probe.draw = () => {}; probe.onRemove = () => {}; probe.setMap(map); }
    let cells = [], cellWeight = 0, drops = [], splashes = [], frame = 0, width = 0, height = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = width * ratio; canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const project = () => {
      const projection = probe?.getProjection();
      if (!projection) return;
      cells = wet.map((asset) => {
        const point = projection.fromLatLngToContainerPixel(new maps.LatLng(asset.lat, asset.lng));
        return point && { x: point.x, y: point.y, r: 26 + asset.score * 46, weight: .25 + asset.score };
      }).filter((cell) => cell && cell.x > -60 && cell.y > -60 && cell.x < width + 60 && cell.y < height + 60);
      cellWeight = 0;
      cells.forEach((cell) => { cellWeight += cell.weight; cell.cumulativeWeight = cellWeight; });
    };
    const spawn = (local) => {
      let x, y;
      if (local && cells.length) {
        const pick = Math.random() * cellWeight;
        let low = 0, high = cells.length - 1;
        while (low < high) { const mid = (low + high) >> 1; if (cells[mid].cumulativeWeight < pick) low = mid + 1; else high = mid; }
        const cell = cells[low];
        const angle = Math.random() * Math.PI * 2, distance = Math.sqrt(Math.random()) * cell.r;
        x = cell.x + Math.cos(angle) * distance; y = cell.y + Math.sin(angle) * distance - 55 - Math.random() * 35;
        return { x, y, end: y + 55 + Math.random() * 35, speed: 8 + intensity * 8 + Math.random() * 3, length: 10 + intensity * 17 + Math.random() * 5, local: true };
      }
      x = Math.random() * width; y = Math.random() * height - height * .2;
      return { x, y, end: height + 20, speed: 7 + intensity * 8 + Math.random() * 2, length: 9 + intensity * 16 + Math.random() * 5, local: false };
    };
    const tick = () => {
      context.clearRect(0, 0, width, height);
      const { local: localTarget, background: backgroundTarget } = rainTargets({ width, height, visibleWetCount: cells.length, intensity });
      const localCount = drops.filter((drop) => drop.local).length;
      const backgroundCount = drops.length - localCount;
      for (let i = localCount; i < localTarget; i += 1) drops.push(spawn(true));
      for (let i = backgroundCount; i < backgroundTarget; i += 1) drops.push(spawn(false));
      context.lineCap = 'round';
      drops = drops.filter((drop) => {
        drop.y += drop.speed; drop.x -= drop.speed * .2;
        if (drop.y >= drop.end) { if (drop.local && splashes.length < 250) splashes.push({ x: drop.x, y: drop.end, r: 1, life: 1 }); return false; }
        context.strokeStyle = drop.local ? `rgba(10, 76, 153, ${.45 + intensity * .45})` : `rgba(25, 92, 166, ${.18 + intensity * .34})`;
        context.lineWidth = drop.local ? 1.2 + intensity * 1.6 : .9 + intensity * .8;
        context.beginPath(); context.moveTo(drop.x, drop.y); context.lineTo(drop.x + drop.length * .18, drop.y - drop.length); context.stroke();
        return true;
      });
      splashes = splashes.filter((splash) => {
        splash.r += .9; splash.life -= .06;
        if (splash.life <= 0) return false;
        context.strokeStyle = `rgba(22, 100, 192, ${splash.life * .65})`; context.lineWidth = 1.2;
        context.beginPath(); context.ellipse(splash.x, splash.y, splash.r * 1.6, splash.r * .6, 0, 0, Math.PI * 2); context.stroke();
        return true;
      });
      frame = window.requestAnimationFrame(tick);
    };
    resize();
    const listeners = map ? [map.addListener('bounds_changed', project), map.addListener('idle', project)] : [];
    const observer = new ResizeObserver(() => { resize(); project(); });
    observer.observe(canvas);
    const start = window.setTimeout(() => { project(); frame = window.requestAnimationFrame(tick); }, 60);
    return () => { window.clearTimeout(start); window.cancelAnimationFrame(frame); listeners.forEach((listener) => listener.remove()); observer.disconnect(); probe?.setMap(null); context.clearRect(0, 0, width, height); };
  }, [canvasRef, mapRef, ready, enabled, wet, intensity]);
}

function MapWorkspace({ activeTier, setActiveTier, selected, setSelected, properties, hotspots, offer, portfolioSummary, singleOffer = false }) {
  const node = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const pulseRef = useRef(null);
  const [mapStatus, setMapStatus] = useState('loading');
  const [layers, setLayers] = useState({ hotspots: true, assets: true, mesh: true, pulse: true, rain: true });
  const rainRef = useRef(null);
  const [layerMenu, setLayerMenu] = useState(false);
  const [hover, setHover] = useState(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const currentTier = TIERS.find((tier) => tier.id === activeTier);
  const allAssets = useMemo(() => properties.filter((property) => property.latitude != null && property.longitude != null).map((property) => ({ ...property, lat: property.latitude, lng: property.longitude, value: property.insuredValueKes == null ? null : property.insuredValueKes / 1e6, score: Number(property.hazardScores?.[activeTier] ?? 0), loss: property.loss100Kes == null ? null : property.loss100Kes / 1e6, type: property.housingClass, status: property.reviewStatus === 'unconfirmed' ? 'Unconfirmed property' : 'Portfolio property' })), [properties, activeTier]);
  const mesh = useMemo(() => buildFloodMesh(allAssets), [allAssets]);
  useRainLayer({ canvasRef: rainRef, mapRef, ready: mapStatus === 'ready', enabled: layers.rain, wet: mesh.wet, intensity: currentTier.rain });

  useEffect(() => {
    if (!apiKey) { setMapStatus('missing'); return undefined; }
    let cancelled = false;
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !node.current) return;
      mapRef.current = new maps.Map(node.current, { center: { lat: -1.2921, lng: 36.8219 }, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, styles: [{ featureType:'poi', elementType:'labels', stylers:[{visibility:'off'}] },{featureType:'water',elementType:'geometry',stylers:[{color:'#b8e1ea'}]},{featureType:'landscape',stylers:[{saturation:-60},{lightness:10}]}] });
      setMapStatus('ready');
    }).catch(() => setMapStatus('error'));
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => {  // a pasted offer: fly to the offered building
    if (mapStatus === 'ready' && offer && mapRef.current) { mapRef.current.panTo({ lat: offer.lat, lng: offer.lng }); mapRef.current.setZoom(15); }
  }, [mapStatus, offer]);

  useEffect(() => {
    const maps = window.google?.maps;
    if (!mapRef.current || !maps) return undefined;
    overlaysRef.current.forEach((item) => item.setMap(null));
    overlaysRef.current = [];
    const add = (item) => { overlaysRef.current.push(item); return item; };
    const color = currentTier.color;
    const hoverable = (item, kind, data) => {
      item.addListener('mouseover', (event) => {
        const box = node.current?.getBoundingClientRect();
        if (!box || !event.domEvent) return;
        setHover({ kind, data, x: event.domEvent.clientX - box.left, y: event.domEvent.clientY - box.top, width: box.width, height: box.height });
      });
      item.addListener('mouseout', () => setHover(null));
      return item;
    };

    if (layers.mesh) {
      mesh.clusters.forEach((cluster) => {
        const polygon = add(new maps.Polygon({ map: mapRef.current, paths: cluster.hull.map((p) => ({ lat: p.lat, lng: p.lng })), fillColor: color, fillOpacity: .12, strokeColor: color, strokeOpacity: .75, strokeWeight: 1.5, zIndex: 1 }));
        hoverable(polygon, 'cluster', { name: `Flood cluster · ${cluster.members.length} properties`, lat: cluster.lat, lng: cluster.lng, count: cluster.members.length, value: cluster.value, meanScore: cluster.meanScore });
        polygon.addListener('click', () => setSelected({ kind: 'cluster', name: `Flood cluster · ${cluster.members.length} properties`, lat: cluster.lat, lng: cluster.lng, count: cluster.members.length, value: cluster.value, meanScore: cluster.meanScore, status: `Connected wet properties within ${LINK_KM} km in the ${currentTier.label.toLowerCase()} scenario` }));
      });
      const flow = { path: 'M 0,-1 0,1', strokeOpacity: .9, strokeColor: color, scale: 2 };
      const lines = mesh.edges.map(([a, b]) => add(new maps.Polyline({ map: mapRef.current, path: [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], strokeColor: color, strokeOpacity: .25, strokeWeight: 1.4, icons: [{ icon: flow, offset: '0%', repeat: '18px' }], zIndex: 2, clickable: false })));
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && lines.length) {
        let step = 0;
        const timer = window.setInterval(() => { step = (step + 1) % 180; lines.forEach((line) => line.set('icons', [{ icon: flow, offset: `${step / 1.8}%`, repeat: '18px' }])); }, 120);
        overlaysRef.current.push({ setMap: () => window.clearInterval(timer) });
      }
    }

    if (layers.assets) {
      allAssets.forEach((asset) => {
        const wet = asset.score > 0;
        const marker = add(new maps.Marker({ map: mapRef.current, position: { lat: asset.lat, lng: asset.lng }, zIndex: wet ? 10 + Math.round(asset.score * 100) : 3,
          icon: { path: maps.SymbolPath.CIRCLE, scale: wet ? 4 + asset.score * 9 : 2.6, fillColor: wet ? color : '#8a96a2', fillOpacity: wet ? .6 + asset.score * .35 : .45, strokeColor: '#fff', strokeWeight: wet ? 1.5 : .8 } }));
        hoverable(marker, 'asset', asset);
        marker.addListener('click', () => setSelected({ ...asset, kind: 'asset' }));
      });
    }

    if (layers.hotspots) {
      hotspots.forEach((spot) => {
        const marker = add(new maps.Marker({ map: mapRef.current, position: { lat: spot.latitude, lng: spot.longitude }, zIndex: 200, icon: { path: 'M 0,-9 L 8,6 L -8,6 Z', fillColor: '#041d3b', fillOpacity: .9, strokeColor: '#fff', strokeWeight: 1.5, scale: 1 } }));
        hoverable(marker, 'hotspot', spot);
        marker.addListener('click', () => setSelected({ ...spot, kind: 'hotspot', lat: spot.latitude, lng: spot.longitude, status: 'Reference hotspot' }));
      });
    }

    if (offer) {
      hoverable(add(new maps.Marker({ map: mapRef.current, position: { lat: offer.lat, lng: offer.lng }, zIndex: 400,
        icon: { path: 'M 0,-13 L 4,-4 L 13,-4 L 6,2 L 9,12 L 0,6 L -9,12 L -6,2 L -13,-4 L -4,-4 Z', fillColor: '#d11242', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.1 } })), 'offer', offer);
    }

    if (layers.pulse) {
      class PulseLayer extends maps.OverlayView {
        constructor(points) { super(); this.points = points; this.root = document.createElement('div'); this.root.className = 'map-pulse-layer'; }
        onAdd() {
          this.points.forEach((point) => { const dot = document.createElement('span'); dot.className = 'map-pulse'; dot.style.setProperty('--pulse', color); dot.style.setProperty('--size', `${18 + point.score * 26}px`); dot.style.animationDelay = `${(point.score * 1.7) % 1.6}s`; this.root.appendChild(dot); });
          this.getPanes().overlayLayer.appendChild(this.root);
        }
        draw() {
          const projection = this.getProjection();
          if (!projection) return;
          [...this.root.children].forEach((dot, index) => { const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(this.points[index].lat, this.points[index].lng)); dot.style.left = `${pixel.x}px`; dot.style.top = `${pixel.y}px`; });
        }
        onRemove() { this.root.remove(); }
      }
      const top = [...mesh.wet].sort((a, b) => b.score - a.score).slice(0, PULSE_COUNT);
      if (top.length) { const layer = new PulseLayer(top); layer.setMap(mapRef.current); add(layer); }
    }
    return () => { overlaysRef.current.forEach((item) => item.setMap(null)); overlaysRef.current = []; setHover(null); };
  }, [mapStatus, activeTier, layers, allAssets, mesh, hotspots, offer, setSelected, currentTier]);

  const tierStats = { wet: mesh.wet.length, total: allAssets.length, wetValue: mesh.wet.reduce((sum, asset) => sum + (asset.value || 0), 0), clusters: mesh.clusters.length, links: mesh.edges.length };
  return <section className="map-workspace">
    <header className="map-toolbar"><div className="map-search"><Search size={15} /><input placeholder="Search Nairobi location or portfolio property" /><span>⌘ K</span></div><button className={layerMenu ? 'active' : ''} onClick={() => setLayerMenu(!layerMenu)}><Layers3 size={16} /> Layers <ChevronDown size={13} /></button></header>
    <div className="map-canvas" style={{'--tier': currentTier.color, '--rain': layers.rain ? currentTier.rain : 0}}>
      <div ref={node} className="google-map" />
      <div className="rain-sky" aria-hidden="true"/>
      <canvas ref={rainRef} className="rain-canvas" aria-hidden="true"/>
      <MapTooltip hover={hover} tier={currentTier} assets={allAssets}/>
      {mapStatus !== 'ready' && <div className="map-fallback"><div className="map-grid"/>{allAssets.filter((asset) => asset.score > 0).slice(0, 60).map((asset) => <button key={asset.id} className="fallback-dot" style={{left:`${Math.max(2,Math.min(98,(asset.lng-36.6)/.5*100))}%`,top:`${Math.max(4,Math.min(96,(-1.1-asset.lat)/.4*100))}%`,'--pin':currentTier.color,'--s':asset.score}} title={asset.name} onClick={() => setSelected({ ...asset, kind: 'asset' })}/>)}<div className="map-setup"><Map size={22}/><strong>{mapStatus === 'missing' ? 'Add your Google Maps key for the live basemap' : mapStatus === 'error' ? 'Google Maps could not load' : 'Loading Nairobi map…'}</strong>{mapStatus === 'missing' && <span>VITE_GOOGLE_MAPS_API_KEY</span>}</div></div>}
      <div className="model-run">{singleOffer ? <><span><i/> SINGLE OFFER LOCATION</span><small>Portfolio properties are hidden; see offer checks for site risk.</small></> : <><span><i/> {portfolioSummary?.status === 'approved' ? 'APPROVED' : 'DRAFT'}: {PORTFOLIO_ID}</span><small>{portfolioSummary ? `KES ${(portfolioSummary.totalInsuredValueKes / 1e9).toFixed(3)}B TIV · ${portfolioSummary.propertyCount} properties` : 'Loading portfolio…'}</small></>}</div>
      <div className="tier-control"><div><span>HAZARD SUSCEPTIBILITY TIER</span><small>Proxy score · not flood depth</small></div><div className="tier-buttons">{TIERS.map((tier) => <button key={tier.id} className={activeTier === tier.id ? 'active' : ''} style={{'--tier':tier.color}} onClick={() => setActiveTier(tier.id)}><i />{tier.label}<span>{tier.range}</span></button>)}</div></div>
      <div className="map-legend tier-legend">
        <span>{currentTier.label.toUpperCase()} SCENARIO · {currentTier.range}</span>
        {singleOffer ? <div className="legend-row"><i className="dot" style={{background: '#d11242'}}/>Placement offer is marked on the map; portfolio overlay is hidden.</div> : <div className="legend-row"><i className="dot" style={{background: currentTier.color}}/><b>{tierStats.wet}</b> of {tierStats.total} properties wet · KES {(tierStats.wetValue / 1000).toFixed(2)}B</div>}
        {!singleOffer && <><div className="legend-row"><i className="dot dry"/>Dry in this scenario</div>
          <div className="legend-row"><i className="ramp" style={{background:`linear-gradient(90deg, ${currentTier.color}55, ${currentTier.color})`}}/>Size and colour = proxy score 0 → 1</div>
          {layers.mesh && <><div className="legend-row"><i className="line" style={{borderColor: currentTier.color}}/>{tierStats.links} connectors: wet neighbours within {LINK_KM} km</div><div className="legend-row"><i className="hull" style={{borderColor: currentTier.color, background: `${currentTier.color}22`}}/>{tierStats.clusters} flood clusters (4+ connected)</div></>}
          {layers.pulse && <div className="legend-row"><i className="pulse-key" style={{'--pulse': currentTier.color}}/>Pulsing: {Math.min(PULSE_COUNT, tierStats.wet)} highest scores</div>}
          {layers.rain && <div className="legend-row"><i className="rain-key"/>{currentTier.rainLabel} rain animation · illustrative, not a forecast</div>}</>}
      </div>
      {layerMenu && <div className="layer-menu"><strong>MAP LAYERS</strong>{[['assets','Portfolio properties'],['rain','Animated rain (illustrative)'],['mesh','Flood clusters & connectors'],['pulse','Pulse highest scores'],['hotspots','Documented hotspots']].map(([key,label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => setLayers({...layers,[key]:!layers[key]})}/><span>{label}</span></label>)}<small>Scenario: {currentTier.label} ({currentTier.range})</small></div>}
      {selected && <div className="asset-inspector"><button className="close" onClick={() => setSelected(null)}><X size={15}/></button><span className="inspector-type">{selected.kind === 'hotspot' ? 'REFERENCE HOTSPOT' : selected.kind === 'cluster' ? 'FLOOD CLUSTER' : 'PORTFOLIO PROPERTY'}</span><h3>{selected.name}</h3><p><MapPin size={12}/> {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</p><div className="inspector-grid">{selected.kind === 'cluster' ? <><div><span>PROPERTIES</span><strong>{selected.count}</strong></div><div><span>MEAN {currentTier.label.toUpperCase()} SCORE</span><strong style={{color:currentTier.color}}>{selected.meanScore.toFixed(2)}</strong></div><div><span>INSURED VALUE</span><strong>KES {selected.value.toFixed(1)}M</strong></div><div><span>SCENARIO</span><strong>{currentTier.range}</strong></div></> : <><div><span>{currentTier.label.toUpperCase()} SCORE</span><strong style={{color: (selected.hazardScores?.[activeTier] ?? 0) > 0 ? currentTier.color : undefined}}>{selected.hazardScores?.[activeTier] == null ? 'n/a' : Number(selected.hazardScores[activeTier]).toFixed(2)}</strong></div><div><span>SCENARIO</span><strong style={{color:currentTier.color}}>{currentTier.label} · {currentTier.range}</strong></div>{selected.value != null && <><div><span>INSURED VALUE</span><strong>KES {selected.value.toFixed(1)}M</strong></div><div><span>APPROVED 1-IN-100 LOSS</span><strong className="danger">{selected.loss == null ? 'Pending run' : `KES ${selected.loss.toFixed(2)}M`}</strong></div></>}</>}</div><div className="inspector-caveat"><AlertTriangle size={13}/>{selected.status || 'Portfolio source'}</div>{selected.kind !== 'cluster' && <button className="ask-location" onClick={() => setSelected({...selected, ask:true})}><Bot size={15}/> Ask Furika Bot about this location <MessageSquareText size={13}/></button>}</div>}
    </div>
    <footer className="coordinates">{singleOffer ? 'Single offer · portfolio overlay hidden' : <>{currentTier.label} scenario <i/> {tierStats.wet} wet properties <i/> {tierStats.clusters} clusters <i/> {tierStats.links} connectors</>} <span>GOOGLE MAPS · PROXY OVERLAY</span></footer>
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
  const [savedView] = useState(() => readStorage('furika-workspace-view', {}));
  const [savedOfferReview] = useState(() => {
    const chat = restoreChatState(localStorage, INITIAL_CHAT_MESSAGE);
    return chat.offerContext ? [...chat.messages].reverse().find((message) => message.offerChecks) || null : null;
  });
  const [activeScreen, setActiveScreen] = useState('workspace');
  const [tier, setTier] = useState('severe');
  const [selected, setSelected] = useState(null);
  const [chatContext, setChatContext] = useState(null);
  const [assets, setAssets] = useState([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [rightView, setRightView] = useState(savedView.rightView === 'map' ? 'map' : 'workflow');
  const [reportReady, setReportReady] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const [rightOpen, setRightOpen] = useState(Boolean(savedView.rightOpen));
  const [workflowRunSignal, setWorkflowRunSignal] = useState(0);
  const [workflowReloadSignal, setWorkflowReloadSignal] = useState(0);
  const [offerSite, setOfferSite] = useState(savedOfferReview?.asset || null);
  const [offerReview, setOfferReview] = useState(savedOfferReview);
  const [workflowScope, setWorkflowScope] = useState(savedView.workflowScope === 'offer' && savedOfferReview ? 'offer' : 'portfolio');
  useEffect(() => { writeStorage('furika-workspace-view', { rightOpen, rightView, workflowScope }); }, [rightOpen, rightView, workflowScope]);
  const showOfferReview = (response, { restoring = false } = {}) => {
    setOfferReview(response?.offerChecks ? response : null);
    setOfferSite(response?.asset || null);
    setSelected(null);
    if (!restoring || !response?.offerChecks) setWorkflowScope(response?.offerChecks ? 'offer' : 'portfolio');
    if (response?.offerChecks && !restoring) setRightView('workflow');
  };
  const showPendingRun = (_run, { restoring = false } = {}) => { setWorkflowScope('portfolio'); if (!restoring) setRightView('workflow'); setWorkflowReloadSignal((signal) => signal + 1); };
  const [uploads, setUploads] = useState([]);
  const [sourcesLoad, setSourcesLoad] = useState({ status: 'loading', message: '' });
  const [attested, setAttestedState] = useState(() => { const stored = readStorage(ATTESTATION_STORAGE_KEY, ''); return ['synthetic', 'redacted'].includes(stored) ? stored : ''; });
  const [uploadErrors, setUploadErrors] = useState([]);
  const [mapProperties, setMapProperties] = useState([]);
  const [mapHotspots, setMapHotspots] = useState([]);
  const [portfolioSummary, setPortfolioSummary] = useState(null);
  const [latestRun, setLatestRun] = useState(null);
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
      const [properties, hotspots, summary, runs] = await Promise.all([
        apiGet(`/portfolios/${PORTFOLIO_ID}/properties?limit=2000`),
        apiGet('/locations/hotspots'),
        apiGet(`/portfolios/${PORTFOLIO_ID}/summary`),
        apiGet(`/model-runs?portfolioId=${encodeURIComponent(PORTFOLIO_ID)}`).catch(() => ({ items: [] })),
      ]);
      setLatestRun(runs.items?.[0] || null);
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
  const askAboutPortfolio = () => {
    setChatContext(null);
    setActiveScreen('workspace');
    setChatOpen(true);
    setRightOpen(false);
  };
  return <main className={`workspace ${chatOpen ? '' : 'chat-collapsed'} ${navExpanded ? 'nav-expanded' : ''}`}>
    <header className="app-header minimal"><Brand /><div className="header-actions"><button className="profile-button"><span className="header-avatar">AO</span><span>Dr. A. Omondi</span></button><button onClick={onLogout} title="Sign out"><LogOut size={16}/></button></div></header>
    <div className="app-body"><nav className={`tool-rail ${navExpanded?'expanded':''}`}><button className="rail-toggle" onClick={()=>setNavExpanded(!navExpanded)} title={navExpanded?'Collapse navigation':'Expand navigation'}><Menu size={19}/><strong>{navExpanded?'Collapse':'Menu'}</strong></button><div className="rail-items"><button className={activeScreen==='data-sources'?'active':''} onClick={()=>setActiveScreen('data-sources')}><Database size={19}/><strong>Data store</strong></button><button className={`rail-bot ${activeScreen==='workspace'?'active':''}`} onClick={()=>setActiveScreen('workspace')}><FurikaMascot size={26}/><strong>Furika Bot</strong></button><button className={activeScreen==='portfolio'?'active':''} onClick={()=>setActiveScreen('portfolio')}><Building2 size={19}/><strong>Portfolio</strong></button></div></nav>
      {activeScreen==='portfolio' ? <PortfolioScreen onAskProperty={askAboutProperty} onAskPortfolio={askAboutPortfolio} onReviewRun={() => { setActiveScreen('workspace'); setWorkflowScope('portfolio'); setRightView('workflow'); setRightOpen(true); setWorkflowReloadSignal((signal) => signal + 1); }} onUploadFiles={uploadDataSources} dataSources={dataSources} attested={attested} setAttested={setAttested}/> : activeScreen==='data-sources' ? <DataSourcesScreen dataSources={dataSources} onUploadFiles={uploadDataSources} onDeleteSource={deleteDataSource} onReprocessSource={reprocessDataSource} attested={attested} setAttested={setAttested} loadState={sourcesLoad} uploadErrors={uploadErrors} onDismissErrors={() => setUploadErrors([])}/> : <div className={`split-view ${rightOpen?'':'right-collapsed'}`}>
        {chatOpen && <ChatPanel onRunDecided={() => { refreshMap(); setWorkflowReloadSignal((signal) => signal + 1); }} latestRun={latestRun} selectedLocation={chatContext} addedAssets={assets} onAddAsset={(asset) => setAssets([...assets, asset])} onOpenView={(view,autoRun=false,review=null)=>{if(view==='offer-workflow'){if(review?.offerChecks)showOfferReview(review);setWorkflowScope('offer');setRightView('workflow');}else{if(view==='workflow')setWorkflowScope('portfolio');setRightView(view);}setRightOpen(true);if(view==='workflow'&&autoRun)setWorkflowRunSignal((signal)=>signal+1)}} onWorkflowPending={showPendingRun} onOfferReview={showOfferReview} reportReady={reportReady} portfolioSummary={portfolioSummary} dataSources={dataSources} onUploadFiles={uploadDataSources} attested={attested} setAttested={setAttested}/>}
        {rightOpen && <button className="collapse-chat" onClick={() => setChatOpen(!chatOpen)} title={chatOpen ? 'Collapse analyst' : 'Open analyst'}>{chatOpen ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}</button>}
        {rightOpen && <div className="right-pane"><div className="right-view-tabs"><button className={rightView==='map'?'active':''} onClick={()=>setRightView('map')}><Map size={15}/> Map</button><button className={rightView==='workflow'?'active':''} onClick={()=>setRightView('workflow')}><Workflow size={15}/> {workflowScope==='offer' && offerReview ? 'Offer workflow' : 'Workflow'} <span>HITL</span></button><div><i className={workflowScope==='offer' && offerReview ? '' : reportReady?'approved-dot':''}/> {workflowScope==='offer' && offerReview ? 'REVIEW' : reportReady?'APPROVED':'DRAFT'}</div><button className="collapse-right" onClick={()=>{if(!chatOpen)setChatOpen(true);setRightOpen(false)}} title="Cancel and close side panel"><X size={16}/></button></div><div className="right-view-content"><div className={`right-mode ${rightView==='map'?'active':''}`}><MapWorkspace activeTier={tier} setActiveTier={setTier} selected={selected} setSelected={setSelected} properties={workflowScope==='offer' && offerReview && !offerSite?.portfolioComparison ? [] : mapProperties} hotspots={mapHotspots} offer={offerSite} portfolioSummary={portfolioSummary} singleOffer={workflowScope==='offer' && !!offerReview && !offerSite?.portfolioComparison}/></div><div className={`right-mode ${rightView==='workflow'?'active':''}`}>{workflowScope==='offer' && offerReview ? <OfferWorkflowWorkspace review={offerReview} onViewPortfolio={()=>setWorkflowScope('portfolio')}/> : <WorkflowWorkspace onRunChange={refreshMap} autoRunSignal={workflowRunSignal} reloadSignal={workflowReloadSignal} onRunStart={()=>setReportReady(false)} onApproved={()=>{setReportReady(true);refreshMap()}}/>}</div></div></div>}
      </div>}
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

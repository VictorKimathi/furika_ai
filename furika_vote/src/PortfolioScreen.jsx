import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Download,
  ExternalLink,
  Filter,
  Layers3,
  Map as MapIcon,
  MapPin,
  Search,
  Sparkles,
  TableProperties,
  TrendingUp,
  Play,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import './portfolio.css';
import './portfolio-dashboard.css';
import { API_BASE_URL, PORTFOLIO_ID, apiGet, apiRequest, describeError, log } from './api.js';
import { AccumulationMap } from './AccumulationScreen.jsx';
import { assessAgainstNairobiReference, buildFloodOverlay, FLOOD_TIERS } from './accumulationRisk.js';

const HOUSING_LABEL = { informal_iron_sheet:'Informal iron sheet', semi_permanent:'Semi-permanent', permanent_masonry:'Permanent masonry', concrete_rcc:'Concrete / RCC' };
const BAND_LABEL = { low:'Low', moderate:'Moderate', high:'High', severe:'Severe', pending:'Pending' };
const NAIROBI_BOUNDS = { latMin:-1.5, latMax:-1.1, lngMin:36.6, lngMax:37.1 };

const millions = (value) => value == null ? null : value / 1e6;

function toUiProperty(item) {
  return { id:item.id, name:item.name, region:item.region || 'Unassigned', housing:HOUSING_LABEL[item.housingClass] || item.housingClass || 'Unclassified', value:millions(item.insuredValueKes), area:item.floorAreaM2, hazard:item.hazardScore, probability:item.annualFloodProbability == null ? null : item.annualFloodProbability * 100, risk:BAND_LABEL[item.hazardBand] || 'Pending', aal:millions(item.aalKes), loss100:millions(item.loss100Kes), loss250:millions(item.loss250Kes), lat:item.latitude, lng:item.longitude, cluster:item.cluster || 'Unassigned', hotspot:item.nearestHotspotKm ?? null, geocodePrecision:item.geocodePrecision, ai:Boolean(item.aiFlagged), rank:null, sourceTag:item.sourceTag, reviewStatus:item.reviewStatus, hazardSource:item.hazardSource, hazardScores:item.hazardScores, issueCount:item.issueCount || 0 };
}

const MAP_MODES = ['Risk','Property count','Insured value','Loss','Flood probability'];
const RISK_COLOR = { Severe:'#dc284d', High:'#eb701c', Moderate:'#e4a21a', Low:'#169b70', Pending:'#7b8794' };
function mapPointColor(property, mode, properties) {
  if (mode === 'Risk') return RISK_COLOR[property.risk];
  if (mode === 'Property count') {
    const count = properties.filter((item) => item.region === property.region).length;
    return count >= 100 ? '#98404d' : count >= 40 ? '#c76a46' : count >= 15 ? '#d4a13a' : '#438c79';
  }
  const value = mode === 'Insured value' ? property.value : mode === 'Loss' ? property.loss100 : property.probability;
  if (value == null) return RISK_COLOR.Pending;
  const thresholds = mode === 'Insured value' ? [5, 15, 40] : mode === 'Loss' ? [1, 5, 20] : [2, 10, 25];
  return value >= thresholds[2] ? '#d63852' : value >= thresholds[1] ? '#e36d2f' : value >= thresholds[0] ? '#d4a12f' : '#19956e';
}

let portfolioMapsPromise;
function loadPortfolioMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (portfolioMapsPromise) return portfolioMapsPromise;
  portfolioMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-furika-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps), { once:true });
      existing.addEventListener('error', reject, { once:true });
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.furikaMaps = 'true';
    script.onload = () => resolve(window.google.maps);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return portfolioMapsPromise;
}

const money = (value) => value == null || Number.isNaN(value) ? '—' : value >= 1000 ? `KES ${(value/1000).toFixed(2)}B` : `KES ${value.toFixed(value < 10 ? 2 : 1)}M`;
const kes = (value) => money(millions(value));

function createGoogleLocation(lat, lng, label, properties) {
  const nearby = properties.filter((property)=>property.hazardScores).sort((a,b)=>((a.lat-lat)**2+(a.lng-lng)**2)-((b.lat-lat)**2+(b.lng-lng)**2)).slice(0,3);
  const weightTotal = nearby.reduce((total,_,index)=>total+1/(index+1),0);
  const proxyScores = nearby.length ? Object.fromEntries(Object.keys(nearby[0].hazardScores).map((tier)=>[tier, nearby.reduce((total,property,index)=>total+property.hazardScores[tier]/(index+1),0)/weightTotal])) : null;
  return { id:'GOOGLE LOCATION', name:label, region:'Nairobi', housing:'Unclassified location', value:null, area:null, hazard:null, probability:null, risk:'Pending', aal:null, loss100:null, loss250:null, lat, lng, latitude:lat, longitude:lng, cluster:'Not assigned', hotspot:null, ai:false, rank:null, isMapSearch:true, referenceId:nearby[0]?.id, proxyScores, hazardScores:proxyScores };
}

function PortfolioMap({ properties, selected, onSelect, mode, setMode, clusterBy, setClusterBy }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef([]);
  const [status, setStatus] = useState('loading');
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) { setStatus('missing'); return undefined; }
    let cancelled = false;
    loadPortfolioMaps(apiKey).then((maps) => {
      if (cancelled || !mapNode.current) return;
      mapRef.current = new maps.Map(mapNode.current, { center:{lat:-1.2921,lng:36.8219}, zoom:11, mapTypeControl:false, streetViewControl:false, fullscreenControl:false, styles:[{featureType:'poi',elementType:'labels',stylers:[{visibility:'off'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#b8e1ea'}]}] });
      setStatus('ready');
    }).catch(() => setStatus('error'));
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    markers.current.forEach((marker) => marker.setMap(null));
    const locatedProperties = properties.filter((property) => Number.isFinite(property.lat) && Number.isFinite(property.lng));
    const mapPoints = selected && Number.isFinite(selected.lat) && Number.isFinite(selected.lng) && !locatedProperties.some((property)=>property.id===selected.id) ? [...locatedProperties,selected] : locatedProperties;
    markers.current = mapPoints.map((property) => {
      const color = mapPointColor(property, mode, locatedProperties);
      const marker = new window.google.maps.Marker({ map:mapRef.current, position:{lat:property.lat,lng:property.lng}, title:`${property.id} · ${property.name}${property.reviewStatus==='unconfirmed'?' · unconfirmed':''}`, icon:{path:window.google.maps.SymbolPath.CIRCLE,scale:selected?.id===property.id?10:7,fillColor:color,fillOpacity:property.reviewStatus==='unconfirmed'?.15:.92,strokeColor:property.reviewStatus==='unconfirmed'?color:'#fff',strokeWeight:2} });
      marker.addListener('click', () => onSelect(property));
      return marker;
    });
  }, [properties, selected, onSelect, status, mode]);

  useEffect(() => {
    if (!mapRef.current || !selected || !Number.isFinite(selected.lat) || !Number.isFinite(selected.lng)) return;
    mapRef.current.panTo({ lat:selected.lat, lng:selected.lng });
    mapRef.current.setZoom(17);
  }, [selected]);

  return <div className="portfolio-map">
    <div ref={mapNode} className="portfolio-google-map" />
    {status !== 'ready' && <div className="portfolio-map-fallback"><div className="portfolio-road-grid"/><svg viewBox="0 0 800 460" preserveAspectRatio="none"><path d="M-20 340 C150 240 240 410 410 280 S650 150 830 230"/><path d="M80 -20 C190 130 280 150 340 250 S470 350 560 500"/><path d="M-20 120 C150 190 260 70 430 130 S670 250 830 100"/></svg>{properties.filter((property)=>Number.isFinite(property.lat)&&Number.isFinite(property.lng)).map((property,index)=><button key={property.id} className={`portfolio-fallback-pin ${properties.length>20?'compact':''} ${selected?.id===property.id?'selected':''}`} style={{'--risk':mapPointColor(property,mode,properties),left:`${(property.lng-NAIROBI_BOUNDS.lngMin)/(NAIROBI_BOUNDS.lngMax-NAIROBI_BOUNDS.lngMin)*100}%`,top:`${(NAIROBI_BOUNDS.latMax-property.lat)/(NAIROBI_BOUNDS.latMax-NAIROBI_BOUNDS.latMin)*100}%`}} onClick={()=>onSelect(property)} title={property.id}>{properties.length<=20&&<span>{index+1}</span>}</button>)}<div className="portfolio-map-message"><MapIcon size={18}/><span>{status==='missing'?'Add VITE_GOOGLE_MAPS_API_KEY for the live map':status==='error'?'Live map unavailable — showing portfolio canvas':'Loading portfolio map…'}</span></div></div>}
    <div className="map-mode-card"><span>COLOUR BY</span><div>{MAP_MODES.map((item)=><button key={item} className={mode===item?'active':''} onClick={()=>setMode(item)}>{item}</button>)}</div></div>
    <label className="cluster-select"><Layers3 size={13}/><span>Cluster by</span><select value={clusterBy} onChange={(event)=>setClusterBy(event.target.value)}><option>Neighbourhood</option><option>Grid</option><option>Hazard band</option><option>Housing class</option></select><ChevronDown size={12}/></label>
    <div className="map-key">{mode==='Risk'?<><i className="low"/> Low <i className="moderate"/> Moderate <i className="high"/> High <i className="severe"/> Severe <i className="pending"/> Pending <i className="unconfirmed"/> Unconfirmed</>:<><i className="low"/> Lower <i className="moderate"/> Moderate <i className="high"/> High <i className="severe"/> Higher <span>{mode}</span></>}</div>
  </div>;
}

// Property EP curve from the approved run: loss (KES M) against return period on a log axis.
function EpCurve({ curve }) {
  const [hover, setHover] = useState(null);
  const points = (curve || []).filter((point) => point.rp >= 1).sort((a, b) => a.rp - b.rp);
  if (points.length < 2) return <div className="property-ep empty">EP curve appears with approved results.</div>;
  const W = 300, H = 150, padL = 44, padR = 10, padT = 18, padB = 26;
  const maxRp = Math.max(...points.map((point) => point.rp), 250);
  const maxLoss = Math.max(...points.map((point) => point.loss_kes), 1);
  const x = (rp) => padL + Math.log(rp) / Math.log(maxRp) * (W - padL - padR);
  const y = (loss) => padT + (1 - loss / maxLoss) * (H - padT - padB);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.rp).toFixed(1)} ${y(point.loss_kes).toFixed(1)}`).join(' ');
  const ticks = [1, 10, 25, 100, 250].filter((rp) => rp <= maxRp);
  return <div className="property-ep-wrap"><svg className="property-ep" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Property exceedance probability curve" onMouseLeave={() => setHover(null)}>
    <text x="2" y="10" className="ep-caption">KES M</text>
    {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t * maxLoss)} y2={y(t * maxLoss)} className="ep-grid"/><text x={padL - 5} y={y(t * maxLoss) + 3} className="ep-tick" textAnchor="end">{(t * maxLoss / 1e6).toFixed(t ? 1 : 0)}</text></g>)}
    {ticks.map((rp) => <text key={rp} x={x(rp)} y={H - 10} className="ep-tick" textAnchor="middle">{rp === 1 ? '1y' : `${rp}y`}</text>)}
    <text x={(padL + W - padR) / 2} y={H - 1} className="ep-caption" textAnchor="middle">return period (log scale)</text>
    <path d={`${path} L ${x(points.at(-1).rp)} ${y(0)} L ${x(points[0].rp)} ${y(0)} Z`} className="ep-area"/>
    <path d={path} className="ep-line"/>
    {points.map((point) => <circle key={point.rp} cx={x(point.rp)} cy={y(point.loss_kes)} r={hover?.rp === point.rp ? 5 : 3.5} className="ep-dot" onMouseEnter={() => setHover(point)}/>)}
  </svg>{hover && <div className="ep-tooltip"><strong>1 in {Math.round(hover.rp)} years</strong><span>{(1 / hover.rp * 100).toFixed(hover.rp > 100 ? 1 : 0)}% annual chance</span><span>Loss KES {(hover.loss_kes / 1e6).toFixed(2)}M</span></div>}</div>;
}

function PropertyStreetView({ property }) {
  const node = useRef(null);
  const panorama = useRef(null);
  const [status, setStatus] = useState('loading');
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!Number.isFinite(property.lat) || !Number.isFinite(property.lng)) { setStatus('unavailable'); return undefined; }
    if (!apiKey) { setStatus('missing'); return undefined; }
    let cancelled = false;
    setStatus('loading');
    loadPortfolioMaps(apiKey).then((maps) => {
      if (cancelled || !node.current) return;
      const service = new maps.StreetViewService();
      service.getPanorama({ location:{lat:property.lat,lng:property.lng}, radius:500, preference:maps.StreetViewPreference.NEAREST }, (data, resultStatus) => {
        if (cancelled || !node.current) return;
        if (resultStatus !== maps.StreetViewStatus.OK || !data?.location?.pano) { setStatus('unavailable'); return; }
        panorama.current = new maps.StreetViewPanorama(node.current, { pano:data.location.pano, pov:{heading:20,pitch:0}, zoom:0, addressControl:false, fullscreenControl:false, motionTrackingControl:false, linksControl:true, panControl:false });
        setStatus('ready');
      });
    }).catch(() => setStatus('unavailable'));
    return () => { cancelled = true; panorama.current?.setVisible(false); panorama.current = null; };
  }, [apiKey, property.id, property.lat, property.lng]);

  return <section className="street-view-card"><div ref={node} className="street-view-canvas"/>{status!=='ready'&&<div className="street-view-state"><MapPin size={20}/><strong>{status==='loading'?'Finding the nearest Google Street View…':status==='missing'?'Google Maps key required':'No Google Street View is available within 500 m'}</strong><span>{Number.isFinite(property.lat)&&Number.isFinite(property.lng)?`${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}`:'Coordinates not provided'}</span></div>}<span className="street-view-label"><i/> GOOGLE STREET VIEW · NEAREST AVAILABLE IMAGE</span></section>;
}

function ModelAction({ status, busy, error, onRun, onApprove }) {
  if (!status || status.state === 'approved') return null;
  if (status.state === 'draft') return <div className="model-action draft"><span><strong>Draft results</strong>{status.reason} Approving publishes them to the portfolio, map and reports.</span><button disabled={busy} onClick={onApprove}><ShieldCheck size={15}/> {busy ? 'Approving…' : `Approve run ${status.runId}`}</button>{error && <em>{error}</em>}</div>;
  if (!status.canRun) return <div className="model-action blocked"><span><strong>This property can't be modelled yet</strong>{status.reason}</span></div>;
  return <div className="model-action"><span><strong>{status.state === 'stale' ? 'Results are out of date' : 'No results for this property yet'}</strong>{status.reason}</span><button disabled={busy} onClick={onRun}><Play size={15}/> {busy ? 'Running the flood model…' : 'Run flood model'}</button>{error && <em>{error}</em>}</div>;
}

function PropertyDrawer({ property, full, setFull, onClose, onAsk, onResultsChanged }) {
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [reload, setReload] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const detailId = property.isMapSearch ? property.referenceId : property.id;
  useEffect(() => {
    if (!reload) setDetail(null);
    setDetailError('');
    if (!detailId) return undefined;
    let cancelled = false;
    apiGet(`/properties/${encodeURIComponent(detailId)}?includeDraft=true`).then((body)=>{ if (!cancelled) setDetail(body); }).catch((error)=>{ if (!cancelled) setDetailError(error.message); });
    return () => { cancelled = true; };
  }, [detailId, reload]);
  useEffect(() => { setActionError(''); }, [detailId]);

  const status = property.isMapSearch ? null : detail?.modelStatus;
  const act = async (request) => {
    setActionBusy(true); setActionError('');
    try { await request(); setReload((value) => value + 1); onResultsChanged?.(); }
    catch (error) { log.error('Property panel model action failed', { step: error.step, requestId: error.requestId, message: error.message }); setActionError(describeError(error)); }
    finally { setActionBusy(false); }
  };
  const runModel = () => act(() => apiRequest('/model-runs', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ portfolioId:property.portfolioId || PORTFOLIO_ID }) }));
  const approveRun = () => act(() => apiRequest(`/model-runs/${status.runId}/decision`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ action:'approve', comment:`Approved from property ${property.id}` }) }));

  // Values come from the detail (approved or draft run); the list item is only a fallback while it loads.
  const loss = detail?.loss;
  const fromDetail = !property.isMapSearch && loss?.aalKes != null;
  const view = fromDetail ? { ...property, aal:loss.aalKes/1e6, loss100:loss.loss100Kes/1e6, loss250:loss.loss250Kes/1e6, probability:detail.hazard.annualFloodProbability != null ? detail.hazard.annualFloodProbability*100 : null } : property;
  const isDraft = status?.state === 'draft';

  const dMax = detail?.hazard?.depthAssumption?.dMaxM;
  const tiers = (detail?.hazard?.tiers || []).map((tier)=>property.isMapSearch ? { ...tier, score:property.proxyScores?.[tier.name] ?? null, depthM:property.proxyScores?.[tier.name] != null && dMax ? property.proxyScores[tier.name]*dMax : null } : tier);
  const hasLoss = !property.isMapSearch && view.aal != null && property.value;
  const warnings = property.isMapSearch ? [] : detail?.explainability?.warnings || [];
  const provenance = property.isMapSearch ? [] : detail?.explainability?.provenance || [];
  const context = property.isMapSearch ? null : detail?.portfolioContext;
  const cost = property.value && property.area ? Math.round(property.value*1000000/property.area) : null;
  const pending = property.risk === 'Pending';
  if (!Number.isFinite(property.lat) || !Number.isFinite(property.lng)) return <aside className={`property-drawer ${full?'full':''}`}><header><div><span>PROPERTY DETAIL</span><h2>{property.id}</h2><p>{property.name}, {property.region}</p></div><div className="drawer-head-actions"><button onClick={()=>setFull(!full)}>{full?'Close full page':'Open full page'}</button><button onClick={onClose} title="Close property details"><X size={17}/></button></div></header><div className="property-scroll"><div className="property-badges"><span>{property.sourceTag==='redacted'?'Redacted':property.sourceTag==='synthetic'?'Synthetic':'Uploaded data'}</span><span>Location not provided</span><span>{property.housing}</span></div><section className="detail-section"><div className="detail-title"><div><Building2 size={15}/><span><strong>Exposure</strong><small>Portfolio record</small></span></div></div><div className="context-grid"><div><span>AREA</span><strong>{property.region}</strong></div><div><span>INSURED VALUE</span><strong>{money(property.value)}</strong></div><div><span>FLOOR AREA</span><strong>{property.area!=null?`${property.area.toLocaleString()} m²`:'—'}</strong></div><div><span>RISK</span><strong>{property.risk}</strong></div></div></section><div className="missing-exposure"><MapPin size={15}/><span><strong>This property is not mapped</strong>Add coordinates or a mappable address to include it in the Nairobi map and location-based risk review.</span></div></div><footer><button onClick={()=>onAsk(property)}><Bot size={15}/> Ask Furika</button></footer></aside>;
  return <aside className={`property-drawer ${full?'full':''}`}>
    <header><div><span>PROPERTY DETAIL</span><h2>{property.id}</h2><p><MapPin size={12}/>{property.name}, {property.region}</p></div><div className="drawer-head-actions"><button onClick={()=>setFull(!full)}>{full?'Close full page':'Open full page'}</button><button onClick={onClose} title="Close property details"><X size={17}/></button></div></header>
    <div className="property-scroll">
      <div className="property-badges"><span className="synthetic">{property.isMapSearch?'Google Maps result':property.sourceTag==='redacted'?'Redacted':'Synthetic'}</span><span style={{'--risk':RISK_COLOR[property.risk]}} className="property-risk">{pending?'Risk pending model run':`${property.risk} risk`}</span>{property.reviewStatus==='unconfirmed'&&<span>Unconfirmed</span>}{['neighbourhood','city','region'].includes(property.geocodePrecision)&&<span>Approximate location</span>}<span>{property.housing}</span></div>
      <PropertyStreetView property={property}/>
      <section className="detail-map-card"><div className="detail-mini-map"><div className="mini-roads"/><MapPin size={26}/><span>{property.lat.toFixed(4)}, {property.lng.toFixed(4)}</span></div><div><span>{property.isMapSearch?'NEAREST MODEL REFERENCE':'NEAREST KNOWN HOTSPOT'}</span><strong>{property.isMapSearch?property.referenceId || 'None loaded':property.hotspot!=null?`${property.hotspot.toFixed(1)} km away`:'Not loaded'}</strong><small>{property.isMapSearch?'Hazard is a nearby-location proxy, not a matched policy record.':property.hotspot!=null?(detail?.hazard?.nearestHotspot?.name ? `${detail.hazard.nearestHotspot.name}${detail.hazard.nearbyHotspots?.length>1?` · ${detail.hazard.nearbyHotspots.length} hotspots within 3 km`:''}` : 'Distance to the nearest named flood hotspot'):'Hotspot reference data is not loaded yet.'}</small><a href={`https://www.google.com/maps/search/?api=1&query=${property.lat},${property.lng}`} target="_blank" rel="noreferrer"><ExternalLink size={11}/> Open exact location in Google Maps</a></div></section>
      <section className="detail-section"><div className="detail-title"><div><Building2 size={15}/><span><strong>Exposure</strong><small>{property.isMapSearch?'Insurance information not supplied':'Source portfolio fields'}</small></span></div><em>{property.isMapSearch?'REQUIRED':property.sourceTag==='redacted'?'REDACTED':'SYNTHETIC'}</em></div>{property.isMapSearch?<div className="missing-exposure"><AlertTriangle size={15}/><span><strong>No portfolio record at this location</strong>Add floor area, construction class and insured value before financial loss can be calculated.</span></div>:<div className="detail-kpis"><div><span>FLOOR AREA</span><strong>{property.area!=null?`${property.area.toLocaleString()} m²`:'—'}</strong></div><div><span>COST / M²</span><strong>{cost!=null?`KES ${cost.toLocaleString()}`:'—'}</strong></div><div className="primary"><span>INSURED VALUE</span><strong>{money(property.value)}</strong></div></div>}</section>
      <section className="detail-section"><div className="detail-title"><div><TrendingUp size={15}/><span><strong>Hazard</strong><small>{property.isMapSearch?'Nearby model interpolation':property.hazardSource==='interpolated'?`Interpolated from ${detail?.hazard?.lookup?.points?.length ?? 'nearby'} scored reference points`:'Proxy scores per scenario tier'}</small></span></div><em>{property.isMapSearch?'PROXY ONLY':property.hazardSource==='interpolated'?'INTERPOLATED':'PROXY'}</em></div><div className="probability-callout"><span>{property.isMapSearch?'NEARBY PROXY FLOOD PROBABILITY':'ANNUAL FLOOD PROBABILITY'}</span><strong>{view.probability!=null?`About ${view.probability<1?view.probability.toFixed(1):Math.round(view.probability)}% chance each year`:fromDetail?'Not reached by any scenario':'Pending model run'}{isDraft&&<i className="draft-chip">DRAFT</i>}</strong><small>{view.probability!=null||fromDetail?'Smallest scenario tier reaching this property · not a full stochastic result':'Flood probability is calculated by the flood model for this property.'}</small></div><ModelAction status={status} busy={actionBusy} error={actionError} onRun={runModel} onApprove={approveRun}/>{tiers.length?<div className="hazard-table"><div><span>SCENARIO · ASSUMED RP</span><span>SCORE</span><span>DEPTH</span></div>{tiers.map((tier)=><div key={tier.name}><strong>{tier.name} · 1-in-{tier.returnPeriodYears}</strong><span>{tier.score!=null?tier.score.toFixed(2):'—'}</span><span>{tier.depthM!=null?`${tier.depthM.toFixed(2)} m`:'—'}</span></div>)}</div>:<div className="loss-unavailable"><TrendingUp size={19}/><strong>{detailError?'Hazard detail unavailable':detail?'No hazard scores supplied':'Loading hazard scores…'}</strong><span>{detailError || (detail?'This property is excluded from model runs until hazard scores are looked up.':'')}</span></div>}</section>
      <section className="detail-section"><div className="detail-title"><div><BarChart3 size={15}/><span><strong>Loss and probability</strong><small>Damage ratio × insured value</small></span></div><em className={isDraft?'draft':undefined}>{property.isMapSearch?'AWAITING EXPOSURE':hasLoss?(isDraft?'DRAFT · AWAITING APPROVAL':'MODELLED'):'PENDING'}</em></div>{hasLoss?<div className="loss-layout"><EpCurve curve={detail?.loss?.epCurve}/><div className="loss-kpis"><div><span>AVERAGE ANNUAL LOSS</span><strong>{money(view.aal)}</strong><small>{(view.aal/property.value*1000).toFixed(1)}‰ of TIV</small></div><div><span>LOSS AT 1-IN-100</span><strong>{money(view.loss100)}</strong><small>{(view.loss100/property.value*100).toFixed(1)}% damage ratio</small></div><div><span>LOSS AT 1-IN-250</span><strong>{money(view.loss250)}</strong><small>{(view.loss250/property.value*100).toFixed(1)}% damage ratio</small></div><div><span>SHARE OF PORTFOLIO</span><strong>{detail?.loss?.portfolioLoss100Share!=null?`${(detail.loss.portfolioLoss100Share*100).toFixed(2)}%`:'–'}</strong><small>of portfolio 1-in-100 loss</small></div></div></div>:<div className="loss-unavailable"><BarChart3 size={19}/><strong>Financial loss is not available</strong><span>{property.isMapSearch?'The exact Google location has no insured value or vulnerability class. Its nearby hazard proxy is shown above, but loss will not be invented.':status?.canRun?'Run the flood model above to calculate this property\'s losses.':(status?.reason||'Losses appear once this property is modelled.')}</span></div>}</section>
      <section className="detail-section explanation"><div className="detail-title"><div><CircleHelp size={15}/><span><strong>Why this rating?</strong><small>Plain-language explanation</small></span></div></div>{property.isMapSearch?<p>This is the exact location returned by Google Maps. The hazard scores above are a <strong>proxy from the three nearest portfolio records</strong>. They are not a property-level underwriting result.</p>:<p>{detail?.explainability?.summary || (detailError?`Could not load the explanation: ${detailError}`:'Loading…')}</p>}{provenance.length>0&&<div className="provenance">{provenance.map((item)=><span key={item.method}>{item.method.replace('_',' ')} · {item.fields} fields</span>)}</div>}{property.reviewStatus==='unconfirmed'&&<div className="property-warning"><AlertTriangle size={14}/><span><strong>Unconfirmed</strong>Some fields were AI-mapped with low confidence. This property is excluded from model runs until someone confirms it.</span></div>}{warnings.map((warning)=><div key={warning.code} className="property-warning"><AlertTriangle size={14}/><span><strong>{warning.code.replaceAll('_',' ')}</strong>{warning.message}</span></div>)}</section>
      <section className="detail-section"><div className="detail-title"><div><TableProperties size={15}/><span><strong>Portfolio context</strong><small>Accumulation and ranking</small></span></div></div>{property.isMapSearch?<div className="missing-exposure"><CircleHelp size={15}/><span><strong>Location is outside the loaded portfolio records</strong>Add it as a synthetic exposure to calculate portfolio rank, cluster accumulation and local TIV.</span></div>:<div className="context-grid"><div><span>AAL RANK</span><strong>{context?.aalRank || 'Pending'}</strong></div><div><span>CLUSTER</span><strong>{property.cluster}</strong></div><div><span>WITHIN 500 M</span><strong>{context?`${context.propertiesWithin500m} properties`:'…'}</strong></div><div><span>LOCAL TIV</span><strong>{context?kes(context.localInsuredValueKes):'…'}</strong></div></div>}</section>
    </div>
    <footer><button onClick={()=>onAsk(property)}><Bot size={15}/> Ask Furika</button><button><Sparkles size={15}/> Add to comparison</button><button><Download size={15}/> Export</button></footer>
  </aside>;
}

function ClusterAnalytics({ clusters, status }) {
  const top = clusters.slice(0,4);
  const mix = (cluster) => { const a=(cluster.classMix.informal||0)*100; const b=a+(cluster.classMix.semiPermanent||0)*100; const c=b+(cluster.classMix.masonry||0)*100; return `conic-gradient(#2a78d6 0 ${a}%,#eb6834 ${a}% ${b}%,#1baf7a ${b}% ${c}%,#eda100 ${c}% 100%)`; };
  const maxLoss = Math.max(...top.map((cluster)=>cluster.loss100Kes||0),1);
  return <section className="cluster-analytics"><div className="section-heading"><div><span>PORTFOLIO ACCUMULATION</span><h2>Clusters and concentration</h2></div></div>{top.length?<><div className="analytics-grid"><div className="treemap-card"><header><strong>Value concentration</strong><span>Size = insured value · colour = risk (grey = pending)</span></header><div className="treemap">{top.map((cluster,index)=><div key={cluster.id} className={`tree-${index} ${cluster.riskBand}`}><strong>{cluster.name}</strong><span>{kes(cluster.insuredValueKes)}</span><small>{cluster.propertyCount} properties</small></div>)}</div></div><div className="bubble-card area-loss-card"><header><strong>Loss concentration</strong><span>1-in-100 year scenario</span></header><div className="area-loss-list">{top.map((cluster,index)=><div className="area-loss-row" key={cluster.id}><span className="area-loss-rank">{String(index+1).padStart(2,'0')}</span><span className="area-loss-info"><strong>{cluster.name}</strong><i><b className={cluster.riskBand||'pending'} style={{width:`${cluster.loss100Kes==null?0:Math.max(4,cluster.loss100Kes/maxLoss*100)}%`}}/></i><small>{cluster.propertyCount} properties · {cluster.portfolioLossShare!=null?`${(cluster.portfolioLossShare*100).toFixed(1)}% of portfolio loss`:'Loss pending'}</small></span><strong className="area-loss-value">{cluster.loss100Kes!=null?kes(cluster.loss100Kes):'Pending'}</strong></div>)}</div></div></div><div className="cluster-cards">{top.map((cluster)=><article key={cluster.id}><header><div><span className={`cluster-dot ${cluster.riskBand}`}/><strong>{cluster.name}</strong></div><em>{cluster.accumulationFlag?.replaceAll('_',' ') || (cluster.riskBand==='pending'?'Risk pending':'')}</em></header><div className="cluster-metrics"><div><span>PROPERTIES</span><strong>{cluster.propertyCount}</strong></div><div><span>INSURED VALUE</span><strong>{kes(cluster.insuredValueKes)}</strong></div><div><span>1-IN-100 LOSS</span><strong>{kes(cluster.loss100Kes)}</strong></div><div><span>AAL / TIV</span><strong>{cluster.aalPercentTiv!=null?`${cluster.aalPercentTiv}%`:'—'}</strong></div></div><div className="cluster-foot"><div className="class-mix" style={{background:mix(cluster)}}/><span>{cluster.tivShare!=null?`${(cluster.tivShare*100).toFixed(1)}% of portfolio TIV`:'—'}</span><small>{cluster.annualFloodProbability!=null?`Avg flood probability ${(cluster.annualFloodProbability*100).toFixed(1)}%`:'Flood probability pending'}</small></div></article>)}</div></>:<div className="loss-unavailable"><Layers3 size={19}/><strong>{status==='error'?'Clusters unavailable':status==='ready'?'No clusters yet':'Loading clusters…'}</strong><span>{status==='ready'?'Upload or seed properties to see accumulation.':''}</span></div>}</section>;
}

export default function PortfolioScreen({ onAskProperty, onAskPortfolio, onReviewRun, onUploadFiles, dataSources = [], attested, setAttested }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [returnPeriod, setReturnPeriod] = useState('250');
  const [sortBy, setSortBy] = useState('loss');
  const [showAllRows, setShowAllRows] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ highRisk:false, masonry:false, hotspot:false, ai:false, attention:false });
  const [fullDetail, setFullDetail] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [properties, setProperties] = useState([]);
  const [summary, setSummary] = useState(null);
  const [areaClusters, setAreaClusters] = useState([]);
  const [load, setLoad] = useState({ status:'loading', message:'' });
  const [areaClusterStatus, setAreaClusterStatus] = useState('loading');
  const [reference, setReference] = useState({ points:[], hotspots:[] });
  const [referenceStatus, setReferenceStatus] = useState('loading');
  const [selectedMapRegion, setSelectedMapRegion] = useState(null);
  const [uploadId, setUploadId] = useState('all');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const [latestRun, setLatestRun] = useState(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runFeedback, setRunFeedback] = useState(null);
  const uploadInput = useRef(null);
  const uploadPanel = useRef(null);
  const uploadFilter = uploadId === 'all' ? '' : `&uploadId=${encodeURIComponent(uploadId)}`;
  const sourceState = dataSources.map((source) => `${source.id}:${source.status}`).join('|');
  const sourceProcessing = dataSources.some((source) => source.processing && ['csv', 'excel'].includes(source.upload?.extractor));
  const latestRunStale = Boolean(latestRun?.createdAt && summary?.asOf && Date.parse(summary.asOf) > Date.parse(latestRun.createdAt));
  const uploadSources = useMemo(() => {
    const referenceUploads = new Set(reference.referenceUploadIds || []);
    return dataSources.filter((source) => ['csv','excel'].includes(source.upload?.extractor) && !referenceUploads.has(source.id));
  }, [dataSources, reference.referenceUploadIds]);

  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet(`/portfolios/${PORTFOLIO_ID}/properties?limit=2000&sort=tiv:desc&excludeReference=true${uploadFilter}`), apiGet(`/portfolios/${PORTFOLIO_ID}/summary`)])
      .then(([list, summaryBody]) => { if (cancelled) return; setProperties(list.items.map(toUiProperty)); setSummary(summaryBody); setLoad({ status:'ready', message:'' }); })
      .catch((error) => { if (!cancelled) setLoad({ status:'error', message:error.message }); });
    return () => { cancelled = true; };
  }, [dataVersion, uploadId, sourceState]);

  useEffect(() => {
    let cancelled = false;
    apiGet(`/model-runs?portfolioId=${encodeURIComponent(PORTFOLIO_ID)}`)
      .then((body) => { if (!cancelled) setLatestRun(body.items?.[0] || null); })
      .catch(() => { if (!cancelled) setLatestRun(null); });
    return () => { cancelled = true; };
  }, [dataVersion]);

  useEffect(() => {
    let cancelled = false;
    setAreaClusterStatus('loading');
    apiGet(`/portfolios/${PORTFOLIO_ID}/clusters?type=neighbourhood&excludeReference=true${uploadFilter}`)
      .then((body) => { if (!cancelled) { setAreaClusters(body.items); setAreaClusterStatus('ready'); } })
      .catch(() => { if (!cancelled) { setAreaClusters([]); setAreaClusterStatus('error'); } });
    return () => { cancelled = true; };
  }, [dataVersion, uploadId, sourceState]);

  useEffect(() => {
    let cancelled = false;
    setReferenceStatus('loading');
    apiGet('/locations/flood-reference')
      .then((body) => { if (!cancelled) { setReference(body); setReferenceStatus('ready'); } })
      .catch(() => { if (!cancelled) { setReference({ points:[], hotspots:[] }); setReferenceStatus('error'); } });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => properties.filter((property) => {
    const text = `${property.id} ${property.name} ${property.region} ${property.lat} ${property.lng}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filters.highRisk && !['High','Severe'].includes(property.risk)) return false;
    if (filters.masonry && !property.housing.toLowerCase().includes('masonry')) return false;
    if (filters.hotspot && (property.hotspot == null || property.hotspot > 1)) return false;
    if (filters.ai && !property.ai) return false;
    if (filters.attention && !(property.reviewStatus === 'unconfirmed' || property.hazard == null || property.issueCount > 0)) return false;
    return true;
  }), [properties, query, filters]);

  const displayRows = useMemo(() => [...filtered].sort((a, b) => {
    const metric = sortBy === 'value' ? 'value' : sortBy === 'probability' ? 'probability' : returnPeriod === '100' ? 'loss100' : 'loss250';
    const left = a[metric];
    const right = b[metric];
    if (left == null && right == null) return String(a.id).localeCompare(String(b.id));
    if (left == null) return 1;
    if (right == null) return -1;
    return right - left;
  }), [filtered, sortBy, returnPeriod]);
  const visibleRows = showAllRows ? displayRows : displayRows.slice(0, 10);
  const attentionCount = properties.filter((property) => property.reviewStatus === 'unconfirmed' || property.hazard == null || property.issueCount > 0).length;
  const scenarioLossKes = summary?.status === 'approved' ? uploadId === 'all' && returnPeriod === '100' ? summary.loss100Kes : properties.reduce((total, property) => total + (property[returnPeriod === '100' ? 'loss100' : 'loss250'] ?? 0) * 1e6, 0) : null;
  const scenarioModelledCount = properties.filter((property) => property[returnPeriod === '100' ? 'loss100' : 'loss250'] != null).length;
  const scenarioExpectedCount = uploadId === 'all' ? summary?.confirmedCount ?? 0 : properties.filter((property) => property.reviewStatus === 'confirmed').length;
  const scenarioInsuredValueKes = uploadId === 'all' ? summary?.totalInsuredValueKes : properties.reduce((total, property) => total + (property.value ?? 0) * 1e6, 0);
  const scenarioIsComplete = summary?.status === 'approved' && scenarioLossKes != null && scenarioExpectedCount > 0 && scenarioModelledCount >= scenarioExpectedCount;
  const referenceTier = FLOOD_TIERS.find((item) => item.years === Number(returnPeriod)) || FLOOD_TIERS[0];
  const assessedMapProperties = useMemo(() => properties.map((property) => ({
    ...property,
    latitude:property.lat,
    longitude:property.lng,
    insuredValueKes:property.value == null ? null : property.value * 1e6,
    riskComparison:assessAgainstNairobiReference({ latitude:property.lat, longitude:property.lng, hazardScores:property.hazardScores }, reference.points, reference.hotspots, referenceTier.id),
  })), [properties, reference.points, reference.hotspots, referenceTier.id]);
  const referenceOverlay = useMemo(() => buildFloodOverlay(reference.points, referenceTier.id, null, 'neighbourhood'), [reference.points, referenceTier.id]);
  const regionScores = useMemo(() => {
    const groups = new Map();
    assessedMapProperties.forEach((property) => {
      const score = property.riskComparison?.referenceScore;
      if (score == null) return;
      const name = property.region || 'Unassigned';
      const group = groups.get(name) || { sum:0, count:0 };
      group.sum += score;
      group.count += 1;
      groups.set(name, group);
    });
    return Object.fromEntries([...groups].map(([name, group]) => [name, group.sum / group.count]));
  }, [assessedMapProperties]);
  const referenceScoresById = useMemo(() => new Map(assessedMapProperties.map((property) => [property.id, property.riskComparison])), [assessedMapProperties]);
  const mapProperties = useMemo(() => {
    const visible = assessedMapProperties.filter((property) => filtered.some((item) => item.id === property.id));
    if (!selected?.isMapSearch || !Number.isFinite(selected.lat) || !Number.isFinite(selected.lng)) return visible;
    return [...visible, { ...selected, latitude:selected.lat, longitude:selected.lng, riskComparison:assessAgainstNairobiReference({ latitude:selected.lat, longitude:selected.lng, hazardScores:selected.proxyScores }, reference.points, reference.hotspots, referenceTier.id) }];
  }, [assessedMapProperties, filtered, selected, reference.points, reference.hotspots, referenceTier.id]);

  const toggleFilter = (key) => setFilters((current)=>({...current,[key]:!current[key]}));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const selectProperty = (property, message = '') => {
    setSelected(property);
    setFullDetail(false);
    setSearchStatus(message || (Number.isFinite(property.lat) && Number.isFinite(property.lng) ? `${property.id} located at ${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}. Map focused and risk record opened.` : `${property.id} opened. No coordinates are available to focus the map.`));
  };

  const locateProperty = async () => {
    const term = query.trim();
    if (!term) { setSearchStatus('Enter a property ID, neighbourhood, address, or latitude and longitude.'); return; }
    const coordinateMatch = term.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
    const normalizedTerm = term.toLowerCase();
    let match = properties.find((property)=>property.id.toLowerCase()===normalizedTerm || property.name.toLowerCase()===normalizedTerm);
    if (coordinateMatch) {
      setSelectedMapRegion(null);
      const lat = Number(coordinateMatch[1]);
      const lng = Number(coordinateMatch[2]);
      const location = createGoogleLocation(lat,lng,`Searched coordinates`,properties);
      selectProperty(location, location.referenceId ? `Exact coordinates located. Nearby hazard is shown only as a proxy; this location is not ${location.referenceId}.` : 'Exact coordinates located. No portfolio records with hazard scores are loaded to use as a proxy.');
      return;
    }
    if (match) { setSelectedMapRegion(null); selectProperty(match); return; }
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) { setSearchStatus('No portfolio match. Add VITE_GOOGLE_MAPS_API_KEY to search addresses with Google Maps.'); return; }
    setSearchStatus('Searching Google Maps…');
    try {
      const maps = await loadPortfolioMaps(apiKey);
      const geocoder = new maps.Geocoder();
      geocoder.geocode({ address:`${term}, Nairobi, Kenya`, region:'KE' }, (results, status) => {
        if (status !== 'OK' || !results?.[0]) { setSearchStatus('Google Maps could not find that location. Try an ID, neighbourhood, or coordinates.'); return; }
        const location = results[0].geometry.location;
        const lat = location.lat();
        const lng = location.lng();
        const locationResult = createGoogleLocation(lat,lng,results[0].formatted_address,properties);
        setSelectedMapRegion(null);
        selectProperty(locationResult, `Google found “${results[0].formatted_address}”. The pin is exact; nearby hazard scores are shown separately as a proxy.`);
      });
    } catch { setSearchStatus('Google Maps search is currently unavailable.'); }
  };

  const exportProperties = () => {
    const columns = ['Property ID', 'Property', 'Area', 'Insured value (KES)', 'Annual flood chance (%)', 'Risk band', 'Nairobi reference score (/100)', 'Property hazard score (/100)', `Loss at 1-in-${returnPeriod} (KES)`];
    const rows = displayRows.map((property) => { const comparison=referenceScoresById.get(property.id); return [property.id, property.name, property.region, property.value == null ? '' : Math.round(property.value * 1e6), property.probability ?? '', property.risk, comparison?.referenceScore == null ? '' : Math.round(comparison.referenceScore * 100), comparison?.sourceScore == null ? '' : Math.round(comparison.sourceScore * 100), property[returnPeriod === '100' ? 'loss100' : 'loss250'] == null ? '' : Math.round(property[returnPeriod === '100' ? 'loss100' : 'loss250'] * 1e6)]; });
    const csv = [columns, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `furika-portfolio-${returnPeriod}-year.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const focusCluster = (cluster) => {
    setQuery(cluster.name);
    setSelectedMapRegion(cluster.name);
    setFilters((current) => ({ ...current, attention:false }));
    const match = properties.find((property) => property.region === cluster.name || property.cluster === cluster.name);
    if (match) selectProperty(match, `${cluster.name} selected. Matching portfolio properties are shown below.`);
  };
  const requestPortfolioUpload = () => {
    uploadPanel.current?.scrollIntoView({ behavior:'smooth', block:'center' });
    if (!attested) {
      setUploadFeedback({ error:true, text:'First confirm whether the file contains synthetic or redacted data.' });
      return;
    }
    uploadInput.current?.click();
  };
  const runPortfolioModel = async () => {
    if (runBusy || sourceProcessing || !summary?.confirmedCount) return;
    setRunBusy(true);
    setRunFeedback(null);
    try {
      const run = await apiRequest('/model-runs', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ portfolioId:PORTFOLIO_ID }) });
      setLatestRun(run);
      setRunFeedback({ error:false, text:`Model run ${run.id} finished for ${run.configuration?.summary?.propertyCount ?? 'the confirmed'} properties. Review and approve it to publish updated loss insights.` });
    } catch (error) {
      setRunFeedback({ error:true, text:describeError(error) });
    } finally {
      setRunBusy(false);
    }
  };
  const uploadPortfolioDataset = async (event) => {
    const input = event.currentTarget;
    const files = input.files;
    if (!files?.length) return;
    if (!attested) {
      setUploadFeedback({ error:true, text:'Choose Synthetic or Redacted before uploading.' });
      input.value = '';
      return;
    }
    setUploadBusy(true);
    setUploadFeedback(null);
    try {
      const result = await onUploadFiles?.(files);
      const errors = result?.errors || [];
      if (result?.added?.length) {
        setUploadId(result.added[0].id);
        setDataVersion((value) => value + 1);
        setSelectedMapRegion(null);
        setQuery('');
      }
      setUploadFeedback({ error:errors.length > 0 || !result?.added?.length, text:errors.length ? errors.map((item) => `${item.name}: ${item.message}`).join(' ') : result?.added?.length ? `${result.added.length} dataset uploaded. Portfolio properties are refreshing against the existing Nairobi susceptibility layer.` : 'No dataset was uploaded.' });
    } catch (error) {
      setUploadFeedback({ error:true, text:error.message || 'The dataset could not be uploaded.' });
    } finally {
      setUploadBusy(false);
      input.value = '';
    }
  };
  const selectMappedProperty = (mapProperty) => {
    if (mapProperty.isMapSearch) { selectProperty(mapProperty); return; }
    const property = properties.find((item) => item.id === mapProperty.id);
    if (!property) return;
    const score = mapProperty.riskComparison?.referenceScore;
    selectProperty(property, score == null ? `${property.id} selected. No nearby Nairobi reference score is available.` : `${property.id} selected. Nairobi reference susceptibility for the 1-in-${returnPeriod} tier: ${(score * 100).toFixed(0)}/100.`);
  };
  const selectMapRegion = (region) => {
    setSelectedMapRegion(region);
    setQuery(region);
  };
  const selectReferencePoint = (point) => {
    const score = Number(point.hazardScores?.[referenceTier.id]);
    setSearchStatus(`${point.name || point.id} is a Nairobi reference point: ${Number.isFinite(score) ? `susceptibility ${(score * 100).toFixed(0)}/100` : 'no score available'} for the 1-in-${returnPeriod} scenario.`);
  };
  const sourceLabel = summary?.sourceTag === 'mixed' ? 'Mixed portfolio sources' : summary?.sourceTag === 'redacted' ? 'Redacted portfolio data' : summary?.sourceTag === 'synthetic' ? 'Synthetic portfolio data' : summary ? 'Uploaded portfolio data' : 'Portfolio data loading';
  const sourceClass = summary?.sourceTag === 'synthetic' ? 'synthetic' : summary?.sourceTag === 'redacted' ? 'redacted' : 'uploaded';

  return <section className="portfolio-screen">
    <header className="portfolio-header"><div><span>PORTFOLIO INTELLIGENCE</span><h1>Nairobi book of business</h1><p>See where insured value sits and which areas drive flood loss.</p></div><div className="portfolio-header-actions"><span className={`portfolio-source-tag ${sourceClass}`}><i/>{sourceLabel}</span><button onClick={exportProperties}><Download size={15}/> Export</button><button onClick={onAskPortfolio}><Sparkles size={15}/> Ask Furika</button><button className="primary" onClick={requestPortfolioUpload}><Upload size={15}/> Upload properties</button></div></header>
    <div className="portfolio-scenario-bar"><span className="scenario-label">FLOOD SIZE</span><label><select value={returnPeriod} onChange={(event)=>setReturnPeriod(event.target.value)}><option value="250">1-in-250 year</option><option value="100">1-in-100 year</option></select><ChevronDown size={14}/></label><span className="scenario-context">Estimated loss if a flood of this size occurs</span><span className="scenario-status"><i className={scenarioIsComplete?'approved':''}/>{scenarioIsComplete?'Approved model results':'Model results pending'}</span></div>
    <section className="portfolio-model-action" aria-label="Portfolio flood model"><div><strong>{latestRunStale ? 'Portfolio data changed since the last model run' : latestRun?.status === 'review' ? 'Model run ready for review' : summary?.status === 'approved' ? 'Portfolio model results are published' : 'Calculate the portfolio to unlock loss insights'}</strong><p>{sourceProcessing ? 'Wait for the uploaded dataset to finish processing before running the model.' : summary && !summary.confirmedCount ? 'Confirm at least one property with complete model inputs before running the model.' : latestRunStale ? 'Run the model again to include the latest property changes.' : latestRun?.status === 'review' ? `${latestRun.id} is a draft. Approve it to publish the new loss and risk insights.` : 'Run the model on confirmed properties, then review and approve the draft results.'}</p>{runFeedback && <p className={runFeedback.error ? 'model-feedback error' : 'model-feedback'} role={runFeedback.error ? 'alert' : 'status'}>{runFeedback.text}</p>}</div><div className="portfolio-model-buttons"><button type="button" className="run-model-button" onClick={runPortfolioModel} disabled={runBusy || sourceProcessing || !summary?.confirmedCount}><Play size={15}/>{runBusy ? 'Running model…' : latestRun ? 'Run model again' : 'Run flood model'}</button>{latestRun?.status === 'review' && !latestRunStale && <button type="button" className="review-model-button" onClick={onReviewRun} disabled={runBusy}><ShieldCheck size={15}/> Review run</button>}</div></section>
    <div className="portfolio-summary"><div><span>TOTAL INSURED VALUE</span><strong>{summary?kes(summary.totalInsuredValueKes):'—'}</strong><small>{summary?`${summary.propertyCount} properties insured`:'Loading portfolio…'}</small></div><div><span>AVERAGE YEARLY LOSS</span><strong>{summary?.status==='approved'?kes(summary.portfolioAalKes):'Pending'}</strong><small>{summary?.status==='approved'&&summary.aalPercentTiv!=null?`${summary.aalPercentTiv.toFixed(2)}% of insured value`:'Available after model approval'}</small></div><div><span>LOSS IN 1-IN-{returnPeriod} FLOOD</span><strong>{scenarioIsComplete?kes(scenarioLossKes):'Pending'}</strong><small>{scenarioIsComplete&&scenarioInsuredValueKes?`${(scenarioLossKes/scenarioInsuredValueKes*100).toFixed(1)}% of insured value`:'Available after model approval'}</small></div><button className={`attention-kpi ${filters.attention?'active':''}`} onClick={()=>toggleFilter('attention')}><span>NEEDS ATTENTION</span><strong>{summary?attentionCount:'—'}</strong><small>{filters.attention?'Showing records to review':'Click to review records'}</small></button></div>
    <section className="portfolio-upload-card" ref={uploadPanel}><div className="portfolio-upload-copy"><span className="upload-symbol"><Upload size={17}/></span><div><strong>Overlay a new property dataset</strong><p>Upload insured properties here. We’ll map them against the existing Nairobi susceptibility reference and compare scores.</p><a href="/accumulation-template.csv" download>Download the CSV template</a></div></div><div className="portfolio-upload-controls"><div className="portfolio-attestation"><span>DATA TYPE</span><button className={attested==='synthetic'?'active':''} onClick={()=>setAttested?.('synthetic')}>Synthetic</button><button className={attested==='redacted'?'active':''} onClick={()=>setAttested?.('redacted')}>Redacted</button></div><input ref={uploadInput} type="file" multiple accept=".csv,.xlsx" onChange={uploadPortfolioDataset} hidden/><button className="portfolio-upload-button" disabled={uploadBusy} onClick={requestPortfolioUpload}><Upload size={15}/>{uploadBusy?'Uploading…':'Choose dataset'}</button></div>{uploadFeedback&&<div className={`portfolio-upload-feedback ${uploadFeedback.error?'error':''}`}><span>{uploadFeedback.text}</span></div>}</section>
    {searchStatus&&<div className="portfolio-search-status"><CheckCircle2 size={13}/><span>{searchStatus}</span><button onClick={()=>setSearchStatus('')}><X size={12}/></button></div>}
    {filtersOpen&&<div className="portfolio-filters"><span>QUICK FILTERS</span><button className={filters.masonry?'active':''} onClick={()=>toggleFilter('masonry')}>Permanent masonry</button><button className={filters.highRisk?'active':''} onClick={()=>toggleFilter('highRisk')}>High + severe risk</button><button className={filters.hotspot?'active':''} onClick={()=>toggleFilter('hotspot')}>Within 1 km hotspot</button><button className={filters.ai?'active':''} onClick={()=>toggleFilter('ai')}>AI flagged</button><button className={filters.attention?'active':''} onClick={()=>toggleFilter('attention')}>Needs attention</button>{activeFilterCount>0&&<button className="clear" onClick={()=>setFilters({highRisk:false,masonry:false,hotspot:false,ai:false,attention:false})}>Clear all</button>}</div>}
    <div className="portfolio-dashboard-grid">
      <section className="portfolio-map-panel"><header className="panel-heading"><div><span>NAIROBI FLOOD EXPOSURE</span><h2>Properties vs. susceptibility</h2><p>Green pins are insured assets; coloured areas and dots are the Nairobi reference score.</p></div><div className="map-heading-actions"><label className="map-dataset-select"><span>SHOW</span><select value={uploadId} onChange={(event)=>{setUploadId(event.target.value);setSelectedMapRegion(null);setQuery('');}}><option value="all">All underwriter assets</option>{uploadSources.map((source)=><option key={source.id} value={source.id}>{source.name}</option>)}</select><ChevronDown size={12}/></label><span className="map-count"><MapPin size={14}/>{filtered.filter((property)=>Number.isFinite(property.lat)&&Number.isFinite(property.lng)).length.toLocaleString()} mapped</span>{selectedMapRegion&&<button onClick={()=>{setSelectedMapRegion(null);setQuery('');}}>Clear area</button>}</div></header><AccumulationMap regions={areaClusters.map((region)=>({...region,type:'neighbourhood'}))} properties={mapProperties} referencePoints={reference.points||[]} hotspots={reference.hotspots||[]} regionScores={regionScores} tier={referenceTier.id} floodOverlay={referenceOverlay} selectedRegion={selectedMapRegion} onSelectRegion={selectMapRegion} onSelectProperty={selectMappedProperty} onSelectReference={selectReferencePoint}/><div className="portfolio-reference-note">{referenceStatus==='error'?'Nairobi susceptibility reference is unavailable.':referenceStatus==='loading'?'Loading the Nairobi susceptibility reference…':`${reference.points.length.toLocaleString()} fixed Nairobi reference locations shown · Scenario: 1-in-${returnPeriod} years. Scores are 0–1 susceptibility proxies, not measured flood depths or probabilities.`}</div></section>
      <section className="risk-areas-panel"><header className="panel-heading"><div><span>WHERE THE RISK SITS</span><h2>Top areas by loss</h2></div><span className="risk-area-period">1-in-100 scenario</span></header><div className="risk-area-list">{areaClusters.slice(0,6).map((cluster,index)=><button key={cluster.id} className="risk-area-row" onClick={()=>focusCluster(cluster)}><span className="risk-area-rank">{String(index+1).padStart(2,'0')}</span><span className={`risk-area-dot ${cluster.riskBand||'pending'}`}/><span className="risk-area-main"><strong>{cluster.name}</strong><small>{Number(cluster.propertyCount||0).toLocaleString()} properties · {cluster.tivShare!=null?`${(cluster.tivShare*100).toFixed(1)}% of TIV`:'TIV share pending'}</small></span><span className="risk-area-loss"><strong>{cluster.loss100Kes!=null?kes(cluster.loss100Kes):'Pending'}</strong><small>{cluster.portfolioLossShare!=null?`${(cluster.portfolioLossShare*100).toFixed(1)}% of loss`:'Loss pending'}</small></span></button>)}{areaClusterStatus!=='ready'&&<div className="risk-areas-empty"><Layers3 size={17}/><span>{areaClusterStatus==='error'?'Risk areas could not be loaded':'Loading area risk…'}</span></div>}{areaClusterStatus==='ready'&&!areaClusters.length&&<div className="risk-areas-empty"><Layers3 size={17}/><span>Area comparisons appear when portfolio results are available.</span></div>}</div><div className="risk-area-legend"><i className="severe"/> Highest risk <i className="high"/> Elevated <i className="moderate"/> Moderate <i className="low"/> Lower</div></section>
      {selected&&<PropertyDrawer property={selected} full={fullDetail} setFull={setFullDetail} onClose={()=>setSelected(null)} onAsk={onAskProperty} onResultsChanged={()=>setDataVersion((value)=>value+1)}/>}
    </div>
    <section className="portfolio-properties-panel"><header className="properties-heading"><div><span>INSURED PROPERTIES</span><h2>Portfolio details</h2><p>Search and compare properties, with the highest modelled loss shown first.</p></div><div className="properties-actions"><label><Search size={15}/><input value={query} onChange={(event)=>{setQuery(event.target.value);setSelectedMapRegion(null);setSearchStatus('')}} onKeyDown={(event)=>{if(event.key==='Enter')locateProperty()}} placeholder="Search ID, area, or address"/><kbd>ENTER</kbd></label><button className="search-submit" onClick={locateProperty}><MapPin size={14}/> Locate</button><button className={filtersOpen?'active':''} onClick={()=>setFiltersOpen(!filtersOpen)}><Filter size={14}/> Filters{activeFilterCount>0&&<i>{activeFilterCount}</i>}</button><label className="sort-select"><span>Sort:</span><select value={sortBy} onChange={(event)=>setSortBy(event.target.value)}><option value="loss">Highest scenario loss</option><option value="value">Largest insured value</option><option value="probability">Highest flood chance</option></select><ChevronDown size={12}/></label></div></header>
      <div className="properties-table-wrap"><table className="properties-table"><thead><tr><th>PROPERTY</th><th>AREA</th><th>INSURED VALUE</th><th>CHANCE OF FLOODING</th><th>NAIROBI REF. / PROPERTY SCORE</th><th>LOSS IN 1-IN-{returnPeriod} FLOOD</th></tr></thead><tbody>{load.status!=='ready'?<tr><td colSpan="6"><div className="table-empty"><Search size={20}/><strong>{load.status==='error'?'Portfolio could not be loaded':'Loading portfolio…'}</strong><span>{load.status==='error'?`${load.message}. Start the Flask backend and run flask --app run.py seed-reference.`:`${PORTFOLIO_ID} from ${API_BASE_URL}`}</span></div></td></tr>:visibleRows.length?visibleRows.map((property)=>{const comparison=referenceScoresById.get(property.id);return <tr key={property.id} className={selected?.id===property.id?'selected':''} onClick={()=>selectProperty(property)}><td><div className="table-property"><span className="property-table-icon"><Building2 size={15}/></span><span><strong>{property.name||property.id}</strong><small>{property.id} · {property.housing}</small></span><em className={`table-risk ${property.risk.toLowerCase()}`}>{property.risk}</em></div></td><td>{property.region}</td><td className="numeric-cell">{money(property.value)}</td><td>{property.probability!=null?`~${property.probability.toFixed(1)}% / year`:'Pending'}</td><td><div className="susceptibility-pair"><strong>{comparison?.referenceScore!=null?`Ref ${Math.round(comparison.referenceScore*100)}/100`:'Ref unavailable'}</strong><small>{comparison?.sourceScore!=null?`Property ${Math.round(comparison.sourceScore*100)}/100`:'Property score unavailable'}{comparison?.approximate?' · approximate':''}</small></div></td><td className="numeric-cell">{property[returnPeriod==='100'?'loss100':'loss250']!=null?money(property[returnPeriod==='100'?'loss100':'loss250']):'Pending'}</td></tr>}):<tr><td colSpan="6"><div className="table-empty"><Search size={20}/><strong>No matching properties</strong><span>Try another search or clear the active filters.</span></div></td></tr>}</tbody></table></div>
      <footer className="properties-table-footer"><span>Showing {Math.min(visibleRows.length,displayRows.length)} of {displayRows.length.toLocaleString()} matching properties</span>{displayRows.length>10&&<button onClick={()=>setShowAllRows((value)=>!value)}>{showAllRows?'Show top 10':'Show all properties'} <ArrowRight size={13}/></button>}</footer>
    </section>
    <details className="portfolio-more-analytics"><summary><BarChart3 size={15}/> Explore concentration charts <ChevronDown size={14}/></summary><ClusterAnalytics clusters={areaClusters} status={areaClusterStatus}/></details>
    <details className="portfolio-how-to"><summary><CircleHelp size={15}/> How to read these numbers <ChevronDown size={14}/></summary><div><p><strong>Flood chance</strong> is the estimated chance of flooding in any one year. It is not the same as the size of a possible loss.</p><p><strong>Scenario loss</strong> is an estimate for a flood at the selected return period, based on approved model results. A 1-in-250 year event is rare, but it does not mean it occurs on a fixed 250-year schedule.</p><p><strong>Data labels:</strong> {sourceLabel}. Hazard scores and return periods may use proxy or assumed inputs; review property-level details before underwriting decisions.</p></div></details>
    <div className="portfolio-method-note"><CircleHelp size={15}/><p><strong>Decision support, not a substitute for review.</strong> Flood chance and event loss are different measures. Figures are shown only when portfolio records and model results support them; unresolved exposure or hazard information is marked pending.</p></div>
  </section>;
}

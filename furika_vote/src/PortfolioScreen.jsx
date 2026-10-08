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
  Map,
  MapPin,
  Search,
  Sparkles,
  TableProperties,
  TrendingUp,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';
import './portfolio.css';
import { API_BASE_URL, PORTFOLIO_ID, apiGet, apiRequest } from './api.js';

const HOUSING_LABEL = { informal_iron_sheet:'Informal iron sheet', semi_permanent:'Semi-permanent', permanent_masonry:'Permanent masonry' };
const BAND_LABEL = { low:'Low', moderate:'Moderate', high:'High', severe:'Severe', pending:'Pending' };
const CLUSTER_TYPES = { Neighbourhood:'neighbourhood', Grid:'grid', 'Hazard band':'hazard_band', 'Housing class':'housing_class' };
const NAIROBI_BOUNDS = { latMin:-1.5, latMax:-1.1, lngMin:36.6, lngMax:37.1 };

const millions = (value) => value == null ? null : value / 1e6;

function toUiProperty(item) {
  return { id:item.id, name:item.name, region:item.region || 'Unassigned', housing:HOUSING_LABEL[item.housingClass] || item.housingClass || 'Unclassified', value:millions(item.insuredValueKes), area:item.floorAreaM2, hazard:item.hazardScore, probability:item.annualFloodProbability == null ? null : item.annualFloodProbability * 100, risk:BAND_LABEL[item.hazardBand] || 'Pending', aal:millions(item.aalKes), loss100:millions(item.loss100Kes), loss250:millions(item.loss250Kes), lat:item.latitude, lng:item.longitude, cluster:item.cluster || 'Unassigned', hotspot:item.nearestHotspotKm ?? null, geocodePrecision:item.geocodePrecision, ai:Boolean(item.aiFlagged), rank:null, sourceTag:item.sourceTag, reviewStatus:item.reviewStatus, hazardSource:item.hazardSource, hazardScores:item.hazardScores, issueCount:item.issueCount || 0 };
}

const MAP_MODES = ['Risk','Property count','Insured value','Loss','Flood probability'];
const RISK_COLOR = { Severe:'#dc284d', High:'#eb701c', Moderate:'#e4a21a', Low:'#169b70', Pending:'#7b8794' };

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
  return { id:'GOOGLE LOCATION', name:label, region:'Nairobi', housing:'Unclassified location', value:null, area:null, hazard:null, probability:null, risk:'Pending', aal:null, loss100:null, loss250:null, lat, lng, cluster:'Not assigned', hotspot:null, ai:false, rank:null, isMapSearch:true, referenceId:nearby[0]?.id, proxyScores };
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
    const mapPoints = selected && !properties.some((property)=>property.id===selected.id) ? [...properties,selected] : properties;
    markers.current = mapPoints.map((property) => {
      const marker = new window.google.maps.Marker({ map:mapRef.current, position:{lat:property.lat,lng:property.lng}, title:`${property.id} · ${property.name}${property.reviewStatus==='unconfirmed'?' · unconfirmed':''}`, icon:{path:window.google.maps.SymbolPath.CIRCLE,scale:selected?.id===property.id?10:7,fillColor:RISK_COLOR[property.risk],fillOpacity:property.reviewStatus==='unconfirmed'?.15:.92,strokeColor:property.reviewStatus==='unconfirmed'?RISK_COLOR[property.risk]:'#fff',strokeWeight:2} });
      marker.addListener('click', () => onSelect(property));
      return marker;
    });
  }, [properties, selected, onSelect, status]);

  useEffect(() => {
    if (!mapRef.current || !selected) return;
    mapRef.current.panTo({ lat:selected.lat, lng:selected.lng });
    mapRef.current.setZoom(17);
  }, [selected]);

  return <div className="portfolio-map">
    <div ref={mapNode} className="portfolio-google-map" />
    {status !== 'ready' && <div className="portfolio-map-fallback"><div className="portfolio-road-grid"/><svg viewBox="0 0 800 460" preserveAspectRatio="none"><path d="M-20 340 C150 240 240 410 410 280 S650 150 830 230"/><path d="M80 -20 C190 130 280 150 340 250 S470 350 560 500"/><path d="M-20 120 C150 190 260 70 430 130 S670 250 830 100"/></svg>{properties.map((property,index)=><button key={property.id} className={`portfolio-fallback-pin ${properties.length>20?'compact':''} ${selected?.id===property.id?'selected':''}`} style={{'--risk':RISK_COLOR[property.risk],left:`${(property.lng-NAIROBI_BOUNDS.lngMin)/(NAIROBI_BOUNDS.lngMax-NAIROBI_BOUNDS.lngMin)*100}%`,top:`${(NAIROBI_BOUNDS.latMax-property.lat)/(NAIROBI_BOUNDS.latMax-NAIROBI_BOUNDS.latMin)*100}%`}} onClick={()=>onSelect(property)} title={property.id}>{properties.length<=20&&<span>{index+1}</span>}</button>)}<div className="portfolio-map-message"><Map size={18}/><span>{status==='missing'?'Add VITE_GOOGLE_MAPS_API_KEY for the live map':status==='error'?'Live map unavailable — showing portfolio canvas':'Loading portfolio map…'}</span></div></div>}
    <div className="map-mode-card"><span>COLOUR BY</span><div>{MAP_MODES.map((item)=><button key={item} className={mode===item?'active':''} onClick={()=>setMode(item)}>{item}</button>)}</div></div>
    <label className="cluster-select"><Layers3 size={13}/><span>Cluster by</span><select value={clusterBy} onChange={(event)=>setClusterBy(event.target.value)}><option>Neighbourhood</option><option>Grid</option><option>Hazard band</option><option>Housing class</option></select><ChevronDown size={12}/></label>
    <div className="map-key"><i className="low"/> Low <i className="moderate"/> Moderate <i className="high"/> High <i className="severe"/> Severe <i className="pending"/> Pending <i className="unconfirmed"/> Unconfirmed</div>
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

  return <section className="street-view-card"><div ref={node} className="street-view-canvas"/>{status!=='ready'&&<div className="street-view-state"><MapPin size={20}/><strong>{status==='loading'?'Finding the nearest Google Street View…':status==='missing'?'Google Maps key required':'No Google Street View is available within 500 m'}</strong><span>{property.lat.toFixed(5)}, {property.lng.toFixed(5)}</span></div>}<span className="street-view-label"><i/> GOOGLE STREET VIEW · NEAREST AVAILABLE IMAGE</span></section>;
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
    catch (error) { setActionError(error.message); }
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
  const hasProbability = top.some((cluster)=>cluster.annualFloodProbability!=null);
  const mix = (cluster) => { const informal=(cluster.classMix.informal||0)*100; const semi=(cluster.classMix.semiPermanent||0)*100; return `conic-gradient(#041d3b 0 ${informal}%,#ef9f23 ${informal}% ${informal+semi}%,#7658a2 ${informal+semi}% 100%)`; };
  return <section className="cluster-analytics"><div className="section-heading"><div><span>PORTFOLIO ACCUMULATION</span><h2>Clusters and concentration</h2></div><button><Download size={14}/> Export cluster view</button></div>{top.length?<><div className="analytics-grid"><div className="treemap-card"><header><strong>Value concentration</strong><span>Size = insured value · colour = risk (grey = pending)</span></header><div className="treemap">{top.map((cluster,index)=><div key={cluster.id} className={`tree-${index} ${cluster.riskBand}`}><strong>{cluster.name}</strong><span>{kes(cluster.insuredValueKes)}</span><small>{cluster.propertyCount} properties</small></div>)}</div></div><div className="bubble-card"><header><strong>Value vs. risk</strong><span>Bubble size = cluster TIV</span></header>{hasProbability?<div className="bubble-chart"><span className="axis-y">INSURED VALUE</span><span className="axis-x">FLOOD PROBABILITY →</span>{top.map((cluster,index)=>{ const value=cluster.insuredValueKes/1e6; return <button key={cluster.id} className={cluster.riskBand} style={{left:`${12+(cluster.annualFloodProbability||0)*300}%`,bottom:`${15+value/15}%`,width:`${28+value/30}px`,height:`${28+value/30}px`}} title={`${cluster.name}: ${kes(cluster.insuredValueKes)}`}><span>{index+1}</span></button>; })}</div>:<div className="loss-unavailable"><BarChart3 size={19}/><strong>Flood probability pending</strong><span>Cluster risk is plotted after an approved model run.</span></div>}</div></div><div className="cluster-cards">{top.map((cluster)=><article key={cluster.id}><header><div><span className={`cluster-dot ${cluster.riskBand}`}/><strong>{cluster.name}</strong></div><em>{cluster.accumulationFlag?.replaceAll('_',' ') || (cluster.riskBand==='pending'?'Risk pending':'')}</em></header><div className="cluster-metrics"><div><span>PROPERTIES</span><strong>{cluster.propertyCount}</strong></div><div><span>INSURED VALUE</span><strong>{kes(cluster.insuredValueKes)}</strong></div><div><span>1-IN-100 LOSS</span><strong>{kes(cluster.loss100Kes)}</strong></div><div><span>AAL / TIV</span><strong>{cluster.aalPercentTiv!=null?`${cluster.aalPercentTiv}%`:'—'}</strong></div></div><div className="cluster-foot"><div className="class-mix" style={{background:mix(cluster)}}/><span>{cluster.tivShare!=null?`${(cluster.tivShare*100).toFixed(1)}% of portfolio TIV`:'—'}</span><small>{cluster.annualFloodProbability!=null?`Avg flood probability ${(cluster.annualFloodProbability*100).toFixed(1)}%`:'Flood probability pending'}</small></div></article>)}</div></>:<div className="loss-unavailable"><Layers3 size={19}/><strong>{status==='error'?'Clusters unavailable':status==='ready'?'No clusters yet':'Loading clusters…'}</strong><span>{status==='ready'?'Upload or seed properties to see accumulation.':''}</span></div>}</section>;
}

export default function PortfolioScreen({ onAskProperty }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('Risk');
  const [clusterBy, setClusterBy] = useState('Neighbourhood');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ highRisk:false, masonry:false, hotspot:false, ai:false });
  const [fullDetail, setFullDetail] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [properties, setProperties] = useState([]);
  const [summary, setSummary] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [load, setLoad] = useState({ status:'loading', message:'' });
  const [clusterStatus, setClusterStatus] = useState('loading');

  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet(`/portfolios/${PORTFOLIO_ID}/properties?limit=2000&sort=tiv:desc`), apiGet(`/portfolios/${PORTFOLIO_ID}/summary`)])
      .then(([list, summaryBody]) => { if (cancelled) return; setProperties(list.items.map(toUiProperty)); setSummary(summaryBody); setLoad({ status:'ready', message:'' }); })
      .catch((error) => { if (!cancelled) setLoad({ status:'error', message:error.message }); });
    return () => { cancelled = true; };
  }, [dataVersion]);

  useEffect(() => {
    let cancelled = false;
    setClusterStatus('loading');
    apiGet(`/portfolios/${PORTFOLIO_ID}/clusters?type=${CLUSTER_TYPES[clusterBy]}`)
      .then((body) => { if (!cancelled) { setClusters(body.items); setClusterStatus('ready'); } })
      .catch(() => { if (!cancelled) { setClusters([]); setClusterStatus('error'); } });
    return () => { cancelled = true; };
  }, [clusterBy, dataVersion]);

  const filtered = useMemo(() => properties.filter((property) => {
    const text = `${property.id} ${property.name} ${property.region} ${property.lat} ${property.lng}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filters.highRisk && !['High','Severe'].includes(property.risk)) return false;
    if (filters.masonry && !property.housing.toLowerCase().includes('masonry')) return false;
    if (filters.hotspot && (property.hotspot == null || property.hotspot > 1)) return false;
    if (filters.ai && !property.ai) return false;
    return true;
  }), [properties, query, filters]);

  const toggleFilter = (key) => setFilters((current)=>({...current,[key]:!current[key]}));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const selectProperty = (property, message = '') => {
    setSelected(property);
    setFullDetail(false);
    setSearchStatus(message || `${property.id} located at ${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}. Map focused and risk record opened.`);
  };

  const locateProperty = async () => {
    const term = query.trim();
    if (!term) { setSearchStatus('Enter a property ID, neighbourhood, address, or latitude and longitude.'); return; }
    const coordinateMatch = term.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
    const normalizedTerm = term.toLowerCase();
    let match = properties.find((property)=>property.id.toLowerCase()===normalizedTerm || property.name.toLowerCase()===normalizedTerm);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]);
      const lng = Number(coordinateMatch[2]);
      const location = createGoogleLocation(lat,lng,`Searched coordinates`,properties);
      selectProperty(location, location.referenceId ? `Exact coordinates located. Nearby hazard is shown only as a proxy; this location is not ${location.referenceId}.` : 'Exact coordinates located. No portfolio records with hazard scores are loaded to use as a proxy.');
      return;
    }
    if (match) { selectProperty(match); return; }
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
        selectProperty(locationResult, `Google found “${results[0].formatted_address}”. The pin is exact; nearby hazard scores are shown separately as a proxy.`);
      });
    } catch { setSearchStatus('Google Maps search is currently unavailable.'); }
  };

  return <section className="portfolio-screen">
    <header className="portfolio-header"><div><span>PORTFOLIO INTELLIGENCE</span><h1>Property risk and accumulation</h1><p>Search synthetic exposure, inspect property loss, and identify correlated flood concentrations.</p></div><div><button><Download size={15}/> Export</button><button className="primary"><Sparkles size={15}/> Ask Furika</button></div></header>
    <div className="portfolio-search-row"><label><Search size={17}/><input value={query} onChange={(event)=>{setQuery(event.target.value);setSearchStatus('')}} onKeyDown={(event)=>{if(event.key==='Enter')locateProperty()}} placeholder="Search ID, neighbourhood, address, or -1.2584, 36.8554"/><kbd>ENTER</kbd></label><button className="search-submit" onClick={locateProperty}><MapPin size={15}/> Locate on map</button><button className={filtersOpen?'active':''} onClick={()=>setFiltersOpen(!filtersOpen)}><Filter size={15}/> Filters {activeFilterCount>0&&<i>{activeFilterCount}</i>}</button><button><ArrowRight size={15}/> Sort: AAL</button></div>
    {searchStatus&&<div className="portfolio-search-status"><CheckCircle2 size={13}/><span>{searchStatus}</span><button onClick={()=>setSearchStatus('')}><X size={12}/></button></div>}
    {filtersOpen&&<div className="portfolio-filters"><span>QUICK FILTERS</span><button className={filters.masonry?'active':''} onClick={()=>toggleFilter('masonry')}>Permanent masonry</button><button className={filters.highRisk?'active':''} onClick={()=>toggleFilter('highRisk')}>High + severe risk</button><button className={filters.hotspot?'active':''} onClick={()=>toggleFilter('hotspot')}>Within 1 km hotspot</button><button className={filters.ai?'active':''} onClick={()=>toggleFilter('ai')}>AI flagged</button>{activeFilterCount>0&&<button className="clear" onClick={()=>setFilters({highRisk:false,masonry:false,hotspot:false,ai:false})}>Clear all</button>}</div>}
    <div className="portfolio-summary"><div><span>TOTAL INSURED VALUE</span><strong>{summary?kes(summary.totalInsuredValueKes):'—'}</strong><small>{summary?`${summary.propertyCount} ${summary.sourceTag==='mixed'?'':summary.sourceTag||''} properties`:'Loading…'}</small></div><div><span>PORTFOLIO AAL</span><strong>{kes(summary?.portfolioAalKes)}</strong><small>{summary?.aalPercentTiv!=null?`${summary.aalPercentTiv.toFixed(2)}% of TIV`:'Pending model run'}</small></div><div><span>LOSS AT 1-IN-100</span><strong>{kes(summary?.loss100Kes)}</strong><small>{summary?.loss100Kes!=null&&summary.totalInsuredValueKes?`${(summary.loss100Kes/summary.totalInsuredValueKes*100).toFixed(1)}% damage ratio`:'Pending model run'}</small></div><div><span>UNCONFIRMED</span><strong>{summary?summary.unconfirmedCount:'—'}</strong><small>Excluded from model runs</small></div><div><span>HAZARD MISSING</span><strong>{summary?summary.hazardMissingCount:'—'}</strong><small>No proxy scores yet</small></div></div>
    <div className="portfolio-master"><aside className="property-list"><header><div><strong>{filtered.length} results</strong><span>of {summary?.propertyCount ?? properties.length} properties</span></div><button title="List options"><SlidersHorizontalIcon/></button></header><div>{load.status!=='ready'?<div className="no-properties"><Search size={24}/><strong>{load.status==='error'?'Portfolio could not be loaded':'Loading portfolio…'}</strong><span>{load.status==='error'?`${load.message}. Start the Flask backend and run flask --app run.py seed-reference.`:`${PORTFOLIO_ID} from ${API_BASE_URL}`}</span></div>:filtered.length?filtered.map((property)=><button key={property.id} className={selected?.id===property.id?'active':''} onClick={()=>selectProperty(property)}><span className="property-list-icon"><Building2 size={16}/></span><span className="property-list-main"><span><strong>{property.id}</strong><em style={{'--risk':RISK_COLOR[property.risk]}}>{property.risk}</em>{property.reviewStatus==='unconfirmed'&&<em style={{'--risk':'#5f6b78'}}>Unconfirmed</em>}{property.issueCount>0&&<em style={{'--risk':'#b7791f'}}>{property.issueCount} warning{property.issueCount>1?'s':''}</em>}</span><small>{property.name} · {property.housing}</small><span className="property-row-metrics"><b>{money(property.value)}</b><i>{property.probability!=null?`~${property.probability}% / year`:'Probability pending'}</i><i>AAL {money(property.aal)}</i></span></span><ArrowRight size={14}/></button>):<div className="no-properties"><Search size={24}/><strong>No matching properties</strong><span>Press Enter to search the address with Google Maps.</span></div>}</div></aside><div className="portfolio-map-column"><div className="map-context"><div><MapPin size={14}/><span><strong>Nairobi portfolio map</strong><small>{filtered.length} visible properties · select one to zoom to its coordinates</small></span></div><span><i/> Map and results are synchronized</span></div><PortfolioMap properties={filtered} selected={selected} onSelect={(property)=>selectProperty(property)} mode={mode} setMode={setMode} clusterBy={clusterBy} setClusterBy={setClusterBy}/></div>
      {selected&&<PropertyDrawer property={selected} full={fullDetail} setFull={setFullDetail} onClose={()=>setSelected(null)} onAsk={onAskProperty} onResultsChanged={()=>setDataVersion((value)=>value+1)}/>} 
    </div>
    <ClusterAnalytics clusters={clusters} status={clusterStatus}/>
    <div className="portfolio-method-note"><CircleHelp size={15}/><p><strong>Scenario-based approximation.</strong> Flood probability and exceedance loss are different measures. Five model tiers are used here—not a full stochastic event set. Return periods per tier are assumed, and every portfolio record shown is synthetic or redacted.</p></div>
  </section>;
}

function SlidersHorizontalIcon(){return <Filter size={14}/>;}

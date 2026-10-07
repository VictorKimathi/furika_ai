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
  X,
} from 'lucide-react';
import './portfolio.css';

const PROPERTIES = [
  { id:'NBO-0002', name:'Mathare 4A', region:'Mathare', housing:'Informal iron sheet', value:18.4, area:126, hazard:.91, probability:50, risk:'Severe', aal:2.31, loss100:11.8, loss250:15.6, lat:-1.2584, lng:36.8554, cluster:'Mathare Basin', hotspot:.2, ai:true, rank:'Top 3%' },
  { id:'NBO-0091', name:'Mathare North', region:'Mathare', housing:'Permanent masonry', value:72, area:510, hazard:.88, probability:20, risk:'Severe', aal:5.84, loss100:33.7, loss250:41.2, lat:-1.2568, lng:36.8581, cluster:'Mathare Basin', hotspot:.4, ai:true, rank:'Top 2%' },
  { id:'NBO-0218', name:'South C · Popo Rd', region:'South C', housing:'Permanent masonry', value:48.5, area:344, hazard:.74, probability:10, risk:'High', aal:2.76, loss100:18.5, loss250:23.1, lat:-1.3172, lng:36.8252, cluster:'Nairobi South', hotspot:.7, ai:false, rank:'Top 8%' },
  { id:'NBO-0337', name:'Kibera · Lindi', region:'Kibera', housing:'Informal iron sheet', value:12.8, area:96, hazard:.71, probability:10, risk:'High', aal:1.42, loss100:9.2, loss250:10.8, lat:-1.3121, lng:36.7893, cluster:'Kibera Drainage', hotspot:.3, ai:true, rank:'Top 6%' },
  { id:'NBO-0504', name:'Industrial Area', region:'Makadara', housing:'Engineered concrete', value:105, area:740, hazard:.53, probability:4, risk:'Moderate', aal:3.14, loss100:14.7, loss250:22.4, lat:-1.3044, lng:36.8622, cluster:'Industrial East', hotspot:1.7, ai:false, rank:'Top 14%' },
  { id:'NBO-0416', name:'Westlands · Brookside', region:'Westlands', housing:'Permanent masonry', value:86.2, area:580, hazard:.42, probability:4, risk:'Moderate', aal:1.93, loss100:12.1, loss250:19.8, lat:-1.2649, lng:36.8007, cluster:'Westlands North', hotspot:.9, ai:true, rank:'Top 22%' },
  { id:'NBO-0572', name:'Embakasi · Pipeline', region:'Embakasi', housing:'Semi-permanent', value:24.6, area:190, hazard:.67, probability:10, risk:'High', aal:1.78, loss100:10.4, loss250:14.9, lat:-1.3168, lng:36.8914, cluster:'Industrial East', hotspot:1.1, ai:false, rank:'Top 11%' },
  { id:'NBO-0594', name:'Karen · Miotoni', region:'Karen', housing:'Permanent masonry', value:94.5, area:620, hazard:.18, probability:.4, risk:'Low', aal:.38, loss100:4.9, loss250:9.8, lat:-1.3191, lng:36.7128, cluster:'Karen West', hotspot:4.8, ai:false, rank:'Bottom 18%' },
];

const CLUSTERS = [
  { name:'Mathare Basin', properties:74, value:638, loss:211, aal:4.8, probability:24, share:17, risk:'severe', mix:[58,29,13], flag:'High accumulation' },
  { name:'Kibera Drainage', properties:96, value:514, loss:184, aal:5.1, probability:19, share:15, risk:'high', mix:[64,25,11], flag:'AI hotspot uplift' },
  { name:'Industrial East', properties:61, value:892, loss:163, aal:2.4, probability:8, share:13, risk:'moderate', mix:[12,20,68], flag:'Value concentration' },
  { name:'Nairobi South', properties:83, value:746, loss:146, aal:2.8, probability:10, share:12, risk:'high', mix:[18,34,48], flag:'Drainage proximity' },
];

const MAP_MODES = ['Risk','Property count','Insured value','Loss','Flood probability'];
const RISK_COLOR = { Severe:'#dc284d', High:'#eb701c', Moderate:'#e4a21a', Low:'#169b70' };

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

const money = (value) => value >= 1000 ? `KES ${(value/1000).toFixed(2)}B` : `KES ${value.toFixed(value < 10 ? 2 : 1)}M`;

function createGoogleLocation(lat, lng, label, nearest) {
  const nearby = [...PROPERTIES].sort((a,b)=>((a.lat-lat)**2+(a.lng-lng)**2)-((b.lat-lat)**2+(b.lng-lng)**2)).slice(0,3);
  const weighted = nearby.reduce((total,property,index)=>total+property.hazard/(index+1),0) / nearby.reduce((total,_,index)=>total+1/(index+1),0);
  const hazard = Math.max(0,Math.min(1,weighted));
  const risk = hazard>=.8?'Severe':hazard>=.6?'High':hazard>=.4?'Moderate':'Low';
  const probability = hazard>=.9?50:hazard>=.8?20:hazard>=.6?10:hazard>=.4?4:.4;
  return { id:'GOOGLE LOCATION', name:label, region:'Nairobi', housing:'Unclassified location', value:null, area:null, hazard, probability, risk, aal:null, loss100:null, loss250:null, lat, lng, cluster:'Not assigned', hotspot:null, ai:false, rank:'Not ranked', isMapSearch:true, referenceId:nearest.id };
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
      const marker = new window.google.maps.Marker({ map:mapRef.current, position:{lat:property.lat,lng:property.lng}, title:`${property.id} · ${property.name}`, icon:{path:window.google.maps.SymbolPath.CIRCLE,scale:selected?.id===property.id?10:7,fillColor:RISK_COLOR[property.risk],fillOpacity:.92,strokeColor:'#fff',strokeWeight:2} });
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
    {status !== 'ready' && <div className="portfolio-map-fallback"><div className="portfolio-road-grid"/><svg viewBox="0 0 800 460" preserveAspectRatio="none"><path d="M-20 340 C150 240 240 410 410 280 S650 150 830 230"/><path d="M80 -20 C190 130 280 150 340 250 S470 350 560 500"/><path d="M-20 120 C150 190 260 70 430 130 S670 250 830 100"/></svg>{properties.map((property,index)=><button key={property.id} className={`portfolio-fallback-pin pfp-${index%8} ${selected?.id===property.id?'selected':''}`} style={{'--risk':RISK_COLOR[property.risk]}} onClick={()=>onSelect(property)} title={property.id}><span>{index+1}</span></button>)}<div className="portfolio-map-message"><Map size={18}/><span>{status==='missing'?'Add VITE_GOOGLE_MAPS_API_KEY for the live map':status==='error'?'Live map unavailable — showing portfolio canvas':'Loading portfolio map…'}</span></div></div>}
    <div className="map-mode-card"><span>COLOUR BY</span><div>{MAP_MODES.map((item)=><button key={item} className={mode===item?'active':''} onClick={()=>setMode(item)}>{item}</button>)}</div></div>
    <label className="cluster-select"><Layers3 size={13}/><span>Cluster by</span><select value={clusterBy} onChange={(event)=>setClusterBy(event.target.value)}><option>Neighbourhood</option><option>Grid</option><option>Hazard band</option><option>Housing class</option></select><ChevronDown size={12}/></label>
    <div className="map-key"><i className="low"/> Low <i className="moderate"/> Moderate <i className="high"/> High <i className="severe"/> Severe</div>
  </div>;
}

function EpCurve({ property }) {
  const points = `15,67 58,62 105,52 152,${Math.max(22,58-property.hazard*35)} 198,${Math.max(8,45-property.hazard*35)}`;
  return <svg className="property-ep" viewBox="0 0 215 88" role="img" aria-label="Property exceedance probability curve"><line x1="15" y1="7" x2="15" y2="68"/><line x1="15" y1="68" x2="202" y2="68"/><polyline points={points}/><path d={`M ${points.replaceAll(' ',', L ')}`}/>{[[15,67],[58,62],[105,52],[152,Math.max(22,58-property.hazard*35)],[198,Math.max(8,45-property.hazard*35)]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.8"/>)}<text x="13" y="81">2y</text><text x="52" y="81">10y</text><text x="96" y="81">25y</text><text x="143" y="81">100y</text><text x="187" y="81">250y</text></svg>;
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

function PropertyDrawer({ property, full, setFull, onClose, onAsk }) {
  const tiers = [
    ['2-year',Math.max(.08,property.hazard-.46),.35],['10-year',Math.max(.16,property.hazard-.27),.8],['25-year',Math.max(.24,property.hazard-.15),1.2],['100-year',property.hazard,1.8],['250-year',Math.min(.99,property.hazard+.08),2.4],
  ];
  const drivers = [['Elevation',78],['Depressions',62],['Slope',44],['River distance',71],['AI uplift',property.ai?66:12]];
  const cost = property.value && property.area ? Math.round(property.value*1000000/property.area) : null;
  return <aside className={`property-drawer ${full?'full':''}`}>
    <header><div><span>PROPERTY DETAIL</span><h2>{property.id}</h2><p><MapPin size={12}/>{property.name}, {property.region}</p></div><div className="drawer-head-actions"><button onClick={()=>setFull(!full)}>{full?'Close full page':'Open full page'}</button><button onClick={onClose} title="Close property details"><X size={17}/></button></div></header>
    <div className="property-scroll">
      <div className="property-badges"><span className="synthetic">{property.isMapSearch?'Google Maps result':'Synthetic'}</span><span style={{'--risk':RISK_COLOR[property.risk]}} className="property-risk">{property.isMapSearch?'Nearby proxy: ':''}{property.risk} risk</span><span>{property.housing}</span></div>
      <PropertyStreetView property={property}/>
      <section className="detail-map-card"><div className="detail-mini-map"><div className="mini-roads"/><MapPin size={26}/><span>{property.lat.toFixed(4)}, {property.lng.toFixed(4)}</span></div><div><span>{property.isMapSearch?'NEAREST MODEL REFERENCE':'NEAREST KNOWN HOTSPOT'}</span><strong>{property.isMapSearch?property.referenceId:`${property.hotspot.toFixed(1)} km away`}</strong><small>{property.isMapSearch?'Risk is a nearby-location proxy, not a matched policy record.':property.ai?'Drainage evidence uplift applied':'Terrain proxy is directionally consistent'}</small><a href={`https://www.google.com/maps/search/?api=1&query=${property.lat},${property.lng}`} target="_blank" rel="noreferrer"><ExternalLink size={11}/> Open exact location in Google Maps</a></div></section>
      <section className="detail-section"><div className="detail-title"><div><Building2 size={15}/><span><strong>Exposure</strong><small>{property.isMapSearch?'Insurance information not supplied':'Source portfolio fields'}</small></span></div><em>{property.isMapSearch?'REQUIRED':'SYNTHETIC'}</em></div>{property.isMapSearch?<div className="missing-exposure"><AlertTriangle size={15}/><span><strong>No portfolio record at this location</strong>Add floor area, construction class and insured value before financial loss can be calculated.</span></div>:<div className="detail-kpis"><div><span>FLOOR AREA</span><strong>{property.area} m²</strong></div><div><span>COST / M²</span><strong>KES {cost.toLocaleString()}</strong></div><div className="primary"><span>INSURED VALUE</span><strong>{money(property.value)}</strong></div></div>}</section>
      <section className="detail-section"><div className="detail-title"><div><TrendingUp size={15}/><span><strong>Hazard</strong><small>{property.isMapSearch?'Nearby model interpolation':'Scenario approximation'}</small></span></div><em>{property.isMapSearch?'PROXY ONLY':'DERIVED'}</em></div><div className="probability-callout"><span>{property.isMapSearch?'NEARBY PROXY FLOOD PROBABILITY':'ANNUAL FLOOD PROBABILITY'}</span><strong>About {property.probability}% chance each year</strong><small>{property.isMapSearch?'Indicative interpolation from nearby samples · run the hazard workflow for this coordinate':'Smallest scenario tier reaching this property · not a full stochastic result'}</small></div><div className="hazard-table"><div><span>SCENARIO</span><span>SCORE</span><span>DEPTH</span></div>{tiers.map(([tier,score,scale])=><div key={tier}><strong>{tier}</strong><span>{score.toFixed(2)}</span><span>{(score*scale).toFixed(2)} m</span></div>)}</div><span className="subsection-label">FLOOD DRIVER BREAKDOWN</span><div className="driver-bars">{drivers.map(([label,value])=><div key={label}><span>{label}</span><i><b style={{width:`${value}%`}}/></i><strong>{value}%</strong></div>)}</div></section>
      <section className="detail-section"><div className="detail-title"><div><BarChart3 size={15}/><span><strong>Loss and probability</strong><small>Damage ratio × insured value</small></span></div><em>{property.isMapSearch?'AWAITING EXPOSURE':'MODELLED'}</em></div>{property.isMapSearch?<div className="loss-unavailable"><BarChart3 size={19}/><strong>Financial loss is not available</strong><span>The exact Google location has no insured value or vulnerability class. Its nearby hazard proxy is shown above, but loss will not be invented.</span></div>:<div className="loss-layout"><EpCurve property={property}/><div className="loss-kpis"><div><span>AVERAGE ANNUAL LOSS</span><strong>{money(property.aal)}</strong><small>{(property.aal/property.value*1000).toFixed(1)}‰ of TIV</small></div><div><span>LOSS AT 1-IN-100</span><strong>{money(property.loss100)}</strong><small>{(property.loss100/property.value*100).toFixed(1)}% damage ratio</small></div><div><span>LOSS AT 1-IN-250</span><strong>{money(property.loss250)}</strong><small>{(property.loss250/property.value*100).toFixed(1)}% damage ratio</small></div><div><span>PORTFOLIO CONTRIBUTION</span><strong>{(property.loss100/896*100).toFixed(1)}%</strong><small>of 1-in-100 loss</small></div></div></div>}</section>
      <section className="detail-section explanation"><div className="detail-title"><div><CircleHelp size={15}/><span><strong>Why this rating?</strong><small>Plain-language explanation</small></span></div></div>{property.isMapSearch?<p>This is the exact location returned by Google Maps. The <strong>{property.risk.toLowerCase()} hazard indication is a nearby-portfolio proxy</strong> derived from three modelled sample locations. It is not a property-level underwriting result.</p>:<p>This property is reached by flooding in approximately the {property.probability>=20?'frequent':'less frequent'} scenarios. At 1-in-100 it could lose about <strong>{(property.loss100/property.value*100).toFixed(0)}% of its value ({money(property.loss100)})</strong>.</p>}<div className="provenance"><span>{property.isMapSearch?'Google geocode':'Terrain proxy'}</span><span>{property.isMapSearch?'Nearby hazard proxy':'Assumed depth'}</span>{!property.isMapSearch&&<span>Adapted vulnerability</span>}</div>{property.ai&&<div className="property-warning"><AlertTriangle size={14}/><span><strong>Drainage warning</strong>Reports describe flooding near this property that terrain alone may understate.</span></div>}</section>
      <section className="detail-section"><div className="detail-title"><div><TableProperties size={15}/><span><strong>Portfolio context</strong><small>Accumulation and ranking</small></span></div></div>{property.isMapSearch?<div className="missing-exposure"><CircleHelp size={15}/><span><strong>Location is outside the loaded sample records</strong>Add it as a synthetic exposure to calculate portfolio rank, cluster accumulation and local TIV.</span></div>:<div className="context-grid"><div><span>AAL RANK</span><strong>{property.rank}</strong></div><div><span>CLUSTER</span><strong>{property.cluster}</strong></div><div><span>WITHIN 500 M</span><strong>{Math.round(12+property.hazard*42)} properties</strong></div><div><span>LOCAL TIV</span><strong>{money(96+property.value*2.1)}</strong></div></div>}</section>
    </div>
    <footer><button onClick={()=>onAsk(property)}><Bot size={15}/> Ask Furika</button><button><Sparkles size={15}/> Add to comparison</button><button><Download size={15}/> Export</button></footer>
  </aside>;
}

function ClusterAnalytics() {
  return <section className="cluster-analytics"><div className="section-heading"><div><span>PORTFOLIO ACCUMULATION</span><h2>Clusters and concentration</h2></div><button><Download size={14}/> Export cluster view</button></div><div className="analytics-grid"><div className="treemap-card"><header><strong>Value concentration</strong><span>Size = insured value · colour = risk</span></header><div className="treemap">{CLUSTERS.map((cluster,index)=><div key={cluster.name} className={`tree-${index} ${cluster.risk}`}><strong>{cluster.name}</strong><span>{money(cluster.value)}</span><small>{cluster.properties} properties</small></div>)}</div></div><div className="bubble-card"><header><strong>Value vs. risk</strong><span>Bubble size = cluster TIV</span></header><div className="bubble-chart"><span className="axis-y">INSURED VALUE</span><span className="axis-x">FLOOD PROBABILITY →</span>{CLUSTERS.map((cluster,index)=><button key={cluster.name} className={cluster.risk} style={{left:`${12+cluster.probability*3}%`,bottom:`${15+cluster.value/15}%`,width:`${28+cluster.value/30}px`,height:`${28+cluster.value/30}px`}} title={`${cluster.name}: ${money(cluster.value)}`}><span>{index+1}</span></button>)}</div></div></div><div className="cluster-cards">{CLUSTERS.map((cluster)=><article key={cluster.name}><header><div><span className={`cluster-dot ${cluster.risk}`}/><strong>{cluster.name}</strong></div><em>{cluster.flag}</em></header><div className="cluster-metrics"><div><span>PROPERTIES</span><strong>{cluster.properties}</strong></div><div><span>INSURED VALUE</span><strong>{money(cluster.value)}</strong></div><div><span>1-IN-100 LOSS</span><strong>{money(cluster.loss)}</strong></div><div><span>AAL / TIV</span><strong>{cluster.aal}%</strong></div></div><div className="cluster-foot"><div className="class-mix" style={{background:`conic-gradient(#087f91 0 ${cluster.mix[0]}%,#ef9f23 ${cluster.mix[0]}% ${cluster.mix[0]+cluster.mix[1]}%,#7658a2 ${cluster.mix[0]+cluster.mix[1]}% 100%)`}}/><span>{cluster.share}% of portfolio loss</span><small>Avg flood probability {cluster.probability}%</small></div></article>)}</div></section>;
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

  const filtered = useMemo(() => PROPERTIES.filter((property) => {
    const text = `${property.id} ${property.name} ${property.region} ${property.lat} ${property.lng}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filters.highRisk && !['High','Severe'].includes(property.risk)) return false;
    if (filters.masonry && !property.housing.toLowerCase().includes('masonry')) return false;
    if (filters.hotspot && property.hotspot > 1) return false;
    if (filters.ai && !property.ai) return false;
    return true;
  }), [query, filters]);

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
    let match = PROPERTIES.find((property)=>property.id.toLowerCase()===normalizedTerm || property.name.toLowerCase()===normalizedTerm);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]);
      const lng = Number(coordinateMatch[2]);
      const nearest = [...PROPERTIES].sort((a,b)=>((a.lat-lat)**2+(a.lng-lng)**2)-((b.lat-lat)**2+(b.lng-lng)**2))[0];
      const location = createGoogleLocation(lat,lng,`Searched coordinates`,nearest);
      selectProperty(location, `Exact coordinates located. Nearby hazard is shown only as a proxy; this location is not ${nearest.id}.`);
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
        const nearest = [...PROPERTIES].sort((a,b)=>((a.lat-lat)**2+(a.lng-lng)**2)-((b.lat-lat)**2+(b.lng-lng)**2))[0];
        const locationResult = createGoogleLocation(lat,lng,results[0].formatted_address,nearest);
        selectProperty(locationResult, `Google found “${results[0].formatted_address}”. The pin is exact; nearby model risk is shown separately as a proxy.`);
      });
    } catch { setSearchStatus('Google Maps search is currently unavailable.'); }
  };

  return <section className="portfolio-screen">
    <header className="portfolio-header"><div><span>PORTFOLIO INTELLIGENCE</span><h1>Property risk and accumulation</h1><p>Search synthetic exposure, inspect property loss, and identify correlated flood concentrations.</p></div><div><button><Download size={15}/> Export</button><button className="primary"><Sparkles size={15}/> Ask Furika</button></div></header>
    <div className="portfolio-search-row"><label><Search size={17}/><input value={query} onChange={(event)=>{setQuery(event.target.value);setSearchStatus('')}} onKeyDown={(event)=>{if(event.key==='Enter')locateProperty()}} placeholder="Search ID, neighbourhood, address, or -1.2584, 36.8554"/><kbd>ENTER</kbd></label><button className="search-submit" onClick={locateProperty}><MapPin size={15}/> Locate on map</button><button className={filtersOpen?'active':''} onClick={()=>setFiltersOpen(!filtersOpen)}><Filter size={15}/> Filters {activeFilterCount>0&&<i>{activeFilterCount}</i>}</button><button><ArrowRight size={15}/> Sort: AAL</button></div>
    {searchStatus&&<div className="portfolio-search-status"><CheckCircle2 size={13}/><span>{searchStatus}</span><button onClick={()=>setSearchStatus('')}><X size={12}/></button></div>}
    {filtersOpen&&<div className="portfolio-filters"><span>QUICK FILTERS</span><button className={filters.masonry?'active':''} onClick={()=>toggleFilter('masonry')}>Permanent masonry</button><button className={filters.highRisk?'active':''} onClick={()=>toggleFilter('highRisk')}>High + severe risk</button><button className={filters.hotspot?'active':''} onClick={()=>toggleFilter('hotspot')}>Within 1 km hotspot</button><button className={filters.ai?'active':''} onClick={()=>toggleFilter('ai')}>AI flagged</button>{activeFilterCount>0&&<button className="clear" onClick={()=>setFilters({highRisk:false,masonry:false,hotspot:false,ai:false})}>Clear all</button>}</div>}
    <div className="portfolio-summary"><div><span>TOTAL INSURED VALUE</span><strong>KES 4.82B</strong><small>600 synthetic properties</small></div><div><span>PORTFOLIO AAL</span><strong>KES 126.4M</strong><small>2.62% of TIV</small></div><div><span>LOSS AT 1-IN-100</span><strong>KES 895.5M</strong><small>18.6% damage ratio</small></div><div><span>HIGH-RISK VALUE</span><strong>38.4%</strong><small>KES 1.85B exposed</small></div><div><span>AI-FLAGGED</span><strong>47</strong><small>Drainage review needed</small></div></div>
    <div className="portfolio-master"><aside className="property-list"><header><div><strong>{filtered.length} representative results</strong><span>of 600 properties</span></div><button title="List options"><SlidersHorizontalIcon/></button></header><div>{filtered.length?filtered.map((property)=><button key={property.id} className={selected?.id===property.id?'active':''} onClick={()=>selectProperty(property)}><span className="property-list-icon"><Building2 size={16}/></span><span className="property-list-main"><span><strong>{property.id}</strong><em style={{'--risk':RISK_COLOR[property.risk]}}>{property.risk}</em></span><small>{property.name} · {property.housing}</small><span className="property-row-metrics"><b>{money(property.value)}</b><i>~{property.probability}% / year</i><i>AAL {money(property.aal)}</i></span></span><ArrowRight size={14}/></button>):<div className="no-properties"><Search size={24}/><strong>No matching properties</strong><span>Press Enter to search the address with Google Maps.</span></div>}</div></aside><div className="portfolio-map-column"><div className="map-context"><div><MapPin size={14}/><span><strong>Nairobi portfolio map</strong><small>{filtered.length} visible sample properties · select one to zoom to its coordinates</small></span></div><span><i/> Map and results are synchronized</span></div><PortfolioMap properties={filtered} selected={selected} onSelect={(property)=>selectProperty(property)} mode={mode} setMode={setMode} clusterBy={clusterBy} setClusterBy={setClusterBy}/></div>
      {selected&&<PropertyDrawer property={selected} full={fullDetail} setFull={setFullDetail} onClose={()=>setSelected(null)} onAsk={onAskProperty}/>} 
    </div>
    <ClusterAnalytics/>
    <div className="portfolio-method-note"><CircleHelp size={15}/><p><strong>Scenario-based approximation.</strong> Flood probability and exceedance loss are different measures. Five model tiers are used here—not a full stochastic event set—and every portfolio record shown is synthetic.</p></div>
  </section>;
}

function SlidersHorizontalIcon(){return <Filter size={14}/>;}

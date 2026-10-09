import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, FileSpreadsheet, MapPin, Pause, Play, UploadCloud } from 'lucide-react';
import { PORTFOLIO_ID, apiGet } from './api.js';
import { assessAgainstNairobiReference, buildFloodOverlay, floodColour, FLOOD_TIERS } from './accumulationRisk.js';
import './accumulation.css';

const money = (value) => value == null ? '—' : value >= 1e9 ? `KES ${(value / 1e9).toFixed(2)}B` : `KES ${(value / 1e6).toFixed(1)}M`;
const number = (value) => Number(value || 0).toLocaleString('en-KE');
const classNames = { informal: 'Informal', semiPermanent: 'Semi-permanent', masonry: 'Masonry', concrete: 'Concrete', other: 'Other' };
const regionForProperty = (property, clusterType) => clusterType === 'grid'
  ? property.latitude == null || property.longitude == null ? 'Unlocated' : `Grid ${(Math.round(property.latitude / 0.05) * 0.05).toFixed(2)}, ${(Math.round(property.longitude / 0.05) * 0.05).toFixed(2)}`
  : property.region || 'Unassigned';

let mapsPromise;
function loadMaps(key) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-furika-maps]');
    const created = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      script.async = true;
      script.defer = true;
      script.dataset.furikaMaps = 'true';
    }
    const timer = window.setTimeout(() => reject(new Error('Google Maps timed out.')), 15000);
    const onLoad = () => { window.clearTimeout(timer); window.google?.maps ? resolve(window.google.maps) : reject(new Error('Google Maps did not initialize.')); };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('Google Maps could not load.')); }, { once: true });
    if (created) document.head.appendChild(script);
    else if (window.google?.maps) onLoad();
  }).catch((error) => { mapsPromise = null; throw error; });
  return mapsPromise;
}

async function loadAllProperties(filter) {
  const items = [];
  let cursor = null;
  let total = 0;
  do {
    const page = await apiGet(`/portfolios/${PORTFOLIO_ID}/properties?limit=2000${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(page.items || []));
    total = page.total || 0;
    cursor = page.nextCursor;
  } while (cursor);
  return { items, total };
}

export function AccumulationMap({ regions, properties, referencePoints, hotspots, regionScores, tier, floodOverlay, selectedRegion, onSelectRegion, onSelectProperty, onSelectReference }) {
  const mapNode = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const referenceMarkers = useRef([]);
  const floodCircles = useRef([]);
  const [status, setStatus] = useState('loading');
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!key) { setStatus('missing'); return undefined; }
    let active = true;
    loadMaps(key).then((maps) => {
      if (!active || !mapNode.current) return;
      map.current = new maps.Map(mapNode.current, {
        center: { lat: -1.2921, lng: 36.8219 }, zoom: 11,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; markers.current.forEach((marker) => marker.setMap(null)); referenceMarkers.current.forEach((marker) => marker.setMap(null)); };
  }, [key]);

  useEffect(() => {
    if (!map.current || !window.google?.maps) return;
    markers.current.forEach((marker) => marker.setMap(null));
    const maps = window.google.maps;
    const bounds = new maps.LatLngBounds();
    const points = regions.filter((region) => region.centroidLat != null && region.centroidLng != null);
    const regionMarkers = points.map((region) => {
      const position = { lat: region.centroidLat, lng: region.centroidLng };
      bounds.extend(position);
      const marker = new maps.Marker({
        map: map.current, position, title: `${region.name}: ${number(region.propertyCount)} insured properties`,
        label: { text: String(region.propertyCount), color: '#fff', fontSize: '12px', fontWeight: '700' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: Math.min(34, 14 + Math.sqrt(region.propertyCount) * 2),
          fillColor: selectedRegion === region.name ? '#f97316' : regionScores[region.name] == null ? '#12395f' : floodColour(regionScores[region.name]), fillOpacity: 0.92,
          strokeColor: '#fff', strokeWeight: 2 }, zIndex: 5,
      });
      marker.addListener('click', () => onSelectRegion(region.name));
      return marker;
    });
    const assetMarkers = properties.filter((property) => (!selectedRegion || regionForProperty(property, regions[0]?.type) === selectedRegion) && property.latitude != null && property.longitude != null).map((property) => {
      const marker = new maps.Marker({ map: map.current,
        position: { lat: property.latitude, lng: property.longitude },
        title: `${property.name || property.id} · Nairobi ${tier} proxy: ${property.riskComparison?.referenceScore == null ? 'not available' : `${(property.riskComparison.referenceScore * 100).toFixed(0)}/100`}`,
        zIndex: 6, icon: { path: maps.SymbolPath.CIRCLE, scale: 5,
          fillColor: '#10b981', fillOpacity: 0.96, strokeColor: '#064e3b', strokeWeight: 1.4 } });
      marker.addListener('click', () => onSelectProperty(property));
      return marker;
    });
    markers.current = [...regionMarkers, ...assetMarkers];
    if (selectedRegion) {
      const selected = points.find((region) => region.name === selectedRegion);
      if (selected) { map.current.panTo({ lat: selected.centroidLat, lng: selected.centroidLng }); map.current.setZoom(13); }
    } else if (points.length > 1) map.current.fitBounds(bounds, 55);
    else if (points.length === 1) { map.current.panTo({ lat: points[0].centroidLat, lng: points[0].centroidLng }); map.current.setZoom(12); }
  }, [regions, properties, regionScores, tier, selectedRegion, onSelectRegion, onSelectProperty, status]);

  useEffect(() => {
    if (status !== 'ready' || !map.current || !window.google?.maps) return undefined;
    const maps = window.google.maps;
    referenceMarkers.current = [
      ...referencePoints.map((point) => {
        const score = Number(point.hazardScores?.[tier]);
        const marker = new maps.Marker({ map: map.current, position: { lat: point.latitude, lng: point.longitude },
          title: `Nairobi reference ${point.id} · ${tier} susceptibility: ${Number.isFinite(score) ? `${(score * 100).toFixed(0)}/100` : 'not available'}`,
          zIndex: 2, icon: { path: maps.SymbolPath.CIRCLE, scale: 3.5, fillColor: Number.isFinite(score) ? floodColour(score) : '#64748b',
            fillOpacity: 0.85, strokeColor: '#fff', strokeWeight: 0.6 } });
        marker.addListener('click', () => onSelectReference({ ...point, kind: 'reference' }));
        return marker;
      }),
      ...hotspots.map((hotspot) => {
        const marker = new maps.Marker({ map: map.current, position: { lat: hotspot.latitude, lng: hotspot.longitude },
          title: `Named flood hotspot: ${hotspot.name}`, zIndex: 4,
          icon: { path: 'M 0,-8 L 7,5 L -7,5 Z', fillColor: '#102e50', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 } });
        marker.addListener('click', () => onSelectReference({ ...hotspot, kind: 'hotspot' }));
        return marker;
      }),
    ];
    return () => { referenceMarkers.current.forEach((marker) => marker.setMap(null)); referenceMarkers.current = []; };
  }, [referencePoints, hotspots, tier, status, onSelectReference]);

  useEffect(() => {
    if (status !== 'ready' || !map.current || !window.google?.maps) return undefined;
    const maps = window.google.maps;
    floodCircles.current = floodOverlay.cells.map((cell) => new maps.Circle({
      map: map.current,
      center: { lat: cell.lat, lng: cell.lng },
      radius: 440,
      fillColor: floodColour(cell.score),
      fillOpacity: 0.32,
      strokeColor: floodColour(cell.score),
      strokeOpacity: 0.7,
      strokeWeight: 1,
      clickable: false,
      zIndex: 1,
    }));
    return () => {
      floodCircles.current.forEach((circle) => circle.setMap(null));
      floodCircles.current = [];
    };
  }, [floodOverlay, status]);

  return <div className="acc-map-wrap">
    <div ref={mapNode} className="acc-google-map" aria-label="Insured property regions and indicative flood-hazard scores on Google Maps" />
    {status !== 'ready' && <div className="acc-map-fallback"><MapPin size={25}/><strong>{status === 'missing' ? 'Google Maps key needed' : status === 'error' ? 'Google Maps is unavailable' : 'Loading Google Maps…'}</strong><span>{status === 'missing' ? 'Add VITE_GOOGLE_MAPS_API_KEY to the frontend environment.' : 'Regional counts remain available in the table.'}</span></div>}
    {status === 'ready' && !regions.some((region) => region.geocodedCount) && <div className="acc-map-empty">{referencePoints.length ? 'Nairobi reference layer shown · upload insured properties to compare.' : 'No mapped assets or reference scores yet.'}</div>}
    {status === 'ready' && <div className="acc-map-legend"><span><i className="region"/> Uploaded region count</span><span><i className="asset"/> Uploaded insured property</span><span><i className="hotspot"/> Named hotspot</span><span><i className="low"/> Low proxy</span><span><i className="moderate"/> Moderate</span><span><i className="high"/> High</span><span><i className="severe"/> Severe</span></div>}
  </div>;
}

export default function AccumulationScreen({ dataSources, onUploadFiles, attested, setAttested, embedded = false }) {
  const fileInput = useRef(null);
  const [reference, setReference] = useState({ points: [], hotspots: [], referenceUploadIds: [] });
  const [referenceLoad, setReferenceLoad] = useState({ status: 'loading', message: '' });
  const [uploadId, setUploadId] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(null);
  const [regions, setRegions] = useState([]);
  const [properties, setProperties] = useState([]);
  const [totalProperties, setTotalProperties] = useState(0);
  const [load, setLoad] = useState({ status: 'loading', message: '' });
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [selectedReference, setSelectedReference] = useState(null);
  const [tierIndex, setTierIndex] = useState(0);
  const [playing, setPlaying] = useState(() => typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const tableSources = useMemo(() => {
    if (referenceLoad.status !== 'ready') return [];
    const baseIds = new Set(reference.referenceUploadIds || []);
    return dataSources.filter((source) => ['csv', 'excel'].includes(source.upload.extractor) && !baseIds.has(source.id));
  }, [dataSources, reference.referenceUploadIds, referenceLoad.status]);
  const sourceState = tableSources.map((source) => `${source.id}:${source.status}`).join('|');
  const selectedSource = tableSources.find((source) => source.id === uploadId);
  const tier = FLOOD_TIERS[tierIndex];
  const floodOverlay = useMemo(() => buildFloodOverlay(reference.points, tier.id, null, 'neighbourhood'), [reference.points, tier.id]);
  const assessedProperties = useMemo(() => properties.map((property) => ({
    ...property, riskComparison: assessAgainstNairobiReference(property, reference.points, reference.hotspots, tier.id),
  })), [properties, reference.points, reference.hotspots, tier.id]);
  const regionScores = useMemo(() => {
    const groups = new Map();
    for (const property of assessedProperties) {
      const score = property.riskComparison?.referenceScore;
      if (score == null) continue;
      const key = regionForProperty(property, regions[0]?.type);
      const group = groups.get(key) || { sum: 0, count: 0 };
      group.sum += score; group.count += 1; groups.set(key, group);
    }
    return Object.fromEntries([...groups].map(([name, group]) => [name, group.sum / group.count]));
  }, [assessedProperties, regions]);
  const animationActive = playing && floodOverlay.scoredCount > 0;

  useEffect(() => {
    let active = true;
    apiGet('/locations/flood-reference').then((body) => {
      if (!active) return;
      setReference(body);
      setReferenceLoad({ status: 'ready', message: '' });
    }).catch((error) => { if (active) setReferenceLoad({ status: 'error', message: error.message }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!animationActive) return undefined;
    const timer = window.setInterval(() => setTierIndex((index) => (index + 1) % FLOOD_TIERS.length), 2200);
    return () => window.clearInterval(timer);
  }, [animationActive]);

  const selectRegion = useCallback((name) => { setSelectedRegion(name); setSelectedProperty(null); setSelectedReference(null); }, []);
  const selectReference = useCallback((point) => { setSelectedReference(point); setSelectedProperty(null); }, []);
  const selectProperty = useCallback((property) => { setSelectedProperty(property); setSelectedReference(null); }, []);

  useEffect(() => {
    let active = true;
    setLoad({ status: 'loading', message: '' });
    setRegions([]);
    setProperties([]);
    setTotalProperties(0);
    const filter = `&excludeReference=true${uploadId === 'all' ? '' : `&uploadId=${encodeURIComponent(uploadId)}`}`;
    Promise.all([
      apiGet(`/portfolios/${PORTFOLIO_ID}/clusters?type=neighbourhood${filter}`),
      loadAllProperties(filter),
    ]).then(([clusterBody, propertyBody]) => {
      if (!active) return;
      setRegions(clusterBody.items || []);
      setProperties(propertyBody.items || []);
      setTotalProperties(propertyBody.total || 0);
      setLoad({ status: 'ready', message: '' });
    }).catch((error) => { if (active) setLoad({ status: 'error', message: error.message }); });
    return () => { active = false; };
  }, [uploadId, sourceState]);

  const chooseSource = (id) => { setUploadId(id); setSelectedRegion(null); setSelectedProperty(null); setSelectedReference(null); };
  const upload = async (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    setUploading(true);
    setUploadMessage(null);
    try {
      const result = await onUploadFiles(files);
      if (result.added.length) chooseSource(result.added[0].id);
      setUploadMessage({ error: Boolean(result.errors?.length), text: result.errors?.length ? result.errors.map((item) => `${item.name}: ${item.message}`).join(' ') : `${result.added.length} dataset${result.added.length === 1 ? '' : 's'} uploaded. Region totals will update when processing finishes.` });
    } catch (error) { setUploadMessage({ error: true, text: error.message }); }
    finally { setUploading(false); event.target.value = ''; }
  };

  const total = regions.reduce((sum, region) => sum + region.propertyCount, 0);
  const tiv = regions.reduce((sum, region) => sum + region.insuredValueKes, 0);
  const geocoded = regions.reduce((sum, region) => sum + region.geocodedCount, 0);
  const unconfirmed = regions.reduce((sum, region) => sum + region.unconfirmedCount, 0);
  const highest = [...regions].sort((a, b) => b.propertyCount - a.propertyCount)[0];
  const activeRegion = regions.find((region) => region.name === selectedRegion);
  const regionProperties = selectedRegion ? assessedProperties.filter((property) => regionForProperty(property, regions[0]?.type) === selectedRegion) : [];
  const topClass = activeRegion ? Object.entries(activeRegion.classMix || {}).sort((a, b) => b[1] - a[1])[0] : null;
  const selectedAsset = assessedProperties.find((property) => property.id === selectedProperty?.id);
  const selectedAssessment = selectedAsset?.riskComparison;
  const highSusceptibility = assessedProperties.filter((property) => (property.riskComparison?.referenceScore ?? -1) >= 0.5).length;

  return <section className={`acc-screen${embedded ? ' acc-screen-embedded' : ''}`}>
    <header className="acc-header"><div><span>PORTFOLIO INTELLIGENCE</span><h2>{embedded ? 'Accumulation analysis' : 'Accumulation'}</h2><p>See how insured value and flood susceptibility are concentrated across the book.</p></div><div className="acc-source-select"><label htmlFor="acc-source">VIEW UPLOADED DATASET</label><select id="acc-source" value={uploadId} onChange={(event) => chooseSource(event.target.value)}><option value="all">All underwriter assets</option>{tableSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div></header>
    <div className="acc-upload"><div><FileSpreadsheet size={22}/><span><strong>Add an insured-assets dataset</strong><small>Upload a Nairobi CSV or Excel file with property ID, construction class, floor area, cost per m², insured value, and coordinates or an address for geocoding. Missing hazard scores are looked up from the fixed reference. <a href="/accumulation-template.csv" download>Download CSV template</a></small></span></div><div className="acc-upload-actions"><div className="acc-attestation"><span>Files contain only</span><button className={attested === 'synthetic' ? 'active' : ''} onClick={() => setAttested('synthetic')}>Synthetic</button><button className={attested === 'redacted' ? 'active' : ''} onClick={() => setAttested('redacted')}>Redacted</button></div><input ref={fileInput} type="file" multiple accept=".csv,.xlsx" onChange={upload} hidden/><button className="acc-upload-button" disabled={!attested || uploading} onClick={() => fileInput.current?.click()}><UploadCloud size={16}/>{uploading ? 'Uploading…' : 'Upload dataset'}</button></div></div>
    {uploadMessage && <div className={`acc-feedback ${uploadMessage.error ? 'error' : ''}`}>{uploadMessage.error ? <AlertTriangle size={15}/> : <CheckCircle2 size={15}/>}<span>{uploadMessage.text}</span></div>}
    {referenceLoad.status === 'error' && <div className="acc-feedback error"><AlertTriangle size={15}/><span>Nairobi reference layer could not load: {referenceLoad.message}. Uploaded assets can still be listed, but their reference comparison is unavailable.</span></div>}
    {referenceLoad.status === 'ready' && !reference.points.length && <div className="acc-feedback error"><AlertTriangle size={15}/><span>No Nairobi susceptibility reference is loaded yet. Run <code>flask --app run.py seed-reference</code> with the supplied exposure and hotspot CSVs before comparing uploaded assets.</span></div>}
    {selectedSource?.processing && <div className="acc-feedback"><FileSpreadsheet size={15}/><span>{selectedSource.name} is still processing. Counts will appear when its rows are available.</span></div>}
    {load.status === 'error' && <div className="acc-feedback error"><AlertTriangle size={15}/><span>Insured assets could not be loaded: {load.message}. The Nairobi reference map remains available.</span></div>}
    <>
      <div className="acc-kpis"><article><span>INSURED PROPERTIES</span><strong>{load.status === 'ready' ? number(total) : load.status === 'error' ? '—' : '…'}</strong><small>Across {number(regions.length)} uploaded regions</small></article><article><span>TOTAL INSURED VALUE</span><strong>{load.status === 'ready' ? money(tiv) : load.status === 'error' ? '—' : '…'}</strong><small>{total ? `${money(tiv / total)} average per property` : 'No underwriter exposure loaded yet'}</small></article><article><span>LARGEST REGION BY COUNT</span><strong>{highest?.name || '—'}</strong><small>{highest ? `${number(highest.propertyCount)} insured properties` : 'Upload a dataset to compare regions'}</small></article><article><span>HIGHER REFERENCE SUSCEPTIBILITY</span><strong>{reference.points.length ? number(highSusceptibility) : '—'}</strong><small>Uploaded assets at proxy score ≥ 0.50 in this scenario</small></article></div>
      <div className="acc-layout"><div className="acc-map-card">
        <div className="acc-card-head"><div><MapPin size={17}/><span><strong>Nairobi reference + insured assets</strong><small>{number(reference.pointCount ?? reference.points.length)} scored base locations · {number(reference.hotspotCount ?? reference.hotspots.length)} named hotspots</small></span></div><em>{number(geocoded)} uploaded assets mapped · {number(total - geocoded)} without coordinates</em></div>
        <div className="acc-flood-controls">
          <div className="acc-flood-heading"><strong>Reference susceptibility scenario</strong><small>Model assumption: 1-in-{tier.years}-year tier · not a measured flood probability</small></div>
          <div className="acc-flood-timeline" role="group" aria-label="Flood return-period scenario">
            {FLOOD_TIERS.map((item, index) => <button type="button" key={item.id} className={tierIndex === index ? 'active' : ''} aria-pressed={tierIndex === index} onClick={() => { setTierIndex(index); setPlaying(false); }}><span>1 in {item.years}</span><small>{item.id} tier</small></button>)}
            <button type="button" className="acc-flood-play" onClick={() => setPlaying((value) => !value)} disabled={!floodOverlay.scoredCount} aria-label={animationActive ? 'Pause flood scenario animation' : 'Play flood scenario animation'}>{animationActive ? <Pause size={15}/> : <Play size={15}/>}<span>{animationActive ? 'Pause' : 'Play'}</span></button>
          </div>
        </div>
        <AccumulationMap regions={regions} properties={assessedProperties} referencePoints={reference.points} hotspots={reference.hotspots} regionScores={regionScores} tier={tier.id} floodOverlay={floodOverlay} selectedRegion={selectedRegion} onSelectRegion={selectRegion} onSelectProperty={selectProperty} onSelectReference={selectReference}/>
        <div className="acc-flood-readout"><strong>{floodOverlay.scoredCount ? `${number(floodOverlay.scoredCount)} Nairobi reference locations scored · ${number(highSusceptibility)} uploaded assets at higher susceptibility (≥0.50) in this tier.` : 'Nairobi flood-reference scores are not loaded yet.'}</strong><span>The coloured circles and small dots represent the synthetic reference's 0–1 susceptibility scores. Green pins are the underwriter's insured properties; dark triangles are named hotspots. These are not mapped flood boundaries, measured depths, or calibrated probabilities. {floodOverlay.mappedCount > floodOverlay.scoredCount && `${number(floodOverlay.mappedCount - floodOverlay.scoredCount)} reference locations have no score in this tier.`}</span></div>
        {totalProperties > properties.length && <p className="acc-map-note">Loading or displaying {number(properties.length)} of {number(totalProperties)} uploaded properties. Regional totals include all records.</p>}
      </div>
        <div className="acc-region-card"><div className="acc-card-head"><div><Building2 size={17}/><span><strong>Regional breakdown</strong><small>Counts and values include every uploaded property</small></span></div></div><div className="acc-region-list">{regions.length ? regions.map((region) => <button key={region.id} className={selectedRegion === region.name ? 'active' : ''} onClick={() => selectRegion(region.name)}><span><strong>{region.name}</strong><small>{money(region.insuredValueKes)} · {((region.tivShare || 0) * 100).toFixed(1)}% of selected exposure</small></span><em>{number(region.propertyCount)}<small>properties</small></em></button>) : <div className="acc-empty">{load.status === 'loading' ? 'Loading regions…' : selectedSource && !selectedSource.processing ? 'No insured properties were added from this file. Check its rows and issues in Data store.' : 'No insured properties yet. Upload a CSV or Excel dataset above.'}</div>}</div></div></div>
      <div className="acc-insights">
        <div className="acc-card-head"><div><Building2 size={17}/><span><strong>{activeRegion ? `${activeRegion.name} insights` : 'Portfolio insights'}</strong><small>{activeRegion ? 'Regional underwriting detail' : 'Select a region to explore its assets'}</small></span></div>{activeRegion && <button onClick={() => selectRegion(null)}>Clear region</button>}</div>
        {activeRegion ? <>
          <div className="acc-insight-grid"><div><span>INSURED PROPERTIES</span><strong>{number(activeRegion.propertyCount)}</strong></div><div><span>INSURED VALUE</span><strong>{money(activeRegion.insuredValueKes)}</strong></div><div><span>MAPPED ASSETS</span><strong>{number(activeRegion.geocodedCount)}</strong></div><div><span>NEED REVIEW</span><strong>{number(activeRegion.unconfirmedCount)}</strong></div><div><span>AVERAGE VALUE</span><strong>{money(activeRegion.insuredValueKes / activeRegion.propertyCount)}</strong></div><div><span>LEADING CONSTRUCTION</span><strong>{topClass ? classNames[topClass[0]] || topClass[0] : '—'}</strong></div></div>
          <div className="acc-region-risk"><strong>{regionScores[activeRegion.name] == null ? 'Nairobi reference score: unavailable for this region' : `Mean Nairobi reference susceptibility: ${(regionScores[activeRegion.name] * 100).toFixed(0)}/100`}</strong><span>Average reference proxy at this region's mapped insured properties for the selected 1-in-{tier.years} tier. This is not a measured flood probability or a legal flood zone.</span></div>
          <div className="acc-property-list"><strong>Properties in {activeRegion.name}</strong>{regionProperties.map((property) => <button key={property.id} onClick={() => selectProperty(property)}><span>{property.name || property.id}<small>{property.id} · {property.reviewStatus === 'confirmed' ? 'Confirmed' : 'Needs review'} · Nairobi proxy {property.riskComparison?.referenceScore == null ? 'n/a' : `${(property.riskComparison.referenceScore * 100).toFixed(0)}/100`}</small></span><em>{money(property.insuredValueKes)}</em></button>)}</div>
        </> : <div className="acc-overview"><p>{number(unconfirmed)} uploaded properties need review; {number(total - geocoded)} have no map coordinates. The highest insured-value region is <strong>{regions[0]?.name || 'not available'}</strong>.</p><p>The Nairobi susceptibility reference stays on the map while you switch uploaded portfolios. Coloured region counts and green asset pins show the selected underwriter exposure.</p></div>}
        {selectedProperty && <div className="acc-selected-property"><span>SELECTED INSURED PROPERTY</span><strong>{selectedProperty.name || selectedProperty.id}</strong><small>{selectedProperty.id} · {selectedProperty.region || 'Unassigned'} · {money(selectedProperty.insuredValueKes)}</small><small>Nairobi reference proxy, 1-in-{tier.years} tier: {selectedAssessment?.referenceScore == null ? 'not available' : `${(selectedAssessment.referenceScore * 100).toFixed(0)}/100`}</small><small>Property's uploaded or enriched score: {selectedAssessment?.sourceScore == null ? 'not available' : `${(selectedAssessment.sourceScore * 100).toFixed(0)}/100`} ({selectedProperty.hazardSource || 'source unknown'})</small><small>Nearest named hotspot: {selectedAssessment?.nearestHotspot ? `${selectedAssessment.nearestHotspot.name} · ${selectedAssessment.nearestHotspot.km.toFixed(2)} km away` : 'not available'}</small>{selectedAssessment?.approximate && <small className="acc-approx-warning">Nearest scored reference is {selectedAssessment.nearestReferenceKm.toFixed(2)} km away; treat this location estimate as approximate.</small>}<button onClick={() => setSelectedProperty(null)}>Close</button></div>}
        {selectedReference && <div className="acc-selected-property reference"><span>{selectedReference.kind === 'hotspot' ? 'NAMED FLOOD HOTSPOT' : 'NAIROBI SUSCEPTIBILITY REFERENCE'}</span><strong>{selectedReference.name || selectedReference.id}</strong><small>{Number(selectedReference.latitude).toFixed(5)}, {Number(selectedReference.longitude).toFixed(5)}</small>{selectedReference.kind === 'reference' && <small>1-in-{tier.years} tier proxy: {selectedReference.hazardScores?.[tier.id] == null ? 'not available' : `${(Number(selectedReference.hazardScores[tier.id]) * 100).toFixed(0)}/100`}</small>}<button onClick={() => setSelectedReference(null)}>Close</button></div>}
      </div>
    </>
  </section>;
}

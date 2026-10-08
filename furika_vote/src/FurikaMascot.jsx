import React, { useId } from 'react';

// "Furi", the Furika Bot mascot: a friendly flood-water drop in Kenya Re navy with a red wave scarf.
export default function FurikaMascot({ size = 32, animated = false, title = 'Furika Bot', className = '' }) {
  const id = useId().replace(/:/g, '');
  return <svg className={`furika-mascot ${animated ? 'animated' : ''} ${className}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
    <defs>
      <linearGradient id={`${id}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#2a78d6"/>
        <stop offset="0.55" stopColor="#0d366b"/>
        <stop offset="1" stopColor="#041d3b"/>
      </linearGradient>
    </defs>
    <g className="mascot-body">
      <path d="M32 4 C32 4 12 26 12 40 a20 20 0 0 0 40 0 C52 26 32 4 32 4 Z" fill={`url(#${id}-body)`}/>
      <path d="M22 26 C24 20 28 15 31 11" stroke="#ffffff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <g className="mascot-eyes">
        <ellipse cx="25" cy="38" rx="4.6" ry="5.4" fill="#fff"/>
        <ellipse cx="39" cy="38" rx="4.6" ry="5.4" fill="#fff"/>
        <circle cx="26" cy="39" r="2.4" fill="#041d3b"/>
        <circle cx="40" cy="39" r="2.4" fill="#041d3b"/>
        <circle cx="26.9" cy="37.9" r=".8" fill="#fff"/>
        <circle cx="40.9" cy="37.9" r=".8" fill="#fff"/>
      </g>
      <circle cx="20.5" cy="45" r="2.4" fill="#f3a1b6" opacity=".75"/>
      <circle cx="43.5" cy="45" r="2.4" fill="#f3a1b6" opacity=".75"/>
      <path d="M28 46 q4 3.6 8 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M14.5 51 q4.4 -3 8.8 0 t8.8 0 t8.8 0 t8.6 0 v3.2 q-4.3 2.8 -8.6 0 t-8.8 0 t-8.8 0 t-8.8 0 Z" fill="#d11242"/>
    </g>
  </svg>;
}

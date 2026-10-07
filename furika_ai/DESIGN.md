---
name: Furika AI
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3e484d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#6e797e'
  outline-variant: '#bdc8ce'
  surface-tint: '#006780'
  primary: '#00647c'
  on-primary: '#ffffff'
  primary-container: '#007f9d'
  on-primary-container: '#fafdff'
  inverse-primary: '#6cd3f7'
  secondary: '#006781'
  on-secondary: '#ffffff'
  secondary-container: '#8fdfff'
  on-secondary-container: '#00647d'
  tertiary: '#1d637a'
  on-tertiary: '#ffffff'
  tertiary-container: '#3c7c94'
  on-tertiary-container: '#fafdff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b7eaff'
  primary-fixed-dim: '#6cd3f7'
  on-primary-fixed: '#001f28'
  on-primary-fixed-variant: '#004e61'
  secondary-fixed: '#b9eaff'
  secondary-fixed-dim: '#81d1f0'
  on-secondary-fixed: '#001f29'
  on-secondary-fixed-variant: '#004d62'
  tertiary-fixed: '#baeaff'
  tertiary-fixed-dim: '#91cfea'
  on-tertiary-fixed: '#001f29'
  on-tertiary-fixed-variant: '#004d62'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  metric-display:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system targets urban hydrologists, catastrophe risk modelers, municipal disaster management authorities, and reinsurance underwriters managing flood risk across the Nairobi metropolitan basin.

The aesthetic fuses high-precision geospatial telemetry with clean, mission-critical climate-tech instrumentation. It avoids sensationalist disaster styling in favor of operational clarity, high information density, and instant legibility under high-stress emergency response conditions.

Key visual attributes:
- **Atmospheric Precision**: Structural, clean surfaces with crisp hairline delineation, avoiding decorative clutter.
- **Scientific Authoritativeness**: Tabular, data-dense layouts paired with clear geospatial visual hierarchy.
- **Decisive Risk Semantics**: Strict, universal chromatic hierarchy for rapid hydrological risk assessment and loss exposure calculation.

## Colors

The palette establishes an analytical balance between clear white/slate operational surfaces, deep equatorial teal accents, and calibrated 5-tier hydrological risk indicators.

### Surface and Structure
- **Canvas Base**: `#FFFFFF` for primary work surfaces, inspector panels, and data cards.
- **Application Ground**: `#F8FAFC` (Slate 50) for canvas backgrounds, split-view layout gutters, and map underlays.
- **Surface Dim / Secondary**: `#F1F5F9` (Slate 100) for control bars, inactive map dock panels, and table headers.
- **Hairline Borders**: `#E2E8F0` (Slate 200) for structural division lines and metric bounding boxes.

### Brand & Interface Primaries
- **Teal Focus (Primary)**: `#0891B2` (Cyan 600) for interactive states, primary action triggers, and active vector layers.
- **Deep Nairobi Teal (Secondary)**: `#0E7490` (Cyan 700) for persistent navigation states, analytical filters, and focused map extents.
- **Basin Deep (Tertiary)**: `#155E75` (Cyan 800) for high-emphasis headlines, active tab bars, and structural callouts.

### Risk Tier Palette (Hydrological & Loss Semantics)
- **Common (Low Risk / Routine Inundation)**: `#38BDF8` (Sky 400) — Low vulnerability, minor surface runoff.
- **Occasional (Moderate-Low / 5-10 Year Return)**: `#10B981` (Emerald 500) — Managed drainage channels, localized pooling.
- **Moderate (Medium / 20-Year Return)**: `#F59E0B` (Amber 500) — Riverine overtop warnings, alert thresholds breached.
- **Severe (High / 50-Year Return)**: `#EA580C` (Orange 600) — Major structural threat, business interruption, critical infrastructure inundation.
- **Extreme (Catastrophic / 100+ Year Return)**: `#E11D48` (Rose 600) — Life safety hazard, total asset exposure, evacuation imperative.

### Text & Telemetry Contrast
- **Text Primary**: `#0F172A` (Slate 900) for critical metrics, primary readings, and table cells.
- **Text Secondary**: `#475569` (Slate 600) for operational labels, coordinates, and supporting metadata.
- **Text Muted**: `#94A3B8` (Slate 400) for inactive states, units of measure, and timestamps.

## Typography

Typography prioritizes structural clarity and numeric alignment across complex risk dashboards and maps:

- **Primary Interface (Inter)**: Handles all structural text, interface labels, headers, and contextual analytical summaries. Strict tracking parameters are applied to keep headings tight and authoritative.
- **Analytical Telemetry (JetBrains Mono)**: Applied to all exposure loss currency values (e.g., KES, USD), hydrological metrics (m³/s discharge, rainfall mm/h, return periods), coordinates (WGS84 / UTM), and geospatial layer toggles.
- **Tabular Figures**: All numerical listings in tables and telemetry badges must enforce monospace font settings (`font-variant-numeric: tabular-nums`) to ensure zero-jitter dynamic updates during live rainfall simulations.

## Layout & Spacing

The layout is built around a hybrid workspace: a responsive full-viewport GIS canvas combined with collapsible analytical side panels and floating floating control islands.

### Workspace Structure
- **Desktop (>= 1280px)**: 3-column split view consisting of a fixed 64px global tool rail, an expandable 360px Layer & Scenario panel, an edge-to-edge geospatial viewport, and a 420px contextual Loss Analytics Inspector.
- **Tablet (768px - 1279px)**: Full GIS viewport with a bottom dock drawer for loss estimations and a slide-over modal for hydrological filters.
- **Mobile (< 768px)**: Stacked viewport with a 50vh top interactive map pane and a vertical scrolling risk assessment stream below.

### Density & Rhythms
A base unit of 4px (`0.25rem`) governs all internal component spacing to maintain the high-density requirements of engineering and modeling software. Data grids and parameter inputs use compact `space-xs` and `space-sm` increments, while operational workspace panels use `space-lg` to separate distinct analytical cards.

## Elevation & Depth

Visual hierarchy uses flat tonal layering reinforced by ultra-fine hairline containment, rather than heavy drop shadows. This maintains crisp geometric lines over high-resolution satellite, elevation (DEM), and hydrological vector overlays.

- **Level 0 (Map & Canvas Surface)**: Raw map viewport and canvas backplates. Flat, no borders.
- **Level 1 (Docked Structural Panels)**: Fixed inspection panels, side drawers, and top metric bars. Rendered in `#FFFFFF` with a 1px border (`#E2E8F0`) and zero elevation shadow.
- **Level 2 (Floating Map Controls & Popovers)**: Zoom controls, layer overlays, scenario selectors, and basin pickers. Rendered in `#FFFFFF` with a 1px border (`#E2E8F0`) and subtle ambient shadow: `box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.08), 0 1px 4px -1px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Emergency Alerts & Critical Modals)**: Basin breach notifications, catastrophic scenario run configurations, and PDF report generators. Elevated using `box-shadow: 0 12px 24px -6px rgba(15, 23, 42, 0.12), 0 4px 8px -2px rgba(15, 23, 42, 0.04)` with a 1px border (`#CBD5E1`).

## Shapes

The design system uses a soft, disciplined geometry (Level 1):

- **Default Form Controls & Cards**: `rounded` (0.25rem / 4px). Creates sharp, engineered edges suitable for tabular dashboards and tight parameter grids.
- **Analytical Badges & Pills**: `rounded-sm` (0.125rem / 2px) to preserve tabular vertical alignment without wasteful circular padding.
- **Floating Overlays & Panels**: `rounded-md` (0.375rem / 6px) to slightly soften exterior application frames without sacrificing spatial density.
- **Circular Utilities**: Limited strictly to map node radius icons, user presence indicators, and live status beacon dots.

## Components

### Buttons & Interactive Controls
- **Primary Action (Run Simulation / Export Loss Model)**: Background `#0891B2`, text `#FFFFFF`, font Inter SemiBold (13px), height 32px, padding `0 12px`, border-radius 4px. Hover: `#0E7490`. Active: `#155E75`.
- **Secondary (Telemetry Toggles / Layer Filters)**: Background `#FFFFFF`, text `#0F172A`, 1px border `#CBD5E1`. Hover: `#F8FAFC` and border `#94A3B8`.
- **Destructive / High Alert Action**: Background `#E11D48`, text `#FFFFFF`. Hover: `#BE123C`.

### Risk Tier Status Pills
Compact, non-pill-shaped rectangular tags (JetBrains Mono 11px, weight 500, height 20px, padding `0 6px`, border-radius 2px):
- **Common**: Background `#F0F9FF`, border `#BAE6FD`, text `#0284C7`.
- **Occasional**: Background `#ECFDF5`, border `#A7F3D0`, text `#059669`.
- **Moderate**: Background `#FFFBEB`, border `#FDE68A`, text `#D97706`.
- **Severe**: Background `#FFF7ED`, border `#FED7AA`, text `#C2410C`.
- **Extreme**: Background `#FFF1F2`, border `#FECDD3`, text `#BE123C`.

### Catastrophe Modeling Cards & Exposure Metrics
- Built on `#FFFFFF` surfaces with a 1px border `#E2E8F0` and 4px corner radius.
- Cards feature a structural 28px header row containing the asset/sub-county name (e.g., "Kibera Basin - Zone 4") in Inter 12px Bold uppercase, accompanied by a 6px status dot matching the active risk tier.
- Numerical value blocks display total exposed asset values using JetBrains Mono 20px/Bold, accompanied by small unit descriptors (e.g., `KES 1.42B` / `PML 90%`).

### Map Controls & GIS Toolbars
- Stacked square control clusters (32x32px per tool button) grouped inside `#FFFFFF` panels with 1px `#E2E8F0` borders.
- Active layer icons switch from slate text `#64748B` to `#0891B2` with a subtle `#F0FDFA` background fill.
- Coordinates Bar: Fixed bottom map strip rendered in JetBrains Mono 11px (`lat: -1.2921, lon: 36.8219 | DEM: 1680m ASL | Rainfall: +42mm/h`).

### Input Fields & Parameter Sliders
- Input fields use 32px standard height, `#FFFFFF` background, 1px border `#CBD5E1`, text `#0F172A`, and focus ring of 1px `#0891B2`.
- Hydrological return-period slider controls (1-in-10yr to 1-in-100yr) use a 4px slate-200 track, `#0891B2` active fill, and a crisp 12px rectangular slider handle.

### Tabular Loss Grids
- Ultra-dense row height (28px for compact view, 36px for expanded view).
- Column headers: Inter 11px uppercase, tracking `0.05em`, color `#64748B`, background `#F8FAFC`.
- Numeric data columns: JetBrains Mono 12px, tabular numbers, aligned flush-right.
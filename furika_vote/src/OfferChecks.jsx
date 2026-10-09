import React from 'react';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import './offer-checks.css';

export default function OfferChecks({ report }) {
  if (!report?.stages?.length) return null;
  const complete = report.stages.filter((stage) => stage.status === 'complete').length;
  const attention = report.stages.filter((stage) => ['warning', 'blocked'].includes(stage.status)).length;
  return <section className="offer-checks chat-offer-summary" aria-label="Placement offer check summary">
    <ShieldCheck size={22}/><div><strong>Offer checks are ready</strong><span><Check size={13}/>{complete} complete <AlertTriangle size={13}/>{attention} need attention</span><small>Underwriter review is still required.</small></div>
  </section>;
}

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services import furika_model as fm

FIXTURE = Path(__file__).parent / "fixtures" / "reference_sample.csv"
TERMS = {"deductible_pct_tiv": 0.01, "limit_pct_tiv": 0.5, "quota_share_ceded": 0.25, "cat_xl_attachment_kes": 100.0, "cat_xl_limit_kes": 200.0}


def test_policy_terms_apply_deductible_then_limit_per_building():
    losses = pd.DataFrame({"tiv_kes": [1000.0, 1000.0, 1000.0], "loss_kes": [5.0, 300.0, 900.0]})
    out = fm.apply_policy_terms(losses, TERMS)
    # Deductible 10: below it the owner keeps everything; limit 500 caps the third building.
    assert out["gross_kes"].tolist() == [0.0, 290.0, 500.0]
    assert out["retained_by_owner_kes"].tolist() == [5.0, 10.0, 10.0]
    assert out["above_limit_kes"].tolist() == [0.0, 0.0, 390.0]
    assert np.allclose(out["gross_kes"] + out["retained_by_owner_kes"] + out["above_limit_kes"], losses["loss_kes"])


def test_reinsurance_takes_quota_share_first_then_cat_xl_on_what_is_kept():
    layers = fm.apply_reinsurance([80.0, 400.0, 1000.0], TERMS)
    # Retained after 25% QS: 60, 300, 750. XL 200 xs 100 pays 0, 200 (capped), 200 (capped).
    assert layers["quota_share_kes"].tolist() == [20.0, 100.0, 250.0]
    assert layers["cat_xl_kes"].tolist() == [0.0, 200.0, 200.0]
    assert layers["net_kes"].tolist() == [60.0, 100.0, 550.0]


def test_cat_xl_layer_defaults_scale_with_portfolio_value():
    terms = fm.resolve_financial_terms(None, 1e9)
    assert terms["cat_xl_attachment_kes"] == pytest.approx(5e6)
    assert terms["cat_xl_limit_kes"] == pytest.approx(2e7)
    with pytest.raises(ValueError):
        fm.resolve_financial_terms({"quota_share_ceded": 1.5}, 1e9)


def test_run_model_reports_ground_up_gross_and_net_curves():
    exposure = pd.read_csv(FIXTURE).drop(columns=["name", "region"])
    exposure["synthetic"] = True
    result = fm.run_model(exposure)
    tiers = result["tier_losses"]
    assert (tiers["gross_kes"] <= tiers["loss_kes"] + 1e-6).all()
    assert np.allclose(tiers["net_kes"] + tiers["quota_share_kes"] + tiers["cat_xl_kes"], tiers["gross_kes"])
    aal = result["financial"]["aal"]
    assert aal["net"]["aal_central"] <= aal["gross"]["aal_central"] <= aal["ground_up"]["aal_central"]
    assert aal["ground_up"]["aal_central"] == pytest.approx(result["aal"]["aal_central"])

"""Run with: python test_furika.py (no API key required)."""

from io import StringIO
from pathlib import Path
import tempfile

import pandas as pd

import furika_model as fm
from furika_resolver import DataResolver, NeedInput, Pipeline, build_steps


ROWS = """loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,tiv_kes,hazard_score_common,hazard_score_occasional,hazard_score_moderate,hazard_score_severe,hazard_score_extreme
NBO-0002,-1.2576,36.8962,semi_permanent,33,10000,3300000,0.458406,0.407297,0.345205,0.247281,0.134603
NBO-0005,-1.2023,36.93068,informal_iron_sheet,16,9800,1570000,0.669771,0.638609,0.600749,0.541041,0.472337
NBO-0009,-1.33795,36.75613,permanent_masonry,77,55800,42965000,0,0,0,0,0
"""


class FakeLLM:
    """Scripted model used to verify AI-assisted resolution offline."""

    def __init__(self, bad_quote=False):
        self.calls = 0
        self.bad_quote = bad_quote

    def json(self, _system, prompt):
        self.calls += 1
        if "Required columns" in prompt:
            mapping = {
                "loc_id": "building_id",
                "lat": "latitude",
                "lon": "longitude",
                "housing_class": "type",
                "floor_area_m2": "area",
                "cost_per_m2_kes": "cost_sqm",
                "tiv_kes": "value",
                **{f"hazard_score_{tier}": f"h_{tier}" for tier in fm.TIERS},
            }
            return {"mapping": mapping, "confidence": 0.93}
        if "tier_rp" in prompt:
            quote = "not present in the source" if self.bad_quote else "extreme=5 years"
            return {
                "found": True,
                "value": {"extreme": 5, "severe": 20, "moderate": 50, "occasional": 100, "common": 250},
                "quote": quote,
                "confidence": 0.9,
            }
        return {"found": False}


def test_core_math():
    exposure = pd.read_csv(StringIO(ROWS))
    clean, issues = fm.validate_exposure(exposure)
    assert any("10.00x" in issue for issue in issues)
    result = fm.run_model(clean)
    assert result["tier_losses"]["loss_kes"].is_monotonic_increasing
    assert not result["monotonic_violations"]
    assert result["aal"]["aal_low"] <= result["aal"]["aal_central"] <= result["aal"]["aal_high"]
    sample = result["losses"].query("loc_id == 'NBO-0002' and tier == 'common'").iloc[0]
    assert abs(sample.damage_ratio - 0.81) < 0.01
    assert abs(sample.loss_kes - 2.67e6) < 0.03e6


def test_resolver_and_human_input():
    with tempfile.TemporaryDirectory() as directory:
        resolver = DataResolver(FakeLLM(), directory)
        need = Pipeline(build_steps(), resolver).run()
        assert isinstance(need, NeedInput)
        assert need.questions[0].name == "exposure"

        source = pd.read_csv(StringIO(ROWS)).rename(
            columns={
                "loc_id": "building_id",
                "lat": "latitude",
                "lon": "longitude",
                "housing_class": "type",
                "floor_area_m2": "area",
                "cost_per_m2_kes": "cost_sqm",
                "tiv_kes": "value",
                **{f"hazard_score_{tier}": f"h_{tier}" for tier in fm.TIERS},
            }
        )
        source.to_csv(Path(directory) / "portfolio.csv", index=False)
        (Path(directory) / "notes.txt").write_text(
            "Team note: extreme=5 years, severe=20, moderate=50, occasional=100, common=250.",
            encoding="utf-8",
        )
        pipeline = Pipeline(build_steps(), DataResolver(FakeLLM(), directory))
        result = pipeline.run()
        provenance = pipeline.provenance_report().set_index("input")
        assert result["depths"].rp.min() == 5
        assert provenance.loc["exposure", "provenance"] == "ai_mapped"
        assert provenance.loc["tier_rp", "provenance"] == "ai_extracted"


def test_hallucinated_quote_is_rejected():
    with tempfile.TemporaryDirectory() as directory:
        exposure = pd.read_csv(StringIO(ROWS))
        exposure.to_csv(Path(directory) / "exposure.csv", index=False)
        (Path(directory) / "notes.txt").write_text("extreme=5 years", encoding="utf-8")
        pipeline = Pipeline(build_steps(), DataResolver(FakeLLM(bad_quote=True), directory))
        pipeline.run()
        provenance = pipeline.provenance_report().set_index("input")
        assert provenance.loc["tier_rp", "provenance"] == "assumed"


if __name__ == "__main__":
    test_core_math()
    test_resolver_and_human_input()
    test_hallucinated_quote_is_rejected()
    print("ALL TESTS PASSED")

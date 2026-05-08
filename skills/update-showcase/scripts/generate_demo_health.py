#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Regenerate Demo Person's Apple Health fixture in v7 shape.

The persisted demo fixture drifted to an older schema (workouts-as-object,
missing `numeric`/`category` buckets on dailies). This script produces a
fresh `AppleHealthSummary` for `person-demo/export.zip` with 90 days of
fabricated-but-realistic data covering every HK metric the snapshot
computer reads.

It preserves everything else in `.docvault-health.json` (other people,
clinical, illness notes) and clears the cached snapshot so the backend
recomputes from scratch on first GET.

Runs standalone or as a pre-capture step from the update-showcase skill.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

PERSON_ID = "person-demo"
PERSON_NAME = "Demo Person"
EXPORT_FILENAME = "export.zip"
SUMMARY_KEY = f"{PERSON_ID}/{EXPORT_FILENAME}"

# Parser + HealthStore schema version that this file targets. Must stay
# in sync with PARSER_VERSION in server/parsers/apple-health.ts and the
# HealthStore `version` in server/routes/health.ts.
PARSER_VERSION = "1.2.0"
STORE_VERSION = 1
SNAPSHOT_SCHEMA_VERSION = 7  # for reference only; we leave snapshot empty

# Deterministic seed so re-runs produce identical screenshots.
RNG_SEED = 42

# Metrics the snapshot computer reads. Keys are stripped
# HKQuantityTypeIdentifier / HKCategoryTypeIdentifier names.
NUMERIC_TYPES = [
    "StepCount",
    "ActiveEnergyBurned",
    "BasalEnergyBurned",
    "AppleExerciseTime",
    "AppleStandHour",
    "DistanceWalkingRunning",
    "DistanceCycling",
    "FlightsClimbed",
    "RestingHeartRate",
    "HeartRate",
    "HeartRateVariabilitySDNN",
    "WalkingHeartRateAverage",
    "HeartRateRecoveryOneMinute",
    "RespiratoryRate",
    "AppleSleepingWristTemperature",
    "BodyMass",
    "Height",
    "OxygenSaturation",
]
CATEGORY_TYPES = ["SleepAnalysis"]

WORKOUT_TYPES = ["Running", "Cycling", "FunctionalStrengthTraining", "Walking"]


@dataclass
class DayParams:
    """Per-day random draws shared across metrics so totals stay coherent."""

    steps: int
    active_kcal: float
    exercise_min: int
    stand_hours: int
    distance_km: float
    resting_hr: float
    avg_hr: float
    hrv_ms: float
    walking_hr: float
    recovery_hr: float
    respiratory: float
    wrist_temp: float
    weight_kg: float
    height_cm: float
    spo2: float
    sleep_min: float
    # Sleep phase minutes
    core: float
    deep: float
    rem: float
    awake: float
    in_bed: float


def draw_day(rng: random.Random, day: date, baseline_weight_kg: float) -> DayParams:
    """Draw one day's metric baselines. Weekends get more sleep, fewer steps."""
    weekend = day.weekday() >= 5
    steps = int(rng.gauss(9500 if not weekend else 6500, 1800))
    steps = max(2000, steps)
    active_kcal = round(steps * rng.uniform(0.045, 0.055), 0)  # ~0.05 kcal/step
    exercise_min = max(0, int(rng.gauss(35 if not weekend else 20, 15)))
    stand_hours = min(14, max(6, int(rng.gauss(11, 2))))
    distance_km = round(steps * rng.uniform(0.0007, 0.00075), 2)
    resting_hr = round(rng.gauss(58, 2.5), 1)
    avg_hr = round(rng.gauss(72, 4), 1)
    hrv_ms = round(rng.gauss(45, 8), 1)
    walking_hr = round(rng.gauss(98, 6), 1)
    recovery_hr = round(rng.gauss(32, 4), 1)  # HR drop 1 min post-exercise
    respiratory = round(rng.gauss(15.5, 0.8), 1)
    wrist_temp = round(rng.gauss(36.1, 0.15), 2)
    # Slow linear weight drift downward over 90 days: ~1 kg loss
    drift = (day.toordinal() - date.today().toordinal()) / 90.0  # -1 .. 0
    weight_kg = round(baseline_weight_kg + drift + rng.gauss(0, 0.25), 2)
    height_cm = 178.0
    spo2 = round(rng.uniform(0.96, 0.99), 3)
    sleep_min = round(rng.gauss(445 if weekend else 420, 35), 0)  # ~7-7.5 h
    # Split into phases: core ~55%, deep ~18%, rem ~22%, awake ~5%
    core = round(sleep_min * rng.uniform(0.50, 0.58), 0)
    deep = round(sleep_min * rng.uniform(0.15, 0.22), 0)
    rem = round(sleep_min * rng.uniform(0.18, 0.24), 0)
    awake = round(sleep_min * rng.uniform(0.03, 0.08), 0)
    in_bed = sleep_min + awake + round(rng.uniform(5, 20), 0)
    return DayParams(
        steps, active_kcal, exercise_min, stand_hours, distance_km,
        resting_hr, avg_hr, hrv_ms, walking_hr, recovery_hr,
        respiratory, wrist_temp, weight_kg, height_cm, spo2,
        sleep_min, core, deep, rem, awake, in_bed,
    )


def numeric_agg(count: int, values: list[float], unit: str) -> dict[str, Any]:
    """Build a NumericAggregate matching the parser's shape."""
    if not values:
        return {"count": 0, "sum": 0, "min": 0, "max": 0, "first": 0, "last": 0, "unit": unit}
    total = sum(values)
    return {
        "count": count,
        "sum": round(total, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
        "first": round(values[0], 4),
        "last": round(values[-1], 4),
        "unit": unit,
    }


def single_numeric(value: float, unit: str, count: int = 1) -> dict[str, Any]:
    """Aggregate representing a single measurement (or daily total)."""
    return {
        "count": count,
        "sum": round(value * count, 4) if count > 1 else round(value, 4),
        "min": round(value, 4),
        "max": round(value, 4),
        "first": round(value, 4),
        "last": round(value, 4),
        "unit": unit,
    }


def intraday_numeric(rng: random.Random, avg: float, spread: float, count: int, unit: str) -> dict[str, Any]:
    """Aggregate simulating N samples scattered around `avg`."""
    samples = [max(0, rng.gauss(avg, spread)) for _ in range(count)]
    return numeric_agg(count, samples, unit)


def build_day(rng: random.Random, day: date, p: DayParams) -> dict[str, Any]:
    """Build a DailySummary keyed entry."""
    numeric: dict[str, Any] = {
        "StepCount": single_numeric(p.steps, "count", count=max(1, p.steps // 200)),
        "ActiveEnergyBurned": single_numeric(p.active_kcal, "kcal", count=max(1, int(p.active_kcal / 8))),
        "BasalEnergyBurned": single_numeric(round(rng.uniform(1500, 1700), 0), "kcal", count=144),
        "AppleExerciseTime": single_numeric(p.exercise_min, "min"),
        "AppleStandHour": single_numeric(p.stand_hours, "count", count=p.stand_hours),
        "DistanceWalkingRunning": single_numeric(p.distance_km, "km", count=max(1, p.steps // 300)),
        "DistanceCycling": single_numeric(0, "km") if rng.random() > 0.25 else single_numeric(round(rng.uniform(8, 25), 2), "km"),
        "FlightsClimbed": single_numeric(max(0, int(rng.gauss(11, 4))), "count"),
        "RestingHeartRate": single_numeric(p.resting_hr, "count/min"),
        "HeartRate": intraday_numeric(rng, p.avg_hr, 15, 288, "count/min"),  # ~5-min samples
        "HeartRateVariabilitySDNN": single_numeric(p.hrv_ms, "ms"),
        "WalkingHeartRateAverage": single_numeric(p.walking_hr, "count/min"),
        "HeartRateRecoveryOneMinute": single_numeric(p.recovery_hr, "count/min"),
        "RespiratoryRate": intraday_numeric(rng, p.respiratory, 0.6, 40, "count/min"),
        "AppleSleepingWristTemperature": single_numeric(p.wrist_temp, "degC"),
        "BodyMass": single_numeric(p.weight_kg, "kg"),
        "Height": single_numeric(p.height_cm, "cm"),
        "OxygenSaturation": intraday_numeric(rng, p.spo2, 0.012, 12, "%"),
    }
    # Sleep category aggregate
    sleep_value_durations = {
        "InBed": round(p.in_bed, 0),
        "AsleepCore": round(p.core, 0),
        "AsleepDeep": round(p.deep, 0),
        "AsleepREM": round(p.rem, 0),
        "Awake": round(p.awake, 0),
    }
    sleep_value_counts = {"InBed": 1, "AsleepCore": 3, "AsleepDeep": 2, "AsleepREM": 2, "Awake": 1}
    category = {
        "SleepAnalysis": {
            "count": sum(sleep_value_counts.values()),
            "valueCounts": sleep_value_counts,
            "totalDurationMinutes": round(sum(sleep_value_durations.values()), 0),
            "valueDurationMinutes": sleep_value_durations,
        }
    }
    return {"date": day.isoformat(), "numeric": numeric, "category": category}


def build_workout(rng: random.Random, day: date) -> dict[str, Any]:
    """Produce a single workout for the given day."""
    w_type = rng.choices(WORKOUT_TYPES, weights=[40, 25, 20, 15])[0]
    duration = int(rng.gauss(40, 12)) if w_type != "Walking" else int(rng.gauss(25, 8))
    duration = max(10, duration)
    start_hr = rng.randint(6, 19)
    start = datetime(day.year, day.month, day.day, start_hr, rng.randint(0, 59), tzinfo=timezone.utc)
    end = start + timedelta(minutes=duration)
    avg_hr = rng.gauss(148, 10) if w_type != "Walking" else rng.gauss(108, 8)
    kcal = round(duration * rng.uniform(7.5, 11.5), 0)
    stats: dict[str, Any] = {
        "ActiveEnergyBurned": {"sum": kcal, "unit": "kcal"},
        "HeartRate": {"avg": round(avg_hr, 1), "min": round(avg_hr - 20, 1), "max": round(avg_hr + 20, 1), "unit": "count/min"},
    }
    if w_type in ("Running", "Walking"):
        stats["DistanceWalkingRunning"] = {"sum": round(duration * rng.uniform(0.12, 0.18), 2), "unit": "km"}
    if w_type == "Cycling":
        stats["DistanceCycling"] = {"sum": round(duration * rng.uniform(0.35, 0.45), 2), "unit": "km"}
    return {
        "type": w_type,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "durationMinutes": duration,
        "sourceName": "Apple Watch",
        "statistics": stats,
        "metadata": {},
    }


def build_summary(start: date, end: date) -> dict[str, Any]:
    rng = random.Random(RNG_SEED)
    days: dict[str, Any] = {}
    activity_rows: list[dict[str, Any]] = []
    workouts: list[dict[str, Any]] = []
    baseline_weight = 77.8  # kg (~171.5 lb)
    d = start
    while d <= end:
        p = draw_day(rng, d, baseline_weight)
        days[d.isoformat()] = build_day(rng, d, p)
        activity_rows.append({
            "date": d.isoformat(),
            "activeEnergyBurned": p.active_kcal,
            "activeEnergyBurnedGoal": 500,
            "activeEnergyBurnedUnit": "kcal",
            "appleMoveTime": p.exercise_min,
            "appleMoveTimeGoal": 30,
            "appleExerciseTime": p.exercise_min,
            "appleExerciseTimeGoal": 30,
            "appleStandHours": p.stand_hours,
            "appleStandHoursGoal": 12,
        })
        # ~35% of days have a workout; extra ~10% have a second short one
        if rng.random() < 0.35:
            workouts.append(build_workout(rng, d))
        if rng.random() < 0.10:
            workouts.append(build_workout(rng, d))
        d += timedelta(days=1)

    record_count_by_type: dict[str, int] = {}
    for k, day in days.items():
        for t, agg in day["numeric"].items():
            record_count_by_type[t] = record_count_by_type.get(t, 0) + int(agg["count"])
        for t, agg in day["category"].items():
            record_count_by_type[t] = record_count_by_type.get(t, 0) + int(agg["count"])

    return {
        "schemaVersion": 1,
        "exportDate": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "dateOfBirth": "1990-01-15",
            "biologicalSex": "HKBiologicalSexMale",
            "bloodType": "HKBloodTypeOPositive",
        },
        "dateRange": {"start": start.isoformat(), "end": end.isoformat()},
        "recordCounts": {
            "totalRecords": sum(record_count_by_type.values()),
            "totalWorkouts": len(workouts),
            "totalActivitySummaries": len(activity_rows),
            "byType": record_count_by_type,
        },
        "typesSeen": {"numeric": NUMERIC_TYPES, "category": CATEGORY_TYPES},
        "dailySummaries": days,
        "activitySummaries": activity_rows,
        "workouts": workouts,
        "parseDurationMs": 1234,
        "parserVersion": PARSER_VERSION,
    }


def regenerate(health_json_path: Path, days: int = 90) -> None:
    today = date.today()
    start = today - timedelta(days=days - 1)

    if health_json_path.exists():
        store = json.loads(health_json_path.read_text())
    else:
        store = {}

    store.setdefault("version", STORE_VERSION)
    people = store.get("people") or []
    if not any(p.get("id") == PERSON_ID for p in people):
        people.append({
            "id": PERSON_ID,
            "name": PERSON_NAME,
            "color": "#6ee7b7",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })
    store["people"] = people

    summaries = store.get("summaries") or {}
    summaries[SUMMARY_KEY] = build_summary(start, today)
    store["summaries"] = summaries

    # Clear cached snapshot so backend recomputes with current schema.
    snapshots = store.get("snapshots") or {}
    snapshots.pop(SUMMARY_KEY, None)
    store["snapshots"] = snapshots

    health_json_path.write_text(json.dumps(store, indent=2) + "\n")
    print(
        f"[fixture] wrote {health_json_path.relative_to(health_json_path.parents[1]) if len(health_json_path.parents) >= 2 else health_json_path}: "
        f"{days} days, {len(summaries[SUMMARY_KEY]['workouts'])} workouts"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        help="Path to .docvault-health.json (default: ../../../../demo-data/.docvault-health.json relative to this script)",
    )
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()

    if args.output:
        path = args.output
    else:
        # scripts/generate_demo_health.py → <repo>/demo-data/.docvault-health.json
        here = Path(__file__).resolve().parent
        for up in (here, *here.parents):
            if (up / "demo-data" / ".docvault-health.json").exists() or (up / "package.json").is_file():
                path = up / "demo-data" / ".docvault-health.json"
                break
        else:
            raise SystemExit("Could not locate demo-data/.docvault-health.json — pass --output")

    regenerate(path, days=args.days)


if __name__ == "__main__":
    main()

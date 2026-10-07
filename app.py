"""Lightweight Flask UI: one box per phases.json step, chained output-to-input."""
import argparse
import json
import time
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from model_runner import ask_model, ModelError
from parsing import parse_steps

DEFAULT_PHASES_PATH = Path(__file__).resolve().parent / "config" / "phases.json"

app = Flask(__name__)

config = {}
settings = {}


def load_phases(path):
    global config, settings
    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)
    settings = dict(config.get("settings", {}))


load_phases(DEFAULT_PHASES_PATH)


def phase_view(phase):
    return {
        "id": phase["id"],
        "name": phase.get("name", phase["id"]),
        "steps": [
            {
                "id": s["id"],
                "prompt_template": s.get("prompt_template", ""),
                "type": s.get("type", "normal"),
            }
            for s in phase.get("steps", [])
        ],
    }


@app.route("/")
def index():
    # "init" is the root chain; "loop" boxes fill every step created by a Split;
    # "merge" boxes fill every panel created by a Merge.
    phases = {p["id"]: phase_view(p) for p in config.get("phases", [])}
    init = phases.get("init", {"id": "init", "name": "Initialization", "steps": []})
    return render_template(
        "index.html",
        init=init,
        loop_steps=phases.get("loop", {}).get("steps", []),
        merge_steps=phases.get("merge", {}).get("steps", []),
        settings=settings,
    )


@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json(force=True) or {}
    prompt_text = data.get("prompt_text", "")
    input_text = data.get("input_text", "")
    combined = f"{prompt_text}\n\n{input_text}".strip() if input_text.strip() else prompt_text

    max_words = settings.get("max_words")
    if max_words:
        combined = f"{combined}\n\nThe response should max have {int(max_words)} words."

    delay = float(settings.get("delay_seconds", 0) or 0)
    if delay > 0:
        time.sleep(delay)

    try:
        output_text = ask_model(combined)
    except ModelError as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({"output_text": output_text})


@app.route("/api/parse_steps", methods=["POST"])
def api_parse_steps():
    data = request.get_json(force=True) or {}
    text = data.get("text", "")
    try:
        items = parse_steps(text)
    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    return jsonify({"items": items})


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        for key in ("delay_seconds", "max_words", "breakdown_steps"):
            if key in data:
                try:
                    settings[key] = float(data[key]) if key == "delay_seconds" else int(data[key])
                except (TypeError, ValueError):
                    return jsonify({"error": f"invalid value for {key}"}), 400
    return jsonify(settings)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Divide and Calibrate UI")
    parser.add_argument("--phases", type=Path, default=DEFAULT_PHASES_PATH,
                         help="path to a phases.json config file (default: config/phases.json)")
    args = parser.parse_args()
    load_phases(args.phases)
    app.run(debug=True, threaded=True, extra_files=[str(args.phases)])

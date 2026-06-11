# VulcanForge — Adversarial Dataset for AI Red Teaming

VulcanForge Adversarial Dataset (VF‑Adv) is a large‑scale, real‑world adversarial prompt corpus for stress‑testing the safety, security, and governance behaviour of large language models and LLM‑powered applications.

It pairs a carefully curated base of open‑source adversarial prompts with variant attack techniques that transforms each seed into many realistic attack patterns. The result is a corpus of over 11.9 million attack patterns spanning multiple harm categories, attack techniques, and languages.

VulcanForge is not a re‑hosting of existing benchmarks. The contribution is the curation methodology, the unified schema and taxonomy, and the transformation pipeline that turns a few hundred thousand curated seeds into millions of structured, traceable adversarial variants.

## Why VulcanForge exists

Individual public benchmarks (AdvBench, HarmBench, AIR‑Bench, and others) are small, inconsistently formatted, and cover different slices of the threat landscape. Used in isolation they leave large blind spots, and they are trivial for a model to overfit.

VulcanForge addresses three gaps:

- **Fragmentation** — Sources use different schemas, labels, and assumptions. We normalise everything into one schema and one risk taxonomy.
- **Scale and realism** — Real attackers do not send clean, plain‑text prompts. They obfuscate, role‑play, and switch languages. We model those behaviours explicitly.
- **Traceability** — Every variant records the seed it came from and the exact technique applied, so findings are reproducible and auditable.

## What we actually did (the value‑add)

We think of the work in three stages: **collect → curate → forge.**

1. **Collect.** We gathered adversarial prompts from a wide set of reputable open research datasets and benchmarks (full list below).
2. **Curate.** Aggregation is the straightforward part; curation is where the substantive work lies. We:
   - De‑duplicated within and across sources,
   - Normalised heterogeneous records into a single schema,
   - Mapped each prompt to a unified risk taxonomy (four pillars; see below),
   - Retained the original source attribution on every row for provenance.

   Curation is an ongoing effort. Sources are continually reviewed, added, and refined, and the corpus is maintained as a living dataset rather than a one‑off release.
3. **Forge.** We then expand the curated base into many realistic attack patterns by applying variant techniques drawn from Vulcan's adversarial taxonomy. Variants are selected for appropriateness per source and technique rather than emitted as exhaustive permutations, and the un‑transformed base is excluded so no row simply duplicates a seed. To protect the integrity of the methodology, the variant generators themselves are not distributed in this repository.

> **Update as of June 2026:** 11,962,187 attack patterns.

## Risk taxonomy

Every prompt is mapped to one of four pillars, aligned with common AI‑assurance frameworks:

| Pillar | Focus | Example sub‑risks |
|--------|-------|-------------------|
| **Security** | System compromise & circumvention | instruction override, jailbreaking, guardrail bypass, malware generation, unauthorized actions, privilege escalation |
| **Moderation** | Harmful content | hate speech, violence/extremism, CBRNE, self‑harm, sexual content, harassment, dangerous instructions, misinformation, illegal advice, fraud facilitation, discrimination/bias, brand‑damaging content, copyright |
| **Data Leakage** | Exposure of sensitive data | PII exfiltration, sensitive/training‑data extraction, privacy violations, model extraction |
| **System Information** | Disclosure of system internals | system‑prompt extraction, configuration/infrastructure disclosure, internal instruction leakage, model/version disclosure |

## Dataset composition

The curated base draws on the following open‑source datasets, normalised into a single schema and taxonomy. The collection is updated on an ongoing basis.

| Source | Language | Focus |
|--------|----------|-------|
| advbench | English | Harmful behaviours / instructions |
| airbench | English | Broad AI‑risk benchmark |
| gptfuzz | English | Jailbreak templates |
| harmbench | English | Standardised harmful behaviours |
| hh_rlhf_red_team | English | Human red‑team dialogues |
| jailbreak_llms | English | In‑the‑wild jailbreak prompts |
| jailbreakbench | English | Jailbreak robustness benchmark |
| mhj | English | Multi‑turn human jailbreaks |
| mt_jailbreak | English | Multi‑turn jailbreaks |
| owasp_aitg | English | OWASP AI testing guide prompts |
| red_queen | English | Multi‑turn attack scenarios |
| safe_mt_data | English | Safety multi‑turn data |
| safedialbench | English | Safety dialogue benchmark |
| safety_prompts | English | Large safety prompt set |
| toxicchat | English | Toxicity in real conversations |
| wildjailbreak | English | Synthetic + in‑the‑wild jailbreaks |
| xguard | English | Guardrail evaluation prompts |
| linguasafe | Multilingual | Multilingual safety benchmark |
| jailjudge | Chinese | Jailbreak judgement / attack prompts |
| sustech (ChineseSafe‑Benchmark) | Chinese | Chinese safety benchmark |
| cssbench | Chinese | Chinese safety scenarios benchmark |
| flames | Chinese | Chinese value‑alignment red‑team prompts |

## Schema

All files are JSON Lines (`.jsonl`), one record per line. Base records carry source fields; forged variants add `base_id`, `encoding`, and `roleplay` for full traceability.

```json
{
  "id": "advbench-00001-dan-base64",
  "base_id": "advbench-00001",
  "prompt": "WW91IGFyZSBEQU4sIGFuIEFJ...",
  "hit_threats": "harmful_request",
  "category": null,
  "language": "en",
  "encoding": "base64",
  "roleplay": "dan"
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique variant identifier |
| `base_id` | The curated seed this variant derives from |
| `prompt` | The (possibly transformed) attack text |
| `hit_threats` | High‑level threat category |
| `category` | Fine‑grained category (where available) |
| `language` | Language code |
| `encoding` | Obfuscation technique applied (`plain` = none) |
| `roleplay` | Role‑play framing applied (`direct` = none) |

## Repository structure

```
vulcan-datasets/
├── README.md
├── index.html              # prompt browser UI
├── viewer.js               # table logic + on-demand (Range / File.slice) reads
├── viewer.css              # styling
├── build_catalog.py        # scans data/, emits catalog.js
├── serve.py                # local static server with HTTP Range support
└── data/
    ├── advbench.jsonl                  # curated base
    ├── advbench-extension1.jsonl       # forged variants (encoding / roleplay)
    ├── advbench-extension2.jsonl
    ├── advbench-extension3.jsonl
    ├── …                               # + 17 more flat families (base + extensions)
    ├── AI45Lab:Flames/                 # directory datasets (owner:name)
    ├── Anonymous4open:JailJudge/
    ├── SUSTech:ChineseSafe-Benchmark/
    ├── Yaesir06:CSSBench/
    └── zhiyuan-ning:linguasafe/
```

Each flat source contributes a base `*.jsonl` plus its `-extension*` variant
files; the five `owner:name` directories are multi‑file datasets.

## Running the local viewer

This repository ships a small static viewer for browsing the corpus.

```bash
python3 serve.py            # http://localhost:8077/
```

`serve.py` builds the catalog from `data/` and serves the viewer. Open
<http://localhost:8077/> and you get every prompt in one paginated table — pick a
source to narrow it down, or filter the current page. Click a prompt to expand it.

```bash
python3 serve.py 9000       # custom port
python3 serve.py --no-build # skip the rebuild
python3 build_catalog.py    # just rebuild the catalog, don't serve
```

> Use `serve.py` rather than `python -m http.server` — it adds the range support
> the viewer needs to page through the data.

## Intended use

VulcanForge is intended for defensive security research and AI safety evaluation: red‑teaming models, benchmarking guardrails, training and evaluating safety classifiers, and measuring robustness to obfuscation, role‑play, and multilingual attacks.

It is **not** intended to help anyone cause real‑world harm. The prompts are deliberately adversarial; handle the corpus accordingly.

## Responsible use & safety

- Use only for legitimate safety, security, and compliance research.
- Do not deploy these prompts against systems you are not authorised to test.
- Outputs generated from these prompts may be harmful; review handling, storage, and sharing against your organisation's policies and applicable law.
- Consider access controls (e.g. gated download) if you redistribute.

## Licensing & attribution

VulcanForge is a derivative compilation. Each source dataset retains its original license, and downstream users must comply with the terms of every upstream source listed above. Provenance is preserved on every row via `base_id` / source fields.

VulcanForge's own contributions — the curation, the unified schema and taxonomy, and the transformation pipeline — are released under **CC BY 4.0** for the data and **Apache 2.0** for the accompanying scripts.

## Acknowledgements

VulcanForge builds on the work of the open research community. We gratefully acknowledge the authors and maintainers of every source dataset listed above; this corpus would not exist without their contributions.

---

Maintained by Vulcan. Contributions, corrections, and additional source proposals are welcome via issues and pull requests.

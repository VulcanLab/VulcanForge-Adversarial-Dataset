/* AI Safety Prompts viewer — pure vanilla JS, no dependencies.
   A single unified table of every prompt across all local datasets. Pages are
   read on demand: small/JSON files load whole; large JSONL files are read in
   byte windows via an offset index (File.slice when opened from disk, HTTP
   Range when served). Catalog + offset indexes are inlined in catalog.js. */

"use strict";

const LARGE_WHOLE_FILE_LIMIT = 12 * 1024 * 1024; // load whole file below this

// ---- helpers ----
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  });
  kids.flat().forEach((c) => n.append(c instanceof Node ? c : document.createTextNode(c)));
  return n;
};
const safeParse = (line) => {
  try { return JSON.parse(line); } catch (e) { return { __parse_error: line.slice(0, 300) }; }
};

// ================= data source =================
// file:// blocks fetch of local files, so when opened directly from disk we
// read data files through a one-time folder pick (File API). Over HTTP/S3 we
// fetch normally. The catalog + offset indexes are always inlined in
// catalog.js, so the table itself needs no fetch in either mode.
const MODE = location.protocol === "file:" ? "local" : "http";
let pickedFiles = [];
const wholeCache = new Map(); // file.path -> array of records

function folderConnected() { return pickedFiles.length > 0; }

function resolveLocal(path) {
  return pickedFiles.find((f) => {
    const r = f.webkitRelativePath || f.name;
    return r === path || r.endsWith("/" + path);
  }) || null;
}

async function readText(file) {
  if (MODE === "http") return (await fetch(file.path)).text();
  const lf = resolveLocal(file.path);
  if (!lf) throw new Error("data folder not connected");
  return lf.text();
}

async function readRange(file, start, endExclusive) {
  if (MODE === "http") {
    const r = await fetch(file.path, { headers: { Range: `bytes=${start}-${endExclusive - 1}` } });
    return r.text();
  }
  const lf = resolveLocal(file.path);
  if (!lf) throw new Error("data folder not connected");
  return lf.slice(start, endExclusive).text(); // reads only this byte range from disk
}

function setupFolderPicker() {
  const btn = $("#connectBtn"), picker = $("#folderPicker");
  if (MODE === "local") btn.style.display = "inline-flex";
  btn.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    pickedFiles = Array.from(picker.files || []);
    const dataCount = pickedFiles.filter((f) => /\.(jsonl|json)$/i.test(f.name)).length;
    $("#connectLabel").textContent = `${dataCount} files connected`;
    btn.classList.add("connected");
    wholeCache.clear();
    renderPromptTable();
  });
}

async function getWholeFile(file) {
  if (wholeCache.has(file.path)) return wholeCache.get(file.path);
  const text = await readText(file);
  let arr;
  if (file.format === "json") {
    const data = JSON.parse(text);
    arr = Array.isArray(data) ? data : [data];
  } else {
    arr = text.split("\n").map((l) => l.trim()).filter(Boolean).map(safeParse);
  }
  wholeCache.set(file.path, arr);
  return arr;
}

function getIndex(file) {
  return (window.OFFSETS && window.OFFSETS[file.path]) || null;
}

// Read a contiguous line range [startLine, startLine+count) from any file:
// whole-file (cached) for small/JSON, or an offset-indexed byte window for
// large JSONL (File.slice locally, HTTP Range when served).
async function readRecords(file, startLine, count) {
  const idx = file.format === "jsonl" && file.size >= LARGE_WHOLE_FILE_LIMIT ? getIndex(file) : null;
  if (!idx) {
    const all = await getWholeFile(file);
    return all.slice(startLine, startLine + count);
  }
  if (startLine >= idx.line_count) return [];
  const endLine = Math.min(startLine + count, idx.line_count);
  const stride = idx.stride;
  const block = Math.floor(startLine / stride);
  const byteStart = idx.offsets[block];
  const endBlock = Math.ceil(endLine / stride);
  const byteEnd = endBlock < idx.offsets.length ? idx.offsets[endBlock] : idx.byte_size;
  const text = await readRange(file, byteStart, byteEnd);
  const lines = text.split("\n");
  const skip = startLine - block * stride;
  return lines.slice(skip, skip + count).map((l) => l.trim()).filter(Boolean).map(safeParse);
}

// ================= pagination control =================
function pagerControls(container, page, total, pageSize, onGo, onSize) {
  container.innerHTML = "";
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, pages);
  container.append(el("span", {}, `${total.toLocaleString()} item${total === 1 ? "" : "s"}`));
  container.append(el("span", { class: "spacer" }));
  if (onSize) {
    const sel = el("select", { onchange: (e) => onSize(+e.target.value) });
    [20, 50, 100, 200].forEach((s) => sel.append(el("option", { value: s, ...(s === pageSize ? { selected: "" } : {}) }, s)));
    container.append(el("span", {}, "Page Size"), sel);
  }
  const mk = (label, target, opts = {}) =>
    el("button", { class: "pgbtn" + (opts.active ? " active" : ""), ...(opts.disabled ? { disabled: "" } : {}), onclick: () => onGo(target) }, label);
  container.append(mk("First", 1, { disabled: page <= 1 }));
  container.append(mk("Prev", page - 1, { disabled: page <= 1 }));
  const win = 2;
  const lo = Math.max(1, page - win), hi = Math.min(pages, page + win);
  if (lo > 1) container.append(el("span", {}, "…"));
  for (let p = lo; p <= hi; p++) container.append(mk(String(p), p, { active: p === page }));
  if (hi < pages) container.append(el("span", {}, "…"));
  container.append(mk("Next", page + 1, { disabled: page >= pages }));
  container.append(mk("Last", pages, { disabled: page >= pages }));
}

// ================= unified prompt table =================
// Every prompt across all datasets' canonical files (base file for families,
// all files for directory datasets — not the encoded extensions). The offset
// indexes + this segment map ARE the index; pages are read on demand, so no
// prompt text is duplicated to disk.
const PROMPT_FIELDS = ["prompt", "Prompt", "user_prompt", "text", "query", "question", "instruction", "goal", "input"];
const LANG_FIELDS = ["language", "lang", "Language"];
const CAT_FIELDS = ["category", "Category", "hit_threats", "Hit Threats", "type", "subtype",
  "label", "subject", "dimension", "subcomponent", "hazard_cate_llamaguard3"];

const state = { catalog: [] };
const pv = { scope: "all", page: 1, pageSize: 50, segs: [], total: 0, loaded: [], filter: "" };

function buildSegments(scope) {
  const datasets = scope === "all" ? state.catalog : state.catalog.filter((d) => d.id === scope);
  const segs = [];
  let start = 0;
  for (const d of datasets) {
    for (const f of d.files) {
      if (!f || !f.records) continue;
      // label rows with the dataset, naming the variant when there's more than one file
      const isVariant = d.files.length > 1 && f.name.replace(/\.(jsonl|json)$/i, "") !== d.id;
      const label = isVariant ? f.name.replace(/\.(jsonl|json)$/i, "") : d.Name;
      segs.push({ dataset: label, file: f, count: f.records, start });
      start += f.records;
    }
  }
  return { segs, total: start };
}

function resolveSegment(segs, gi) {
  let lo = 0, hi = segs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, s = segs[m];
    if (gi < s.start) hi = m - 1;
    else if (gi >= s.start + s.count) lo = m + 1;
    else return { seg: s, local: gi - s.start };
  }
  return null;
}

function pickPrompt(rec) {
  if (!rec || typeof rec !== "object") return { field: null, text: String(rec) };
  for (const f of PROMPT_FIELDS) {
    if (f in rec && rec[f] != null && String(rec[f]).trim() !== "")
      return { field: f, text: typeof rec[f] === "string" ? rec[f] : JSON.stringify(rec[f], null, 2) };
  }
  for (const [k, v] of Object.entries(rec))
    if (typeof v === "string" && v.trim()) return { field: k, text: v };
  return { field: null, text: JSON.stringify(rec, null, 2) };
}

function pickField(rec, fields) {
  if (!rec || typeof rec !== "object") return "";
  for (const f of fields) {
    if (f in rec && rec[f] != null && String(rec[f]).trim() !== "") {
      const v = rec[f];
      return typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return "";
}

// Turn snake_case / kebab-case identifiers into readable labels, preserving
// known acronyms and already-CamelCased / all-caps tokens.
const ACRONYMS = {
  hh: "HH", rlhf: "RLHF", mt: "MT", owasp: "OWASP", aitg: "AITG", llm: "LLM",
  llms: "LLMs", qa: "QA", ai: "AI", os: "OS", id: "ID", ood: "OOD", css: "CSS",
  gpt: "GPT", us: "US", csv: "CSV", nlp: "NLP", pii: "PII",
};
function humanize(s) {
  if (!s) return s;
  return String(s).split(/[\s_\-]+/).filter(Boolean).map((w) => {
    const low = w.toLowerCase();
    if (ACRONYMS[low]) return ACRONYMS[low];
    if (/^[A-Z0-9]+$/.test(w)) return w;        // codes / all-caps (e.g. S14)
    if (/[A-Z]/.test(w.slice(1))) return w;     // internal caps (e.g. JailJudge)
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

const LANG_DISPLAY = {
  en: "English", zh: "Chinese", "zh-cn": "Chinese", "zh-tw": "Chinese",
  ar: "Arabic", vi: "Vietnamese", fr: "French", de: "German", es: "Spanish",
  ru: "Russian", ja: "Japanese", ko: "Korean", hi: "Hindi", pt: "Portuguese",
  it: "Italian", th: "Thai", id: "Indonesian", tr: "Turkish", bn: "Bengali",
  fa: "Persian", jv: "Javanese", sw: "Swahili", ms: "Malay", tl: "Tagalog",
  ur: "Urdu", ta: "Tamil", te: "Telugu", mr: "Marathi", nl: "Dutch",
  pl: "Polish", uk: "Ukrainian", he: "Hebrew", el: "Greek",
};
function langName(code) {
  if (!code) return "";
  return LANG_DISPLAY[String(code).trim().toLowerCase()] || code;
}

// Load `count` consecutive global rows starting at `start`, walking across
// dataset segments (a page may straddle a file boundary).
async function loadUnifiedPage(start, count) {
  const rows = [];
  let need = count, gi = start;
  while (need > 0 && gi < pv.total) {
    const r = resolveSegment(pv.segs, gi);
    if (!r) break;
    const seg = r.seg;
    const take = Math.min(need, seg.count - r.local);
    let recs = [];
    try { recs = await readRecords(seg.file, r.local, take); } catch (e) { recs = []; }
    for (let i = 0; i < take; i++) rows.push({ global: gi + i, dataset: seg.dataset, rec: recs[i] ?? null });
    gi += take; need -= take;
  }
  return rows;
}

function connectPromptRow() {
  const td = el("td", { colspan: 5 });
  td.append(el("div", { class: "connect-prompt" },
    el("div", { class: "big" }, "Connect your data folder to read prompts"),
    el("div", {}, "Opened from disk — pick the project folder (containing data/). Nothing is uploaded."),
    el("button", { onclick: () => $("#folderPicker").click() }, "Select data folder")));
  return el("tr", {}, td);
}

function rowEl(row) {
  const { text } = pickPrompt(row.rec);
  const tr = el("tr");
  tr.append(el("td", { class: "r-num" }, (row.global + 1).toLocaleString()));
  tr.append(el("td", {}, el("span", { class: "ds-pill", title: row.dataset }, humanize(row.dataset))));
  const pt = el("div", { class: "prompt-text" }, text);
  pt.addEventListener("click", () => pt.classList.toggle("open"));
  tr.append(el("td", { class: "r-prompt" }, pt));
  tr.append(el("td", {}, langName(pickField(row.rec, LANG_FIELDS))));
  tr.append(el("td", {}, humanize(pickField(row.rec, CAT_FIELDS))));
  return tr;
}

// paint the currently loaded page, applying the optional per-page filter
function paintRows() {
  const body = $("#promptBody");
  body.innerHTML = "";
  let rows = pv.loaded;
  if (pv.filter) {
    rows = rows.filter((row) => {
      const hay = (row.dataset + " " + JSON.stringify(row.rec)).toLowerCase();
      return hay.includes(pv.filter);
    });
  }
  if (!rows.length) {
    body.append(el("tr", {}, el("td", { colspan: 5, class: "spin" },
      pv.filter ? "No rows on this page match the filter." : "No prompts in this source.")));
  } else {
    rows.forEach((row) => body.append(rowEl(row)));
  }
  requestAnimationFrame(() => {
    body.querySelectorAll(".prompt-text").forEach((p) => {
      if (p.scrollHeight > p.clientHeight + 2) p.classList.add("clamped");
    });
  });
}

async function renderPromptTable() {
  const body = $("#promptBody");
  if (MODE === "local" && !folderConnected()) {
    $("#promptPager").innerHTML = "";
    body.innerHTML = "";
    body.append(connectPromptRow());
    return;
  }
  body.innerHTML = "";
  body.append(el("tr", {}, el("td", { colspan: 5, class: "spin" }, "Loading…")));
  const start = (pv.page - 1) * pv.pageSize;
  try { pv.loaded = await loadUnifiedPage(start, pv.pageSize); }
  catch (e) {
    body.innerHTML = "";
    body.append(el("tr", {}, el("td", { colspan: 5, class: "spin" }, "Error: " + e.message)));
    return;
  }
  paintRows();
  pagerControls($("#promptPager"), pv.page, pv.total, pv.pageSize,
    (p) => { pv.page = p; renderPromptTable(); },
    (s) => { pv.pageSize = s; pv.page = 1; renderPromptTable(); });
}

function setScope(scope) {
  pv.scope = scope;
  const { segs, total } = buildSegments(scope);
  pv.segs = segs; pv.total = total; pv.page = 1;
  $("#promptCount").textContent = `${total.toLocaleString()} prompts`;
  renderPromptTable();
}

function setupPrompts() {
  const sel = $("#promptSource");
  sel.innerHTML = "";
  sel.append(el("option", { value: "all" }, "All datasets"));
  state.catalog.forEach((d) => sel.append(el("option", { value: d.id }, humanize(d.Name))));
  sel.value = "all";
  sel.addEventListener("change", () => setScope(sel.value));
  let t;
  $("#promptSearch").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { pv.filter = e.target.value.toLowerCase().trim(); paintRows(); }, 150);
  });
}

// ================= init =================
async function init() {
  const payload = window.CATALOG;
  if (!payload) {
    $("#promptBody").append(el("tr", {}, el("td", { colspan: 5, class: "spin" },
      "Failed to load catalog.js. Run `python3 build_catalog.py` to generate it.")));
    return;
  }
  state.catalog = payload.datasets || [];
  setupFolderPicker();
  setupPrompts();
  setScope("all");

  const totalPrompts = state.catalog.reduce(
    (sum, d) => sum + d.files.reduce((s, f) => s + (f.records || 0), 0), 0);
  $("#heroSub").textContent =
    `${totalPrompts.toLocaleString()} prompts across ${state.catalog.length.toLocaleString()} datasets — `
    + "pick a source to scope, click a prompt to expand.";
}

init();

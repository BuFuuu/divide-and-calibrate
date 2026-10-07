const $ = (id) => document.getElementById(id);

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function resizeWithin(root) {
  root.querySelectorAll("textarea").forEach(autoResize);
}

async function api(path, body) {
  const opts = body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// The server sleeps for the saved delay before each model call; mirror it
// with a bar that fills up along the header.
let savedDelay = Number($("cfg-delay").value);
let delayBarTimer;

function showDelayBar() {
  if (!(savedDelay > 0)) return;
  const bar = $("delay-bar");
  const fill = bar.firstElementChild;
  fill.style.transition = "none";
  fill.style.width = "0";
  bar.classList.add("active");
  fill.offsetWidth; // restart the transition from 0
  fill.style.transition = `width ${savedDelay}s linear`;
  fill.style.width = "100%";
  clearTimeout(delayBarTimer);
  delayBarTimer = setTimeout(() => bar.classList.remove("active"), savedDelay * 1000);
}

$("cfg-save").addEventListener("click", async () => {
  await api("/api/config", {
    delay_seconds: Number($("cfg-delay").value),
    max_words: Number($("cfg-words").value),
    breakdown_steps: Number($("cfg-breakdown").value),
  });
  savedDelay = Number($("cfg-delay").value);
  $("cfg-status").textContent = "Saved.";
  setTimeout(() => { $("cfg-status").textContent = ""; }, 1500);
});

// Tree model: every .node has a .chain of step boxes; output flows down the
// chain. The chain's last box can Split, which fills the node's .branches
// with one child node per parsed item, laid out horizontally.

const bodyOf = (node) => node.querySelector(":scope > .node-body");
const chainOf = (node) => bodyOf(node).querySelector(":scope > .chain");
const loopSteps = JSON.parse($("loop-steps").textContent);
const mergeSteps = JSON.parse($("merge-steps").textContent);
const contextInput = $("context-input");
const initInput = $("init-input");
const fillContext = (text) => text
  .replaceAll("{context}", contextInput.value)
  .replaceAll("{init}", initInput.value);
const isFirstRootBox = (box) =>
  box === document.querySelector(".root-node > .node-body > .chain > .step-box");

async function callRun(box) {
  const runBtn = box.querySelector(".run-btn");
  const promptField = box.querySelector(".prompt-field");
  const inputField = box.querySelector(".input-field");
  const outputField = box.querySelector(".output-field");

  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  outputField.classList.remove("field-error");
  if (isFirstRootBox(box)) initInput.value = inputField.value;
  showDelayBar();
  try {
    const { output_text } = await api("/api/run", {
      prompt_text: fillContext(promptField.value),
      input_text: fillContext(inputField.value),
    });
    outputField.value = output_text;
    autoResize(outputField);
    if (box.classList.contains("context-box")) {
      contextInput.value = output_text;
    } else {
      // Feed following context boxes and the first regular box after them.
      let next = box.nextElementSibling;
      while (next) {
        const nextInput = next.querySelector(".input-field");
        nextInput.value = output_text;
        autoResize(nextInput);
        if (!next.classList.contains("context-box")) break;
        next = next.nextElementSibling;
      }
    }
    return true;
  } catch (e) {
    outputField.value = `Error: ${e.message}`;
    outputField.classList.add("field-error");
    autoResize(outputField);
    return false;
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Run";
  }
}

function createBox(label, promptValue, inputValue, type) {
  const section = document.createElement("section");
  section.className = type === "context" ? "step-box context-box" : "step-box";
  section.innerHTML = `
    <button class="insert-box-btn" title="Insert box here" aria-label="Insert box here">+</button>
    <div class="step-header">
      <span class="step-label"></span>
      ${type === "context" ? '<span class="context-tag" title="Running this box sets {context}">→ {context}</span>' : ""}
      <div class="box-actions">
        <button class="run-btn" title="Run">Run</button>
        ${type === "splittable" ? '<button class="split-btn" title="Split output into steps">Split</button>' : ""}
        <button class="remove-btn" title="Remove box" aria-label="Remove box">×</button>
      </div>
    </div>
    <span class="split-status"></span>
    <textarea class="prompt-field" rows="2" placeholder="Prompt"></textarea>
    <textarea class="input-field" rows="3" placeholder="Input"></textarea>
    <textarea class="output-field" rows="3" placeholder="Output"></textarea>
  `;
  section.querySelector(".step-label").textContent = label;
  section.querySelector(".prompt-field").value = promptValue;
  section.querySelector(".input-field").value = inputValue;
  return section;
}

// A step panel (from Split, filled with loop boxes) or a merge panel (from
// Merge, filled with merge boxes). `input` goes into the first box.
function createNode(id, input, isMerge) {
  const node = document.createElement("div");
  node.className = isMerge ? "node merge-node" : "node";
  node.innerHTML = `
    <div class="node-header">
      <button class="fold-btn" aria-expanded="true" title="Fold">▾</button>
      <span class="node-title"></span>
      <span class="node-preview"></span>
      <span class="node-meta"></span>
      <button class="remove-step-btn" title="Remove panel" aria-label="Remove panel">×</button>
    </div>
    <div class="node-body">
      <div class="chain"></div>
      <button class="add-box-btn" title="Add another box to this chain">+ Add box</button>
      <button class="merge-btn" title="Merge the outputs above into a new panel below (click again to refresh)">Merge</button>
    </div>
  `;
  setNodeId(node, id);
  if (!isMerge) {
    const preview = node.querySelector(".node-preview");
    preview.textContent = input;
    preview.title = input;
  }
  const chain = chainOf(node);
  const steps = isMerge ? mergeSteps : loopSteps;
  if (steps.length) {
    steps.forEach((step, i) => {
      chain.appendChild(createBox(step.id, step.prompt_template, i === 0 ? input : "", step.type));
    });
  } else {
    chain.appendChild(createBox("#1", "", input, "splittable"));
  }
  return node;
}

const prefixFor = (node) => node.classList.contains("root-node") ? "" : `${node.dataset.nodeId}.`;
const branchesOf = (node) => bodyOf(node).querySelector(":scope > .branches");
const mergeOf = (node) => bodyOf(node).querySelector(":scope > .merge-node");

// Sets a node's id and title, then re-derives the ids of everything below it.
function setNodeId(node, id) {
  node.dataset.nodeId = id;
  if (!node.classList.contains("root-node")) {
    const title = node.classList.contains("merge-node") ? "Merge" : `Step ${id}`;
    node.querySelector(":scope > .node-header > .node-title").textContent = title;
  }
  const prefix = prefixFor(node);
  const branches = branchesOf(node);
  if (branches) {
    Array.from(branches.children).forEach((wrap, i) => {
      setNodeId(wrap.querySelector(":scope > .node"), `${prefix}${i + 1}`);
    });
  }
  const merge = mergeOf(node);
  if (merge) setNodeId(merge, `${prefix}m`);
}

const renumber = (branches) => {
  const node = branches.closest(".node");
  setNodeId(node, node.dataset.nodeId);
};

// A box's output, or "" if it hasn't run or errored.
function validOutput(box) {
  const field = box.querySelector(".output-field");
  return field.classList.contains("field-error") ? "" : field.value.trim();
}

// A panel's result: its merge panel's result if that has one, else the last
// valid output in its chain (boxes further down that haven't run are skipped).
function resultOf(node) {
  const merge = mergeOf(node);
  const merged = merge ? resultOf(merge) : "";
  if (merged) return merged;
  const boxes = Array.from(chainOf(node).children).filter((b) => !b.classList.contains("context-box")).reverse();
  for (const box of boxes) {
    const out = validOutput(box);
    if (out) return out;
  }
  return "";
}

function mergeInput(node) {
  const branches = branchesOf(node);
  const parts = branches
    ? Array.from(branches.children).map((wrap) => {
        const child = wrap.querySelector(":scope > .node");
        return [child.querySelector(":scope > .node-header > .node-title").textContent, resultOf(child)];
      })
    : Array.from(chainOf(node).children).map((box) => [
        box.querySelector(".step-label").textContent,
        validOutput(box),
      ]);
  return parts.filter(([, text]) => text).map(([label, text]) => `${label}:\n${text}`).join("\n\n");
}

function mergePanel(node) {
  const input = mergeInput(node);
  const existing = mergeOf(node);
  if (existing) {
    const firstInput = chainOf(existing).querySelector(".input-field");
    if (firstInput) {
      firstInput.value = input;
      autoResize(firstInput);
    }
    return;
  }
  const merge = createNode(`${prefixFor(node)}m`, input, true);
  bodyOf(node).appendChild(merge);
  resizeWithin(merge);
}

function createBranch(id, item) {
  const wrap = document.createElement("div");
  wrap.className = "branch";
  wrap.innerHTML = `
    <button class="add-step-btn before" title="Insert step before" aria-label="Insert step before">+</button>
    <button class="add-step-btn after" title="Insert step after" aria-label="Insert step after">+</button>
  `;
  wrap.appendChild(createNode(id, item));
  return wrap;
}

function insertStep(wrap, before) {
  const fresh = createBranch("", "");
  if (before) wrap.before(fresh); else wrap.after(fresh);
  renumber(wrap.parentElement);
  resizeWithin(fresh);
}

function removeStep(node) {
  if (node.classList.contains("merge-node")) {
    node.remove();
    return;
  }
  const wrap = node.parentElement;
  const branches = wrap.parentElement;
  wrap.remove();
  if (branches.children.length) renumber(branches); else branches.remove();
}

// Inserts a box before `before` (or at the end), fed by the preceding box's output.
function insertBox(chain, before) {
  let prev = before ? before.previousElementSibling : chain.lastElementChild;
  while (prev && prev.classList.contains("context-box")) prev = prev.previousElementSibling;
  const input = prev ? prev.querySelector(".output-field").value : "";
  const box = createBox(`#${chain.children.length + 1}`, "", input, "splittable");
  chain.insertBefore(box, before);
  resizeWithin(box);
}

function removeBox(box) {
  const next = box.nextElementSibling;
  const input = box.querySelector(".input-field").value;
  if (next && input.trim()) {
    const nextInput = next.querySelector(".input-field");
    nextInput.value = input;
    autoResize(nextInput);
  }
  const branches = branchesOf(box.closest(".node"));
  if (branches && branches.sourceBox === box) branches.remove();
  box.remove();
}

function setFolded(node, folded) {
  node.classList.toggle("folded", folded);
  const btn = node.querySelector(":scope > .node-header > .fold-btn");
  btn.textContent = folded ? "▸" : "▾";
  btn.title = folded ? "Unfold" : "Fold";
  btn.setAttribute("aria-expanded", String(!folded));
  if (folded) {
    const boxCount = node.querySelectorAll(".step-box").length;
    const branchCount = bodyOf(node).querySelectorAll(":scope > .branches > .branch").length;
    let meta = `${boxCount} box${boxCount === 1 ? "" : "es"}`;
    if (branchCount) meta += ` · ${branchCount} step${branchCount === 1 ? "" : "s"}`;
    node.querySelector(":scope > .node-header > .node-meta").textContent = meta;
  } else {
    resizeWithin(bodyOf(node));
  }
}

async function splitBox(box) {
  const splitBtn = box.querySelector(".split-btn");
  const statusEl = box.querySelector(".split-status");
  const text = box.querySelector(".output-field").value.trim();
  if (!text) {
    statusEl.textContent = "Nothing to split.";
    setTimeout(() => { statusEl.textContent = ""; }, 1500);
    return;
  }

  splitBtn.disabled = true;
  splitBtn.textContent = "Splitting…";
  statusEl.textContent = 'Searching output for "-", "*", numbered items, or separate lines…';
  try {
    const { items } = await api("/api/parse_steps", { text });
    const node = box.closest(".node");
    const body = bodyOf(node);
    let branches = body.querySelector(":scope > .branches");
    if (!branches) {
      branches = document.createElement("div");
      branches.className = "branches";
      body.insertBefore(branches, body.querySelector(":scope > .merge-btn"));
    }
    branches.innerHTML = "";
    branches.sourceBox = box;
    const prefix = prefixFor(node);
    items.forEach((item, i) => branches.appendChild(createBranch(`${prefix}${i + 1}`, item)));
    resizeWithin(branches);
    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    splitBtn.disabled = false;
    splitBtn.textContent = "Split";
  }
}

const tree = $("tree");

tree.addEventListener("click", (e) => {
  const target = e.target.closest("button, .node-title");
  if (!target) return;
  if (target.matches(".fold-btn, .node-title")) {
    const node = target.closest(".node");
    setFolded(node, !node.classList.contains("folded"));
  } else if (target.matches(".run-btn")) {
    callRun(target.closest(".step-box"));
  } else if (target.matches(".split-btn")) {
    splitBox(target.closest(".step-box"));
  } else if (target.matches(".remove-btn")) {
    removeBox(target.closest(".step-box"));
  } else if (target.matches(".remove-step-btn")) {
    removeStep(target.closest(".node"));
  } else if (target.matches(".add-step-btn")) {
    insertStep(target.closest(".branch"), target.classList.contains("before"));
  } else if (target.matches(".add-box-btn")) {
    insertBox(chainOf(target.closest(".node")), null);
  } else if (target.matches(".insert-box-btn")) {
    const box = target.closest(".step-box");
    insertBox(box.parentElement, box);
  } else if (target.matches(".merge-btn")) {
    mergePanel(target.closest(".node"));
  }
});

// Ctrl+Enter in any of a box's fields runs that box.
tree.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.ctrlKey || !e.target.matches("textarea")) return;
  const box = e.target.closest(".step-box");
  if (!box) return;
  e.preventDefault();
  const runBtn = box.querySelector(".run-btn");
  if (!runBtn.disabled) callRun(box);
});

tree.addEventListener("input", (e) => {
  if (e.target.matches("textarea")) autoResize(e.target);
});

resizeWithin(tree);

// Auto Run: walks the tree depth-first until switched off or a box errors.
// Each chain runs box by box; splittable boxes are split right after running,
// the resulting steps run once the rest of their parent chain is done, and
// then those steps are merged and the merge panel runs.
const autoRunToggle = $("auto-run-toggle");
const autoRunStatus = $("auto-run-status");
let autoRunActive = false;

const rootBoxes = () => Array.from(
  document.querySelectorAll(".root-node > .node-body > .chain > .step-box"));
const labelOf = (box) => box.querySelector(".step-label").textContent;

autoRunToggle.addEventListener("change", () => {
  if (!autoRunToggle.checked) {
    autoRunActive = false;
    autoRunStatus.textContent = "";
    return;
  }
  if (rootBoxes().length === 0) {
    autoRunToggle.checked = false;
    return;
  }
  autoRunActive = true;
  runAutoLoop();
});

// Returns "done", "stopped" (toggled off) or "error". `depth` is the node's
// level (root 0, Step 1 = 1, Step 1.1 = 2); splits never go past Breakdown.
async function runChain(node, depth) {
  const maxDepth = Number($("cfg-breakdown").value);
  const where = node.classList.contains("root-node")
    ? ""
    : `${node.querySelector(":scope > .node-header > .node-title").textContent} › `;
  for (const box of Array.from(chainOf(node).children)) {
    if (!autoRunActive) return "stopped";
    const label = `${where}${labelOf(box)}`;
    autoRunStatus.textContent = `Running "${label}"…`;
    if (!(await callRun(box))) {
      autoRunStatus.textContent = `Stopped at "${label}" (error).`;
      return "error";
    }
    if (box.querySelector(".split-btn") && depth < maxDepth) await splitBox(box);
  }
  const branches = branchesOf(node);
  const steps = branches ? Array.from(branches.children) : [];
  for (const wrap of steps) {
    const result = await runChain(wrap.querySelector(":scope > .node"), depth + 1);
    if (result !== "done") return result;
  }
  // All steps done: merge them (same rule as the Merge button) and run the merge.
  if (steps.length > 1) {
    if (!autoRunActive) return "stopped";
    mergePanel(node);
    return runChain(mergeOf(node), depth + 1);
  }
  return "done";
}

async function runAutoLoop() {
  const result = await runChain(document.querySelector(".root-node"), 0);
  autoRunActive = false;
  autoRunToggle.checked = false;
  if (result === "done") autoRunStatus.textContent = "Done.";
  else if (result === "stopped") autoRunStatus.textContent = "Stopped.";
}

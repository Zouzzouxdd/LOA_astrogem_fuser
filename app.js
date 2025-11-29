// app.js

// -----------------------------------
// Core definitions
// -----------------------------------

const GEM_BASES = {
  Stability:    { type: "Order", baseWill: 8 },
  Solidity:     { type: "Order", baseWill: 9 },
  Immutability: { type: "Order", baseWill: 10 },
  Corrosion:    { type: "Chaos", baseWill: 8 },
  Distortion:   { type: "Chaos", baseWill: 9 },
  Destruction:  { type: "Chaos", baseWill: 10 },
};

const GEM_NAMES = [
  "Stability",
  "Solidity",
  "Immutability",
  "Corrosion",
  "Distortion",
  "Destruction",
];

const RARITIES = ["Uncommon", "Rare", "Epic"];

const RARE_UPGRADE = {
  Uncommon: 0.045, // 4.5 %
  Rare:     0.35,  // 35  %
  Epic:     0.40,  // 40  %
};

const EPIC_UPGRADE = {
  Uncommon: 0.005, // 0.5 %
  Rare:     0.03,  // 3   %
  Epic:     0.25,  // 25  %
};

const RARITY_ORDER = {
  Uncommon: 0,
  Rare: 1,
  Epic: 2,
};

function makeQuantityTemplate() {
  const quantities = {};
  for (const rarity of RARITIES) {
    for (const name of GEM_NAMES) {
      const key = `${rarity}|${name}`;
      quantities[key] = 0;
    }
  }
  return quantities;
}

function getBucketKeys() {
  const keys = [];
  for (const rarity of RARITIES) {
    for (const name of GEM_NAMES) {
      keys.push({ rarity, name });
    }
  }
  return keys;
}

// -----------------------------------
// Pattern evaluation
// -----------------------------------

function buildBucketMeta(bucketKeys) {
  const bucketRarity = [];
  const bucketType = [];
  const bucketWill = [];

  for (const { rarity, name } of bucketKeys) {
    const base = GEM_BASES[name];
    bucketRarity.push(rarity);
    bucketType.push(base.type);
    bucketWill.push(base.baseWill);
  }

  return { bucketRarity, bucketType, bucketWill };
}

function evaluatePattern(
  counts,
  bucketKeys,
  meta,
  targetRarity,
  targetType,
  targetWill
) {
  const totalGems = counts.reduce((a, b) => a + b, 0);
  if (totalGems !== 3) {
    return {
      P_rarity_target: 0,
      P_type_target: 0,
      P_base_target: 0,
      score: 0,
    };
  }

  const { bucketRarity, bucketType, bucketWill } = meta;

  // ---------- Rarity probabilities (game-accurate) ----------
  // 1) Sum per-gem contributions
  let epicRaw = 0;
  let rareRaw = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i];
    if (!c) continue;
    const r = bucketRarity[i];
    epicRaw += c * EPIC_UPGRADE[r];
    rareRaw += c * RARE_UPGRADE[r];
  }

  // epicRaw and rareRaw are in [0, +), interpreted as probabilities in [0,1]
  const pEpicRaw = epicRaw;
  const pRareRaw = rareRaw;

  // Epic chance is just the raw sum, clamped to 1 as a safety guard
  const pEpic = Math.min(1.0, pEpicRaw);

  // Uncommon is "whatever is left", clamped at 0
  // pU = max(0, 1 - pE_raw - pR_raw)
  const pUncommon = Math.max(0, 1.0 - pEpicRaw - pRareRaw);

  // Rare gets the remaining mass: pR = 1 - pE - pU
  const pRare = 1.0 - pEpic - pUncommon;

  const rarityProbs = {
    Uncommon: pUncommon,
    Rare: pRare,
    Epic: pEpic,
  };

  // P(rarity >= target rarity)
  let pRarity;
  if (targetRarity == null) {
    pRarity = 1.0;
  } else if (targetRarity === "Uncommon") {
    // Uncommon or higher is always 1 by definition
    pRarity = rarityProbs.Uncommon + rarityProbs.Rare + rarityProbs.Epic;
  } else if (targetRarity === "Rare") {
    pRarity = rarityProbs.Rare + rarityProbs.Epic;
  } else if (targetRarity === "Epic") {
    pRarity = rarityProbs.Epic;
  } else {
    pRarity = 0.0;
  }


  // ---------- Type inheritance ----------
  let pType = 1.0;
  if (targetType != null) {
    let typeMatches = 0;
    for (let i = 0; i < counts.length; i += 1) {
      const c = counts[i];
      if (!c) continue;
      if (bucketType[i] === targetType) typeMatches += c;
    }
    pType = typeMatches / totalGems; // totalGems = 3
  }

  // ---------- Base willpower inheritance ----------
  let pBase = 1.0;
  if (targetWill != null) {
    let baseMatches = 0;
    for (let i = 0; i < counts.length; i += 1) {
      const c = counts[i];
      if (!c) continue;
      if (bucketWill[i] === targetWill) baseMatches += c;
    }
    pBase = baseMatches / totalGems; // totalGems = 3
  }

  // Joint probability under independence assumption
  const score = pRarity * pType * pBase;

  return {
    P_rarity_target: pRarity,
    P_type_target: pType,
    P_base_target: pBase,
    score,
  };
}

// -----------------------------------
// Pattern generator (bucket space)
// -----------------------------------

function bestFusionPatterns(
  quantities,
  targetRarity,
  targetType,
  targetWill,
  topN
) {
  const bucketKeys = getBucketKeys();
  const numBuckets = bucketKeys.length;
  const meta = buildBucketMeta(bucketKeys);
  const { bucketType, bucketWill } = meta;

  const avail = new Array(numBuckets).fill(0);

  for (let i = 0; i < numBuckets; i += 1) {
    const { rarity, name } = bucketKeys[i];
    const key = `${rarity}|${name}`;
    const q = quantities[key] || 0;
    let a = Math.min(q, 3);

    // Exclude target-or-better gems in same slot
    if (
      bucketType[i] === targetType &&
      bucketWill[i] === targetWill &&
      RARITY_ORDER[rarity] >= RARITY_ORDER[targetRarity]
    ) {
      a = 0;
    }

    avail[i] = a;
  }

  if (avail.reduce((a, b) => a + b, 0) < 3) {
    return { results: [], bucketKeys };
  }

  const results = [];
  const counts = new Array(numBuckets).fill(0);

  function backtrack(idx, remaining) {
    if (remaining === 0) {
      const stats = evaluatePattern(
        counts,
        bucketKeys,
        meta,
        targetRarity,
        targetType,
        targetWill
      );
      if (stats.score > 0) {
        results.push({
          counts: counts.slice(),
          ...stats,
        });
      }
      return;
    }

    if (idx === numBuckets) return;

    const maxUse = Math.min(avail[idx], remaining);

    for (let k = 0; k <= maxUse; k += 1) {
      counts[idx] = k;
      backtrack(idx + 1, remaining - k);
    }
    counts[idx] = 0;
  }

  backtrack(0, 3);

  results.sort((a, b) => b.score - a.score);

  return {
    results: results.slice(0, topN),
    bucketKeys,
  };
}

// -----------------------------------
// Rendering helpers
// -----------------------------------

function patternToLabels(counts, bucketKeys) {
  const labels = [];
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i];
    if (!c) continue;
    const { rarity, name } = bucketKeys[i];
    if (c === 1) labels.push(`${rarity} ${name}`);
    else labels.push(`${c}x ${rarity} ${name}`);
  }
  return labels;
}

function formatProb(p) {
  return (p * 100).toFixed(2) + "%";
}

// -----------------------------------
// DOM wiring
// -----------------------------------

function buildInventoryTable() {
  const tbody = document.querySelector("#inventory-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  for (const rarity of RARITIES) {
    for (const name of GEM_NAMES) {
      const tr = document.createElement("tr");
      tr.classList.add("rarity-row", `rarity-row-${rarity}`);

      const tdR = document.createElement("td");
      tdR.textContent = rarity;
      tdR.classList.add(`rarity-${rarity}`);
      tr.appendChild(tdR);

      const tdN = document.createElement("td");
      tdN.textContent = name;
      tr.appendChild(tdN);

      const tdQ = document.createElement("td");
      const wrapper = document.createElement("div");
      wrapper.classList.add("qty-wrapper");

      const decBtn = document.createElement("button");
      decBtn.type = "button";
      decBtn.textContent = "−";
      decBtn.classList.add("qty-btn", "qty-btn-dec");

      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = "0";
      input.classList.add("quantity-input");
      input.dataset.rarity = rarity;
      input.dataset.name = name;

      const incBtn = document.createElement("button");
      incBtn.type = "button";
      incBtn.textContent = "+";
      incBtn.classList.add("qty-btn", "qty-btn-inc");

      wrapper.appendChild(decBtn);
      wrapper.appendChild(input);
      wrapper.appendChild(incBtn);

      tdQ.appendChild(wrapper);
      tr.appendChild(tdQ);

      tbody.appendChild(tr);
    }
  }
}

function readQuantitiesFromForm() {
  const inputs = document.querySelectorAll(".quantity-input");
  const quantities = makeQuantityTemplate();

  inputs.forEach((input) => {
    const rarity = input.dataset.rarity;
    const name = input.dataset.name;
    const key = `${rarity}|${name}`;
    const val = parseInt(input.value, 10);
    quantities[key] = Number.isFinite(val) && val > 0 ? val : 0;
  });

  return quantities;
}

function renderResults(
  results,
  bucketKeys,
  targetRarity,
  targetType,
  targetWill
) {
  const tbody = document.querySelector("#results-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!results || results.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No valid fusion patterns with current inventory and target.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  results.forEach((entry, idx) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = String(idx + 1);
    tr.appendChild(tdIndex);

    const tdPattern = document.createElement("td");
    const labels = patternToLabels(entry.counts, bucketKeys);
    tdPattern.textContent = labels.join(" + ");
    tr.appendChild(tdPattern);

    const tdPRarity = document.createElement("td");
    tdPRarity.textContent = formatProb(entry.P_rarity_target);
    tr.appendChild(tdPRarity);

    const tdPType = document.createElement("td");
    tdPType.textContent = formatProb(entry.P_type_target);
    tr.appendChild(tdPType);

    const tdPBase = document.createElement("td");
    tdPBase.textContent = formatProb(entry.P_base_target);
    tr.appendChild(tdPBase);

    const tdScore = document.createElement("td");
    tdScore.textContent = formatProb(entry.score);
    tr.appendChild(tdScore);

    tbody.appendChild(tr);
  });
}

function runCalculator() {
  const quantities = readQuantitiesFromForm();

  const targetRaritySelect = document.getElementById("target-rarity");
  const targetNameSelect = document.getElementById("target-name");
  const topNInput = document.getElementById("top-n");

  const targetRarity = targetRaritySelect
    ? targetRaritySelect.value
    : "Rare";
  const targetName = targetNameSelect
    ? targetNameSelect.value
    : "Stability";
  const topNVal = topNInput ? parseInt(topNInput.value, 10) : 20;
  const topN = Number.isFinite(topNVal) && topNVal > 0 ? topNVal : 20;

  const base = GEM_BASES[targetName];
  const targetType = base.type;
  const targetWill = base.baseWill;

  const { results, bucketKeys } = bestFusionPatterns(
    quantities,
    targetRarity,
    targetType,
    targetWill,
    topN
  );

  renderResults(results, bucketKeys, targetRarity, targetType, targetWill);
}

document.addEventListener("DOMContentLoaded", () => {
  buildInventoryTable();

  const runBtn = document.getElementById("run-btn");
  if (runBtn) runBtn.addEventListener("click", runCalculator);

  // + / − buttons (event delegation)
  const invTable = document.getElementById("inventory-table");
  if (invTable) {
    invTable.addEventListener("click", (e) => {
      const btn = e.target.closest(".qty-btn");
      if (!btn) return;

      const wrapper = btn.closest(".qty-wrapper");
      if (!wrapper) return;
      const input = wrapper.querySelector(".quantity-input");
      if (!input) return;

      let val = parseInt(input.value, 10);
      if (!Number.isFinite(val) || val < 0) val = 0;

      if (btn.classList.contains("qty-btn-inc")) {
        val += 1;
      } else if (btn.classList.contains("qty-btn-dec")) {
        val = Math.max(0, val - 1);
      }

      input.value = String(val);
    });
  }
});

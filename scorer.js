/*
 * scorer.js — pure scoring engine for Upwork job cards.
 * No DOM access here. Exposes window.UpworkScorer for content.js.
 */
(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    // Stop-words / red-flag phrases (case-insensitive substring match on title+description)
    stopWords: [
      "telegram",
      "whatsapp",
      "contact me outside",
      "our client",
      "white-label",
      "white label",
      "crypto",
      "web3",
      "blockchain",
      "nft",
      "betting",
      "casino",
      "adult",
      "onlyfans",
      "guaranteed income",
      "earn money from home"
    ],
    // Vague-scope markers
    vagueWords: [
      "build an mvp",
      "from scratch",
      "full platform",
      "do everything",
      "complete solution"
    ],
    // Non-dev role markers (design/art/etc. — penalized for developer profile)
    roleMismatchWords: [
      "designer",
      "graphic design",
      "ui/ux",
      "ux/ui",
      "figma",
      "photoshop",
      "illustrator",
      "logo design",
      "character design",
      "2d artist",
      "3d artist",
      "animator",
      "video editing",
      "video editor",
      "copywriter",
      "content writer",
      "translator",
      "virtual assistant",
      "data entry",
      "voice over",
      "voiceover"
    ],
    // Thresholds
    lowProposalCount: 10,     // fresh job
    highProposalCount: 30,    // saturated
    clientSpentGood: 1000,    // $1k+ spent = decent history
    clientSpentGreat: 10000,  // $10k+ spent = strong client
    // Rule weights (editable via options page)
    weights: {
      baseline: 5,
      fixed: 2,
      hourly: 0,
      shortScope: 1,
      longScope: -1,
      verified: 1,
      unverified: -2,
      spentGreat: 2,
      spentGood: 1,
      noSpend: -2,
      fresh: 1,
      crowded: -2,
      seenBefore: -3,
      stopWord: -3,
      vague: -1,
      roleMismatch: -3,
      descGood: 1,
      descLong: -1,
      locationMismatch: -2,
      langMismatch: -2,
      alertMin: 7
    },
    // Preferred client geography/language — mismatches are red flags.
    // Lowercase; empty string disables the check.
    preferredCountry: "ukraine",
    preferredLanguage: "ukrainian",
    // Minimum fixed-price budget — jobs below this score 0 (0 = off).
    minBudget: 0,
    // Minimum hourly rate (upper bound of the range) — below = 0 (0 = off).
    minHourlyRate: 0
  };

  // Possessive pronouns that indicate the word refers to an existing team
  // member, not the role being hired ("work with our designer").
  const POSSESSIVES = /^(our|my|your|their|his|her|its)$/;

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Role-mismatch match: word-boundary hit that is NOT immediately preceded
   * by a possessive/article — "our designer" / "the designer" describe
   * colleagues, not the role being hired.
   */
  function isRoleHit(text, word) {
    const re = new RegExp("\\b" + escapeRe(word.toLowerCase()) + "\\b", "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      // Inspect the word immediately before the match — "our designer"
      // refers to an existing colleague, "a designer" is the hired role.
      const prev = text.slice(0, m.index).match(/(\w+)\s*$/);
      if (prev && POSSESSIVES.test(prev[1])) continue;
      return true;
    }
    return false;
  }

  /**
   * Score a parsed job object. Returns { score, reasons: [{label, delta}], tier }.
   * job fields: title, description, paymentType ('fixed'|'hourly'|null),
   *   budget, duration (raw string), paymentVerified (bool|null),
   *   clientSpent (number|null), proposals (number|null), seenBefore (bool)
   */
  function scoreJob(job, cfg) {
    const config = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const W = Object.assign({}, DEFAULT_CONFIG.weights, config.weights || {});
    let score = W.baseline;
    let noGo = false;
    const reasons = [];
    const text = ((job.title || "") + " " + (job.description || "")).toLowerCase();

    function add(delta, label) {
      score += delta;
      reasons.push({ label: label, delta: delta });
    }

    // --- Positive signals ---
    if (job.paymentType === "fixed") add(W.fixed, "+Fixed");
    if (job.paymentType === "hourly") add(W.hourly, "-Hourly");

    // Minimum fixed-price budget — under threshold is a hard no-go.
    if (config.minBudget > 0 && job.paymentType === "fixed" &&
        job.budget != null && job.budget < config.minBudget) {
      add(0, "-Budget <$" + config.minBudget);
      noGo = true;
    }

    // Minimum hourly rate (compared against the range's upper bound).
    if (config.minHourlyRate > 0 && job.paymentType === "hourly" &&
        job.budget != null && job.budget < config.minHourlyRate) {
      add(0, "-Rate <$" + config.minHourlyRate + "/hr");
      noGo = true;
    }

    if (job.duration) {
      const d = job.duration.toLowerCase();
      if (d.indexOf("less than 1 month") >= 0 || d.indexOf("1 to 3 months") >= 0) {
        add(W.shortScope, "+Short scope");
      } else if (d.indexOf("more than 6 months") >= 0 || d.indexOf("6+ month") >= 0) {
        add(W.longScope, "-Long scope");
      }
    }

    if (job.paymentVerified === true) add(W.verified, "+Verified");
    if (job.paymentVerified === false) add(W.unverified, "-Unverified");

    if (typeof job.clientSpent === "number") {
      if (job.clientSpent >= config.clientSpentGreat) add(W.spentGreat, "+Client $10k+");
      else if (job.clientSpent >= config.clientSpentGood) add(W.spentGood, "+Client $1k+");
      else if (job.clientSpent <= 0) add(W.noSpend, "-No spend");
    }

    if (typeof job.proposals === "number") {
      if (job.proposals <= config.lowProposalCount) add(W.fresh, "+Fresh (" + job.proposals + ")");
      else if (job.proposals >= config.highProposalCount) add(W.crowded, "-Crowded (" + job.proposals + ")");
    }

    // Description length: hire rate peaks at ~65-200 words, drops past ~400
    if (typeof job.descWords === "number") {
      if (job.descWords > 400) add(W.descLong, "-Long desc");
      else if (job.descWords >= 65) add(W.descGood, "+Desc len");
    }

    // --- Negative signals ---
    if (job.seenBefore) add(W.seenBefore, "-Seen before");

    for (const w of (config.stopWords || [])) {
      if (text.indexOf(w.toLowerCase()) >= 0) {
        add(W.stopWord, "-Flag: " + w);
        break; // one flag hit is enough
      }
    }

    for (const w of (config.vagueWords || [])) {
      if (text.indexOf(w.toLowerCase()) >= 0) {
        add(W.vague, "-Vague scope");
        break;
      }
    }

    for (const w of (config.roleMismatchWords || [])) {
      if (isRoleHit(text, w)) {
        add(W.roleMismatch, "-Non-dev role");
        break;
      }
    }

    // Required worker location: if the job lists allowed locations and the
    // preferred country is NOT among them = hard no-go (score forced to 0).
    if (job.reqLocations && config.preferredCountry) {
      const pref = config.preferredCountry.toLowerCase();
      if (job.reqLocations.indexOf(pref) < 0) {
        add(W.locationMismatch, "-Requires: " + job.reqLocations);
        noGo = true;
      }
    }

    // Native language requirement different from preferred = red flag
    if (job.nativeLang && config.preferredLanguage &&
        job.nativeLang !== config.preferredLanguage.toLowerCase()) {
      add(W.langMismatch, "-Native " + job.nativeLang);
    }

    score = Math.max(0, Math.min(10, score));
    if (noGo) score = 0;
    const tier = score >= W.alertMin ? "good" : score >= 4 ? "mid" : "bad";

    // Badge chips: ALL reasons — positives first, then negatives,
    // each group ordered by |delta|.
    const byMag = reasons.slice()
      .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    const pos = byMag.filter(function (r) { return r.delta > 0; });
    const neg = byMag.filter(function (r) { return r.delta < 0; });
    const top = pos.concat(neg).map(function (r) { return r.label; });

    return { score: score, tier: tier, reasons: reasons, topReasons: top };
  }

  window.UpworkScorer = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    scoreJob: scoreJob
  };
})();

/* options.js — load/save scorer config + refresh/webhook settings. */
(function () {
  "use strict";

  const CONFIG_KEY = "uws_config";
  const SETTINGS_KEY = "uws_settings";

  const DEFAULT_SETTINGS = {
    autoRefresh: false,
    hideBelowScore: -1,
    refreshMinutes: 15,
    webhookUrl: "",
    webhookTemplate: '{"text": "[{{score}}/10] {{title}}\\n{{reasons}}\\n{{url}}"}'
  };

  const WEIGHT_FIELDS = [
    "fixed", "hourly", "shortScope", "longScope", "verified", "unverified",
    "spentGreat", "spentGood", "noSpend", "fresh", "crowded", "seenBefore",
    "stopWord", "vague", "roleMismatch", "descGood", "descLong",
    "locationMismatch", "langMismatch", "baseline", "alertMin"
  ];

  function el(id) { return document.getElementById(id); }

  function load() {
    chrome.storage.local.get([CONFIG_KEY, SETTINGS_KEY], function (res) {
      const cfg = Object.assign({}, window.UpworkScorer.DEFAULT_CONFIG, res[CONFIG_KEY] || {});
      cfg.weights = Object.assign({}, window.UpworkScorer.DEFAULT_CONFIG.weights, cfg.weights || {});
      const st = Object.assign({}, DEFAULT_SETTINGS, res[SETTINGS_KEY] || {});

      WEIGHT_FIELDS.forEach(function (f) { el("w_" + f).value = cfg.weights[f]; });
      el("t_lowProposals").value = cfg.lowProposalCount;
      el("t_highProposals").value = cfg.highProposalCount;
      el("t_spentGood").value = cfg.clientSpentGood;
      el("t_spentGreat").value = cfg.clientSpentGreat;
      el("t_minBudget").value = cfg.minBudget || 0;
      el("t_minHourly").value = cfg.minHourlyRate || 0;
      el("stopWords").value = cfg.stopWords.join("\n");
      el("vagueWords").value = cfg.vagueWords.join("\n");
      el("roleMismatchWords").value = (cfg.roleMismatchWords || []).join("\n");
      el("preferredCountry").value = cfg.preferredCountry || "";
      el("preferredLanguage").value = cfg.preferredLanguage || "";

      el("autoRefresh").checked = !!st.autoRefresh;
      el("hideBelowScore").value = typeof st.hideBelowScore === "number" ? st.hideBelowScore : (st.hideNoGo ? 0 : -1);
      el("refreshMinutes").value = st.refreshMinutes;
      el("webhookUrl").value = st.webhookUrl;
      el("webhookTemplate").value = st.webhookTemplate;
    });
  }

  function lines(id) {
    return el(id).value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function save() {
    const cfg = Object.assign({}, window.UpworkScorer.DEFAULT_CONFIG);
    cfg.weights = {};
    WEIGHT_FIELDS.forEach(function (f) { cfg.weights[f] = parseFloat(el("w_" + f).value) || 0; });
    cfg.lowProposalCount = parseInt(el("t_lowProposals").value, 10) || 0;
    cfg.highProposalCount = parseInt(el("t_highProposals").value, 10) || 999;
    cfg.clientSpentGood = parseInt(el("t_spentGood").value, 10) || 0;
    cfg.clientSpentGreat = parseInt(el("t_spentGreat").value, 10) || 0;
    cfg.minBudget = Math.max(0, parseInt(el("t_minBudget").value, 10) || 0);
    cfg.minHourlyRate = Math.max(0, parseInt(el("t_minHourly").value, 10) || 0);
    cfg.stopWords = lines("stopWords");
    cfg.vagueWords = lines("vagueWords");
    cfg.roleMismatchWords = lines("roleMismatchWords");
    cfg.preferredCountry = el("preferredCountry").value.trim().toLowerCase();
    cfg.preferredLanguage = el("preferredLanguage").value.trim().toLowerCase();

    const st = {
      autoRefresh: el("autoRefresh").checked,
      hideBelowScore: Math.max(-1, Math.min(10, parseInt(el("hideBelowScore").value, 10))),
      refreshMinutes: Math.max(1, parseInt(el("refreshMinutes").value, 10) || 15),
      webhookUrl: el("webhookUrl").value.trim(),
      webhookTemplate: el("webhookTemplate").value.trim() || DEFAULT_SETTINGS.webhookTemplate
    };

    const obj = {};
    obj[CONFIG_KEY] = cfg;
    obj[SETTINGS_KEY] = st;
    chrome.storage.local.set(obj, function () {
      const s = el("status");
      s.textContent = "Saved.";
      setTimeout(function () { s.textContent = ""; }, 2000);
      chrome.runtime.sendMessage({ type: "uws_settings_changed" });
    });
  }

  function reset() {
    chrome.storage.local.remove([CONFIG_KEY, SETTINGS_KEY], load);
  }

  el("save").addEventListener("click", save);
  el("reset").addEventListener("click", reset);
  load();
})();

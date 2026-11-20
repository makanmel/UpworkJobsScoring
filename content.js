/*
 * content.js — observes the Upwork feed, parses cards, scores them, renders badges.
 * Dedup of seen postings via chrome.storage.local (fallback: localStorage).
 */
(function () {
  "use strict";

  const BADGE_CLASS = "uws-badge";
  const PROCESSED_ATTR = "data-uws-processed";
  const STORAGE_KEY = "uws_seen_jobs";
  const CONFIG_KEY = "uws_config";
  const SETTINGS_KEY = "uws_settings";
  const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const SEEN_MAX = 5000;

  let seenCache = null;   // { uid: timestamp }
  let userConfig = null;  // scorer config from options page
  let settings = null;    // extension settings (hideBelowScore etc.)

  // chrome.* dies silently after the extension is reloaded while the page
  // stays open ("Extension context invalidated"). When that happens we fall
  // back to localStorage so badges keep working until the next page reload.
  function extAlive() {
    return typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id);
  }

  function storageGet(key) {
    return new Promise(function (resolve) {
      if (extAlive() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(key, function (res) {
          resolve(res ? res[key] : undefined);
        });
      } else {
        const raw = localStorage.getItem(key);
        resolve(raw ? JSON.parse(raw) : undefined);
      }
    });
  }

  function storageSet(key, value) {
    if (extAlive() && chrome.storage && chrome.storage.local) {
      const obj = {};
      obj[key] = value;
      chrome.storage.local.set(obj);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  function loadSeen() {
    if (seenCache) return Promise.resolve(seenCache);
    return storageGet(STORAGE_KEY).then(function (data) {
      seenCache = data || {};
      // prune old entries
      const now = Date.now();
      const keys = Object.keys(seenCache);
      let dirty = false;
      keys.forEach(function (k) {
        if (now - seenCache[k] > SEEN_TTL_MS) {
          delete seenCache[k];
          dirty = true;
        }
      });
      if (keys.length > SEEN_MAX) {
        Object.keys(seenCache)
          .sort(function (a, b) { return seenCache[a] - seenCache[b]; })
          .slice(0, keys.length - SEEN_MAX)
          .forEach(function (k) { delete seenCache[k]; dirty = true; });
      }
      if (dirty) storageSet(STORAGE_KEY, seenCache);
      return seenCache;
    });
  }

  function markSeen(uid) {
    seenCache[uid] = Date.now();
    storageSet(STORAGE_KEY, seenCache);
  }

  function wasSeen(uid) {
    return Object.prototype.hasOwnProperty.call(seenCache, uid);
  }

  function removeBadge(card) {
    const b = card.querySelector("." + BADGE_CLASS);
    if (b) b.remove();
    card.classList.remove("uws-dim");
  }

  function renderBadge(card, result) {
    removeBadge(card);

    const badge = document.createElement("div");
    badge.className = BADGE_CLASS + " uws-" + result.tier;

    const score = document.createElement("span");
    score.className = "uws-score";
    score.textContent = "Score: " + result.score + "/10";
    badge.appendChild(score);

    result.topReasons.forEach(function (r) {
      const chip = document.createElement("span");
      chip.className = "uws-chip";
      chip.textContent = r;
      badge.appendChild(chip);
    });

    const full = result.reasons.map(function (r) { return r.label; }).join("  ");
    badge.title = full || "No signals";

    // Insert near the title; fall back to top of card
    const titleEl =
      card.querySelector('[data-test="job-tile-title"]') ||
      card.querySelector("h2, h3, h4") ||
      card;
    if (titleEl.parentNode) {
      titleEl.parentNode.insertBefore(badge, titleEl.nextSibling);
    } else {
      card.insertBefore(badge, card.firstChild);
    }

    card.classList.toggle("uws-dim", result.tier === "bad");
    // Hide cards below the configured threshold (0 = disabled).
    // Falls back to the legacy hideNoGo flag (hide only 0/10) for
    // settings saved before the threshold input existed.
    let hideBelow = settings ? parseFloat(settings.hideBelowScore) : 0;
    if (!isFinite(hideBelow)) hideBelow = settings && settings.hideNoGo ? 1 : 0;
    card.classList.toggle("uws-hidden", hideBelow > 0 && result.score < hideBelow);
  }

  function loadConfig() {
    return storageGet(CONFIG_KEY).then(function (cfg) {
      userConfig = cfg || null;
      return userConfig;
    });
  }

  function loadSettings() {
    return storageGet(SETTINGS_KEY).then(function (st) {
      settings = st || {};
      return settings;
    });
  }

  // Re-score everything when the user changes settings in the options page.
  if (extAlive() && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[SETTINGS_KEY]) {
        settings = changes[SETTINGS_KEY].newValue || {};
        document.querySelectorAll("[" + PROCESSED_ATTR + "]").forEach(function (card) {
          card.removeAttribute(PROCESSED_ATTR);
          schedule(card);
        });
      }
      if (area === "local" && changes[CONFIG_KEY]) {
        userConfig = changes[CONFIG_KEY].newValue || null;
        document.querySelectorAll("[" + PROCESSED_ATTR + "]").forEach(function (card) {
          card.removeAttribute(PROCESSED_ATTR);
          schedule(card);
        });
      }
    });
  }

  function notifyHighScore(job, result) {
    if (!extAlive()) return;
    chrome.runtime.sendMessage({
      type: "uws_high_score_job",
      job: {
        title: job.title,
        url: job.url || null,
        score: result.score,
        reasons: result.topReasons
      }
    });
  }

  function processCard(card) {
    if (!card || card.getAttribute(PROCESSED_ATTR)) return;
    // Never score inside the job-details slide-over / modals
    if (card.closest(window.UpworkJobParser.EXCLUDE_CONTAINER)) return;
    // Skip inner containers of an already-processed card
    if (card.parentElement && card.parentElement.closest("[" + PROCESSED_ATTR + "]")) return;
    card.setAttribute(PROCESSED_ATTR, "1");

    const job = window.UpworkJobParser.parseCard(card);
    if (!job.title && !job.description) {
      // Card element exists but content hasn't hydrated yet — unmark so the
      // sweep/scan retries it later instead of permanently skipping it.
      card.removeAttribute(PROCESSED_ATTR);
      return;
    }

    job.seenBefore = wasSeen(job.uid);
    markSeen(job.uid);

    const result = window.UpworkScorer.scoreJob(job, userConfig);
    renderBadge(card, result);

    // Alert only on first sighting (fresh, high-scoring job)
    const W = Object.assign({}, window.UpworkScorer.DEFAULT_CONFIG.weights,
      (userConfig && userConfig.weights) || {});
    if (!job.seenBefore && result.score >= W.alertMin) {
      notifyHighScore(job, result);
    }
  }

  // Debounced batch processing for mutation bursts
  const pending = new Set();
  let flushScheduled = false;

  function schedule(card) {
    pending.add(card);
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(function () {
      flushScheduled = false;
      const cards = Array.from(pending);
      pending.clear();
      cards.forEach(processCard);
    }, 150);
  }

  function scan(root) {
    window.UpworkJobParser.findCards(root).forEach(schedule);
  }

  function init() {
    Promise.all([loadSeen(), loadConfig(), loadSettings()]).then(function () {
      scan(document);

      const observer = new MutationObserver(function (mutations) {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (window.UpworkJobParser.findCards(node).length) scan(node);
            else if (node.matches && node.matches(window.UpworkJobParser.CARD_SELECTOR)) {
              schedule(node);
            }
          }
          // Upwork re-renders inside tiles: the card element survives but the
          // badge sibling is removed — re-process such cards.
          for (const node of m.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const hadBadge =
              (node.classList && node.classList.contains(BADGE_CLASS)) ||
              (node.querySelector && !!node.querySelector("." + BADGE_CLASS));
            if (hadBadge) {
              const card = m.target && m.target.closest
                ? m.target.closest(window.UpworkJobParser.CARD_SELECTOR)
                : null;
              if (card && card.getAttribute(PROCESSED_ATTR)) {
                card.removeAttribute(PROCESSED_ATTR);
                schedule(card);
              }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Upwork re-renders tiles on scroll/filter changes; re-scan cheaply.
      document.addEventListener("scroll", function () { scan(document); }, { passive: true });

      // Safety net: every 2s re-scan the feed — picks up unprocessed cards
      // (e.g. hydrated after first pass) and re-renders badges destroyed by
      // an internal framework re-render we didn't observe.
      function sweep() {
        scan(document);
        document.querySelectorAll("[" + PROCESSED_ATTR + "]").forEach(function (card) {
          if (!card.isConnected) return;
          if (card.getAttribute(PROCESSED_ATTR) !== "1") return;
          if (!card.querySelector("." + BADGE_CLASS)) {
            card.removeAttribute(PROCESSED_ATTR);
            schedule(card);
          }
        });
      }
      setInterval(sweep, 2000);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

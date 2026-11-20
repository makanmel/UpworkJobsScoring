/*
 * parser.js — extracts job fields from a single Upwork job card DOM element.
 * Targets stable attributes (data-test) and text patterns; avoids generated CSS classes.
 * Exposes window.UpworkJobParser.
 */
(function () {
  "use strict";

  function text(el) {
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function findByDataTest(card, value) {
    return card.querySelector('[data-test="' + value + '"]');
  }

  function parseMoney(s) {
    // "$10,000+" / "$500" / "$1.5k+"
    if (!s) return null;
    const m = s.replace(/,/g, "").match(/\$?\s*([\d.]+)\s*(k)?/i);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (m[2] && m[2].toLowerCase() === "k") v *= 1000;
    return isNaN(v) ? null : v;
  }

  function parseProposals(s) {
    // "Proposals: 5 to 10" / "Proposals: Less than 5" / "Proposals: 20 to 50"
    if (!s) return null;
    const range = s.match(/(\d+)\s*to\s*(\d+)/i);
    if (range) return Math.round((parseInt(range[1], 10) + parseInt(range[2], 10)) / 2);
    const less = s.match(/less than\s*(\d+)/i);
    if (less) return parseInt(less[1], 10) - 1;
    const single = s.match(/(\d+)/);
    return single ? parseInt(single[1], 10) : null;
  }

  /**
   * Parse a job card element. Returns field object for scorer.scoreJob(),
   * plus `uid` — a stable dedup key (job id from link, else title hash).
   */
  function parseCard(card) {
    const job = {
      uid: null,
      url: null,
      title: "",
      description: "",
      paymentType: null,
      budget: null,
      duration: null,
      paymentVerified: null,
      clientSpent: null,
      proposals: null,
      descWords: null,
      reqLocations: null,
      nativeLang: null,
      nativeLevel: null,
      seenBefore: false
    };

    // Title + uid from the job link (contains ~<id> or /jobs/~...)
    const titleEl =
      findByDataTest(card, "job-tile-title") ||
      card.querySelector("h2, h3, h4");
    const link = card.querySelector('a[href*="/jobs/"], a[href*="jobdetails"]');
    job.title = text(titleEl || link);
    if (link) {
      job.url = link.href || null; // resolved absolute URL
      const href = link.getAttribute("href") || "";
      const idm = href.match(/~([0-9a-zA-Z]+)/) || href.match(/jobs?\/[^/?]+-?(\d{6,})/);
      job.uid = idm ? idm[1] : href.split("?")[0];
    }

    // Description
    const descEl =
      findByDataTest(card, "job-description-text") ||
      card.querySelector('[data-test*="description"], p');
    job.description = text(descEl).slice(0, 2000);
    job.descWords = job.description ? job.description.split(/\s+/).filter(Boolean).length : null;

    // Whole-card text for pattern fallbacks
    const all = text(card);

    // Payment type + budget ("Fixed-price" / "Hourly: $25-$50")
    if (/fixed[- ]price/i.test(all)) {
      job.paymentType = "fixed";
      const info = findByDataTest(card, "job-type-label") || card;
      const m = text(info).match(/fixed[- ]price[^$]*\$([\d,]+(?:\.\d+)?k?)/i);
      job.budget = m ? parseMoney(m[1]) : null;
    } else if (/hourly/i.test(all)) {
      job.paymentType = "hourly";
      const m = all.match(/hourly[:\s]*\$([\d,]+(?:\.\d+)?)/i);
      job.budget = m ? parseMoney(m[1]) : null;
    }

    // Duration / experience level labels ("Est. Time: ..." or "Duration")
    const durEl =
      findByDataTest(card, "duration-label") ||
      card.querySelector('[data-test*="duration"]');
    job.duration = text(durEl) ||
      (all.match(/(less than 1 month|1 to 3 months|3 to 6 months|more than 6 months)/i) || [null])[0];

    // Payment verified
    if (/payment (method )?verified/i.test(all)) job.paymentVerified = true;
    else if (/payment (method )?unverified/i.test(all)) job.paymentVerified = false;

    // Client spend ("$10k+ spent" / "$500 spent" / "$0 spent")
    const spentM = all.match(/\$([\d,.]+k?)\+?\s*spent/i);
    job.clientSpent = spentM ? parseMoney(spentM[1]) : (job.paymentVerified === false ? 0 : null);

    // Proposals
    const propEl =
      findByDataTest(card, "proposals-tier") ||
      card.querySelector('[data-test*="proposals"]');
    const propText = text(propEl) || (all.match(/proposals?:\s*[^|]+/i) || [null])[0];
    job.proposals = parseProposals(propText);

    // Required worker location — ONLY from the "Preferred qualifications"
    // list (ul.qualification-items). Items flatten to
    // "Location: Philippines" / "English level: Fluent". The client-country
    // pin and skills list are never consulted, so they can't false-match.
    let reqLocText = null;
    const quals = card.querySelector("ul.qualification-items");
    if (quals) {
      const liEls = quals.querySelectorAll("li");
      for (const el of liEls) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        const m = t.match(/^Location\s*:?\s*(.+)$/);
        if (m) { reqLocText = m[1].trim(); break; }
      }
    }
    const reqM = (reqLocText ? { 1: reqLocText } : null) ||
      all.match(/(?:only\s+)?(?:freelancers?|applicants?|candidates?)\s+(?:located|based|residing)\s+in\s+([^\n.;]+)/i) ||
      all.match(/\b(US|U\.?S\.?A?|United States|UK|EU|Europe|Canada|Australia)-?based\b/i);
    if (reqM) {
      job.reqLocations = (reqM[1] || reqM[0])
        .replace(/^(location|country)\s*/i, "")
        .replace(/[.;]+$/, "")
        .trim()
        .toLowerCase() || null;
    }

    // Language requirement — also only inside qualification-items:
    // "English level: Native or Bilingual" / "German level: Fluent".
    // Fallback: "native English" phrasing in the body text.
    if (quals) {
      const qt = (quals.textContent || "").replace(/\s+/g, " ");
      const lvlM = qt.match(/(\w+)\s*level\s*:?\s*([a-z]+)/i);
      if (lvlM) {
        job.nativeLang = lvlM[1].toLowerCase(); // e.g. "english"
        job.nativeLevel = lvlM[2].trim().toLowerCase(); // e.g. "fluent"
      }
    }
    if (!job.nativeLang) {
      // "native English"-style phrasing — but only real language names, so
      // "React Native" / "cloud-native" don't false-positive.
      const LANGS =
        "english|ukrainian|german|french|spanish|italian|portuguese|polish|" +
        "dutch|russian|arabic|chinese|japanese|korean|hindi|turkish|swedish|" +
        "danish|norwegian|finnish|czech|slovak|romanian|hungarian|greek|" +
        "hebrew|thai|vietnamese|indonesian|malay|filipino|tagalog";
      const langM = all.match(new RegExp("native[ -]?(" + LANGS + ")\\b", "i"));
      if (langM) job.nativeLang = langM[1].toLowerCase();
    }

    if (!job.uid) {
      job.uid = "h:" + simpleHash(job.title + "|" + job.description.slice(0, 200));
    }

    return job;
  }

  function simpleHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Find all job card elements currently in the document.
   * Search feed uses <section data-test="JobTile"> / article tiles.
   */
  const CARD_SELECTOR =
    '[data-test="JobTile"], section[data-test*="JobTile"], article[data-test*="job"], .job-tile';

  // Containers that are NOT the search feed — job details slide-over, modals,
  // saved-job popovers. Cards matched inside these must be ignored or the
  // details pane itself gets scored/badged/dimmed.
  const EXCLUDE_CONTAINER =
    '.air3-slider, .air3-slider-content, [data-test*="slider" i], ' +
    '[data-test*="JobDetails" i], [data-test*="job-details" i], ' +
    '[role="dialog"], .up-modal, [data-test="modal"]';

  /**
   * Keep only outermost candidates — drop elements nested inside another
   * matched card, so one job never produces two badges.
   */
  function outermost(cards) {
    return cards.filter(function (card) {
      const parent = card.parentElement;
      return !parent || !parent.closest(CARD_SELECTOR);
    });
  }

  function notExcluded(card) {
    return !card.closest(EXCLUDE_CONTAINER);
  }

  function findCards(root) {
    const scope = root || document;
    const tiles = scope.querySelectorAll(CARD_SELECTOR);
    if (tiles.length) {
      return outermost(Array.prototype.slice.call(tiles)).filter(notExcluded);
    }
    // Fallback: elements containing a /jobs/ link
    const out = [];
    scope.querySelectorAll('a[href*="/jobs/"]').forEach(function (a) {
      if (a.closest(EXCLUDE_CONTAINER)) return;
      const card = a.closest("section, article, li, div[data-test]");
      if (card && !card.closest(EXCLUDE_CONTAINER) && out.indexOf(card) < 0) out.push(card);
    });
    return outermost(out);
  }

  window.UpworkJobParser = {
    parseCard: parseCard,
    findCards: findCards,
    simpleHash: simpleHash,
    CARD_SELECTOR: CARD_SELECTOR,
    EXCLUDE_CONTAINER: EXCLUDE_CONTAINER
  };
})();

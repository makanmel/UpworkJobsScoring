/*
 * background.js — MV3 service worker.
 * - Auto-refreshes open Upwork search tabs on an alarm.
 * - POSTs a webhook (ntfy / Telegram) for new high-score jobs reported by content.js.
 */
"use strict";

const SETTINGS_KEY = "uws_settings";
const ALERTED_KEY = "uws_alerted_jobs";
const COUNT_KEY = "uws_high_count";
const ALARM_NAME = "uws_refresh";
const UPWORK_SEARCH = "https://www.upwork.com/nx/*";
const UPWORK_JOBS_URL = "https://www.upwork.com/nx/search/jobs/";

let settings = null;
let alerted = {}; // uid/url -> timestamp
let highCount = 0; // unviewed high-score jobs

function loadSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([SETTINGS_KEY, ALERTED_KEY, COUNT_KEY], function (res) {
      settings = res[SETTINGS_KEY] || {};
      alerted = res[ALERTED_KEY] || {};
      highCount = res[COUNT_KEY] || 0;
      updateBadge();
      resolve();
    });
  });
}

function updateBadge() {
  const text = highCount > 0 ? (highCount > 99 ? "99+" : String(highCount)) : "";
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: "#14a800" });
}

function bumpCount() {
  highCount += 1;
  const obj = {};
  obj[COUNT_KEY] = highCount;
  chrome.storage.local.set(obj);
  updateBadge();
}

function saveAlerted() {
  const now = Date.now();
  const ttl = 7 * 24 * 60 * 60 * 1000;
  Object.keys(alerted).forEach(function (k) {
    if (now - alerted[k] > ttl) delete alerted[k];
  });
  const obj = {};
  obj[ALERTED_KEY] = alerted;
  chrome.storage.local.set(obj);
}

async function syncAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  if (settings.autoRefresh && settings.refreshMinutes > 0) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshMinutes });
  }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== ALARM_NAME || !settings || !settings.autoRefresh) return;
  chrome.tabs.query({ url: UPWORK_SEARCH }, function (tabs) {
    tabs.forEach(function (t) { chrome.tabs.reload(t.id); });
  });
});

function fillTemplate(tpl, job) {
  return tpl
    .replace(/\{\{title\}\}/g, job.title || "")
    .replace(/\{\{score\}\}/g, String(job.score))
    .replace(/\{\{url\}\}/g, job.url || "")
    .replace(/\{\{reasons\}\}/g, (job.reasons || []).join(", "));
}

async function sendWebhook(job) {
  if (!settings.webhookUrl) return;
  const tpl = settings.webhookTemplate || '{"text": "[{{score}}/10] {{title}}\\n{{reasons}}\\n{{url}}"}';
  const body = fillTemplate(tpl, job);
  await fetch(settings.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body
  });
}

chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== "uws_high_score_job") return;
  const key = msg.job.url || msg.job.title;
  if (alerted[key]) return;
  alerted[key] = Date.now();
  saveAlerted();
  bumpCount();
  sendWebhook(msg.job).catch(function (e) {
    console.warn("[uws] webhook failed:", e);
  });
});

// Click the icon: reset counter, then focus an existing Upwork tab or open one.
chrome.action.onClicked.addListener(function () {
  highCount = 0;
  const obj = {};
  obj[COUNT_KEY] = 0;
  chrome.storage.local.set(obj);
  updateBadge();

  chrome.tabs.query({ url: UPWORK_SEARCH }, function (tabs) {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: UPWORK_JOBS_URL });
    }
  });
});

chrome.runtime.onInstalled.addListener(function () {
  loadSettings().then(syncAlarm);
});
chrome.runtime.onStartup.addListener(function () {
  loadSettings().then(syncAlarm);
});

// Settings changed in options page
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "uws_settings_changed") {
    loadSettings().then(syncAlarm);
  }
});

// Keep service worker state fresh on wake
loadSettings().then(syncAlarm);

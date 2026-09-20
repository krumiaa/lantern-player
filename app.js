"use strict";

const OWNER = "krumiaa";
const REPO = "lantern-protocol";
const WORKFLOW = "generate-next.yml";
const MANIFEST_PATH = "player/manifest.json";

const audio = document.getElementById("audio");
const episodeEl = document.getElementById("episode");
const titleEl = document.getElementById("title");
const statusEl = document.getElementById("status");
const tokenButton = document.getElementById("tokenButton");
const forgetTokenButton = document.getElementById("forgetTokenButton");
const refreshButton = document.getElementById("refreshButton");
const retryButton = document.getElementById("retryButton");

let manifest = null;
let currentEpisode = null;
let audioObjectUrl = null;
let pollTimer = null;

function token() {
  return localStorage.getItem("lanternGithubToken") || "";
}

function headers(extra = {}) {
  const h = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (token()) h.Authorization = `Bearer ${token()}`;
  return h;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const compact = value.replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchManifest() {
  if (!token()) {
    throw new Error("Set the narrowly scoped GitHub token to open the private library.");
  }

  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${MANIFEST_PATH}?ref=main&ts=${Date.now()}`;

  const response = await fetch(url, {
    headers: headers(),
    cache: "no-store",
  });

  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) {
      throw new Error(
        "GitHub token could not read the private library. Check that it is restricted to lantern-protocol with Contents: Read."
      );
    }
    throw new Error(`Manifest HTTP ${response.status}`);
  }

  const payload = await response.json();
  manifest = JSON.parse(decodeBase64Utf8(payload.content));
  return manifest;
}

function lastCompleted() {
  return Number(localStorage.getItem("lanternLastCompleted") || "0");
}

function chooseEpisode() {
  const ready = manifest.episodes
    .filter((e) => e.audio_ready)
    .sort((a, b) => a.number - b.number);

  const unfinished = ready.find((e) => e.number > lastCompleted());
  return unfinished || ready.at(-1) || null;
}

async function repoAudioBlob(ep) {
  if (!ep.audio_path) {
    throw new Error(
      "This episode predates the private playback cache. Refresh after the playback-cache backfill completes."
    );
  }

  const path = encodeRepoPath(ep.audio_path);
  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=main&ts=${Date.now()}`;

  const response = await fetch(url, {
    headers: headers({ Accept: "application/vnd.github.raw+json" }),
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Private playback audio is not available yet.");
    }
    throw new Error(`Private audio HTTP ${response.status}`);
  }

  return await response.blob();
}

async function loadEpisode(ep) {
  currentEpisode = ep;
  episodeEl.textContent = `Episode ${ep.number}`;
  titleEl.textContent = ep.title;
  retryButton.hidden = true;
  setStatus("Loading private audio…");

  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  const blob = await repoAudioBlob(ep);
  audioObjectUrl = URL.createObjectURL(blob);
  audio.src = audioObjectUrl;

  const saved = Number(localStorage.getItem(`lanternPosition:${ep.number}`) || "0");
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (saved > 0 && saved < audio.duration - 2) audio.currentTime = saved;
    },
    { once: true }
  );

  setStatus(saved > 0 ? "Resume when ready." : "Ready.");
}

async function dispatchSuccessor(completedNumber) {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ref: "main",
        inputs: { completed_episode: String(completedNumber) },
      }),
    }
  );

  if (response.status !== 204) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "GitHub token could not dispatch the workflow. Check that Actions is set to Read and write."
      );
    }
    throw new Error(
      `Workflow dispatch HTTP ${response.status}: ${body.slice(0, 180)}`
    );
  }
}

async function pollForSuccessor(completedNumber) {
  clearInterval(pollTimer);
  retryButton.hidden = true;
  setStatus("Episode complete. Preparing the next episode…");

  const check = async () => {
    try {
      await fetchManifest();
      const next = manifest.episodes.find(
        (e) => e.number === completedNumber + 1 && e.audio_ready
      );

      if (next) {
        clearInterval(pollTimer);
        await loadEpisode(next);
      }
    } catch (err) {
      console.error(err);
      setStatus(`Waiting for next episode: ${err.message}`);
    }
  };

  pollTimer = setInterval(check, 30000);
  await check();
}

async function prepareNext(completedNumber) {
  try {
    retryButton.hidden = true;
    setStatus("Authorizing exactly one successor…");
    await dispatchSuccessor(completedNumber);
    await pollForSuccessor(completedNumber);
  } catch (err) {
    console.error(err);
    setStatus(`Next-episode dispatch failed: ${err.message}`);
    retryButton.hidden = false;
  }
}

audio.addEventListener("timeupdate", () => {
  if (!currentEpisode || !Number.isFinite(audio.currentTime)) return;

  localStorage.setItem(
    `lanternPosition:${currentEpisode.number}`,
    String(Math.floor(audio.currentTime))
  );
});

audio.addEventListener("ended", async () => {
  if (!currentEpisode) return;

  const completed = currentEpisode.number;
  localStorage.setItem("lanternLastCompleted", String(completed));
  localStorage.removeItem(`lanternPosition:${completed}`);

  await prepareNext(completed);
});

tokenButton.addEventListener("click", async () => {
  const value = prompt(
    "Paste the fine-grained GitHub token for this beta. It is stored only in this browser's localStorage."
  );

  if (value && value.trim()) {
    localStorage.setItem("lanternGithubToken", value.trim());
    setStatus("Token saved on this device.");
    await boot();
  }
});

forgetTokenButton.addEventListener("click", () => {
  localStorage.removeItem("lanternGithubToken");
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }
  audio.removeAttribute("src");
  currentEpisode = null;
  episodeEl.textContent = "Private library locked";
  titleEl.textContent = "";
  retryButton.hidden = true;
  setStatus("Token removed from this device.");
});

refreshButton.addEventListener("click", () => boot());

retryButton.addEventListener("click", async () => {
  const completed = lastCompleted();
  if (completed > 0) await prepareNext(completed);
});

async function boot() {
  clearInterval(pollTimer);
  retryButton.hidden = true;

  if (!token()) {
    episodeEl.textContent = "Private library locked";
    titleEl.textContent = "";
    audio.removeAttribute("src");
    setStatus("Set the GitHub token once on this device.");
    return;
  }

  try {
    setStatus("Checking private library…");
    await fetchManifest();

    const completed = lastCompleted();
    const nextReady = manifest.episodes.find(
      (e) => e.number === completed + 1 && e.audio_ready
    );

    if (nextReady) {
      await loadEpisode(nextReady);
      return;
    }

    if (completed > 0 && manifest.latest_episode <= completed) {
      episodeEl.textContent = `Episode ${completed} complete`;
      titleEl.textContent = "Next episode not ready";
      audio.removeAttribute("src");
      currentEpisode = null;
      retryButton.hidden = false;
      setStatus(
        "No successor is ready yet. Retry preparation safely; duplicate signals are rejected server-side."
      );
      return;
    }

    const ep = chooseEpisode();
    if (!ep) {
      episodeEl.textContent = "Episode 1";
      titleEl.textContent = "The Girl";
      audio.removeAttribute("src");
      setStatus("Episode 1 audio has not been published yet.");
      return;
    }

    await loadEpisode(ep);
  } catch (err) {
    console.error(err);
    episodeEl.textContent = "Private library unavailable";
    titleEl.textContent = "";
    audio.removeAttribute("src");
    setStatus(err.message);
  }
}

boot();

// ==UserScript==
// @name         Telegram Restriction Tool
// @version      1.0.2
// @namespace    https://github.com/limyucheng/tg-bypass
// @description  Download in-memory images, GIFs and videos in Telegram Web, allowing for permanent downloads or copy-send to other chats.
// @author       limyucheng
// @license      GPL-3.0-only
// @website      https://github.com/limyucheng/tg-bypass
// @homepageURL  https://github.com/limyucheng/tg-bypass
// @supportURL   https://github.com/limyucheng/tg-bypass
// @match        https://web.telegram.org/*
// @match        https://webk.telegram.org/*
// @match        https://webz.telegram.org/*
// ==/UserScript==

/*
 * Fork maintainer details: fill the blank metadata fields above before release.
 * Optional trademark notice:
 * Optional icon: add an @icon URL inside the userscript metadata block.
 *
 * Upstream attribution (retained for this derivative work):
 * Original author: Nestor Qin
 * Original project: https://github.com/Neet-Nestor/Telegram-Media-Downloader
 * Original license: GNU GPLv3
 *
 * Modified on 2026-11-15: English-only interface, metadata placeholders,
 * removal of language-only settings and storage, and source cleanup.
 * Distributed under GNU GPL version 3. See LICENSE and NOTICE.
 */

(function () {
  // Keep interface text in one place; Telegram's own language is unchanged.
  const UI_LANGUAGE = "en";
  const UI_MESSAGES = {
    downloads: "Downloads",
    downloadsCount: "Downloads ({count})",
    mediaDownloads: "Media downloads",
    download: "Download",
    loadingMedia: "Media is loading",
    hide: "Hide",
    show: "Show",
    dismiss: "Dismiss download",
    progress: "Download progress",
    cancel: "Cancel",
    retry: "Retry",
    preparing: "Preparing",
    queued: "Queued",
    downloading: "Downloading",
    saving: "Saving",
    completed: "Completed",
    handedOff: "Sent to browser",
    failed: "Failed",
    cancelled: "Cancelled",
    rate: "{speed}/s",
    video: "video",
    audio: "audio",
    image: "image",
    unknownType: "an unknown file type",
    errorHttp: "Download request failed (HTTP {status})",
    errorMime: "Expected {kind}, received {mime}",
    errorRangeMissing: "Missing or invalid Content-Range",
    errorRangeInconsistent: "Inconsistent media range; download stopped to avoid a corrupt file",
    errorRangeUnsupported: "Server stopped supporting partial downloads",
    errorLength: "Invalid Content-Length",
    errorEmpty: "Empty media response",
    errorTooLarge: "Media response exceeds the expected size",
    errorIncomplete: "Incomplete media response; received byte count does not match",
    errorTimeout: "No data received for 30 seconds. Please retry.",
    errorUnexpected: "Download failed: {message}",
  };
  const formatMessage = (key, params = {}) =>
    (UI_MESSAGES[key] ?? key).replace(
      /\{(\w+)\}/g,
      (placeholder, name) => Object.hasOwn(params, name) ? String(params[name]) : placeholder
    );
  const integerFormat = new Intl.NumberFormat(UI_LANGUAGE, { maximumFractionDigits: 0 });
  const decimalFormat = new Intl.NumberFormat(UI_LANGUAGE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const downloadError = (key, params = {}, name = "Error") => {
    const details = { ...params };
    if (key === "errorMime") {
      details.kind = formatMessage(params.kind);
      details.mime ||= formatMessage("unknownType");
    }
    return Object.assign(new Error(formatMessage(key, details)), { name, messageKey: key, params: details });
  };
  const formatDownloadError = (error) => {
    if (!error) return "";
    if (!error.messageKey) return formatMessage("errorUnexpected", { message: error.message || String(error) });
    return formatMessage(error.messageKey, error.params);
  };
  const labelDownloadButton = (button, loading = false) => {
    const label = formatMessage(loading ? "loadingMedia" : "download");
    if (button.title !== label) button.title = label;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    if (button.lang !== UI_LANGUAGE) button.lang = UI_LANGUAGE;
  };
  const logger = {
    info: (message, fileName = null) => {
      console.log(
        `[Tel Download] ${fileName ? `${fileName}: ` : ""}${message}`
      );
    },
    error: (message, fileName = null) => {
      console.error(
        `[Tel Download] ${fileName ? `${fileName}: ` : ""}${message}`
      );
    },
  };
  // WebK's icon font code points change between releases. Only learn the
  // download glyph from native buttons in this page, never from our own buttons.
  const WEB_K_DOWNLOAD_BUTTON_SELECTOR = [
    "button.quality-download-options-button-menu",
    "button.tgico-download",
    'button[aria-label="Download"]',
    'button[title="Download"]',
  ].join(", ");
  const getWebKDownloadButtons = (container) =>
    Array.from(container.querySelectorAll(WEB_K_DOWNLOAD_BUTTON_SELECTOR)).filter(
      (button) =>
        !button.matches(".tel-download, ._tel_download_button_pinned_container")
    );
  const isUsableDownloadButton = (button) => {
    if (button.disabled || button.getAttribute("aria-disabled") === "true" ||
        button.hidden || button.classList.contains("hide") || button.closest("[inert]")) {
      return false;
    }
    const style = getComputedStyle(button);
    return style.visibility !== "hidden" && style.visibility !== "collapse" &&
      button.getClientRects().length > 0;
  };
  let webKDownloadGlyph = "";
  const createWebKDownloadIcon = (buttonIcon = false) =>
    `<span class="tgico tel-download-icon${buttonIcon ? " button-icon" : ""}" aria-hidden="true">${
      webKDownloadGlyph ||
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle" aria-hidden="true" focusable="false"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/></svg>'
    }</span>`;
  const refreshWebKDownloadIcon = () => {
    for (const button of getWebKDownloadButtons(document)) {
      const glyph = button.querySelector(":scope > .tgico")?.textContent.trim();
      // Ignore labels or menu contents; the icon must be one private-use glyph.
      if (!glyph || !/^[\uE000-\uF8FF]$/.test(glyph)) continue;
      if (glyph !== webKDownloadGlyph) {
        // Keep this in memory only: a new page load may use a different font.
        webKDownloadGlyph = glyph;
        document.querySelectorAll(".tel-download-icon").forEach((icon) => {
          icon.textContent = glyph;
        });
      }
      return;
    }
  };
  // Media requests and local file saving.
  const contentRangeRegex = /^bytes (\d+)-(\d+)\/(\d+)$/;
  const REFRESH_DELAY = 2000;
  const DOWNLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
  const fetchMediaPart = async (url, offset, total, kind, options = {}) => {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    let timer;
    let reader;
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(
        downloadError("errorTimeout", {}, "TimeoutError")
      ), 30000);
    };
    const checkAborted = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    resetTimeout();
    try {
      checkAborted();
      const res = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + DOWNLOAD_CHUNK_SIZE - 1}` },
        signal: controller.signal,
      });
      if (res.status !== 200 && res.status !== 206) {
        throw downloadError("errorHttp", { status: res.status });
      }
      const mime = res.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
      if (!mime?.startsWith(`${kind}/`)) {
        throw downloadError("errorMime", { kind, mime });
      }
      let expectedSize;
      let totalSize;
      if (res.status === 206) {
        const match = res.headers.get("Content-Range")?.match(contentRangeRegex);
        if (!match) throw downloadError("errorRangeMissing");
        const [start, end, size] = match.slice(1).map(Number);
        if (![start, end, size].every(Number.isSafeInteger) ||
            start !== offset || end < start || size <= end ||
            (total !== null && total !== size)) {
          throw downloadError("errorRangeInconsistent");
        }
        expectedSize = end - start + 1;
        totalSize = size;
      } else {
        if (offset !== 0) throw downloadError("errorRangeUnsupported");
        const length = res.headers.get("Content-Length");
        if (length !== null && !res.headers.has("Content-Encoding")) {
          if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
            throw downloadError("errorLength");
          }
          expectedSize = Number(length);
          totalSize = expectedSize;
        }
      }
      if (!res.body) throw downloadError("errorEmpty");
      reader = res.body.getReader();
      controller.signal.addEventListener("abort", () => {
        reader.cancel().catch(() => {});
      }, { once: true });
      const chunks = [];
      let received = 0;
      options.onProgress?.(offset, totalSize ?? null);
      while (true) {
        checkAborted();
        const { value, done } = await reader.read();
        checkAborted();
        if (done) break;
        received += value.byteLength;
        if (expectedSize !== undefined && received > expectedSize) {
          throw downloadError("errorTooLarge");
        }
        // Wait for disk writes before reading more data, so slow disks do not
        // cause an unbounded queue of writes or large in-memory responses.
        clearTimeout(timer);
        if (options.write) await options.write(value);
        else chunks.push(value);
        checkAborted();
        resetTimeout();
        options.onProgress?.(offset + received, totalSize ?? null);
      }
      if (!received || (expectedSize !== undefined && received !== expectedSize)) {
        throw downloadError("errorIncomplete");
      }
      return {
        blob: options.write ? null : new Blob(chunks, { type: mime }),
        mime, totalSize: totalSize ?? received, nextOffset: offset + received,
      };
    } catch (error) {
      controller.abort(error);
      throw controller.signal.reason || error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  };
  const hashCode = (s) => {
    let h = 0,
      l = s.length,
      i = 0;
    if (l > 0) {
      while (i < l) {
        h = ((h << 5) - h + s.charCodeAt(i++)) | 0;
      }
    }
    return h >>> 0;
  };

  const getMediaMetadata = (url) => {
    try {
      return JSON.parse(decodeURIComponent(url.split("/").pop()));
    } catch {
      return {};
    }
  };
  const getDownloadFileName = (url, mime, kind) => {
    const extensions = {
      "video/mp4": ["mp4", "m4v"], "video/webm": ["webm"],
      "video/quicktime": ["mov"], "video/x-matroska": ["mkv"],
      "audio/ogg": ["ogg", "oga", "opus"], "audio/mpeg": ["mp3"],
      "audio/mp4": ["m4a"], "audio/webm": ["webm"], "audio/aac": ["aac"],
      "audio/wav": ["wav"], "audio/x-wav": ["wav"],
      "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
      "image/webp": ["webp"], "image/gif": ["gif"], "image/avif": ["avif"],
      "image/heic": ["heic"], "image/bmp": ["bmp"], "image/svg+xml": ["svg"],
    };
    const metadata = getMediaMetadata(url);
    let name = typeof metadata?.fileName === "string" ? metadata.fileName : "";
    if (!name) {
      try {
        const basename = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop());
        if (/\.[a-z0-9]{2,5}$/i.test(basename)) name = basename;
      } catch {
        // Some blob URLs do not carry a filename.
      }
    }
    name = (name || hashCode(url).toString(36)).replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_");
    const allowed = extensions[mime?.toLowerCase()] || (mime ? null :
      (kind === "video" ? ["mp4"] : kind === "audio" ? ["ogg"] : ["jpg"]));
    const dot = name.lastIndexOf(".");
    if (!allowed) return dot > 0 ? name : name + ".bin";
    if (dot > 0 && allowed.includes(name.slice(dot + 1).toLowerCase())) return name;
    return (dot > 0 ? name.slice(0, dot) : name) + "." + allowed[0];
  };
  const saveMediaBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Let the browser consume the URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // Download queue and progress cards.
  const downloadTasks = new Map();
  const activeDownloads = new Map();
  const downloadQueue = [];
  const MAX_CONCURRENT_DOWNLOADS = 2;
  let runningDownloads = 0;

  const formatBytes = (bytes) => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
    return `${(index ? decimalFormat : integerFormat).format(bytes / (1024 ** index))} ${units[index]}`;
  };
  const updateTaskPanel = () => {
    const panel = document.getElementById("tel-downloader-progress-bar-container");
    if (!panel) return;
    panel.hidden = !panel.querySelector(".tel-task");
    panel.querySelector(".tel-panel-title").textContent = activeDownloads.size
      ? formatMessage("downloadsCount", { count: integerFormat.format(activeDownloads.size) }) : formatMessage("downloads");
  };
  const dismissTask = (task) => {
    document.getElementById("tel-downloader-progress-" + task.id)?.remove();
    if (task.finished) downloadTasks.delete(task.id);
    updateTaskPanel();
  };
  const showTask = (task) => {
    const panel = document.getElementById("tel-downloader-progress-bar-container");
    const list = panel.querySelector(".tel-task-list");
    list.hidden = false;
    const toggle = panel.querySelector(".tel-panel-toggle");
    toggle.textContent = formatMessage("hide");
    toggle.setAttribute("aria-expanded", "true");
    let card = document.getElementById("tel-downloader-progress-" + task.id);
    if (!card) {
      card = document.createElement("div");
      card.id = "tel-downloader-progress-" + task.id;
      card.className = "tel-task";
      card.tabIndex = -1;
      card.innerHTML = `
        <div class="tel-task-heading"><p class="filename" dir="auto"></p><button type="button" data-action="dismiss">&times;</button></div>
        <span class="tel-task-state" role="status" aria-live="polite"></span>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div></div><p></p></div>
        <p class="tel-task-details"></p><p class="tel-task-error"></p>
        <div class="tel-task-actions"><button type="button" data-action="cancel"></button><button type="button" data-action="retry" hidden></button></div>`;
      card.querySelector('[data-action="dismiss"]').onclick = () => dismissTask(task);
      card.querySelector('[data-action="cancel"]').onclick = () => {
        if (task.finished || task.state === "saving") return;
        task.controller.abort(new DOMException("Download cancelled", "AbortError"));
        if (!task.running) finishTask(task, "cancelled");
      };
      card.querySelector('[data-action="retry"]').onclick = () => {
        dismissTask(task);
        downloadMedia(task.url, task.kind);
      };
      list.prepend(card);
    }
    renderTask(task);
    return card;
  };
  const renderTask = (task) => {
    const card = document.getElementById("tel-downloader-progress-" + task.id);
    if (!card) return;
    const label = formatMessage(task.state);
    card.dataset.state = task.state;
    const title = card.querySelector(".filename");
    title.textContent = task.fileName;
    title.title = task.fileName;
    const state = card.querySelector(".tel-task-state");
    if (state.textContent !== label) state.textContent = label;
    const progress = card.querySelector(".progress");
    progress.setAttribute("aria-label", formatMessage("progress"));
    card.querySelector('[data-action="dismiss"]').setAttribute("aria-label", formatMessage("dismiss"));
    const percent = task.total ? Math.min(100, Math.floor(task.received * 100 / task.total)) : null;
    progress.classList.toggle("tel-indeterminate", task.state === "downloading" && percent === null);
    if (percent === null) progress.removeAttribute("aria-valuenow");
    else progress.setAttribute("aria-valuenow", percent);
    progress.setAttribute("aria-valuetext", label);
    progress.querySelector("div").style.width = (percent ?? 0) + "%";
    progress.querySelector("p").textContent = task.state === "downloading" && percent !== null ? `${integerFormat.format(percent)}%` : label;
    const speed = task.received / Math.max((performance.now() - task.startedAt) / 1000, 0.1);
    card.querySelector(".tel-task-details").textContent =
      formatBytes(task.received) + (task.total !== null ? ` / ${formatBytes(task.total)}` : "") +
      (task.state === "downloading" && task.received ? ` · ${formatMessage("rate", { speed: formatBytes(speed) })}` : "");
    const error = card.querySelector(".tel-task-error");
    error.textContent = formatDownloadError(task.error);
    error.hidden = !task.error;
    const cancel = card.querySelector('[data-action="cancel"]');
    cancel.textContent = formatMessage("cancel");
    cancel.hidden = task.finished;
    cancel.disabled = task.state === "saving";
    const retry = card.querySelector('[data-action="retry"]');
    retry.textContent = formatMessage("retry");
    retry.hidden = !["failed", "cancelled"].includes(task.state);
    task.renderedAt = performance.now();
    task.renderedBytes = task.received;
    updateTaskPanel();
  };
  const finishTask = (task, state, error) => {
    if (task.finished) return;
    task.finished = true;
    clearTimeout(task.progressTimer);
    task.state = state;
    task.error = error;
    if (activeDownloads.get(task.key) === task) activeDownloads.delete(task.key);
    if (error) logger.error(error, task.fileName);
    renderTask(task);
    if (!document.getElementById("tel-downloader-progress-" + task.id)) downloadTasks.delete(task.id);
    updateTaskPanel();
    task.resolve({ state, fileName: task.fileName, received: task.received });
  };
  const runTask = async (task) => {
    const parts = [];
    let writable;
    const checkCancelled = () => {
      if (task.controller.signal.aborted) throw task.controller.signal.reason;
    };
    try {
      checkCancelled();
      task.state = "preparing";
      renderTask(task);
      if (task.handle) writable = await task.handle.createWritable();
      checkCancelled();
      task.state = "downloading";
      task.startedAt = performance.now();
      renderTask(task);
      let offset = 0;
      let total = null;
      let mime;
      do {
        const part = await fetchMediaPart(task.url, offset, total, task.kind, {
          signal: task.controller.signal,
          write: writable ? (chunk) => writable.write(chunk) : undefined,
          onProgress: (received, size) => {
            task.received = received;
            task.total = size;
            if ((!task.renderedBytes && received) || performance.now() - task.renderedAt >= 100 || received === size) {
              renderTask(task);
            } else if (!task.progressTimer) {
              task.progressTimer = setTimeout(() => {
                task.progressTimer = null;
                renderTask(task);
              }, 100);
            }
          },
        });
        checkCancelled();
        if (!writable) parts.push(part.blob);
        offset = part.nextOffset;
        total = part.totalSize;
        mime = part.mime;
        task.fileName = getDownloadFileName(task.url, mime, task.kind);
        task.received = offset;
        task.total = total;
        renderTask(task);
      } while (offset < total);
      checkCancelled();
      task.state = "saving";
      renderTask(task);
      if (writable) await writable.close();
      else saveMediaBlob(new Blob(parts, { type: mime }), task.fileName);
      finishTask(task, writable ? "completed" : "handedOff");
    } catch (error) {
      if (writable) {
        try { await writable.abort(); } catch { /* Already closed or errored. */ }
      }
      if (task.controller.signal.aborted || error.name === "AbortError") finishTask(task, "cancelled");
      else finishTask(task, "failed", error);
    } finally {
      parts.length = 0;
      task.handle = null;
    }
  };
  const pumpDownloads = () => {
    while (runningDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length) {
      const task = downloadQueue.shift();
      if (task.finished) continue;
      runningDownloads++;
      task.running = true;
      runTask(task).finally(() => {
        task.running = false;
        runningDownloads--;
        pumpDownloads();
      });
    }
  };
  const downloadMedia = (url, kind) => {
    if (typeof url !== "string" || !url) return Promise.resolve();
    const key = `${kind}:${url}`;
    const existing = activeDownloads.get(key);
    if (existing) {
      const card = showTask(existing);
      card.scrollIntoView({ block: "nearest" });
      card.focus({ preventScroll: true });
      return existing.promise;
    }
    // Retain a small history without retaining media buffers.
    for (const previous of downloadTasks.values()) {
      if (downloadTasks.size < 20) break;
      if (previous.finished) dismissTask(previous);
    }
    const task = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      key, url, kind, fileName: getDownloadFileName(url, getMediaMetadata(url)?.mimeType, kind),
      state: "preparing", received: 0, total: null, controller: new AbortController(),
      startedAt: performance.now(), renderedAt: 0, finished: false,
    };
    task.promise = new Promise(resolve => { task.resolve = resolve; });
    downloadTasks.set(task.id, task);
    activeDownloads.set(key, task);
    showTask(task);
    const enqueue = (handle) => {
      if (task.finished) return;
      task.handle = handle;
      task.state = "queued";
      renderTask(task);
      downloadQueue.push(task);
      pumpDownloads();
    };
    try {
      const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
      if (kind !== "image" && typeof pageWindow.showSaveFilePicker === "function" &&
          pageWindow.self === pageWindow.top) {
        // Keep the picker inside the original click, before queueing or fetching.
        Promise.resolve(pageWindow.showSaveFilePicker({ suggestedName: task.fileName }))
          .then(enqueue, (error) => {
            if (error.name === "AbortError") finishTask(task, "cancelled");
            else finishTask(task, "failed", error);
          });
      } else enqueue(null);
    } catch (error) {
      finishTask(task, "failed", error);
    }
    return task.promise;
  };
  const tel_download_video = (url) => downloadMedia(url, "video");
  const tel_download_audio = (url) => downloadMedia(url, "audio");
  const tel_download_image = (url) => downloadMedia(url, "image");

  // Resolve media sources from Telegram's current viewer.
  const getMediaSource = (media) =>
    media?.getAttribute("src") ? media.src :
      media?.currentSrc || media?.querySelector("source")?.src;

  const getPinnedMedia = () => {
    const pinned = document.querySelector(".pinned-audio");
    const mid = pinned?.getAttribute("data-mid");
    if (!mid) return null;
    const peer = pinned.getAttribute("data-peer-id");
    const candidates = Array.from(document.querySelectorAll("audio-element")).filter(
      (element) => element.closest(".bubble") && element.getAttribute("data-mid") === mid &&
        (!peer || element.closest("[data-peer-id]")?.getAttribute("data-peer-id") === peer)
    );
    const element = candidates.length === 1 ? candidates[0] :
      candidates.find((candidate) => candidate.audio && !candidate.audio.paused);
    const url = getMediaSource(element?.audio);
    return url ? { url, kind: element.audio.tagName === "AUDIO" ? "audio" : "video" } : null;
  };

  const downloadCurrentWebKMedia = () => {
    // The toolbar can outlive its media node. Resolve both at click time.
    const viewer = document.querySelector(".media-viewer-whole");
    if (!viewer) return;
    const buttons = viewer.querySelector(".media-viewer-topbar .media-viewer-buttons");
    const nativeDownload = buttons && getWebKDownloadButtons(buttons).find(
      (button) => isUsableDownloadButton(button) && !button.matches(
        '.quality-download-options-button-menu, .btn-menu-toggle, [aria-haspopup="menu"], [aria-haspopup="true"]'
      )
    );
    if (nativeDownload) {
      nativeDownload.click();
      return;
    }
    const media = viewer.querySelector(".media-viewer-movers .media-viewer-aspecter");
    const videoUrl = getMediaSource(media?.querySelector("video"));
    const imageUrl = getMediaSource(media?.querySelector("img.thumbnail"));
    if (videoUrl) tel_download_video(videoUrl);
    else if (imageUrl) tel_download_image(imageUrl);
  };

  logger.info("Initialized");

  const createDownloadButton = (className, iconHTML, onClick) => {
    const button = document.createElement("button");
    button.className = className;
    button.innerHTML = iconHTML;
    button.type = "button";
    labelDownloadButton(button);
    button.onclick = onClick;
    return button;
  };
  const getWebADownloadButtons = (container) =>
    Array.from(container.querySelectorAll("button")).filter((button) =>
      !button.classList.contains("tel-download") &&
      (button.querySelector(".icon-download") || button.title === "Download" ||
        button.getAttribute("aria-label") === "Download") && isUsableDownloadButton(button)
    );
  const downloadCurrentWebAMedia = () => {
    const media = document.querySelector("#MediaViewer .MediaViewerSlide--active");
    const videoUrl = getMediaSource(media?.querySelector(".VideoPlayer video"));
    const imageUrl = getMediaSource(media?.querySelector(".MediaViewerContent > div > img"));
    if (videoUrl) tel_download_video(videoUrl);
    else if (imageUrl) tel_download_image(imageUrl);
  };

  // Send a copy: stage media in memory and open Web K's native upload preview.
  const COPY_LIMIT = 256 * 1024 * 1024;
  const COPY_UI_CSS = `
    #tel-copy-panel, #tel-downloader-progress-bar-container {
      --tc-bg:#ffffff; --tc-raised:#f5f8fa; --tc-text:#172b39; --tc-muted:#607785;
      --tc-line:#e1e9ed; --tc-accent:#167964; --tc-accent-text:#ffffff;
      --tc-soft:#e7f5f0; --tc-warn:#875b16; --tc-warn-bg:#fff7e7;
      color-scheme:light;
    }
    @media (prefers-color-scheme:dark) {
      #tel-copy-panel, #tel-downloader-progress-bar-container {
        --tc-bg:#14232e; --tc-raised:#1b2e3b; --tc-text:#edf5f8; --tc-muted:#9bb1be;
        --tc-line:#304552; --tc-accent:#8ae1c9; --tc-accent-text:#102c26;
        --tc-soft:#1e3d37; --tc-warn:#f0cc86; --tc-warn-bg:#352f23; color-scheme:dark;
      }
    }
    html.night #tel-copy-panel, html.theme-dark #tel-copy-panel,
    html.night #tel-downloader-progress-bar-container, html.theme-dark #tel-downloader-progress-bar-container {
      --tc-bg:#14232e; --tc-raised:#1b2e3b; --tc-text:#edf5f8; --tc-muted:#9bb1be;
      --tc-line:#304552; --tc-accent:#8ae1c9; --tc-accent-text:#102c26;
      --tc-soft:#1e3d37; --tc-warn:#f0cc86; --tc-warn-bg:#352f23; color-scheme:dark;
    }
    #tel-copy-panel {
      position:fixed; right:max(18px,env(safe-area-inset-right)); left:auto; bottom:max(18px,env(safe-area-inset-bottom));
      width:356px; max-width:calc(100vw - 32px); max-height:calc(100vh - 36px); overflow:auto;
      z-index:2147483646; padding:20px; border:1px solid var(--tc-line); border-radius:20px;
      background:var(--tc-bg); color:var(--tc-text); box-shadow:0 18px 64px #0003,0 2px 8px #0001;
      font:13px/1.55 system-ui,-apple-system,sans-serif; text-align:left; letter-spacing:normal;
    }
    #tel-copy-panel *, #tel-copy-panel *::before, #tel-copy-panel *::after {box-sizing:border-box;}
    #tel-copy-panel[hidden], #tel-copy-panel [hidden], .tel-copy-button[hidden] {display:none!important;}
    #tel-copy-panel .tel-copy-heading {display:flex; align-items:center; gap:11px;}
    #tel-copy-panel .tel-copy-minimize {margin-left:auto; min-height:30px; width:30px; padding:0; border-color:transparent; font-size:23px; line-height:1; color:var(--tc-muted); flex-shrink:0;}
    .tel-copy-launcher {position:fixed; right:18px; bottom:18px; z-index:2147483646; border-radius:30px; padding:10px 16px;}
    #tel-copy-panel .tel-copy-brand {display:grid; place-items:center; flex:0 0 40px; height:40px; border-radius:13px; background:var(--tc-soft); color:var(--tc-accent);}
    #tel-copy-panel .tel-copy-brand svg {width:21px; height:21px;}
    #tel-copy-panel .tel-copy-title {display:block; font-size:17px; font-weight:700; letter-spacing:-.35px; line-height:1.3;}
    #tel-copy-panel .tel-copy-subtitle {display:block; color:var(--tc-muted); font-size:11px; margin-top:3px;}
    #tel-copy-panel .tel-copy-status {margin:17px 0; padding:13px 14px; background:var(--tc-raised); border:1px solid var(--tc-line); border-radius:12px; white-space:pre-line; overflow-wrap:anywhere; font-size:12px; line-height:1.65; color:var(--tc-text);}
    #tel-copy-panel .tel-copy-actions {display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px;}
    #tel-copy-panel button {min-height:39px; padding:9px 13px; border-radius:10px; border:1px solid var(--tc-line); background:transparent; color:var(--tc-text); font:600 12px/1.4 system-ui; cursor:pointer; transition:background .15s,opacity .15s,transform .15s;}
    #tel-copy-panel button:hover {background:var(--tc-raised);}
    #tel-copy-panel button:active {transform:translateY(1px);}
    #tel-copy-panel .tel-copy-prepare {border-color:transparent; background:var(--tc-accent); color:var(--tc-accent-text);}
    #tel-copy-panel .tel-copy-prepare:hover {filter:brightness(1.07);}
    #tel-copy-panel button:disabled {opacity:.38; cursor:default; transform:none; filter:none;}
    #tel-copy-panel button:focus-visible, #tel-copy-panel input:focus-visible {outline:2px solid var(--tc-accent); outline-offset:3px;}
    #tel-copy-panel .tel-copy-bypass {display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; padding:12px; border:1px solid var(--tc-line); border-radius:12px; background:var(--tc-warn-bg); cursor:pointer;}
    #tel-copy-panel .tel-copy-bypass-title {display:block; white-space:nowrap; font-size:12px; font-weight:650; line-height:1.4; color:var(--tc-text);}
    #tel-copy-panel .tel-copy-bypass-hint {display:block; font-size:10px; line-height:1.5; color:var(--tc-warn); margin-top:3px;}
    #tel-copy-panel .tel-copy-bypass input {appearance:none; -webkit-appearance:none; flex:0 0 34px; width:34px; height:20px; margin:0; padding:2px; border:1px solid var(--tc-muted); border-radius:20px; background:var(--tc-raised); cursor:pointer; transition:background .15s;}
    #tel-copy-panel .tel-copy-bypass input::before {content:""; display:block; width:14px; height:14px; border-radius:50%; background:var(--tc-muted); transition:transform .15s;}
    #tel-copy-panel .tel-copy-bypass input:checked {background:var(--tc-accent); border-color:var(--tc-accent);}
    #tel-copy-panel .tel-copy-bypass input:checked::before {transform:translateX(14px); background:var(--tc-accent-text);}
    #tel-copy-panel .tel-copy-note {display:flex; align-items:flex-start; gap:7px; border-top:1px solid var(--tc-line); padding-top:13px; margin-top:15px; color:var(--tc-muted); font-size:10px; line-height:1.6;}
    #tel-copy-panel .tel-copy-note::before {content:""; flex:0 0 5px; height:5px; border-radius:50%; margin-top:5px; background:var(--tc-accent);}
    .tel-copy-button {display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:34px; padding:8px 13px; border:1px solid #3f7b80; border-radius:11px; background:#1b4149; color:#d4fff0; font:650 12px/1.4 system-ui; cursor:pointer; flex-shrink:0; pointer-events:auto; box-shadow:0 3px 12px #0002; transition:background .15s,transform .15s;}
    .tel-copy-button::before {content:"↗"; font-size:17px; line-height:1;}
    .tel-copy-button:hover {background:#28535b; transform:translateY(-1px);}
    .tel-copy-button:focus-visible {outline:2px solid #8ae1c9; outline-offset:3px;}
    .tel-copy-selection {position:fixed; right:18px; bottom:90px; z-index:2147483646; border-radius:30px; padding:11px 17px;}
    #tel-downloader-progress-bar-container, html.night #tel-downloader-progress-bar-container, html.theme-dark #tel-downloader-progress-bar-container {--tel-bg:var(--tc-bg); --tel-fg:var(--tc-text); --tel-muted:var(--tc-muted); --tel-line:var(--tc-line); --tel-track:var(--tc-raised); --tel-accent:var(--tc-accent); border-radius:18px; box-shadow:0 14px 48px #0003;}
    #tel-downloader-progress-bar-container .tel-panel-heading {padding:14px 15px;}
    #tel-downloader-progress-bar-container .tel-panel-title {font-weight:700; letter-spacing:-.2px;}
    #tel-downloader-progress-bar-container .tel-task {padding:14px 15px;}
    #tel-downloader-progress-bar-container .progress {border-radius:30px; overflow:hidden;}
    #tel-downloader-progress-bar-container button {border-radius:8px; min-height:30px;}
    #tel-downloader-progress-bar-container .tel-task-actions {gap:7px;}
    @media (prefers-reduced-motion:reduce) {#tel-copy-panel *, .tel-copy-button {transition:none!important;}}
    @media (max-width:380px) {#tel-copy-panel {padding:15px; right:12px; left:auto; bottom:12px; max-width:calc(100vw - 24px);}}
  `;
  const copyState = { files: [], bytes: 0, account: null, generation: 0, busy: false, popup: null, count: 0, handle: null, opening: false, destination: null, groupingBypass: false, groupingCheckFailed: false };
  const copySilentVideos = new WeakSet();
  const copyPage = () => typeof unsafeWindow === "undefined" ? window : unsafeWindow;

  const copyGetMedia = (message) => {
    const source = message?.media;
    const media = source?.photo || source?.document;
    if (!media || !["photo", "document"].includes(media._)) throw new Error("Choose messages with photos, videos or audio attachments. Links and paid-media previews are not supported.");
    const attributes = media.attributes || [];
    const mime = media._ === "photo" ? "image/jpeg" : String(media.mime_type || "").toLowerCase().split(";")[0];
    if (!/^(image|video|audio)\//.test(mime)) throw new Error(`Unsupported attachment type: ${mime || "missing MIME type"}.`);
    const round = attributes.some(a => a._ === "documentAttributeVideo" && (a.pFlags?.round_message || a.round_message));
    const voice = attributes.some(a => a._ === "documentAttributeAudio" && (a.pFlags?.voice || a.voice));
    const needsVideoConversion = mime === "image/gif";
    // A round-message flag belongs to the original Telegram message. A fresh
    // MP4 File upload has no round-message attribute and is a regular video.
    const groupable = ["image/jpeg", "image/png", "video/mp4"].includes(mime) || needsVideoConversion;
    let thumb;
    if (media._ === "photo") {
      thumb = (media.sizes || []).filter(s => ["photoSize", "photoSizeProgressive"].includes(s._))
        .sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0))[0];
      if (!thumb) throw new Error("The full photo is not available yet. Open it first, then retry.");
    }
    const size = Number(media.size || thumb?.size || thumb?.sizes?.at(-1) || 0);
    const name = attributes.find(a => a._ === "documentAttributeFilename")?.file_name;
    return { media, mime, groupable, thumb, size, name, needsVideoConversion, sourceRound: round, sourceVoice: voice };
  };

  const copyValidateSelection = (messages) => {
    if (!messages.length) throw new Error("Select at least one media message first.");
    const descriptors = messages.map((message, index) => {
      try { return copyGetMedia(message); }
      catch (error) { throw new Error(`Selection item ${index + 1}: ${error.message || String(error)}`); }
    });
    if (descriptors.length > 1) {
      const index = descriptors.findIndex(d => !d.groupable);
      if (index !== -1) {
        const d = descriptors[index];
        const kind = d.sourceVoice ? "voice note" : d.mime.startsWith("audio/") ? "audio" : "attachment";
        const name = d.name ? `, ${String(d.name).slice(0, 100)}` : "";
        throw new Error(`Selection item ${index + 1} (${kind}, ${d.mime}${name}) cannot join a photo/video album. Send that item separately.`);
      }
    }
    if (descriptors.reduce((n, d) => n + d.size, 0) > COPY_LIMIT) throw new Error("This selection exceeds the 256 MiB in-memory limit. Choose a smaller album.");
    return descriptors;
  };

  // Inspect the MP4 track handlers instead of trusting Telegram's optional
  // animated/nosound flags. Skip mdat payloads; only small headers are read.
  const copyMp4HasAudio = async (blob, check = () => {}) => {
    let boxes = 0, moov = false, video = false, audio = false;
    const walk = async (start, end, depth) => {
      for (let offset = start; offset + 8 <= end;) {
        check();
        if (++boxes > 2048) throw new Error("MP4 metadata is too complex to inspect.");
        const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + 16, end)).arrayBuffer());
        check();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let size = view.getUint32(0), header = 8;
        const type = String.fromCharCode(...bytes.slice(4, 8));
        if (size === 1) {
          if (bytes.length < 16) throw new Error("Truncated MP4 metadata.");
          size = view.getUint32(8) * 4294967296 + view.getUint32(12); header = 16;
        } else if (size === 0) size = end - offset;
        if (!Number.isSafeInteger(size) || size < header || offset + size > end) throw new Error("Invalid MP4 box length.");
        if ((depth === 0 && type === "moov") || (depth === 1 && type === "trak") || (depth === 2 && type === "mdia")) {
          if (type === "moov") moov = true;
          await walk(offset + header, offset + size, depth + 1);
        } else if (depth === 3 && type === "hdlr" && size >= header + 12) {
          const handler = new Uint8Array(await blob.slice(offset + header + 8, offset + header + 12).arrayBuffer());
          check();
          const kind = String.fromCharCode(...handler);
          audio ||= kind === "soun";
          video ||= kind === "vide";
        }
        offset += size;
      }
    };
    try { await walk(0, blob.size, 0); } catch (error) { check(); return null; }
    return moov && video ? audio : null;
  };

  const copyMp4RecordingType = () => {
    const page = copyPage();
    if (!page.MediaRecorder || !(page.AudioContext || page.webkitAudioContext) || !page.MediaStream) throw new Error("This browser cannot convert GIFs to album-ready MP4 videos. Use a recent desktop Chrome.");
    const type = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"].find(type => page.MediaRecorder.isTypeSupported(type));
    if (!type) throw new Error("MP4 recording is unavailable in this browser. The album was not sent.");
    return type;
  };

  // Real conversion, not a MIME/extension rename. The silent audio track keeps
  // WebK from reclassifying a short, soundless MP4 as a GIF on fresh upload.
  const copyConvertAnimation = async (blob, descriptor, check, progress) => {
    const page = copyPage();
    const mimeType = copyMp4RecordingType();
    let decoder, video, url, context, oscillator, gain, audioDestination, stream, recorder;
    let frameRequest, timer, done, terminalError, firstImage, recordingStarted = false;
    const cleanups = [];
    const chunks = [];
    let recordedBytes = 0;
    const canvas = document.createElement("canvas");
    const drawing = canvas.getContext("2d", { alpha: false });
    if (!drawing || typeof canvas.captureStream !== "function") throw new Error("Canvas video capture is unavailable in this browser.");
    const stop = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };
    const verify = () => {
      check();
      if (terminalError) throw terminalError;
      if (document.hidden) throw new Error("Keep Telegram’s tab visible while converting GIFs. Nothing was sent.");
    };
    const delay = async ms => {
      let remaining = ms;
      while (remaining > 0) {
        verify();
        const part = Math.min(100, remaining);
        await new Promise(resolve => setTimeout(resolve, part));
        remaining -= part;
      }
      verify();
    };
    const waitFor = (element, event, timeout = 15000) => new Promise((resolve, reject) => {
      let timeoutId;
      const clean = () => { clearTimeout(timeoutId); element.removeEventListener(event, success); element.removeEventListener("error", failure); };
      const success = () => { clean(); resolve(); };
      const failure = () => { clean(); reject(new Error("The animation could not be decoded as video.")); };
      element.addEventListener(event, success, { once: true });
      element.addEventListener("error", failure, { once: true });
      timeoutId = setTimeout(() => { clean(); reject(new Error("Animation decoding timed out.")); }, timeout);
      cleanups.push(clean);
    });
    try {
      verify();
      let width, height, frameCount = 0;
      if (descriptor.mime === "image/gif") {
        if (!page.ImageDecoder || !(await page.ImageDecoder.isTypeSupported("image/gif"))) throw new Error("GIF frame decoding is unavailable in this browser.");
        decoder = new page.ImageDecoder({ data: await blob.arrayBuffer(), type: "image/gif", preferAnimation: true });
        await decoder.tracks.ready;
        await decoder.completed;
        frameCount = decoder.tracks.selectedTrack?.frameCount || 0;
        if (!frameCount) throw new Error("This GIF has no decodable animation frames.");
        firstImage = (await decoder.decode({ frameIndex: 0, completeFramesOnly: true })).image;
        width = firstImage.displayWidth;
        height = firstImage.displayHeight;
      } else {
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.style.cssText = "position:fixed;width:2px;height:2px;left:0;bottom:0;opacity:.01;pointer-events:none";
        url = page.URL.createObjectURL(blob);
        const ready = waitFor(video, "loadeddata");
        video.src = url;
        document.body.append(video);
        await ready;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 180) throw new Error("Animation conversion supports clips up to 3 minutes.");
        width = video.videoWidth;
        height = video.videoHeight;
      }
      if (!width || !height || width * height > 4096 * 2160) throw new Error("The animation dimensions are unsupported for browser conversion.");
      canvas.width = Math.ceil(width / 2) * 2;
      canvas.height = Math.ceil(height / 2) * 2;
      const draw = image => {
        drawing.fillStyle = "#000";
        drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.drawImage(image, 0, 0, width, height);
      };
      draw(firstImage || video);
      stream = canvas.captureStream(30);
      context = new (page.AudioContext || page.webkitAudioContext)();
      audioDestination = context.createMediaStreamDestination();
      oscillator = context.createOscillator();
      gain = context.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(audioDestination);
      oscillator.start();
      let resumeTimeout;
      try {
        await Promise.race([context.resume(), new Promise((_, reject) => { resumeTimeout = setTimeout(() => reject(new Error("Chrome blocked the audio encoder. Interact with Telegram and retry.")), 5000); })]);
      } finally { clearTimeout(resumeTimeout); }
      verify();
      for (const track of audioDestination.stream.getAudioTracks()) stream.addTrack(track);
      if (!stream.getAudioTracks().length) throw new Error("Could not create the silent audio track needed for album grouping.");
      recorder = new page.MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000, audioBitsPerSecond: 64000 });
      if (recorder.mimeType && !recorder.mimeType.toLowerCase().startsWith("video/mp4")) throw new Error("The encoder selected a non-MP4 container; the album was stopped.");
      done = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", event => {
          if (event.data.size) { recordedBytes += event.data.size; chunks.push(event.data); }
          if (recordedBytes > COPY_LIMIT) { terminalError = new Error("Converted video exceeds the in-memory limit."); stop(); }
        });
        recorder.addEventListener("error", event => { terminalError = event.error || new Error("The MP4 encoder failed."); stop(); });
        recorder.addEventListener("stop", () => terminalError ? reject(terminalError) : resolve(new Blob(chunks, { type: "video/mp4" })), { once: true });
      });
      done.catch(() => {});
      recorder.start(250);
      recordingStarted = true;
      const started = performance.now();
      timer = setInterval(() => {
        try {
          verify();
          if (performance.now() - started > 190000) throw new Error("Animation conversion exceeded 3 minutes.");
        } catch (error) { terminalError = error; stop(); }
      }, 150);
      const render = async () => {
        if (decoder) {
          let elapsed = 0;
          for (let i = 0; i < frameCount; i++) {
            verify();
            const frame = i === 0 ? firstImage : (await decoder.decode({ frameIndex: i, completeFramesOnly: true })).image;
            try {
              draw(frame);
              const duration = Math.max(10, Number(frame.duration || 100000) / 1000);
              elapsed += duration;
              if (elapsed > 180000) throw new Error("Animation conversion supports one GIF cycle up to 3 minutes.");
              progress(`Converting GIF · frame ${i + 1} of ${frameCount}`);
              await delay(duration);
            } finally {
              frame.close();
              if (i === 0) firstImage = null;
            }
          }
        } else {
          const ended = waitFor(video, "ended", Math.ceil(video.duration * 1000) + 20000);
          let lastProgress = -1;
          const tick = () => {
            if (video.ended || terminalError) return;
            try {
              verify();
              draw(video);
              const second = Math.floor(video.currentTime);
              if (second !== lastProgress) { lastProgress = second; progress(`Converting animation · ${second} / ${Math.ceil(video.duration)}s`); }
              frameRequest = page.requestAnimationFrame(tick);
            } catch (error) { terminalError = error; stop(); }
          };
          frameRequest = page.requestAnimationFrame(tick);
          await video.play();
          await ended;
        }
        await delay(120);
      };
      await Promise.race([render(), done.then(() => { throw terminalError || new Error("The encoder stopped before conversion finished."); })]);
      verify();
      stop();
      const output = await done;
      verify();
      if (!output.size) throw new Error("The MP4 conversion returned an empty video.");
      const header = new Uint8Array(await output.slice(0, 12).arrayBuffer());
      if (header.length < 12 || String.fromCharCode(...header.slice(4, 8)) !== "ftyp") throw new Error("The encoder output was not an MP4 container; nothing was sent.");
      if (await copyMp4HasAudio(output, verify) !== true) throw new Error("The encoded MP4 has no confirmed audio track. Stopped before upload so it cannot silently revert to a GIF.");
      return output;
    } catch (error) {
      terminalError = error;
      stop();
      if (done && recordingStarted) await done.catch(() => {});
      throw error;
    } finally {
      clearInterval(timer);
      if (frameRequest !== undefined) page.cancelAnimationFrame(frameRequest);
      cleanups.forEach(clean => clean());
      if (video) { video.pause(); video.removeAttribute("src"); video.load(); video.remove(); }
      if (url) page.URL.revokeObjectURL(url);
      firstImage?.close();
      decoder?.close();
      stream?.getTracks().forEach(track => track.stop());
      audioDestination?.stream.getTracks().forEach(track => track.stop());
      try { oscillator?.stop(); } catch {}
      oscillator?.disconnect();
      gain?.disconnect();
      if (context) await context.close().catch(() => {});
      chunks.length = 0;
    }
  };

  const copyLoadFiles = async (descriptors, download, check, progress, convert = copyConvertAnimation) => {
    const files = [];
    let bytes = 0;
    try {
      for (let i = 0; i < descriptors.length; i++) {
        check();
        const d = descriptors[i];
        progress(i, descriptors.length, bytes);
        let blob = await download({ media: d.media, ...(d.thumb ? { thumb: d.thumb } : {}) });
        check();
        if (!blob || typeof blob.arrayBuffer !== "function" || !blob.size) throw new Error("Telegram did not return a readable media file.");
        if (bytes + blob.size > COPY_LIMIT) throw new Error("The album exceeds the 256 MiB in-memory limit. Nothing was attached or sent.");
        const actual = String(blob.type || d.mime).split(";")[0].toLowerCase();
        if (actual !== d.mime && actual !== "application/octet-stream") throw new Error("The downloaded media type did not match the selection.");
        const convertVideo = d.mime === "image/gif";
        let silentVideo = false;
        if (d.mime === "video/mp4") {
          const hasAudio = await copyMp4HasAudio(blob, check);
          check();
          if (hasAudio === null) throw new Error("Could not inspect this MP4’s audio tracks. Nothing was attached or sent.");
          silentVideo = !hasAudio;
        }
        let outputMime = d.mime;
        if (convertVideo) {
          blob = await convert(blob, d, check, phase => progress(i, descriptors.length, bytes, phase));
          check();
          if (!blob?.size || String(blob.type).split(";")[0].toLowerCase() !== "video/mp4") throw new Error("GIF conversion did not produce an MP4 video. Nothing was attached or sent.");
          outputMime = "video/mp4";
        }
        bytes += blob.size;
        if (bytes > COPY_LIMIT) throw new Error("The converted album exceeds the 256 MiB in-memory limit. Nothing was attached or sent.");
        let name = (d.name || `telegram-copy-${i + 1}.${({"image/jpeg":"jpg","image/png":"png","video/mp4":"mp4","audio/ogg":"ogg","audio/mpeg":"mp3","image/gif":"gif"})[outputMime] || "bin"}`)
          .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_");
        if (convertVideo) name = name.replace(/\.[^.]+$/, "") + ".mp4";
        const file = new File([blob], name, { type: outputMime });
        if (silentVideo) copySilentVideos.add(file);
        files.push(file);
      }
      return { files, bytes };
    } catch (error) {
      files.length = 0;
      throw error;
    }
  };

  // WebK's prepared-media path accepts {file, editResult}. Its hasSound flag
  // selects regular-video vs GIF handling in the preview. Here it is a
  // classification hint only: the returned upload blob is the ORIGINAL silent
  // MP4. No audio is added, no encoder runs, and video bytes are not changed.
  const copyPrepareRegularVideo = async (file, check) => {
    const page = copyPage();
    let video, url, timeout, success, failure;
    try {
      check();
      video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;width:2px;height:2px;left:0;bottom:0;opacity:0;pointer-events:none";
      url = page.URL.createObjectURL(file);
      const ready = new Promise((resolve, reject) => {
        success = resolve;
        failure = () => reject(new Error("Could not prepare this silent MP4 for the upload preview."));
        video.addEventListener("loadeddata", success, { once: true });
        video.addEventListener("error", failure, { once: true });
        timeout = setTimeout(() => reject(new Error("Silent-video preview preparation timed out.")), 15000);
      });
      video.src = url;
      document.body.append(video);
      video.load();
      await ready;
      check();
      const width = video.videoWidth, height = video.videoHeight;
      if (!width || !height || !Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The silent video has invalid dimensions or duration.");
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 640 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const drawing = canvas.getContext("2d", { alpha: false });
      if (!drawing) throw new Error("Could not create a silent-video preview image.");
      drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
      const preview = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .8));
      check();
      if (!preview) throw new Error("Could not create a silent-video preview image.");
      const result = { blob: file, hasSound: true };
      return { file, editResult: { isVideo: true, width, height, preview, getResult: () => result } };
    } finally {
      clearTimeout(timeout);
      if (video) {
        video.removeEventListener("loadeddata", success);
        video.removeEventListener("error", failure);
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
      if (url) page.URL.revokeObjectURL(url);
    }
  };

  const copyAlbumSizes = count => {
    const sizes = [];
    for (let i = 0; i < count; i += 10) sizes.push(Math.min(10, count - i));
    return sizes;
  };
  const copyInspectAlbum = (popup, count) => {
    // WebK versions differ in .popup-photo nesting and whether an album's
    // cells carry popup-item-media, album-item, or both. Count each outermost
    // cell once, independently of wrappers, thumbnails and video controls.
    const albums = Array.from(popup.querySelectorAll(".popup-item-album"));
    const media = Array.from(popup.querySelectorAll(".popup-item-media, .popup-item-document"));
    if (count === 1) return { valid: albums.length === 0 && media.length === 1, details: `expected 1; media ${media.length}; albums ${albums.length}` };
    const albumSizes = new Map(albums.map(album => {
      const candidates = Array.from(album.querySelectorAll(".album-item, .grouped-item, .popup-item-media"));
      const candidateSet = new Set(candidates);
      const cells = candidates.filter(node => {
        for (let parent = node.parentElement; parent && parent !== album; parent = parent.parentElement) {
          if (candidateSet.has(parent)) return false;
        }
        return true;
      });
      return [album, cells.length];
    }));
    // Include generic popup-item wrappers: some builds don't label photos as
    // popup-item-media until rendering finishes. A standalone item is allowed
    // only when it matches the final one-item remainder in the batch plan.
    const attachmentNodes = Array.from(popup.querySelectorAll(".popup-item, .popup-item-media, .popup-item-document"));
    const outside = attachmentNodes.filter(node => !albums.some(album => node === album || album.contains(node) || node.contains(album)));
    const outsideSet = new Set(outside);
    const singleItems = new Set(outside.filter(node => {
      for (let parent = node.parentElement; parent && parent !== popup; parent = parent.parentElement) if (outsideSet.has(parent)) return false;
      return true;
    }));
    // querySelectorAll preserves DOM order, including a final standalone item
    // when the remainder is one (11 => 10 + 1, 21 => 10 + 10 + 1).
    const units = Array.from(popup.querySelectorAll(".popup-item-album, .popup-item, .popup-item-media, .popup-item-document"))
      .filter(node => albumSizes.has(node) || singleItems.has(node))
      .map(node => albumSizes.has(node) ? albumSizes.get(node) : 1);
    const expected = copyAlbumSizes(count);
    const valid = count > 0 && units.length === expected.length && units.every((size, i) => size === expected[i]);
    return { valid, details: `expected ${expected.join(" + ")}; detected ${units.join(" + ") || "none"}` };
  };
  const copyShouldBlockSend = ({sameDestination, contextMenu, validGrouping, bypassGrouping}) =>
    contextMenu || !sameDestination || (!validGrouping && !bypassGrouping);

  let copyPanel, copyLauncher, copyMinimized = false;
  const copySetMinimized = (value) => {
    copyMinimized = !!value;
    if (copyPanel) copyPanel.hidden = copyMinimized;
    if (copyLauncher) copyLauncher.hidden = !copyMinimized;
  };
  const copyResetGroupingBypass = () => {
    copyState.groupingBypass = false;
    copyState.groupingCheckFailed = false;
    const choice = copyPanel?.querySelector(".tel-copy-bypass");
    if (choice) {
      choice.hidden = true;
      choice.querySelector("input").checked = false;
    }
  };
  const copySay = (message) => {
    copyEnsurePanel();
    copyPanel.hidden = copyMinimized;
    if (copyLauncher) {
      copyLauncher.hidden = !copyMinimized;
      copyLauncher.textContent = copyState.busy ? "Copy · Loading…" : copyState.files.length ? `Copy · ${copyState.files.length} ready` : copyState.popup ? "Copy · Preview" : "Copy · Open";
    }
    copyPanel.querySelector(".tel-copy-status").textContent = message;
    copyPanel.querySelector(".tel-copy-prepare").disabled = copyState.busy || !copyState.files.length;
    const choice = copyPanel.querySelector(".tel-copy-bypass");
    if (choice) choice.hidden = !copyState.popup?.isConnected || !copyState.groupingCheckFailed;
  };
  const copyClear = () => {
    copyMinimized = false;
    if (copyLauncher) copyLauncher.hidden = true;
    copyResetGroupingBypass();
    copyState.generation++;
    copyState.files.length = 0;
    copyState.bytes = 0;
    copyState.account = null;
    copyState.busy = false;
    copyState.opening = false;
    if (copyState.handle) copyState.handle.hide();
    copyState.handle = null;
    copyState.popup = null;
    copyState.count = 0;
    copyState.destination = null;
    if (copyPanel) copyPanel.hidden = true;
  };
  const copyEnsurePanel = () => {
    if (copyPanel) return;
    copyPanel = document.createElement("section");
    copyPanel.id = "tel-copy-panel";
    copyPanel.lang = UI_LANGUAGE;
    copyPanel.setAttribute("aria-label", "Send a copy");
    const heading = document.createElement("div");
    heading.className = "tel-copy-heading";
    const brand = document.createElement("span");
    brand.className = "tel-copy-brand";
    brand.setAttribute("aria-hidden", "true");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.7");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M9 9h11v11H9z M5 15H4V4h11v1 M12 14h5m-2.5-2.5L17 14l-2.5 2.5");
    icon.append(path);
    brand.append(icon);
    const titleGroup = document.createElement("div");
    const title = document.createElement("strong");
    title.className = "tel-copy-title";
    title.textContent = "Send a copy";
    const subtitle = document.createElement("span");
    subtitle.className = "tel-copy-subtitle";
    subtitle.textContent = "A fresh upload, kept together.";
    titleGroup.append(title, subtitle);
    heading.append(brand, titleGroup);
    const minimize = document.createElement("button");
    minimize.type = "button";
    minimize.className = "tel-copy-minimize";
    minimize.textContent = "−";
    minimize.title = "Minimize — keep the copy in memory";
    minimize.setAttribute("aria-label", "Minimize copy panel");
    minimize.addEventListener("click", () => copySetMinimized(true));
    heading.append(minimize);
    const status = document.createElement("p");
    status.className = "tel-copy-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const prepare = document.createElement("button");
    prepare.type = "button";
    prepare.className = "tel-copy-prepare";
    prepare.textContent = "Prepare upload";
    prepare.title = "Prepare the upload in the currently open chat";
    prepare.addEventListener("click", copyPrepare);
    const discard = document.createElement("button");
    discard.type = "button";
    discard.textContent = "Discard";
    discard.addEventListener("click", copyClear);
    const actions = document.createElement("div");
    actions.className = "tel-copy-actions";
    actions.append(prepare, discard);
    const note = document.createElement("small");
    note.className = "tel-copy-note";
    note.textContent = "Memory only · No Downloads files. Keep this tab open.";
    const bypassChoice = document.createElement("label");
    bypassChoice.className = "tel-copy-bypass";
    bypassChoice.hidden = true;
    const bypassText = document.createElement("span");
    const bypassTitle = document.createElement("span");
    bypassTitle.className = "tel-copy-bypass-title";
    bypassTitle.textContent = "Skip album check";
    const bypassHint = document.createElement("span");
    bypassHint.className = "tel-copy-bypass-hint";
    bypassHint.id = "tel-copy-bypass-hint";
    bypassHint.textContent = "This preview only · May send separately";
    bypassText.append(bypassTitle, bypassHint);
    const bypassInput = document.createElement("input");
    bypassInput.type = "checkbox";
    bypassInput.setAttribute("role", "switch");
    bypassInput.setAttribute("aria-label", "Skip album check");
    bypassInput.setAttribute("aria-describedby", "tel-copy-bypass-hint");
    bypassInput.addEventListener("change", () => {
      copyState.groupingBypass = !!bypassInput.checked && !!copyState.popup?.isConnected && copyState.groupingCheckFailed;
      bypassInput.checked = copyState.groupingBypass;
      copySay(copyState.groupingBypass ? "Grouping check skipped for this preview. Verify all items and grouping yourself; Telegram may send them separately. Click Telegram’s Send button again when ready." : "Grouping check re-enabled. Click Send to check the album again.");
    });
    bypassChoice.append(bypassText, bypassInput);
    copyPanel.append(heading, status, actions, bypassChoice, note);
    copyPanel.hidden = true;
    document.body.append(copyPanel);
    copyLauncher = document.createElement("button");
    copyLauncher.type = "button";
    copyLauncher.lang = UI_LANGUAGE;
    copyLauncher.className = "tel-copy-button tel-copy-launcher";
    copyLauncher.hidden = true;
    copyLauncher.textContent = "Copy · Open";
    copyLauncher.title = "Open the copy panel";
    copyLauncher.setAttribute("aria-label", "Open copy panel");
    copyLauncher.addEventListener("click", () => copySetMinimized(false));
    document.body.append(copyLauncher);
    // Intercept only this copy preview's send action. Ungrouped layouts,
    // missing items and split albums are blocked before the native handler.
    const guard = event => {
      const popup = copyState.popup;
      if (!popup?.isConnected || !event.composedPath().includes(popup)) return;
      const send = event.target.closest?.(".simple-message-input-confirm");
      const shortcut = event.type === "keydown" && event.key === "Enter" && (!event.shiftKey || event.ctrlKey || event.metaKey);
      if (event.type === "keydown" && !shortcut) return;
      if (!send && !shortcut) return;
      const destination = copyState.destination;
      const sameDestination = destination && copyPage().appImManager?.myId === copyState.account &&
        destination.chat.peerId === destination.peerId && destination.chat.threadId === destination.threadId;
      const inspection = copyInspectAlbum(popup, copyState.count);
      if (copyShouldBlockSend({ sameDestination, contextMenu: event.type === "contextmenu", validGrouping: inspection.valid, bypassGrouping: copyState.groupingBypass })) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sameDestination && event.type !== "contextmenu" && !inspection.valid) copyState.groupingCheckFailed = true;
        copySay(!sameDestination ? "Sending blocked because the destination or account changed. Discard this preview and prepare again." : event.type === "contextmenu" ? "Use a normal left-click on Send. Alternative send menus are disabled for this copy preview." : `Album check blocked sending (${inspection.details}). Verify the preview, then optionally turn on Skip album check and click Send again. Skipping may allow separate messages.`);
      }
    };
    document.addEventListener("click", guard, true);
    document.addEventListener("contextmenu", guard, true);
    document.addEventListener("keydown", guard, true);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      document.addEventListener(type, guard, { capture: true, passive: false });
    }
  };

  const copyStart = async (mode) => {
    if (copyState.busy || copyState.files.length || copyState.popup || copyState.opening) {
      copySay("A copy is already in progress. Send or discard it before preparing another.");
      return;
    }
    const page = copyPage();
    const im = page.appImManager;
    const chat = im?.chat;
    const managers = chat?.managers || im?.managers;
    if (!im?.myId || !managers?.appMessagesManager || typeof page.appDownloadManager?.downloadMedia !== "function" || typeof page.showNewMediaPopup !== "function") {
      copySay("This Web K build does not expose the upload/download helpers required for Send a copy. Reload Web K and retry.");
      return;
    }
    copyState.busy = true;
    copyState.account = im.myId;
    const generation = ++copyState.generation;
    const check = () => {
      if (generation !== copyState.generation) throw new Error("Copy discarded.");
      if (copyPage().appImManager?.myId !== copyState.account) throw new Error("The Telegram account changed. Discard this copy and start again.");
    };
    try {
      const entries = [];
      if (mode === "viewer") {
        const viewer = page.appMediaViewer;
        const target = viewer?.target;
        const mid = target?.mid || viewer?.currentMessageId;
        const peerId = target?.peerId || viewer?.currentPeerId;
        if (!mid || !peerId) throw new Error("Open the original media message in the viewer first.");
        entries.push({ peerId, mid });
      } else {
        const selected = chat?.selection?.selectedMids;
        if (!selected || !selected.size) throw new Error("Use Select on messages in the main conversation, then select the media to copy.");
        for (const [peerId, mids] of selected) for (const mid of [...mids].sort((a, b) => a - b)) entries.push({ peerId, mid });
      }
      if (!entries.length) throw new Error("Choose at least one media message to copy.");
      copySay("Checking the selected media…");
      const messages = [];
      for (const entry of entries) {
        check();
        messages.push(await managers.appMessagesManager.getMessageByPeer(entry.peerId, entry.mid));
        check();
      }
      const descriptors = copyValidateSelection(messages);
      if (descriptors.some(d => d.mime === "image/gif")) {
        copyMp4RecordingType();
        if (descriptors.some(d => d.mime === "image/gif") && !page.ImageDecoder) throw new Error("GIF decoding is unavailable in this browser. Use a recent desktop Chrome.");
      }
      const result = await copyLoadFiles(descriptors, options => page.appDownloadManager.downloadMedia(options), check,
        (index, total, bytes, phase) => copySay(phase ? `${phase}\nItem ${index + 1} of ${total} · Keep this tab visible.` : `Loading ${index + 1} of ${total} into memory…\n${(bytes / 1048576).toFixed(1)} MiB ready. Nothing has been sent.`));
      check();
      copyState.files = result.files;
      copyState.bytes = result.bytes;
      copyState.busy = false;
      copySay(`${result.files.length} item(s) ready in memory (${(result.bytes / 1048576).toFixed(1)} MiB).${result.files.length > 10 ? `\nAlbum groups: ${copyAlbumSizes(result.files.length).join(" + ")}.` : ""}\nClose the viewer / cancel selection, open the destination chat or topic, then click Prepare upload.`);
    } catch (error) {
      if (generation !== copyState.generation) return;
      copyState.files.length = 0;
      copyState.busy = false;
      const reason = String(error.message || error).trim().replace(/[.!]+$/, "");
      copySay(`Copy stopped: ${reason}${/\bnothing (?:was|has been) (?:attached or )?sent$/i.test(reason) ? "." : ". Nothing was sent."}`);
    }
  };

  async function copyPrepare() {
    if (copyState.busy || !copyState.files.length || copyState.opening) return;
    const page = copyPage();
    const chat = page.appImManager?.chat;
    if (page.appImManager?.myId !== copyState.account) { copyClear(); copySay("The account changed; temporary copies were discarded."); return; }
    if (!chat?.peerId || !chat?.input) { copySay("Open the destination chat or topic first."); return; }
    if (chat.input.editMessage || chat.input.ephemeralComposer || chat.input.isWelcomeComposer) { copySay("Exit message editing or special composer mode before attaching the album."); return; }
    if (document.querySelector(".popup-new-media, .popup-send-photo")) { copySay("Close the existing attachment preview before preparing this copy."); return; }
    if (typeof page.showNewMediaPopup !== "function") { copySay("The native upload preview is unavailable in this Web K build."); return; }
    const count = copyState.files.length;
    const generation = copyState.generation;
    const files = copyState.files.slice();
    copyResetGroupingBypass();
    copyState.opening = true;
    copyState.busy = true;
    copyState.destination = { chat, peerId: chat.peerId, threadId: chat.threadId };
    copySay("Opening Telegram’s upload preview…");
    try {
      const verifyDestination = () => {
        if (generation !== copyState.generation) throw new Error("Copy discarded.");
        if (page.appImManager?.myId !== copyState.account || chat.peerId !== copyState.destination?.peerId || chat.threadId !== copyState.destination?.threadId) throw new Error("The destination or account changed while preparing the preview.");
      };
      const uploadFiles = [];
      for (const file of files) {
        verifyDestination();
        if (copySilentVideos.has(file)) {
          copySay("Preparing silent video · Keeping the original MP4. No re-encoding.");
          uploadFiles.push(await copyPrepareRegularVideo(file, verifyDestination));
        } else uploadFiles.push(file);
      }
      verifyDestination();
      // One call with the complete list of Files/prepared-video wrappers;
      // the native default is group:true.
      // true preserves unrelated text already in the destination composer.
      copyState.handle = page.showNewMediaPopup(chat, uploadFiles, "media", true);
      const started = Date.now();
      let popup;
      while (!(popup = document.querySelector(".popup-new-media, .popup-send-photo"))) {
        if (generation !== copyState.generation) return;
        if (Date.now() - started > 20000) throw new Error("Telegram did not open the upload preview.");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (generation !== copyState.generation) return;
      copyState.popup = popup;
      copyState.count = count;
      copyState.files.length = 0;
      copyState.bytes = 0;
      copyState.busy = false;
      const grouping = count > 10 ? `${copyAlbumSizes(count).length} album groups (${copyAlbumSizes(count).join(" + ")})` : count > 1 ? "grouped album" : "attachment";
      copySay(`Review the destination and ${grouping} in Telegram’s preview, then press its Send button.\nThe script has released its staged files; Telegram holds them for upload. No Downloads files were created.`);
    } catch (error) {
      if (generation !== copyState.generation) return;
      copyState.handle?.hide();
      copyState.handle = null;
      copyState.busy = false;
      copySay(`Could not prepare: ${error.message}. Your in-memory copy is retained for retry.`);
    } finally {
      files.length = 0;
      if (generation === copyState.generation) copyState.opening = false;
    }
  }

  const copyAddButton = (container, mode) => {
    if (!container || container.querySelector(`:scope > .tel-copy-${mode}`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tel-copy-button tel-copy-${mode}`;
    button.lang = UI_LANGUAGE;
    button.textContent = "Send a copy";
    button.title = "Create a new upload; photos/videos are grouped in batches of up to 10";
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); void copyStart(mode); });
    container.prepend(button);
  };
  const refreshWebKCopyButtons = () => {
    if (copyState.popup && !copyState.popup.isConnected) {
      copyResetGroupingBypass();
      copyState.popup = null;
      copyState.handle = null;
      copyState.count = 0;
      copyState.account = null;
      copyState.destination = null;
      copySay("The upload preview closed. Telegram handles the upload or cancellation. Check that the new message has sent successfully.");
    }
    if (copyState.account !== null && copyPage().appImManager?.myId !== copyState.account) {
      copyClear();
      return;
    }
    const selection = copyPage().appImManager?.chat?.selection;
    const selectionButton = selection?.selectionForwardBtn;
    const selectedCount = selection?.selectedMids ? [...selection.selectedMids.values()].reduce((n, mids) => n + mids.size, 0) : 0;
    if (selectionButton?.isConnected && selectedCount) copyAddButton(document.body, "selection");
    const copyButton = document.querySelector("body > .tel-copy-selection");
    if (copyButton) {
      const hidden = !selectionButton?.isConnected || !selectedCount;
      if (copyButton.hidden !== hidden) copyButton.hidden = hidden;
    }
  };

  // WebA owns only media discovery and button placement.
  const refreshWebA = () => {
    const story = document.getElementById("StoryViewer");
    if (story) {
      const header = story.querySelector(".GrsJNw3y") || story.querySelector(".DropdownMenu")?.parentNode;
      if (header && !header.querySelector(".tel-download") && !getWebADownloadButtons(header).length) {
        header.prepend(createDownloadButton(
          "Button TkphaPyQ tiny translucent-white round tel-download",
          '<i class="icon icon-download" aria-hidden="true"></i>',
          () => {
            const current = document.getElementById("StoryViewer");
            const videoUrl = getMediaSource(current?.querySelector("video"));
            const images = current?.querySelectorAll("img.PVZ8TOWS");
            const imageUrl = getMediaSource(images?.[images.length - 1]);
            if (videoUrl) tel_download_video(videoUrl);
            else if (imageUrl) tel_download_image(imageUrl);
          }
        ));
      }
    }
    const media = document.querySelector("#MediaViewer .MediaViewerSlide--active");
    const actions = document.querySelector("#MediaViewer .MediaViewerActions");
    if (!media || !actions) return;
    const video = media.querySelector(".VideoPlayer video");
    const image = media.querySelector(".MediaViewerContent > div > img");
    if (!getMediaSource(video) && !getMediaSource(image)) return;
    const makeButton = () => createDownloadButton(
      "Button smaller translucent-white round tel-download",
      '<i class="icon icon-download" aria-hidden="true"></i>',
      downloadCurrentWebAMedia
    );
    if (getWebADownloadButtons(actions).length) {
      actions.querySelectorAll("button.tel-download").forEach((button) => button.remove());
    } else if (!actions.querySelector("button.tel-download")) {
      actions.prepend(makeButton());
    }
    const controls = media.querySelector(".VideoPlayerControls .buttons");
    if (video && controls && !controls.querySelector("button.tel-download")) {
      const spacer = controls.querySelector(".spacer");
      if (spacer) spacer.after(makeButton());
      else controls.appendChild(makeButton());
    }
  };

  // WebK owns only media discovery and button placement.
  const refreshWebK = () => {
    refreshWebKCopyButtons();
    refreshWebKDownloadIcon();

    // Resolve the pinned media again on every click: its source may load after
    // the pinned message changes, and message IDs can repeat across chats.
    const pinnedAudio = document.querySelector(".pinned-audio");
    const pinnedUtils = pinnedAudio?.querySelector(".pinned-container-wrapper-utils");
    if (pinnedUtils) {
      let button = pinnedUtils.querySelector("._tel_download_button_pinned_container");
      if (!button) {
        button = document.createElement("button");
        button.className = "btn-icon tgico-download _tel_download_button_pinned_container";
        button.innerHTML = createWebKDownloadIcon(true);
        button.type = "button";
        button.onclick = (event) => {
          event.stopPropagation();
          const media = getPinnedMedia();
          if (!media) return;
          if (media.kind === "audio") tel_download_audio(media.url);
          else tel_download_video(media.url);
        };
        pinnedUtils.appendChild(button);
      }
      const disabled = !getPinnedMedia();
      if (button.disabled !== disabled) button.disabled = disabled;
      labelDownloadButton(button, disabled);
    }

    // Stories
    const storiesContainer = document.getElementById("stories-viewer");
    if (storiesContainer) {
      const createDownloadButton = () => {
        const downloadButton = document.createElement("button");
        downloadButton.className = "btn-icon rp tel-download";
        downloadButton.innerHTML = `${createWebKDownloadIcon()}<div class="c-ripple"></div>`;
        downloadButton.setAttribute("type", "button");
        labelDownloadButton(downloadButton);
        downloadButton.onclick = () => {
          // 1. Story with video
          const video = storiesContainer.querySelector("video.media-video");
          const videoSrc =
            video?.src ||
            video?.currentSrc ||
            video?.querySelector("source")?.src;
          if (videoSrc) {
            tel_download_video(videoSrc);
          } else {
            // 2. Story with image
            const imageSrc =
              storiesContainer.querySelector("img.media-photo")?.src;
            if (imageSrc) tel_download_image(imageSrc);
          }
        };
        return downloadButton;
      };

      const storyHeader = storiesContainer.querySelector(
        "[class*='_ViewerStoryHeaderRight']"
      );
      if (storyHeader && !storyHeader.querySelector(".tel-download")) {
        storyHeader.prepend(createDownloadButton());
      }

      const storyFooter = storiesContainer.querySelector(
        "[class*='_ViewerStoryFooterRight']"
      );
      if (storyFooter && !storyFooter.querySelector(".tel-download")) {
        storyFooter.prepend(createDownloadButton());
      }
    }

    // All media opened are located in .media-viewer-movers > .media-viewer-aspecter
    const mediaContainer = document.querySelector(".media-viewer-whole");
    if (!mediaContainer) return;
    const mediaAspecter = mediaContainer.querySelector(
      ".media-viewer-movers .media-viewer-aspecter"
    );
    const mediaButtons = mediaContainer.querySelector(
      ".media-viewer-topbar .media-viewer-buttons"
    );
    if (!mediaAspecter || !mediaButtons) return;

    // Restore identified download controls; Send a copy uses a new upload.
    // Other actions, including Delete and Edit, are left untouched.
    for (const button of getWebKDownloadButtons(mediaButtons)) {
      if (!button.disabled && button.getAttribute("aria-disabled") !== "true") {
        button.classList.remove("hide");
      }
    }
    copyAddButton(mediaButtons, "viewer");

    // Recognize native downloads by their purpose, not their font code point.
    const nativeDownloadButtons = getWebKDownloadButtons(mediaButtons).filter(isUsableDownloadButton);
    if (nativeDownloadButtons.length > 0) {
      mediaButtons.querySelectorAll("button.tel-download").forEach((button) => {
        button.remove();
      });
    }
    const hasDownloadButton =
      nativeDownloadButtons.length > 0 ||
      mediaButtons.querySelector("button.tel-download");

    if (mediaAspecter.querySelector(".ckin__player")) {
      // 1. Video player detected - Video and it has finished initial loading
      // container > .ckin__player > video[src]

      // add download button to videos
      const controls = mediaAspecter.querySelector(
        ".default__controls.ckin__controls"
      );
      if (controls && !controls.querySelector(".tel-download")) {
        const brControls = controls.querySelector(
          ".bottom-controls .right-controls"
        );
        const downloadButton = document.createElement("button");
        downloadButton.className =
          "btn-icon default__button tgico-download tel-download";
        downloadButton.innerHTML = createWebKDownloadIcon();
        downloadButton.setAttribute("type", "button");
        labelDownloadButton(downloadButton);
        downloadButton.onclick = downloadCurrentWebKMedia;
        brControls?.prepend(downloadButton);
      }
    } else if (
      mediaAspecter.querySelector("video") &&
      !hasDownloadButton
    ) {
      // 2. Video HTML element detected, could be either GIF or unloaded video
      // container > video[src]
      const downloadButton = document.createElement("button");
      downloadButton.className = "btn-icon tgico-download tel-download";
      downloadButton.innerHTML = createWebKDownloadIcon(true);
      downloadButton.setAttribute("type", "button");
      labelDownloadButton(downloadButton);
      downloadButton.onclick = downloadCurrentWebKMedia;
      mediaButtons.prepend(downloadButton);
    } else if (!hasDownloadButton) {
      // 3. Image without download button detected
      // container > img.thumbnail
      if (
        !mediaAspecter.querySelector("img.thumbnail") ||
        !mediaAspecter.querySelector("img.thumbnail").src
      ) {
        return;
      }
      const downloadButton = document.createElement("button");
      downloadButton.className = "btn-icon tgico-download tel-download";
      downloadButton.innerHTML = createWebKDownloadIcon(true);
      downloadButton.setAttribute("type", "button");
      labelDownloadButton(downloadButton);
      downloadButton.onclick = downloadCurrentWebKMedia;
      mediaButtons.prepend(downloadButton);
    }
  };

  // The task panel is independent of Telegram's viewer and survives media changes.
  const panel = document.createElement("section");
  panel.id = "tel-downloader-progress-bar-container";
  panel.dir = "ltr";
  panel.lang = UI_LANGUAGE;
  panel.hidden = true;
  panel.setAttribute("aria-label", formatMessage("mediaDownloads"));
  panel.innerHTML = `
    <div class="tel-panel-heading">
      <strong class="tel-panel-title"></strong>
      <div class="tel-panel-tools">
        <button class="tel-panel-toggle" type="button" aria-expanded="true" aria-controls="tel-task-list"></button>
      </div>
    </div>
    <div id="tel-task-list" class="tel-task-list"></div>`;
  const panelToggle = panel.querySelector(".tel-panel-toggle");
  panelToggle.textContent = formatMessage("hide");
  panelToggle.onclick = () => {
    const list = panel.querySelector(".tel-task-list");
    list.hidden = !list.hidden;
    panelToggle.textContent = formatMessage(list.hidden ? "show" : "hide");
    panelToggle.setAttribute("aria-expanded", String(!list.hidden));
  };
  const style = document.createElement("style");
  style.textContent = `
    #tel-downloader-progress-bar-container {
      --tel-bg: #fff; --tel-fg: #202b36; --tel-muted: #556472; --tel-line: #d9e1e8;
      --tel-track: #e9eef3; --tel-accent: #1967b3; --tel-error: #b42318;
      box-sizing: border-box; position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom));
      width: min(340px, calc(100vw - 24px)); max-height: calc(100vh - 24px); z-index: 2147483646;
      background: var(--tel-bg); color: var(--tel-fg); border: 1px solid var(--tel-line); border-radius: 12px;
      box-shadow: 0 6px 28px #0003; font: 13px/1.4 system-ui, sans-serif; overflow: hidden;
      display: flex; flex-direction: column; text-align: start;
    }
    html.night #tel-downloader-progress-bar-container, html.theme-dark #tel-downloader-progress-bar-container {
      --tel-bg: #202a35; --tel-fg: #f2f5f8; --tel-muted: #b0bdca; --tel-line: #455361;
      --tel-track: #394754; --tel-accent: #73b7ff; --tel-error: #ff9f97;
    }
    #tel-downloader-progress-bar-container [hidden], #tel-downloader-progress-bar-container[hidden] { display: none !important; }
    #tel-downloader-progress-bar-container * { box-sizing: border-box; }
    #tel-downloader-progress-bar-container p { margin: 0; }
    #tel-downloader-progress-bar-container .tel-panel-heading, #tel-downloader-progress-bar-container .tel-task-heading {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    #tel-downloader-progress-bar-container .tel-panel-heading { padding: 10px 12px; flex-shrink: 0; }
    #tel-downloader-progress-bar-container .tel-panel-title { min-width: 0; overflow-wrap: anywhere; }
    #tel-downloader-progress-bar-container .tel-panel-tools { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    #tel-downloader-progress-bar-container .tel-task-list { min-height: 0; overflow-y: auto; max-height: 440px; overscroll-behavior: contain; }
    #tel-downloader-progress-bar-container .tel-task { padding: 12px; border-top: 1px solid var(--tel-line); }
    #tel-downloader-progress-bar-container .filename { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    #tel-downloader-progress-bar-container button {
      appearance: none; background: transparent; color: var(--tel-accent); border: 1px solid transparent;
      font: inherit; border-radius: 6px; padding: 5px 8px; min-height: 32px; cursor: pointer; flex-shrink: 0;
    }
    #tel-downloader-progress-bar-container button:hover { background: var(--tel-track); }
    #tel-downloader-progress-bar-container button:focus-visible, #tel-downloader-progress-bar-container .tel-task:focus-visible { outline: 2px solid var(--tel-accent); outline-offset: -2px; }
    #tel-downloader-progress-bar-container button:disabled { opacity: .5; cursor: default; }
    #tel-downloader-progress-bar-container [data-action="dismiss"] { color: var(--tel-muted); font-size: 20px; }
    #tel-downloader-progress-bar-container .progress { position: relative; min-height: 24px; margin: 8px 0; background: var(--tel-track); border-radius: 6px; overflow: hidden; }
    #tel-downloader-progress-bar-container .progress > div { position: absolute; height: 100%; background: var(--tel-accent); opacity: .35; }
    #tel-downloader-progress-bar-container .progress > p { position: relative; text-align: center; line-height: 1.5; padding: 3px 8px; overflow-wrap: anywhere; color: var(--tel-fg); }
    #tel-downloader-progress-bar-container .tel-task-details { color: var(--tel-muted); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    #tel-downloader-progress-bar-container .tel-task-error { color: var(--tel-error); margin-top: 8px; overflow-wrap: anywhere; }
    #tel-downloader-progress-bar-container .tel-task-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-top: 4px; }
    #tel-downloader-progress-bar-container .tel-task-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    #tel-downloader-progress-bar-container [data-state="failed"] .progress > div { background: var(--tel-error); }
    #tel-downloader-progress-bar-container .tel-indeterminate > div { width: 35% !important; animation: tel-download-progress 1.4s infinite ease-in-out; }
    @keyframes tel-download-progress { from { left: -35%; } to { left: 100%; } }
    @media (prefers-reduced-motion: reduce) { #tel-downloader-progress-bar-container .tel-indeterminate > div { animation: none; left: 32%; } }
  `;
  style.textContent += COPY_UI_CSS;
  document.head.appendChild(style);
  document.body.appendChild(panel);
  updateTaskPanel();

  // Watch Telegram for navigation, media, and selection changes.
  const isWebK = location.hostname === "webk.telegram.org" || location.pathname.startsWith("/k/");
  const isWebA = location.hostname === "webz.telegram.org" || location.pathname.startsWith("/a/");
  const refreshApp = isWebK ? refreshWebK : isWebA ? refreshWebA : null;
  if (refreshApp) {
    const roots = isWebK
      ? ".media-viewer-whole, #stories-viewer, .pinned-audio, audio-element, .selection-wrapper, .search-super-selection-container, .selection-container-forward, .search-super-selection-forward"
      : "#MediaViewer, #StoryViewer";
    let pending;
    const scheduleRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        refreshApp();
      }, 100);
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest("#tel-copy-panel, .tel-copy-button, #tel-downloader-progress-bar-container, .tel-download, ._tel_download_button_pinned_container")) return false;
        return target?.closest(roots) || Array.from(record.addedNodes).some((node) =>
          node instanceof Element && (node.matches(roots) || node.querySelector(roots))
        );
      })) scheduleRefresh();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "src", "data-mid", "data-peer-id", "disabled", "aria-disabled", "hidden"],
    });
    // A fallback handles media source properties changed outside the DOM.
    setInterval(() => { if (!document.hidden) refreshApp(); }, REFRESH_DELAY);
    document.addEventListener("visibilitychange", scheduleRefresh);
    refreshApp();
  }

  logger.info("Completed script setup.");
})();

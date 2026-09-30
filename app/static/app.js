const NUMBER_RE = /^\+?\d{6,15}$/;

const GSM7 = new Set(
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split("")
);
const GSM7_EXT = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

const $ = (id) => document.getElementById(id);

const state = {
  message: "",
  numbers: [],
  rejected: [],
  prefix: "+1",
  rawText: "",
  jobId: null,
  pollTimer: null,
};

function applyPrefix(cleaned) {
  if (cleaned.startsWith("+")) return cleaned;
  const cc = (state.prefix || "").replace(/\D/g, "");
  if (!cc) return cleaned;
  if (cleaned.startsWith(cc) && cleaned.length - cc.length >= 6) {
    return "+" + cleaned;
  }
  return "+" + cc + cleaned;
}

function normalizeNumber(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[\s.\-()/]/g, "");
  if (!cleaned) return null;
  const candidate = applyPrefix(cleaned);
  return NUMBER_RE.test(candidate) ? candidate : null;
}

function parseRecipients(text, existing, skipHeader = true) {
  const seen = new Set(existing);
  const found = [];
  const rejected = [];
  let firstLine = true;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/[,;\t]/);
    let match = null;
    for (const cell of cells) {
      const num = normalizeNumber(cell);
      if (num) {
        match = num;
        break;
      }
    }
    if (match) {
      if (!seen.has(match)) {
        seen.add(match);
        found.push(match);
      }
    } else if (firstLine && skipHeader) {
      firstLine = false;
      continue;
    } else if (cells.some((c) => c.trim())) {
      rejected.push(line.trim());
    }
    firstLine = false;
  }
  return { found, rejected };
}

function gsmInfo(text) {
  let len = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7.has(ch)) len += 1;
    else if (GSM7_EXT.has(ch)) len += 2;
    else {
      gsm = false;
      break;
    }
  }
  return gsm ? { gsm, len } : { gsm, len: [...text].length };
}

function segments(text) {
  if (!text) return 0;
  const { gsm, len } = gsmInfo(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return len <= single ? 1 : Math.ceil(len / multi);
}

function setMessage(text) {
  state.message = text;
  const info = gsmInfo(text);
  $("msg-length").textContent = `${[...text].length} caractère${text.length > 1 ? "s" : ""}`;
  const parts = segments(text);
  $("msg-segments").textContent = `${parts} SMS / destinataire`;

  const warning = $("msg-warning");
  if (text && parts > 1) {
    warning.textContent = `Message découpé en ${parts} SMS par destinataire — multiplie le coût par ${parts}.`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
  render();
}

function render() {
  const preview = $("preview");
  const empty = $("preview-empty");
  preview.innerHTML = "";

  if (state.numbers.length === 0) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    state.numbers.forEach((num, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${num}</span><span class="idx">#${i + 1}</span>`;
      preview.appendChild(li);
    });
  }

  const hint = $("numbers-hint");
  hint.textContent = state.numbers.length
    ? `${state.numbers.length} destinataire${state.numbers.length > 1 ? "s" : ""} prêt${state.numbers.length > 1 ? "s" : ""}.`
    : "Aucun destinataire.";

  const rejected = $("rejected");
  if (state.rejected.length) {
    rejected.textContent = `${state.rejected.length} ligne(s) ignorée(s) — format non reconnu.`;
    rejected.classList.remove("hidden");
  } else {
    rejected.classList.add("hidden");
  }

  const parts = segments(state.message);
  const totalSms = state.numbers.length * (parts || (state.message ? 1 : 0));
  $("cost").textContent = state.numbers.length
    ? `${state.numbers.length} × ${parts || 1} SMS = ${totalSms} SMS facturé${totalSms > 1 ? "s" : ""}`
    : "Sélectionne des destinataires et un message.";

  const ready =
    state.message.trim() &&
    state.numbers.length > 0 &&
    $("device").value &&
    !state.jobId;
  $("send").disabled = !ready;
}

function reparse() {
  const { found, rejected } = parseRecipients(state.rawText, []);
  state.numbers = found;
  state.rejected = rejected;
  render();
}

function loadDevices() {
  fetch("/api/devices")
    .then((r) => r.json())
    .then((data) => {
      const select = $("device");
      select.innerHTML = "";
      const hint = $("device-hint");

      if (data.error) {
        hint.textContent = `Erreur : ${data.error}`;
        return;
      }
      const paired = data.devices.filter((d) => d.paired && d.reachable);
      if (paired.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Aucun appareil appairé";
        select.appendChild(opt);
        const others = data.devices.map((d) => `${d.name} (${d.state || "état inconnu"})`);
        hint.textContent = others.length
          ? `Détecté(s) mais pas appairé(s) et joignable(s) : ${others.join(", ")}. Accepte l'appairage sur le téléphone et vérifie le Wi-Fi.`
          : "Aucun appareil détecté. Vérifie que KDE Connect est ouvert sur le téléphone, sur le même Wi-Fi, puis appaire-le (voir GUIDE.md §5).";
      } else {
        paired.forEach((d) => {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.textContent = d.name;
          select.appendChild(opt);
        });
        hint.textContent = `${paired.length} appareil(s) disponible(s).`;
      }
      render();
    })
    .catch((err) => {
      $("device-hint").textContent = `Impossible de contacter le serveur : ${err}`;
    });
}

function pollJob(jobId) {
  fetch(`/api/job/${jobId}`)
    .then((r) => r.json())
    .then((data) => {
      const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
      $("bar-fill").style.width = `${pct}%`;
      $("progress-text").textContent = `${data.done} / ${data.total} traités`;

      const list = $("results");
      list.innerHTML = "";
      data.results.forEach((res) => {
        const li = document.createElement("li");
        const mark = res.ok ? "✓" : "✗";
        li.innerHTML = `<span class="${res.ok ? "ok" : "ko"}">${mark}</span><span>${res.number}</span>` +
          (res.error ? `<span class="idx">${res.error}</span>` : "");
        list.appendChild(li);
      });
      list.scrollTop = list.scrollHeight;

      if (data.status === "running") {
        state.pollTimer = setTimeout(() => pollJob(jobId), 400);
      } else {
        finishJob(data.status);
      }
    })
    .catch(() => {
      $("send-error").textContent = "Perte de contact avec le serveur pendant l'envoi.";
      $("send-error").classList.remove("hidden");
      finishJob("error");
    });
}

function finishJob(status) {
  clearTimeout(state.pollTimer);
  state.jobId = null;
  $("send").disabled = false;
  $("cancel").classList.add("hidden");
  $("progress-text").textContent +=
    status === "cancelled" ? " — interrompu" : status === "done" ? " — terminé" : "";
  render();
}

function startSend() {
  const deviceId = $("device").value;
  const dryRun = $("dry-run").checked;
  const delay = parseFloat($("delay").value) || 0;

  if (!deviceId) return;

  if (!dryRun) {
    const parts = segments(state.message);
    const total = state.numbers.length * parts;
    const ok = confirm(
      `Envoyer RÉELLEMENT ${state.numbers.length} SMS (${total} segment(s)) depuis « ` +
        `${$("device").selectedOptions[0].textContent} » ?\n\nCette action est facturée et irréversible.`
    );
    if (!ok) return;
  }

  $("send").disabled = true;
  $("send-error").classList.add("hidden");
  $("results").innerHTML = "";
  $("progress").classList.remove("hidden");
  $("bar-fill").style.width = "0%";
  $("progress-text").textContent = "Démarrage…";

  fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId,
      message: state.message,
      numbers: state.numbers,
      default_prefix: state.prefix,
      delay: delay,
      dry_run: dryRun,
    }),
  })
    .then((r) => r.json().then((data) => ({ status: r.status, data })))
    .then(({ status, data }) => {
      if (status !== 200) {
        $("send-error").textContent = data.error || "Erreur inconnue";
        $("send-error").classList.remove("hidden");
        $("progress").classList.add("hidden");
        render();
        return;
      }
      state.jobId = data.job_id;
      $("cancel").classList.remove("hidden");
      pollJob(data.job_id);
    })
    .catch(() => {
      $("send-error").textContent = "Impossible de contacter le serveur.";
      $("send-error").classList.remove("hidden");
      $("progress").classList.add("hidden");
      render();
    });
}

function cancelSend() {
  if (!state.jobId) return;
  fetch(`/api/cancel/${state.jobId}`, { method: "POST" });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isText = tab.dataset.tab === "text";
    $("pane-text").classList.toggle("hidden", !isText);
    $("pane-file").classList.toggle("hidden", isText);
    if (isText) setMessage($("message-text").value);
    else $("message-file").dispatchEvent(new Event("change"));
  });
});

$("message-text").addEventListener("input", (e) => setMessage(e.target.value));

$("message-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setMessage(reader.result);
  reader.readAsText(file);
});

$("numbers-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("numbers-label").textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    $("numbers-text").value = "";
    state.rawText = reader.result;
    reparse();
  };
  reader.readAsText(file);
});

$("numbers-text").addEventListener("input", (e) => {
  state.rawText = e.target.value;
  reparse();
});

$("prefix").addEventListener("input", (e) => {
  state.prefix = e.target.value;
  reparse();
});

$("device").addEventListener("change", render);
$("refresh").addEventListener("click", loadDevices);
$("send").addEventListener("click", startSend);
$("cancel").addEventListener("click", cancelSend);

state.prefix = $("prefix").value;
loadDevices();
render();

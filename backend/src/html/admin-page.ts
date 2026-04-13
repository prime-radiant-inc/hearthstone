export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hearthstone Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #faf9f6; color: #3d3529; padding: 2rem;
      max-width: 980px; margin: 0 auto;
    }
    header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; }
    header .logo { font-size: 2rem; }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    section { margin-bottom: 2.5rem; }
    section h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: #6b6358; text-transform: uppercase; letter-spacing: 0.05em; }
    .card {
      background: white; border-radius: 14px; padding: 1.25rem 1.5rem;
      box-shadow: 0 2px 8px rgba(61, 53, 41, 0.06); border: 1px solid #f0ece3;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.65rem 0.5rem; border-bottom: 1px solid #f0ece3; font-size: 0.95rem; }
    th { color: #9b9488; font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr:last-child td { border-bottom: none; }
    button.primary {
      background: linear-gradient(135deg, #c97b5e, #a65a3e);
      color: white; border: none; padding: 0.7rem 1.3rem; border-radius: 10px;
      font-size: 0.95rem; font-weight: 600; cursor: pointer;
    }
    button.primary:hover { filter: brightness(1.05); }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    button.row-action {
      background: transparent; color: #a65a3e; border: 1px solid #f0ece3;
      padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.82rem;
      font-weight: 500; cursor: pointer;
    }
    button.row-action:hover { background: #faf9f6; border-color: #c97b5e; }
    .row-actions-col { text-align: right; white-space: nowrap; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .info-grid .label { font-size: 0.78rem; color: #9b9488; text-transform: uppercase; letter-spacing: 0.05em; }
    .info-grid .value { font-size: 1rem; color: #3d3529; margin-top: 0.25rem; word-break: break-all; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(61, 53, 41, 0.4); display: none; align-items: center; justify-content: center; }
    .modal-backdrop.open { display: flex; }
    .modal { background: white; border-radius: 16px; padding: 1.75rem; max-width: 460px; width: 90%; box-shadow: 0 16px 40px rgba(61, 53, 41, 0.18); }
    .modal h3 { font-size: 1.15rem; font-weight: 600; margin-bottom: 1rem; }
    .modal input[type="text"] {
      width: 100%; padding: 0.7rem 0.9rem; border: 1.5px solid #f0ece3; border-radius: 10px;
      font-size: 1rem; margin-bottom: 1rem; background: #faf9f6;
    }
    .modal .actions { display: flex; gap: 0.6rem; justify-content: flex-end; }
    .modal button.secondary { background: transparent; color: #6b6358; border: none; padding: 0.7rem 1rem; cursor: pointer; font-size: 0.95rem; }
    .qr-box {
      display: flex; justify-content: center; align-items: center;
      background: #faf9f6; border: 1.5px solid #f0ece3; border-radius: 14px;
      padding: 1rem; margin: 0.75rem 0 1rem;
    }
    .qr-box svg { display: block; width: 220px; height: 220px; }
    .join-url-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
    .join-url-row input,
    .join-url-row button.copy {
      height: 46px;
      box-sizing: border-box;
    }
    .join-url-row input {
      flex: 1; min-width: 0;
      padding: 0 0.9rem;
      border: 1.5px solid #f0ece3; border-radius: 10px;
      font-size: 0.95rem;
      background: #faf9f6;
      font-family: ui-monospace, Menlo, monospace;
    }
    .join-url-row button.copy {
      padding: 0 1.3rem;
      border: 0; border-radius: 10px;
      background: linear-gradient(135deg, #c97b5e, #a65a3e);
      color: white;
      font-size: 0.95rem; font-weight: 600;
      cursor: pointer;
    }
    .modal label.field-label {
      display: block;
      font-size: 0.78rem; color: #9b9488;
      text-transform: uppercase; letter-spacing: 0.05em;
      margin: 0.4rem 0 0.4rem;
    }
    .modal label.field-label:first-child { margin-top: 0; }
    .modal .field-hint { font-size: 0.78rem; color: #9b9488; margin: -0.5rem 0 0.75rem; }
    .pin-label { font-size: 0.78rem; color: #9b9488; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.5rem; }
    .pin-display { text-align: center; font-family: ui-monospace, Menlo, monospace; font-size: 1.4rem; letter-spacing: 0.3rem; color: #6b6358; margin: 0.25rem 0 0.75rem; }
    .hint { font-size: 0.85rem; color: #6b6358; line-height: 1.5; }
  </style>
</head>
<body>
  <header>
    <div class="logo">🏠</div>
    <h1>Hearthstone Admin</h1>
  </header>

  <section>
    <h2>Houses</h2>
    <div class="card">
      <div class="toolbar">
        <div id="houses-count">Loading…</div>
        <button class="primary" id="create-house-btn">Create house</button>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Created</th><th>Owners</th><th>Guests</th><th>Docs</th><th></th></tr>
        </thead>
        <tbody id="houses-tbody"></tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Server info</h2>
    <div class="card info-grid" id="info-grid">Loading…</div>
  </section>

  <div class="modal-backdrop" id="modal">
    <div class="modal" id="modal-body"></div>
  </div>

  <script>
    async function fetchJSON(path, opts) {
      const r = await fetch(path, { credentials: "include", ...opts });
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }

    function escapeHTML(s) {
      return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    async function loadHouses() {
      const data = await fetchJSON("/admin/houses");
      const tbody = document.getElementById("houses-tbody");
      document.getElementById("houses-count").textContent = data.houses.length + " house" + (data.houses.length === 1 ? "" : "s");
      tbody.innerHTML = data.houses.map(h => \`
        <tr>
          <td>\${escapeHTML(h.name)}</td>
          <td>\${new Date(h.created_at).toLocaleDateString()}</td>
          <td>\${h.owner_count}</td>
          <td>\${h.guest_count}</td>
          <td>\${h.document_count}</td>
          <td class="row-actions-col"><button class="row-action" data-action="invite-owner" data-house-id="\${escapeHTML(h.id)}">New owner link</button></td>
        </tr>
      \`).join("");
    }


    async function loadInfo() {
      const data = await fetchJSON("/admin/info");
      const mb = (data.db_file_size_bytes / (1024*1024)).toFixed(2);
      document.getElementById("info-grid").innerHTML = \`
        <div><div class="label">Public URL</div><div class="value">\${escapeHTML(data.public_url)}</div></div>
        <div><div class="label">Database size</div><div class="value">\${mb} MB</div></div>
        <div><div class="label">Version</div><div class="value">\${escapeHTML(data.version)}</div></div>
      \`;
    }

    function openModal(html) {
      document.getElementById("modal-body").innerHTML = html;
      document.getElementById("modal").classList.add("open");
    }
    function closeModal() {
      document.getElementById("modal").classList.remove("open");
    }

    function showCreateForm() {
      openModal(\`
        <h3>Create house</h3>
        <label class="field-label" for="new-house-name">House name</label>
        <input type="text" id="new-house-name" placeholder="The Anderson Home" autofocus>
        <label class="field-label" for="new-owner-name">First owner's name</label>
        <input type="text" id="new-owner-name" placeholder="Jane Anderson">
        <p class="field-hint">Optional. Pre-fills the owner's name so they don't have to type it on first launch.</p>
        <div class="actions">
          <button class="secondary" id="cancel-create">Cancel</button>
          <button class="primary" id="confirm-create">Create</button>
        </div>
      \`);
      document.getElementById("cancel-create").onclick = closeModal;
      document.getElementById("confirm-create").onclick = async () => {
        const name = document.getElementById("new-house-name").value.trim();
        const owner_name = document.getElementById("new-owner-name").value.trim();
        if (!name) return;
        try {
          const data = await fetchJSON("/admin/houses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, owner_name }),
          });
          showResult(data);
          await loadHouses();
        } catch (e) {
          alert("Create failed: " + e.message);
        }
      };
    }

    function showInviteOwnerForm(houseId) {
      openModal(\`
        <h3>New owner link</h3>
        <label class="field-label" for="invite-owner-name">Owner's name</label>
        <input type="text" id="invite-owner-name" placeholder="Jane Anderson" autofocus>
        <p class="field-hint">Optional. Pre-fills their name so they don't have to type it on first launch.</p>
        <div class="actions">
          <button class="secondary" id="cancel-invite">Cancel</button>
          <button class="primary" id="confirm-invite">Mint link</button>
        </div>
      \`);
      document.getElementById("cancel-invite").onclick = closeModal;
      document.getElementById("confirm-invite").onclick = async () => {
        const owner_name = document.getElementById("invite-owner-name").value.trim();
        try {
          const data = await fetchJSON("/admin/houses/" + encodeURIComponent(houseId) + "/owner-invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner_name }),
          });
          showResult(data);
          await loadHouses();
        } catch (e) {
          alert("Could not mint invite: " + e.message);
        }
      };
    }

    function showResult(data) {
      // data.qr_svg is a trusted, server-rendered SVG string encoding data.join_url.
      // It is generated by node-qrcode on the backend — never fetched from a
      // third-party service — so the PIN never leaves this server.
      openModal(\`
        <h3>\${escapeHTML(data.house.name)}</h3>
        <p class="hint" style="margin-bottom:0.5rem;">Share this QR or link with the person who will be the house's first owner.</p>
        <div class="qr-box">\${data.qr_svg}</div>
        <div class="join-url-row">
          <input type="text" readonly value="\${escapeHTML(data.join_url)}" id="join-url-input">
          <button class="copy" id="copy-btn">Copy</button>
        </div>
        <div class="pin-label">Single-use PIN (for reference)</div>
        <div class="pin-display">\${escapeHTML(data.pin)}</div>
        <p class="hint">The link is single-use and expires in 7 days.</p>
        <div class="actions" style="margin-top:1rem;">
          <button class="secondary" id="close-result">Done</button>
        </div>
      \`);
      document.getElementById("copy-btn").onclick = () => {
        navigator.clipboard.writeText(data.join_url);
        const btn = document.getElementById("copy-btn");
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = prev; }, 1200);
      };
      document.getElementById("close-result").onclick = closeModal;
    }

    document.getElementById("create-house-btn").onclick = showCreateForm;
    document.getElementById("houses-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action='invite-owner']");
      if (!btn) return;
      showInviteOwnerForm(btn.dataset.houseId);
    });
    loadHouses();
    loadInfo();
  </script>
</body>
</html>`;
}

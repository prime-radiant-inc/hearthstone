export function renderJoinPage(pin: string, publicUrl: string): string {
  const customScheme = `hearthstone://join?server=${encodeURIComponent(publicUrl)}&pin=${pin}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${customScheme}">
  <title>Open Hearthstone</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #faf9f6;
      color: #3d3529;
      padding: 2rem;
      text-align: center;
    }
    .logo { font-size: 4rem; margin-bottom: 0.5rem; }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.75rem; }
    p { color: #6b6358; max-width: 420px; line-height: 1.5; }
    .open-btn {
      display: inline-block;
      margin-top: 1.75rem;
      padding: 0.95rem 2rem;
      background: linear-gradient(135deg, #c97b5e, #a65a3e);
      color: white;
      text-decoration: none;
      border-radius: 14px;
      font-weight: 600;
      font-size: 1.05rem;
      box-shadow: 0 6px 16px rgba(166, 90, 62, 0.25);
    }
    .pin {
      margin-top: 2rem;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 1.4rem;
      letter-spacing: 0.35rem;
      color: #9b9488;
    }
    .footnote {
      margin-top: 2.5rem;
      font-size: 0.85rem;
      color: #9b9488;
      max-width: 380px;
    }
    .footnote a { color: #6b6358; }
  </style>
</head>
<body>
  <div class="logo">🏠</div>
  <h1>Open Hearthstone</h1>
  <p>Tap below to accept your invite in the Hearthstone app.</p>
  <a class="open-btn" href="${customScheme}">Open in Hearthstone</a>
  <div class="pin">${pin}</div>
  <p class="footnote">
    Don't have Hearthstone yet? Install the app, then return to this page and tap the button above. Your invite code is shown for reference — you won't need to type it.
  </p>
  <script>
    setTimeout(function () { window.location.href = ${JSON.stringify(customScheme)}; }, 50);
  </script>
</body>
</html>`;
}

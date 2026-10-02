/* Run in terminal: `node tests.js` (or `npm test`). Run in browser: open tests.html. */
(() => {
  const isNode = typeof require === "function" && typeof module === "object";
  const L = isNode ? require("./app.js") : window.NovaLogic;
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, pass: true }); }
    catch (e) { results.push({ name, pass: false, detail: e.message }); }
  };
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
  const byId = (ps, id) => ps.find(p => p.id === id);

  // --- esc (security) ---
  test("esc blocks script injection", () => ok(!L.esc("<script>alert(1)</script>").includes("<")));
  test("esc escapes quotes and ampersand", () => eq(L.esc(`a&b"c'd`), "a&amp;b&quot;c&#39;d"));
  test("esc handles numbers and empty values", () => { eq(L.esc(42), "42"); eq(L.esc(""), ""); });

  // --- product data ---
  test("createProducts returns 3 products", () => eq(L.createProducts().length, 3));
  test("createProducts returns independent copies", () => {
    const a = L.createProducts(); a[0].stock = 0;
    eq(L.createProducts()[0].stock, 12);
  });
  test("unavailable products have 0 confidence", () =>
    L.createProducts().filter(p => p.stock === 0).forEach(p => eq(p.confidence, 0)));

  // --- search ---
  test("empty search returns all products", () => eq(L.searchProducts(L.createProducts(), "").length, 3));
  test("search is case-insensitive", () => eq(L.searchProducts(L.createProducts(), "RICE")[0].id, "rice"));
  test("search trims whitespace", () => eq(L.searchProducts(L.createProducts(), "  milk ")[0].id, "milk"));
  test("search with no match returns empty list", () => eq(L.searchProducts(L.createProducts(), "xyz"), []));
  test("search handles null/undefined query", () => {
    eq(L.searchProducts(L.createProducts(), null).length, 3);
    eq(L.searchProducts(L.createProducts(), undefined).length, 3);
  });
  test("search treats HTML as plain text", () => eq(L.searchProducts(L.createProducts(), "<img onerror=x>"), []));

  // --- reserveStock (core reliability logic) ---
  test("reserve decrements stock by 1", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "rice");
    ok(r.ok); eq(byId(ps, "rice").stock, 11);
  });
  test("reserve supports quantity > 1", () => {
    const ps = L.createProducts(); L.reserveStock(ps, "rice", 5); eq(byId(ps, "rice").stock, 7);
  });
  test("reserve fails on out-of-stock item and suggests backup store", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "honey");
    eq(r.ok, false); eq(r.reason, "unavailable"); eq(r.backupStore, L.BACKUP_STORE);
  });
  test("reserve fails when quantity exceeds stock and leaves stock unchanged", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "milk", 5);
    eq(r.ok, false); eq(byId(ps, "milk").stock, 4);
  });
  test("stock never goes negative after repeated reservations", () => {
    const ps = L.createProducts();
    for (let i = 0; i < 20; i++) L.reserveStock(ps, "milk");
    eq(byId(ps, "milk").stock, 0);
  });
  test("reserve rejects unknown product id", () => eq(L.reserveStock(L.createProducts(), "nope").reason, "not_found"));
  test("reserve rejects invalid quantities", () =>
    [0, -1, 1.5, NaN].forEach(q => eq(L.reserveStock(L.createProducts(), "rice", q).reason, "invalid_quantity")));

  // --- sellOne (partner store stock sync) ---
  test("sellOne decrements stock", () => { const ps = L.createProducts(); L.sellOne(ps, "rice"); eq(byId(ps, "rice").stock, 11); });
  test("sellOne floors at 0", () => { const ps = L.createProducts(); L.sellOne(ps, "honey"); eq(byId(ps, "honey").stock, 0); });
  test("sellOne returns null for unknown id", () => eq(L.sellOne(L.createProducts(), "nope"), null));
  test("in-store sale reduces what customers can reserve", () => {
    const ps = L.createProducts(); for (let i = 0; i < 4; i++) L.sellOne(ps, "milk");
    eq(L.reserveStock(ps, "milk").ok, false);
  });


  // --- availabilityInfo ---
  test("availabilityInfo: in-stock product", () => {
    const i = L.availabilityInfo(byId(L.createProducts(), "rice"));
    eq(i.label, "Available"); eq(i.badge, "green"); eq(i.cta, "Pre-book"); ok(i.detail.includes("96%"));
  });
  test("availabilityInfo: out-of-stock product offers backup", () => {
    const i = L.availabilityInfo(byId(L.createProducts(), "honey"));
    eq(i.label, "Unavailable"); eq(i.badge, "red"); eq(i.cta, "Find backup");
  });
  test("availabilityInfo flips to unavailable once last unit is reserved", () => {
    const ps = L.createProducts(); L.reserveStock(ps, "milk", 4);
    eq(L.availabilityInfo(byId(ps, "milk")).label, "Unavailable");
  });

  // --- buildTimeline ---
  test("buildTimeline default: 2 done, 1 current, 1 pending", () =>
    eq(L.buildTimeline().map(s => s.status), ["done", "done", "current", "pending"]));
  test("buildTimeline stage 0 starts at first step", () =>
    eq(L.buildTimeline(0).map(s => s.status), ["current", "pending", "pending", "pending"]));
  test("buildTimeline stage 4 is fully complete", () => ok(L.buildTimeline(4).every(s => s.status === "done")));
  test("buildTimeline uses check marks for done steps and numbers otherwise", () =>
    eq(L.buildTimeline().map(s => s.icon), ["✓", "✓", "3", "4"]));

  // --- mapsSearchUrl ---
  test("mapsSearchUrl points to Google Maps over https", () => ok(L.mapsSearchUrl("x").startsWith("https://www.google.com/maps/search/")));
  test("mapsSearchUrl encodes special characters", () => ok(!L.mapsSearchUrl("a b&c").includes(" ") && L.mapsSearchUrl("a b&c").endsWith("a%20b%26c")));

  // --- Google services ---
  test("mapsEmbedUrl builds a keyless Google Maps embed URL", () => {
    const u = L.mapsEmbedUrl("Sri Lakshmi Store");
    ok(u.startsWith("https://www.google.com/maps?output=embed")); ok(u.endsWith("Sri%20Lakshmi%20Store"));
  });
  test("calendarUrl formats UTC dates for Google Calendar", () => {
    const u = L.calendarUrl({ title: "A&B", start: new Date("2026-10-02T12:00:00Z"), end: new Date("2026-10-02T12:30:00Z") });
    ok(u.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE"));
    ok(u.includes("dates=20261002T120000Z/20261002T123000Z")); ok(u.includes("text=A%26B"));
  });
  test("calendarUrl encodes details text", () =>
    ok(L.calendarUrl({ title: "t", details: "x y", start: new Date(0), end: new Date(1000) }).includes("details=x%20y")));

  // --- role switching ---
  test("nextRole cycles through all roles and wraps", () => {
    let r = "Customer"; const seen = [];
    for (let i = 0; i < 4; i++) { r = L.nextRole(r).name; seen.push(r); }
    eq(seen, ["Community Store", "Partner Store", "HQ", "Customer"]);
  });
  test("nextRole starts from Customer for unknown names", () => eq(L.nextRole("???").name, "Customer"));
  test("every role points to a section id", () => L.ROLES.forEach(r => ok(r.section.length > 0)));

  // --- integration / accessibility checks (Node only: reads the real project files) ---
  if (isNode) {
    const fs = require("fs");
    const html = fs.readFileSync(__dirname + "/index.html", "utf8");
    const app = fs.readFileSync(__dirname + "/app.js", "utf8");
    test("every #id used in app.js exists in index.html", () => {
      const used = [...app.matchAll(/\$\("#([\w-]+)"\)/g)].map(m => m[1]);
      const missing = [...new Set(used)].filter(id => !html.includes(`id="${id}"`));
      eq(missing, []);
    });
    test("index.html declares lang and viewport", () => { ok(/<html[^>]*lang=/.test(html)); ok(html.includes('name="viewport"')); });
    test("search input has an associated label", () => ok(/<label for="q"/.test(html)));
    test("notice area is an aria-live status region", () => ok(/id="notice"[^>]*role="status"[^>]*aria-live="polite"/.test(html)));
    test("index.html loads app.js with defer", () => ok(/<script src="app.js" defer>/.test(html)));
    test("Google Maps and Calendar controls exist in the page", () =>
      ["showMap", "maps", "calendar", "mapBox"].forEach(id => ok(html.includes(`id="${id}"`), id)));
    test("every role section id exists in index.html", () => L.ROLES.forEach(r => ok(html.includes(`id="${r.section}"`), r.section)));
    test("close button and dialog are labelled for screen readers", () => {
      ok(/id="close"[^>]*aria-label=/.test(html)); ok(/<dialog[^>]*aria-labelledby="modalTitle"/.test(html));
    });
    test("skip link and live product region exist", () => { ok(html.includes('href="#customer"')); ok(/id="products"[^>]*aria-live/.test(html)); });
    test("case evidence section maps problems to features", () => ok(html.includes("29%") && html.includes("Pre-book + stock lock")));
    test("source files keep readable line lengths (<=160 chars)", () => {
      ["app.js", "tests.js", "styles.css"].forEach(f => fs.readFileSync(__dirname + "/" + f, "utf8").split("\n")
        .forEach((line, i) => ok(line.length <= 160, `${f}:${i + 1} is ${line.length} chars`)));
    });
    test("every button action id in app.js has a matching modal button", () => {
      const ids = [...app.matchAll(/modalButton\("(\w+)"/g)].map(m => m[1]).concat(["confirm", "backup"]);
      const handlers = app.match(/const ACTIONS = \{([\s\S]*?)\n  \};/)[1];
      ids.forEach(id => ok(new RegExp("\\b" + id + "\\b").test(handlers), `no handler for ${id}`));
    });
    test("no eval or document.write in app code", () => ok(!/\beval\(|document\.write\(/.test(app)));
    test("external window.open uses noopener", () => ok(/noopener/.test(app)));
  }

  // --- report ---
  const passed = results.filter(r => r.pass).length;
  const summary = `${passed}/${results.length} tests passed`;
  if (typeof document !== "undefined") {
    document.getElementById("results").innerHTML = results.map(r =>
      `<li>${r.pass ? "PASS" : "FAIL"} — ${L.esc(r.name)}${r.detail ? ` (${L.esc(r.detail)})` : ""}</li>`).join("");
    document.getElementById("summary").textContent = summary;
  } else {
    results.forEach(r => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  -> " + r.detail : ""}`));
    console.log("\n" + summary);
    if (passed !== results.length) process.exitCode = 1;
  }
})();

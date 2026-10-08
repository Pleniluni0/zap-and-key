// Zap & Key — filtro del Historial de lectura.
// Compartido por el content script y el popup: decide qué páginas son
// realmente un lector de cómics/manga/webtoon y cuáles NO deben guardarse.
(function (root) {
    'use strict';

    // ── 1. Dominios que nunca son un lector de cómics ──
    // Tiendas, redes sociales, streaming, anime, buscadores, wikis...
    const BLOCKED_HOST_PATTERNS = [
        // Tiendas / marketplaces
        /(^|\.)amazon\.[a-z.]+$/, /(^|\.)amzn\.[a-z]+$/, /(^|\.)ebay\.[a-z.]+$/, /(^|\.)aliexpress\.[a-z.]+$/,
        /(^|\.)mercadolibre\.[a-z.]+$/, /(^|\.)wallapop\.com$/, /(^|\.)etsy\.com$/, /(^|\.)temu\.com$/,
        /(^|\.)shein\.[a-z.]+$/, /(^|\.)pccomponentes\.com$/, /(^|\.)elcorteingles\.es$/, /(^|\.)fnac\.[a-z.]+$/,
        /(^|\.)casadellibro\.com$/, /(^|\.)planetadelibros\.com$/, /(^|\.)panini\.[a-z.]+$/, /(^|\.)ikea\.com$/,
        // Redes sociales
        /(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)fb\.com$/, /(^|\.)twitter\.com$/, /(^|\.)x\.com$/,
        /(^|\.)tiktok\.com$/, /(^|\.)reddit\.com$/, /(^|\.)linkedin\.com$/, /(^|\.)pinterest\.[a-z.]+$/,
        /(^|\.)threads\.net$/, /(^|\.)discord\.com$/, /(^|\.)telegram\.org$/, /(^|\.)t\.me$/, /(^|\.)whatsapp\.com$/,
        // Streaming / vídeo
        /(^|\.)youtube\.com$/, /(^|\.)youtu\.be$/, /(^|\.)netflix\.com$/, /(^|\.)primevideo\.com$/,
        /(^|\.)disneyplus\.com$/, /(^|\.)hbomax\.com$/, /(^|\.)max\.com$/, /(^|\.)hulu\.com$/, /(^|\.)pluto\.tv$/,
        /(^|\.)plutotv\.[a-z.]+$/, /(^|\.)twitch\.tv$/, /(^|\.)vimeo\.com$/, /(^|\.)dailymotion\.com$/,
        /(^|\.)crunchyroll\.com$/, /(^|\.)funimation\.com$/, /(^|\.)atresplayer\.com$/, /(^|\.)rtve\.es$/,
        /(^|\.)mitele\.es$/, /(^|\.)spotify\.com$/, /(^|\.)filmin\.[a-z]+$/, /(^|\.)movistarplus\.es$/,
        // Anime (episodios, no cómics)
        /(^|\.)animeflv\.[a-z.]+$/, /(^|\.)jkanime\.[a-z.]+$/, /(^|\.)monoschinos[a-z0-9]*\.[a-z.]+$/,
        /(^|\.)tioanime\.[a-z.]+$/, /(^|\.)animeid\.[a-z.]+$/, /(^|\.)hianime\.[a-z.]+$/, /(^|\.)aniwatch[a-z]*\.[a-z.]+$/,
        /(^|\.)gogoanime[a-z0-9]*\.[a-z.]+$/, /(^|\.)9anime[a-z0-9]*\.[a-z.]+$/, /(^|\.)animeflash\.[a-z.]+$/,
        /(^|\.)animefenix\.[a-z.]+$/, /(^|\.)animeav1\.[a-z.]+$/, /(^|\.)zoro\.to$/, /(^|\.)crunchyroll\.[a-z.]+$/,
        // Fichas / bases de datos / buscadores / wikis / dev
        /(^|\.)myanimelist\.net$/, /(^|\.)anilist\.co$/, /(^|\.)imdb\.com$/, /(^|\.)filmaffinity\.com$/,
        /(^|\.)themoviedb\.org$/, /(^|\.)wikipedia\.org$/, /(^|\.)fandom\.com$/, /(^|\.)goodreads\.com$/,
        /(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /(^|\.)duckduckgo\.com$/, /(^|\.)github\.com$/,
        /(^|\.)stackoverflow\.com$/, /(^|\.)claude\.ai$/, /(^|\.)chatgpt\.com$/, /(^|\.)openai\.com$/
    ];

    const OVERRIDES_KEY = 'zap_history_domains'; // { "host": "block" | "allow" }

    function normalizeHost(hostname) {
        return (hostname || '').toLowerCase().replace(/^www\./, '');
    }

    // Lista automática (sin tener en cuenta lo que el usuario haya configurado)
    function isBlockedDomain(hostname) {
        const h = normalizeHost(hostname);
        if (!h) return true;
        return BLOCKED_HOST_PATTERNS.some(re => re.test(h));
    }

    // Decisión manual del usuario para un dominio: 'block' | 'allow' | null
    function getOverride(hostname, overrides) {
        const v = overrides && overrides[normalizeHost(hostname)];
        return (v === 'block' || v === 'allow') ? v : null;
    }

    // 'allow' | 'block' (manual) | 'auto-blocked' (lista automática) | 'auto'
    function domainStatus(hostname, overrides) {
        const o = getOverride(hostname, overrides);
        if (o) return o;
        return isBlockedDomain(hostname) ? 'auto-blocked' : 'auto';
    }

    // ¿Se debe analizar/guardar algo de este dominio?
    function shouldTrackDomain(hostname, overrides) {
        const st = domainStatus(hostname, overrides);
        return st === 'allow' || st === 'auto';
    }

    // ── 2. Señales positivas / negativas en la propia página ──
    const COMIC_WORDS = /(manga|manhwa|manhua|webtoon|comic|c[oó]mic|historieta|scan(?:lation)?s?|lector|reader|leer-?online|read-?online|doujin|one-?shot)/i;
    const ANIME_WORDS = /(^|[\/.\-_])(anime|animes|ver-anime|watch|pelicula|peliculas|movie|movies|serie-tv|tv-show|tvshow|stream|player-video)([\/.\-_]|$)/i;

    const READER_SELECTORS = [
        '#readerarea', '.reading-content', '.reader-area', '#chapter-container', '.chapter-container',
        '#chapter-images', '.chapter-images', '#images', '.page-break', '.wp-manga-chapter-img',
        '.chapter-content img', '.manga-reader', '.comic-reader', '#viewer', '.viewer-container',
        '[class*="reader"] img', '[id*="reader"] img', '[class*="webtoon"] img', '[class*="chapter-img"]',
        '[class*="manga-page"]', '[class*="comic-page"]', '#vertical-view', '.vertical-reader'
    ].join(',');

    function countReaderImages() {
        let count = 0;
        const imgs = document.images;
        for (let i = 0; i < imgs.length && i < 400; i++) {
            const img = imgs[i];
            const r = img.getBoundingClientRect();
            const w = r.width || img.naturalWidth || 0;
            const h = r.height || img.naturalHeight || 0;
            const lazy = img.dataset && (img.dataset.src || img.dataset.lazySrc || img.dataset.original);
            // Página de cómic: imagen grande (ancho ≥ 250). Si aún no ha cargado, vale si es lazy y ancha.
            if (w >= 250 && (h >= 250 || (lazy && h < 50))) count++;
        }
        return count;
    }

    function hasNegativeStructure() {
        // Vídeo grande (reproductor de episodios / streaming)
        for (const v of document.querySelectorAll('video')) {
            const r = v.getBoundingClientRect();
            if (r.width >= 300 && r.height >= 170) return 'video';
        }
        const ogType = (document.querySelector('meta[property="og:type"]')?.content || '').toLowerCase();
        if (/^(video|music|product|profile|website\.product)/.test(ogType)) return 'og:type=' + ogType;

        // Datos estructurados de producto / vídeo / película
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            const t = s.textContent || '';
            if (/"@type"\s*:\s*"?\[?\s*"?(Product|VideoObject|TVEpisode|Movie|TVSeries|Offer|SoftwareApplication)\b/i.test(t)) return 'ld+json';
        }
        // Botones de compra / carrito
        if (document.querySelector('#add-to-cart-button, [name="add-to-cart"], .add_to_cart_button, [data-action="add-to-cart"], form[action*="/cart"]')) return 'cart';
        const buyText = /(a[ñn]adir al carrito|agregar al carrito|comprar ahora|add to cart|add to basket|buy now|buy it now)/i;
        const actions = document.querySelectorAll('button, a[role="button"], input[type="submit"], input[type="button"]');
        for (let i = 0; i < actions.length && i < 300; i++) {
            if (buyText.test(actions[i].textContent || actions[i].value || '')) return 'buy-button';
        }
        return null;
    }

    // Devuelve { ok, reason, score } — si ok es false, la página NO se guarda.
    function evaluatePage(overrides) {
        const host = (location.hostname || '').toLowerCase();
        const status = domainStatus(host, overrides);
        if (status === 'block') return { ok: false, reason: 'user-blocked' };
        if (status === 'allow') return { ok: true, reason: 'user-allowed' }; // el usuario manda: sin más filtros
        if (status === 'auto-blocked') return { ok: false, reason: 'blocked-domain' };

        const neg = hasNegativeStructure();
        if (neg) return { ok: false, reason: 'negative:' + neg };

        const path = decodeURIComponent(location.pathname || '');
        const title = (document.title || '') + ' ' + (document.querySelector('meta[property="og:title"]')?.content || '');
        const h1 = document.querySelector('h1')?.textContent || '';

        if (ANIME_WORDS.test(host) || ANIME_WORDS.test(path)) {
            // "anime" en dominio/ruta y sin ningún rastro de manga/cómic → descartado
            if (!COMIC_WORDS.test(host + path + title + h1)) return { ok: false, reason: 'anime-url' };
        }

        const readerContainer = !!document.querySelector(READER_SELECTORS);
        const bigImages = countReaderImages();
        const imagesStrong = bigImages >= 4;
        const imagesWeak = bigImages >= 2;

        // Contexto: la URL, el dominio o el título hablan de cómics
        const contextual = COMIC_WORDS.test(host) || COMIC_WORDS.test(path) || COMIC_WORDS.test(title) || COMIC_WORDS.test(h1);

        let score = 0;
        if (readerContainer) score += 3;
        if (imagesStrong) score += 3; else if (imagesWeak) score += 1;
        if (contextual) score += 2;

        // Debe haber ESTRUCTURA de lector (contenedor o varias imágenes grandes)…
        const structural = readerContainer || imagesStrong || (imagesWeak && contextual);
        // …y suficiente evidencia total.
        const ok = structural && score >= 4;
        return { ok, reason: ok ? 'comic-reader' : 'not-a-reader', score, bigImages, readerContainer, contextual };
    }

    // Quita del historial guardado las entradas de dominios bloqueados.
    function purgeBlockedEntries(history, overrides) {
        let removed = 0;
        for (const slug of Object.keys(history || {})) {
            const dom = history[slug] && history[slug].domain;
            if (!shouldTrackDomain(dom, overrides)) {
                delete history[slug];
                removed++;
            }
        }
        return removed;
    }

    root.ZapHistoryFilter = {
        OVERRIDES_KEY, normalizeHost, isBlockedDomain, getOverride, domainStatus,
        shouldTrackDomain, evaluatePage, purgeBlockedEntries
    };
})(typeof self !== 'undefined' ? self : this);

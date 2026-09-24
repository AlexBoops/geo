(function () {
  var clientPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function wispUrl() {
    try {
      if (window.TruffledTransport) return window.TruffledTransport.getWisp();
    } catch (e) {}
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/wisp/';
  }

  function client() {
    if (!clientPromise) {
      clientPromise = (async function () {
        if (!window.TruffledTransport) {
          try { await loadScript('/js/transport.js'); } catch (e) {}
        }
        var mod = await import('/js/libcurlbareclient.mjs');
        var c = new mod.default({ wisp: wispUrl() });
        await c.init();
        return c;
      })();
      clientPromise.catch(function () { clientPromise = null; });
    }
    return clientPromise;
  }

  function headerObject(h) {
    var out = {};
    if (h) {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function (v, k) { out[k] = v; });
      } else if (Array.isArray(h)) {
        for (var i = 0; i < h.length; ++i) out[h[i][0]] = h[i][1];
      } else {
        for (var k in h) out[k] = h[k];
      }
    }
    out['User-Agent'] = ' ';
    if (!out.Accept && !out.accept) out.Accept = '*/*';
    return out;
  }

  function pairsOf(p) {
    if (Array.isArray(p.raw_headers)) return p.raw_headers;
    var out = [];
    if (p.headers && p.headers.forEach) {
      p.headers.forEach(function (v, k) { out.push([k, v]); });
    }
    return out;
  }

  function responseHeaders(pairs) {
    var headers = new Headers();
    (pairs || []).forEach(function (p) {
      try { headers.append(p[0], p[1]); } catch (e) {}
    });
    if (headers.has('content-encoding')) {
      headers.delete('content-encoding');
      headers.delete('content-length');
    }
    return headers;
  }

  function withTimeout(promise, ms, label) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        timer = setTimeout(function () {
          reject(new TypeError(label + ' timed out'));
        }, ms);
      })
    ]).finally(function () { clearTimeout(timer); });
  }

  async function once(c, url, opts) {
    try {
      return await withTimeout(c.session.fetch(url.href, opts), 20000,
                               'request');
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw e;
      if (opts.method !== 'GET' && opts.method !== 'HEAD') throw e;
      c.resetSession();
      return await withTimeout(c.session.fetch(url.href, opts), 20000,
                               'retry');
    }
  }

  window.__gdScramjetFetch = async function (target, init) {
    init = init || {};
    var c = await withTimeout(client(), 15000, 'transport start');
    var method = String(init.method || 'GET').toUpperCase();
    var body = init.body;
    var headers = headerObject(init.headers);
    var url = new URL(target);
    for (var hop = 0; hop < 6; ++hop) {
      var p = await once(c, url, {
        method: method,
        headers: headers,
        body: body,
        redirect: 'manual',
        signal: init.signal
      });
      var pairs = pairsOf(p);
      if (p.status === 403 || p.status === 429 || p.status === 503)
        throw new TypeError('upstream refused the transport (' + p.status + ')');
      if (p.status >= 300 && p.status < 400) {
        var loc = null;
        pairs.forEach(function (q) {
          if (String(q[0]).toLowerCase() === 'location') loc = q[1];
        });
        if (loc) {
          url = new URL(loc, url);
          if (p.status !== 307 && p.status !== 308) {
            method = 'GET';
            body = undefined;
            delete headers['Content-Type'];
            delete headers['content-type'];
          }
          continue;
        }
      }
      var empty = p.status === 204 || p.status === 304 || method === 'HEAD';
      return new Response(empty ? null : p.body, {
        status: p.status,
        statusText: p.statusText || '',
        headers: responseHeaders(pairs)
      });
    }
    throw new TypeError('too many redirects');
  };
})();

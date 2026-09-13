(function (global) {
  'use strict';

  var NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  var SG_VIEWBOX = '103.6,1.47,104.1,1.15';

  var MIN_INTERVAL_MS = 1000;
  var queue = [];
  var queueRunning = false;
  var lastRequestTime = 0;

  function enqueue(taskFn) {
    return new Promise(function (resolve, reject) {
      queue.push({ taskFn: taskFn, resolve: resolve, reject: reject });
      runQueue();
    });
  }

  function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    (function step() {
      if (!queue.length) { queueRunning = false; return; }
      var wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestTime));
      setTimeout(function () {
        var item = queue.shift();
        lastRequestTime = Date.now();
        Promise.resolve().then(item.taskFn).then(item.resolve, item.reject).then(step);
      }, wait);
    })();
  }

  function fetchJson(url) {
    return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('Geocoder: HTTP ' + r.status);
        return r.json();
      });
  }

  function ensureSingapore(address) {
    var s = (address || '').trim();
    if (!s) throw new Error('Address is empty');
    if (!/singapore/i.test(s)) s += ', Singapore';
    return s;
  }

  function formatResult(item) {
    return {
      displayName: item.display_name || 'Unknown',
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    };
  }

  function autocomplete(query) {
    query = (query || '').trim();
    if (query.length < 2) return Promise.resolve([]);

    var searchQuery = ensureSingapore(query);

    return enqueue(function () {
      var params = new URLSearchParams({
        q: searchQuery,
        format: 'jsonv2',
        limit: '5',
        viewbox: SG_VIEWBOX,
        bounded: '1',
        addressdetails: '1'
      });
      return fetchJson(NOMINATIM_BASE + '/search?' + params.toString())
        .then(function (results) {
          if (!Array.isArray(results)) return [];
          return results.map(formatResult);
        });
    }).catch(function (err) {
      console.warn('Autocomplete error:', err);
      return [];
    });
  }

  function geocode(address) {
    var query;
    try { query = ensureSingapore(address); } catch (e) { return Promise.reject(e); }

    return enqueue(function () {
      var params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
        viewbox: SG_VIEWBOX,
        bounded: '1'
      });
      return fetchJson(NOMINATIM_BASE + '/search?' + params.toString())
        .then(function (results) {
          if (!results || !results.length) {
            throw new Error('No results found for "' + address + '"');
          }
          return formatResult(results[0]);
        });
    });
  }

  global.Geocoder = { autocomplete: autocomplete, geocode: geocode };
})(typeof window !== 'undefined' ? window : this);

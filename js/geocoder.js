/**
 * geocoder.js
 *
 * Address geocoding for the Singapore delivery route optimizer, backed by
 * the free Nominatim (OpenStreetMap) search API. No API key required.
 *
 * Usage policy compliance (https://operations.osmfoundation.org/policies/nominatim/):
 *   - A descriptive User-Agent / Referer identifying the application is sent
 *     with every request (custom headers are set where the browser allows it;
 *     a `referrer` param is also added as a fallback since browsers control
 *     the actual Referer header themselves).
 *   - Requests are throttled to a maximum of 1 per second via an internal
 *     request queue, regardless of how many calls the app fires concurrently.
 *   - Results are biased to Singapore using a bounding viewbox.
 *
 * Exposes a single global: `Geocoder`.
 */
(function (global) {
  'use strict';

  var NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  var APP_NAME = 'SG-Delivery-Route-Optimizer/1.0';
  var APP_CONTACT_REFERRER = 'https://sg-delivery-route-optimizer.app';

  // Singapore bounding box: left,top,right,bottom (lon,lat,lon,lat)
  var SG_VIEWBOX = '103.6,1.47,104.1,1.15';

  // ---------------------------------------------------------------------
  // Simple FIFO throttle queue: ensures at least MIN_INTERVAL_MS between
  // the *start* of consecutive outgoing requests, as required by the
  // Nominatim usage policy (max 1 request/second).
  // ---------------------------------------------------------------------
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
      if (queue.length === 0) {
        queueRunning = false;
        return;
      }

      var now = Date.now();
      var elapsed = now - lastRequestTime;
      var wait = Math.max(0, MIN_INTERVAL_MS - elapsed);

      setTimeout(function () {
        var item = queue.shift();
        lastRequestTime = Date.now();
        Promise.resolve()
          .then(item.taskFn)
          .then(item.resolve, item.reject)
          .then(step);
      }, wait);
    })();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function ensureSingapore(address) {
    var trimmed = String(address || '').trim();
    if (!trimmed) {
      throw new Error('Geocoder: address must be a non-empty string.');
    }
    if (!/singapore/i.test(trimmed)) {
      trimmed = trimmed + ', Singapore';
    }
    return trimmed;
  }

  function buildHeaders() {
    // Note: browsers disallow scripts from overriding the real `Referer`
    // header, and some environments also block custom `User-Agent` on
    // fetch. We still set both — they take effect in non-browser runtimes
    // (e.g. Node/server-side use of this module) and are harmless no-ops
    // where the platform ignores them. The `referrer` field on the fetch
    // request additionally signals the calling application.
    return {
      'User-Agent': APP_NAME + ' (' + APP_CONTACT_REFERRER + ')',
      'Accept': 'application/json'
    };
  }

  function fetchJson(url) {
    return fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
      referrer: APP_CONTACT_REFERRER
    }).then(function (response) {
      if (!response.ok) {
        throw new Error(
          'Geocoder: Nominatim request failed with status ' +
            response.status +
            ' ' +
            response.statusText
        );
      }
      return response.json();
    });
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /**
   * Geocode a free-form address to {lat, lng, displayName}.
   * Automatically appends ", Singapore" if not already present, and biases
   * results to the Singapore bounding box.
   *
   * @param {string} address
   * @returns {Promise<{lat: number, lng: number, displayName: string}>}
   */
  function geocode(address) {
    var query;
    try {
      query = ensureSingapore(address);
    } catch (err) {
      return Promise.reject(err);
    }

    return enqueue(function () {
      var params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
        viewbox: SG_VIEWBOX,
        bounded: '1',
        addressdetails: '0'
      });
      var url = NOMINATIM_BASE + '/search?' + params.toString();

      return fetchJson(url).then(function (results) {
        if (!Array.isArray(results) || results.length === 0) {
          throw new Error(
            'Geocoder: no results found for address "' + address + '".'
          );
        }
        var best = results[0];
        var lat = parseFloat(best.lat);
        var lng = parseFloat(best.lon);
        if (isNaN(lat) || isNaN(lng)) {
          throw new Error(
            'Geocoder: Nominatim returned an invalid coordinate for "' +
              address +
              '".'
          );
        }
        return {
          lat: lat,
          lng: lng,
          displayName: best.display_name || query
        };
      });
    });
  }

  /**
   * Reverse-geocode a coordinate pair to a human-readable address string.
   *
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<string>} the display name of the nearest address
   */
  function reverseGeocode(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return Promise.reject(
        new Error('Geocoder: reverseGeocode requires numeric lat and lng.')
      );
    }

    return enqueue(function () {
      var params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'jsonv2',
        zoom: '18',
        addressdetails: '0'
      });
      var url = NOMINATIM_BASE + '/reverse?' + params.toString();

      return fetchJson(url).then(function (result) {
        if (!result || result.error || !result.display_name) {
          throw new Error(
            'Geocoder: no address found for coordinates (' +
              lat +
              ', ' +
              lng +
              ').'
          );
        }
        return result.display_name;
      });
    });
  }

  var Geocoder = {
    geocode: geocode,
    reverseGeocode: reverseGeocode
  };

  global.Geocoder = Geocoder;

  // Support CommonJS/Node-style consumption as well, if present.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Geocoder;
  }
})(typeof window !== 'undefined' ? window : this);

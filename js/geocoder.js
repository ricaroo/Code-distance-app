(function (global) {
  'use strict';

  var PHOTON_BASE = 'https://photon.komoot.io';
  // Singapore center for biasing results
  var SG_LAT = 1.3521;
  var SG_LNG = 103.8198;

  var NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  var SG_VIEWBOX = '103.6,1.47,104.1,1.15';

  var MIN_INTERVAL_MS = 300;
  var lastRequestTime = 0;

  function throttledFetch(url) {
    var now = Date.now();
    var wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestTime));
    return new Promise(function (resolve) {
      setTimeout(resolve, wait);
    }).then(function () {
      lastRequestTime = Date.now();
      return fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Geocoder request failed: ' + response.status);
      }
      return response.json();
    });
  }

  function formatPhotonFeature(feature) {
    var props = feature.properties || {};
    var parts = [];
    if (props.name) parts.push(props.name);
    if (props.street) {
      var streetPart = props.street;
      if (props.housenumber) streetPart = props.housenumber + ' ' + streetPart;
      if (!parts.length || parts[0] !== streetPart) parts.push(streetPart);
    }
    if (props.city || props.district) parts.push(props.city || props.district);
    if (props.country) parts.push(props.country);
    return parts.join(', ') || 'Unknown location';
  }

  /**
   * Autocomplete search — returns up to 5 suggestions as the user types.
   * Uses Photon (Komoot) which is free, no API key, fast.
   */
  function autocomplete(query) {
    query = (query || '').trim();
    if (query.length < 2) {
      return Promise.resolve([]);
    }

    var url = PHOTON_BASE + '/api?' +
      'q=' + encodeURIComponent(query) +
      '&lat=' + SG_LAT +
      '&lon=' + SG_LNG +
      '&limit=5' +
      '&lang=en';

    return throttledFetch(url).then(function (data) {
      if (!data.features || !data.features.length) return [];

      return data.features
        .filter(function (f) {
          // Only keep results in/near Singapore
          var coords = f.geometry && f.geometry.coordinates;
          if (!coords) return false;
          var lng = coords[0], lat = coords[1];
          return lat > 1.1 && lat < 1.5 && lng > 103.5 && lng < 104.2;
        })
        .map(function (f) {
          var coords = f.geometry.coordinates;
          return {
            displayName: formatPhotonFeature(f),
            lat: coords[1],
            lng: coords[0]
          };
        });
    }).catch(function () {
      return [];
    });
  }

  /**
   * Full geocode — for the initial start address on page load.
   * Falls back to Nominatim for a reliable single-result lookup.
   */
  function geocode(address) {
    address = (address || '').trim();
    if (!address) return Promise.reject(new Error('Address is empty'));

    if (!/singapore/i.test(address)) {
      address = address + ', Singapore';
    }

    var params = new URLSearchParams({
      q: address,
      format: 'jsonv2',
      limit: '1',
      viewbox: SG_VIEWBOX,
      bounded: '1'
    });
    var url = NOMINATIM_BASE + '/search?' + params.toString();

    return throttledFetch(url).then(function (results) {
      if (!results || !results.length) {
        throw new Error('No results found for "' + address + '"');
      }
      var best = results[0];
      return {
        displayName: best.display_name || address,
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon)
      };
    });
  }

  global.Geocoder = {
    autocomplete: autocomplete,
    geocode: geocode
  };
})(typeof window !== 'undefined' ? window : this);

/**
 * router.js
 *
 * Driving-distance/duration matrix and route-geometry lookups for the
 * Singapore delivery route optimizer, backed by the public OSRM demo
 * server (https://router.project-osrm.org). No API key required.
 *
 * IMPORTANT: OSRM expects coordinates as "lng,lat" (longitude first),
 * which is the opposite of the {lat, lng} object shape used elsewhere in
 * this app. All conversion happens inside this module so callers can keep
 * passing plain {lat, lng} objects.
 *
 * Exposes a single global: `Router`.
 */
(function (global) {
  'use strict';

  var OSRM_BASE = 'https://router.project-osrm.org';

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function isValidLocation(loc) {
    return (
      loc &&
      typeof loc.lat === 'number' &&
      typeof loc.lng === 'number' &&
      !isNaN(loc.lat) &&
      !isNaN(loc.lng)
    );
  }

  function assertLocations(locations, minCount) {
    if (!Array.isArray(locations) || locations.length < minCount) {
      throw new Error(
        'Router: expected an array of at least ' +
          minCount +
          ' {lat, lng} locations.'
      );
    }
    locations.forEach(function (loc, idx) {
      if (!isValidLocation(loc)) {
        throw new Error(
          'Router: location at index ' +
            idx +
            ' is not a valid {lat, lng} object.'
        );
      }
    });
  }

  // OSRM coordinate string: "lng,lat;lng,lat;..."
  function toCoordinateString(locations) {
    return locations
      .map(function (loc) {
        return loc.lng + ',' + loc.lat;
      })
      .join(';');
  }

  function fetchJson(url) {
    return fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
      .catch(function (err) {
        throw new Error(
          'Router: network error while contacting OSRM (' + err.message + ').'
        );
      })
      .then(function (response) {
        return response.json().catch(function () {
          throw new Error(
            'Router: OSRM returned an unreadable response (HTTP ' +
              response.status +
              ').'
          );
        }).then(function (body) {
          if (!response.ok || (body && body.code && body.code !== 'Ok')) {
            var message =
              (body && (body.message || body.code)) ||
              response.statusText ||
              'unknown error';
            throw new Error('Router: OSRM request failed - ' + message);
          }
          return body;
        });
      });
  }

  function metersToKm(meters) {
    return Math.round((meters / 1000) * 10) / 10; // 1 decimal place
  }

  function secondsToMinutes(seconds) {
    return Math.round((seconds / 60) * 10) / 10; // 1 decimal place
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /**
   * Fetch a full pairwise distance + duration matrix for a set of
   * locations using OSRM's Table service.
   *
   * @param {Array<{lat:number, lng:number}>} locations
   * @returns {Promise<{distances: number[][], durations: number[][]}>}
   *   distances are in km (1 decimal), durations are in minutes (1 decimal).
   *   distances[i][j] / durations[i][j] = travel from location i to location j.
   */
  function getDistanceMatrix(locations) {
    try {
      assertLocations(locations, 2);
    } catch (err) {
      return Promise.reject(err);
    }

    var coords = toCoordinateString(locations);
    var url =
      OSRM_BASE +
      '/table/v1/driving/' +
      coords +
      '?annotations=distance,duration';

    return fetchJson(url).then(function (body) {
      if (!body.distances || !body.durations) {
        throw new Error(
          'Router: OSRM table response is missing distances/durations ' +
            '(the public server may not have annotations=distance enabled).'
        );
      }

      var distancesKm = body.distances.map(function (row) {
        return row.map(function (meters) {
          return meters === null ? null : metersToKm(meters);
        });
      });

      var durationsMin = body.durations.map(function (row) {
        return row.map(function (seconds) {
          return seconds === null ? null : secondsToMinutes(seconds);
        });
      });

      return {
        distances: distancesKm,
        durations: durationsMin
      };
    });
  }

  /**
   * Fetch the actual driving route geometry and metrics for an ordered
   * sequence of stops using OSRM's Route service.
   *
   * @param {Array<{lat:number, lng:number}>} orderedLocations - stops in
   *   the order they should be visited (e.g. an optimized delivery route).
   * @returns {Promise<{
   *   geometry: Object,            // GeoJSON LineString
   *   totalDistance: number,       // km, 1 decimal
   *   totalDuration: number,       // minutes, 1 decimal
   *   legs: Array<{distance: number, duration: number}> // km / minutes per leg
   * }>}
   */
  function getRoute(orderedLocations) {
    try {
      assertLocations(orderedLocations, 2);
    } catch (err) {
      return Promise.reject(err);
    }

    var coords = toCoordinateString(orderedLocations);
    var url =
      OSRM_BASE +
      '/route/v1/driving/' +
      coords +
      '?overview=full&geometries=geojson&steps=false';

    return fetchJson(url).then(function (body) {
      if (!body.routes || body.routes.length === 0) {
        throw new Error(
          'Router: OSRM could not find a driving route for the given stops.'
        );
      }

      var route = body.routes[0];

      var legs = (route.legs || []).map(function (leg) {
        return {
          distance: metersToKm(leg.distance),
          duration: secondsToMinutes(leg.duration)
        };
      });

      return {
        geometry: route.geometry,
        totalDistance: metersToKm(route.distance),
        totalDuration: secondsToMinutes(route.duration),
        legs: legs
      };
    });
  }

  var Router = {
    getDistanceMatrix: getDistanceMatrix,
    getRoute: getRoute
  };

  global.Router = Router;

  // Support CommonJS/Node-style consumption as well, if present.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Router;
  }
})(typeof window !== 'undefined' ? window : this);

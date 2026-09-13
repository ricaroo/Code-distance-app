/**
 * app.js — Main application logic for the SG Route Optimizer.
 * Depends on globals: L (Leaflet), Geocoder, Router, Solver.
 */
(function () {
  'use strict';

  var SINGAPORE_CENTER = [1.3521, 103.8198];
  var DEFAULT_START_ADDRESS = '12 Little Road, Singapore';

  var COLOR_START = '#1f8a3b';
  var COLOR_STOP = '#2563eb';
  var COLOR_ROUTE = '#2563eb';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = {
    start: null, // { address, lat, lng }
    stops: [], // [{ address, lat, lng }]
    map: null,
    startMarker: null,
    stopMarkers: [], // parallel to state.stops
    routeLine: null,
    optimizing: false
  };

  // ---------------------------------------------------------------------
  // DOM references (grabbed once the DOM is ready)
  // ---------------------------------------------------------------------

  var dom = {};

  function cacheDom() {
    dom.startInput = document.getElementById('start-input');
    dom.setStartBtn = document.getElementById('set-start-btn'); // optional, may not exist
    dom.stopInput = document.getElementById('stop-input');
    dom.addStopBtn = document.getElementById('add-stop-btn');
    dom.stopsList = document.getElementById('stops-list');
    dom.optimizeBtn = document.getElementById('optimize-btn');
    dom.resultsPanel = document.getElementById('results-panel');
    dom.totalDistanceEl = document.getElementById('total-distance');
    dom.totalTimeEl = document.getElementById('total-time');
    dom.legsList = document.getElementById('legs-list');
    dom.mapEl = document.getElementById('map');
  }

  // ---------------------------------------------------------------------
  // One-time injected styles (toast, spinner, markers) so the app is fully
  // functional even before/without css/styles.css supplying these rules.
  // ---------------------------------------------------------------------

  function injectBaseStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '.sg-toast-container{position:fixed;top:16px;right:16px;z-index:10000;',
      'display:flex;flex-direction:column;gap:8px;max-width:320px;}',
      '.sg-toast{color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;',
      'line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;',
      'transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease;}',
      '.sg-toast--visible{opacity:1;transform:translateY(0);}',
      '.sg-toast--error{background:#dc2626;}',
      '.sg-toast--info{background:#334155;}',
      '.sg-toast--success{background:#16a34a;}',
      '.sg-marker{display:flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;border-radius:50%;color:#fff;font-weight:700;',
      'font-size:13px;font-family:inherit;box-shadow:0 1px 4px rgba(0,0,0,.4);',
      'border:2px solid #fff;}',
      '.sg-marker--start{background:' + COLOR_START + ';}',
      '.sg-marker--stop{background:' + COLOR_STOP + ';}',
      '.sg-spinner{display:inline-block;width:14px;height:14px;',
      'border:2px solid rgba(255,255,255,.5);border-top-color:#fff;',
      'border-radius:50%;animation:sg-spin .7s linear infinite;',
      'margin-right:8px;vertical-align:-2px;}',
      '@keyframes sg-spin{to{transform:rotate(360deg);}}'
    ].join('');
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------

  var toastContainer = null;

  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'sg-toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function showToast(message, type) {
    var container = ensureToastContainer();
    var toast = document.createElement('div');
    toast.className = 'sg-toast sg-toast--' + (type || 'info');
    toast.textContent = message;
    container.appendChild(toast);

    // Force layout so the transition to visible actually animates.
    requestAnimationFrame(function () {
      toast.classList.add('sg-toast--visible');
    });

    setTimeout(function () {
      toast.classList.remove('sg-toast--visible');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 250);
    }, 4500);
  }

  function showError(message) {
    showToast(message, 'error');
  }

  // ---------------------------------------------------------------------
  // Map setup
  // ---------------------------------------------------------------------

  function initMap() {
    state.map = L.map(dom.mapEl).setView(SINGAPORE_CENTER, 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(state.map);
  }

  function makeDivIcon(label, kind) {
    return L.divIcon({
      html: '<div class="sg-marker sg-marker--' + kind + '">' + label + '</div>',
      className: '', // avoid Leaflet's default divIcon box styling
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  // ---------------------------------------------------------------------
  // Rendering: start marker, stop markers, stops list, route line
  // ---------------------------------------------------------------------

  function renderStartMarker() {
    if (state.startMarker) {
      state.map.removeLayer(state.startMarker);
      state.startMarker = null;
    }
    if (!state.start) {
      return;
    }
    state.startMarker = L.marker([state.start.lat, state.start.lng], {
      icon: makeDivIcon('S', 'start'),
      zIndexOffset: 1000
    })
      .addTo(state.map)
      .bindTooltip(state.start.address);
  }

  function renderStopMarkers() {
    state.stopMarkers.forEach(function (marker) {
      state.map.removeLayer(marker);
    });
    state.stopMarkers = state.stops.map(function (stop, idx) {
      return L.marker([stop.lat, stop.lng], {
        icon: makeDivIcon(String(idx + 1), 'stop')
      })
        .addTo(state.map)
        .bindTooltip(stop.address);
    });
  }

  function renumberStopMarkers() {
    state.stopMarkers.forEach(function (marker, idx) {
      marker.setIcon(makeDivIcon(String(idx + 1), 'stop'));
    });
  }

  function renderStopsList() {
    dom.stopsList.innerHTML = '';
    state.stops.forEach(function (stop, idx) {
      var li = document.createElement('li');
      li.className = 'stop-item';

      var badge = document.createElement('span');
      badge.className = 'stop-item__badge';
      badge.textContent = String(idx + 1);

      var text = document.createElement('span');
      text.className = 'stop-item__address';
      text.textContent = stop.address;

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'stop-item__remove';
      removeBtn.setAttribute('aria-label', 'Remove stop ' + stop.address);
      removeBtn.textContent = '×'; // ×
      removeBtn.addEventListener('click', function () {
        removeStop(idx);
      });

      li.appendChild(badge);
      li.appendChild(text);
      li.appendChild(removeBtn);
      dom.stopsList.appendChild(li);
    });
  }

  function clearRoute() {
    if (state.routeLine) {
      state.map.removeLayer(state.routeLine);
      state.routeLine = null;
    }
    dom.resultsPanel.hidden = true;
    dom.legsList.innerHTML = '';
    dom.totalDistanceEl.textContent = '–';
    dom.totalTimeEl.textContent = '–';
  }

  // ---------------------------------------------------------------------
  // Address actions
  // ---------------------------------------------------------------------

  function setStart(address) {
    address = (address || '').trim();
    if (!address) {
      showError('Please enter a starting address.');
      return Promise.resolve();
    }
    return Geocoder.geocode(address)
      .then(function (result) {
        state.start = {
          address: result.displayName || address,
          lat: result.lat,
          lng: result.lng
        };
        renderStartMarker();
        clearRoute();
      })
      .catch(function (err) {
        showError('Could not find that starting address. ' + describeError(err));
      });
  }

  function addStop(address) {
    address = (address || '').trim();
    if (!address) {
      showError('Please enter a delivery address.');
      return Promise.resolve();
    }
    return Geocoder.geocode(address)
      .then(function (result) {
        state.stops.push({
          address: result.displayName || address,
          lat: result.lat,
          lng: result.lng
        });
        renderStopMarkers();
        renderStopsList();
        clearRoute();
        dom.stopInput.value = '';
      })
      .catch(function (err) {
        showError('Could not find that delivery address. ' + describeError(err));
      });
  }

  function removeStop(index) {
    state.stops.splice(index, 1);
    renderStopMarkers();
    renderStopsList();
    clearRoute();
  }

  function describeError(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    return '';
  }

  // ---------------------------------------------------------------------
  // Router/Solver adapters (tolerate small shape differences)
  // ---------------------------------------------------------------------

  function getDistanceMatrix(points) {
    return Router.getDistanceMatrix(points);
  }

  function getRouteGeometry(points) {
    return Router.getRoute(points);
  }

  // ---------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------

  function formatDistance(km) {
    if (typeof km !== 'number' || isNaN(km)) return '–';
    return km.toFixed(1) + ' km';
  }

  function formatDuration(minutes) {
    if (typeof minutes !== 'number' || isNaN(minutes)) return '–';
    var totalMinutes = Math.round(minutes);
    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    if (hours > 0) {
      return hours + 'h ' + mins + 'm';
    }
    return totalMinutes + ' min';
  }

  // ---------------------------------------------------------------------
  // Optimize flow
  // ---------------------------------------------------------------------

  function setOptimizing(isOptimizing) {
    state.optimizing = isOptimizing;
    dom.optimizeBtn.disabled = isOptimizing;
    if (isOptimizing) {
      dom.optimizeBtn.dataset.originalLabel = dom.optimizeBtn.textContent;
      dom.optimizeBtn.innerHTML = '<span class="sg-spinner"></span>Optimizing…';
    } else {
      dom.optimizeBtn.textContent = dom.optimizeBtn.dataset.originalLabel || 'Optimize Route';
    }
  }

  function optimizeRoute() {
    if (state.optimizing) return;

    if (!state.start) {
      showError('Please set a starting location first.');
      return;
    }
    if (state.stops.length === 0) {
      showError('Please add at least one delivery stop.');
      return;
    }

    setOptimizing(true);

    var allPoints = [state.start].concat(state.stops);
    var latLngPoints = allPoints.map(function (p) {
      return { lat: p.lat, lng: p.lng };
    });

    getDistanceMatrix(latLngPoints)
      .then(function (matrixResult) {
        var distances = matrixResult.distances;
        var solution = Solver.solve(distances, 0);
        var orderedPoints = solution.order.map(function (idx) {
          return latLngPoints[idx];
        });

        return getRouteGeometry(orderedPoints).then(function (routeResult) {
          return { solution: solution, orderedPoints: orderedPoints, routeResult: routeResult };
        });
      })
      .then(function (result) {
        applyOptimizedRoute(allPoints, result.solution, result.routeResult);
      })
      .catch(function (err) {
        showError('Could not optimize the route. ' + describeError(err));
      })
      .then(function () {
        setOptimizing(false);
      });
  }

  function applyOptimizedRoute(allPoints, solution, routeResult) {
    // Re-order state.stops to match the optimized order (excluding the
    // start, which is always allPoints[0] / solution.order[0]).
    var orderedStops = solution.order.slice(1).map(function (idx) {
      return allPoints[idx];
    });
    state.stops = orderedStops;
    renderStopMarkers();
    renderStopsList();

    // Draw the actual road geometry (GeoJSON coordinates are [lng, lat]).
    if (state.routeLine) {
      state.map.removeLayer(state.routeLine);
    }
    var coords = routeResult.geometry && routeResult.geometry.coordinates
      ? routeResult.geometry.coordinates
      : [];
    var latLngs = coords.map(function (c) {
      return [c[1], c[0]]; // GeoJSON [lng,lat] → Leaflet [lat,lng]
    });
    state.routeLine = L.polyline(latLngs, {
      color: COLOR_ROUTE,
      weight: 4
    }).addTo(state.map);

    // Results panel.
    dom.resultsPanel.hidden = false;
    dom.totalDistanceEl.textContent = formatDistance(routeResult.totalDistance);
    dom.totalTimeEl.textContent = formatDuration(routeResult.totalDuration);

    dom.legsList.innerHTML = '';
    var journey = [allPoints[0]].concat(orderedStops);
    var legs = routeResult.legs || [];
    for (var i = 0; i < journey.length - 1; i++) {
      var from = journey[i];
      var to = journey[i + 1];
      var leg = legs[i];

      var li = document.createElement('li');
      li.className = 'leg-card';

      var indexBadge = document.createElement('span');
      indexBadge.className = 'leg-card__index';
      indexBadge.textContent = String(i + 1);

      var body = document.createElement('div');
      body.className = 'leg-card__body';

      var addrEl = document.createElement('div');
      addrEl.className = 'leg-card__address';
      addrEl.textContent = to.address;

      var metaEl = document.createElement('div');
      metaEl.className = 'leg-card__meta';
      metaEl.textContent = leg
        ? formatDistance(leg.distance) + ' · ' + formatDuration(leg.duration)
        : '';

      body.appendChild(addrEl);
      body.appendChild(metaEl);
      li.appendChild(indexBadge);
      li.appendChild(body);
      dom.legsList.appendChild(li);
    }

    // Fit map to show the entire route.
    var bounds = L.latLngBounds(latLngs.length ? latLngs : journey.map(function (p) {
      return [p.lat, p.lng];
    }));
    state.map.fitBounds(bounds, { padding: [40, 40] });

    showToast('Route optimized successfully.', 'success');
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------

  function wireEvents() {
    dom.startInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        setStart(dom.startInput.value);
      }
    });

    if (dom.setStartBtn) {
      dom.setStartBtn.addEventListener('click', function () {
        setStart(dom.startInput.value);
      });
    }

    dom.stopInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStop(dom.stopInput.value);
      }
    });

    dom.addStopBtn.addEventListener('click', function () {
      addStop(dom.stopInput.value);
    });

    dom.optimizeBtn.addEventListener('click', optimizeRoute);
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    cacheDom();
    injectBaseStyles();
    initMap();
    wireEvents();

    var initialAddress = (dom.startInput.value || DEFAULT_START_ADDRESS).trim();
    setStart(initialAddress);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

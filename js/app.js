(function () {
  'use strict';

  var SINGAPORE_CENTER = [1.3521, 103.8198];

  var state = {
    start: null,
    stops: [],
    map: null,
    startMarker: null,
    stopMarkers: [],
    routeLine: null,
    optimizing: false
  };

  var dom = {};

  function cacheDom() {
    dom.startInput = document.getElementById('start-input');
    dom.startSuggestions = document.getElementById('start-suggestions');
    dom.stopInput = document.getElementById('stop-input');
    dom.stopSuggestions = document.getElementById('stop-suggestions');
    dom.addStopBtn = document.getElementById('add-stop-btn');
    dom.stopsList = document.getElementById('stops-list');
    dom.optimizeBtn = document.getElementById('optimize-btn');
    dom.resultsPanel = document.getElementById('results-panel');
    dom.totalDistanceEl = document.getElementById('total-distance');
    dom.totalTimeEl = document.getElementById('total-time');
    dom.legsList = document.getElementById('legs-list');
  }

  // -------------------------------------------------------------------
  // Inline styles for markers and toasts
  // -------------------------------------------------------------------

  function injectStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '.sg-toast-box{position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;max-width:340px}',
      '.sg-toast{color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.25);opacity:0;transform:translateY(-6px);transition:opacity .2s,transform .2s}',
      '.sg-toast--show{opacity:1;transform:translateY(0)}',
      '.sg-toast--error{background:#dc2626}',
      '.sg-toast--info{background:#334155}',
      '.sg-toast--success{background:#16a34a}',
      '.sg-marker{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;color:#fff;font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff}',
      '.sg-marker--start{background:#1f8a3b}',
      '.sg-marker--stop{background:#2563eb}',
      '.sg-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sg-spin .6s linear infinite;margin-right:8px;vertical-align:-2px}',
      '@keyframes sg-spin{to{transform:rotate(360deg)}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // -------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------

  var toastBox;
  function toast(msg, type) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'sg-toast-box';
      document.body.appendChild(toastBox);
    }
    var el = document.createElement('div');
    el.className = 'sg-toast sg-toast--' + (type || 'info');
    el.textContent = msg;
    toastBox.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('sg-toast--show'); });
    setTimeout(function () {
      el.classList.remove('sg-toast--show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, 4000);
  }

  // -------------------------------------------------------------------
  // Map
  // -------------------------------------------------------------------

  function initMap() {
    state.map = L.map('map').setView(SINGAPORE_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(state.map);
  }

  function markerIcon(label, kind) {
    return L.divIcon({
      html: '<div class="sg-marker sg-marker--' + kind + '">' + label + '</div>',
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  // -------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------

  function setupAutocomplete(inputEl, listEl, onSelect) {
    var debounceTimer = null;
    var items = [];
    var activeIdx = -1;
    var selectedFromList = false;

    function showList(suggestions) {
      items = suggestions;
      activeIdx = -1;
      listEl.innerHTML = '';

      if (!suggestions.length) {
        listEl.classList.remove('autocomplete-list--open');
        return;
      }

      suggestions.forEach(function (s, idx) {
        var li = document.createElement('li');
        li.className = 'autocomplete-item';

        var parts = s.displayName.split(', ');
        var nameSpan = document.createElement('div');
        nameSpan.className = 'autocomplete-item__name';
        nameSpan.textContent = parts[0] || s.displayName;

        li.appendChild(nameSpan);

        if (parts.length > 1) {
          var detailSpan = document.createElement('div');
          detailSpan.className = 'autocomplete-item__detail';
          detailSpan.textContent = parts.slice(1).join(', ');
          li.appendChild(detailSpan);
        }

        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectItem(idx);
        });

        listEl.appendChild(li);
      });

      listEl.classList.add('autocomplete-list--open');
    }

    function hideList() {
      listEl.classList.remove('autocomplete-list--open');
      items = [];
      activeIdx = -1;
    }

    function selectItem(idx) {
      if (idx < 0 || idx >= items.length) return;
      var item = items[idx];
      inputEl.value = item.displayName;
      selectedFromList = true;
      hideList();
      onSelect(item);
    }

    function setActive(idx) {
      var children = listEl.children;
      if (activeIdx >= 0 && activeIdx < children.length) {
        children[activeIdx].classList.remove('autocomplete-item--active');
      }
      activeIdx = idx;
      if (activeIdx >= 0 && activeIdx < children.length) {
        children[activeIdx].classList.add('autocomplete-item--active');
        children[activeIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    inputEl.addEventListener('input', function () {
      selectedFromList = false;
      clearTimeout(debounceTimer);
      var query = inputEl.value.trim();
      if (query.length < 2) {
        hideList();
        return;
      }
      debounceTimer = setTimeout(function () {
        Geocoder.autocomplete(query).then(showList);
      }, 250);
    });

    inputEl.addEventListener('keydown', function (e) {
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(activeIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0) {
          selectItem(activeIdx);
        } else if (items.length) {
          selectItem(0);
        }
      } else if (e.key === 'Escape') {
        hideList();
      }
    });

    inputEl.addEventListener('blur', function () {
      setTimeout(hideList, 150);
    });

    return {
      wasSelectedFromList: function () { return selectedFromList; },
      reset: function () { selectedFromList = false; }
    };
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  function renderStartMarker() {
    if (state.startMarker) state.map.removeLayer(state.startMarker);
    state.startMarker = null;
    if (!state.start) return;
    state.startMarker = L.marker([state.start.lat, state.start.lng], {
      icon: markerIcon('S', 'start'),
      zIndexOffset: 1000
    }).addTo(state.map).bindTooltip(state.start.address);
  }

  function renderStopMarkers() {
    state.stopMarkers.forEach(function (m) { state.map.removeLayer(m); });
    state.stopMarkers = state.stops.map(function (stop, i) {
      return L.marker([stop.lat, stop.lng], {
        icon: markerIcon(String(i + 1), 'stop')
      }).addTo(state.map).bindTooltip(stop.address);
    });
  }

  function renderStopsList() {
    dom.stopsList.innerHTML = '';
    state.stops.forEach(function (stop, i) {
      var li = document.createElement('li');
      li.className = 'stop-item';

      var label = document.createElement('span');
      label.className = 'stop-item__label';
      label.textContent = (i + 1) + '. ' + stop.address;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stop-item__remove';
      btn.setAttribute('aria-label', 'Remove ' + stop.address);
      btn.textContent = '×';
      btn.addEventListener('click', function () { removeStop(i); });

      li.appendChild(label);
      li.appendChild(btn);
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

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  function setStart(place) {
    state.start = {
      address: place.displayName,
      lat: place.lat,
      lng: place.lng
    };
    renderStartMarker();
    state.map.setView([place.lat, place.lng], 14);
    clearRoute();
  }

  function addStop(place) {
    state.stops.push({
      address: place.displayName,
      lat: place.lat,
      lng: place.lng
    });
    renderStopMarkers();
    renderStopsList();
    clearRoute();
    dom.stopInput.value = '';
    dom.stopInput.focus();
  }

  function removeStop(idx) {
    state.stops.splice(idx, 1);
    renderStopMarkers();
    renderStopsList();
    clearRoute();
  }

  // -------------------------------------------------------------------
  // Format helpers
  // -------------------------------------------------------------------

  function fmtDist(km) {
    if (typeof km !== 'number' || isNaN(km)) return '–';
    return km.toFixed(1) + ' km';
  }

  function fmtTime(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '–';
    var m = Math.round(mins);
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h > 0 ? h + 'h ' + r + 'm' : m + ' min';
  }

  // -------------------------------------------------------------------
  // Optimize
  // -------------------------------------------------------------------

  function setOptimizing(on) {
    state.optimizing = on;
    dom.optimizeBtn.disabled = on;
    if (on) {
      dom.optimizeBtn.innerHTML = '<span class="sg-spinner"></span>Optimizing…';
    } else {
      dom.optimizeBtn.textContent = 'Optimize Route';
    }
  }

  function optimize() {
    if (state.optimizing) return;
    if (!state.start) { toast('Set a starting location first.', 'error'); return; }
    if (!state.stops.length) { toast('Add at least one delivery stop.', 'error'); return; }

    setOptimizing(true);
    var allPoints = [state.start].concat(state.stops);
    var locs = allPoints.map(function (p) { return { lat: p.lat, lng: p.lng }; });

    Router.getDistanceMatrix(locs)
      .then(function (matrix) {
        var solution = Solver.solve(matrix.distances, 0);
        var ordered = solution.order.map(function (i) { return locs[i]; });
        return Router.getRoute(ordered).then(function (route) {
          return { solution: solution, route: route, orderedAllPoints: solution.order.map(function (i) { return allPoints[i]; }) };
        });
      })
      .then(function (result) {
        // Re-order stops to match optimized order
        var orderedStops = result.solution.order.slice(1).map(function (i) { return allPoints[i]; });
        state.stops = orderedStops;
        renderStopMarkers();
        renderStopsList();

        // Draw route
        if (state.routeLine) state.map.removeLayer(state.routeLine);
        var coords = result.route.geometry && result.route.geometry.coordinates
          ? result.route.geometry.coordinates
          : [];
        var latLngs = coords.map(function (c) { return [c[1], c[0]]; });
        state.routeLine = L.polyline(latLngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(state.map);

        // Results panel
        dom.resultsPanel.hidden = false;
        dom.totalDistanceEl.textContent = fmtDist(result.route.totalDistance);
        dom.totalTimeEl.textContent = fmtTime(result.route.totalDuration);

        // Leg details
        dom.legsList.innerHTML = '';
        var legs = result.route.legs || [];
        var journey = [allPoints[0]].concat(orderedStops);

        for (var i = 0; i < journey.length - 1; i++) {
          var to = journey[i + 1];
          var leg = legs[i];

          var li = document.createElement('li');
          li.className = 'leg-card';

          var badge = document.createElement('span');
          badge.className = 'leg-card__index';
          badge.textContent = String(i + 1);

          var body = document.createElement('div');
          body.className = 'leg-card__body';

          var addr = document.createElement('div');
          addr.className = 'leg-card__address';
          addr.textContent = to.address;

          var meta = document.createElement('div');
          meta.className = 'leg-card__meta';
          meta.textContent = leg ? fmtDist(leg.distance) + ' · ' + fmtTime(leg.duration) : '';

          body.appendChild(addr);
          body.appendChild(meta);
          li.appendChild(badge);
          li.appendChild(body);
          dom.legsList.appendChild(li);
        }

        // Fit map
        if (latLngs.length) {
          state.map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
        }

        toast('Route optimized!', 'success');
      })
      .catch(function (err) {
        toast('Optimization failed: ' + (err.message || err), 'error');
      })
      .then(function () {
        setOptimizing(false);
      });
  }

  // -------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------

  function init() {
    cacheDom();
    injectStyles();
    initMap();

    // Autocomplete for start input
    var startAC = setupAutocomplete(dom.startInput, dom.startSuggestions, function (place) {
      setStart(place);
    });

    // Autocomplete for stop input
    var stopAC = setupAutocomplete(dom.stopInput, dom.stopSuggestions, function (place) {
      addStop(place);
    });

    // Fallback: if user types and presses Enter without selecting from dropdown
    dom.startInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !startAC.wasSelectedFromList()) {
        e.preventDefault();
        var val = dom.startInput.value.trim();
        if (!val) return;
        Geocoder.geocode(val).then(setStart).catch(function (err) {
          toast('Could not find that address. ' + (err.message || ''), 'error');
        });
      }
    });

    dom.addStopBtn.addEventListener('click', function () {
      var val = dom.stopInput.value.trim();
      if (!val) return;
      if (!stopAC.wasSelectedFromList()) {
        Geocoder.geocode(val).then(addStop).catch(function (err) {
          toast('Could not find that address. ' + (err.message || ''), 'error');
        });
      }
    });

    dom.optimizeBtn.addEventListener('click', optimize);

    // Geocode default start on load
    Geocoder.geocode(dom.startInput.value).then(setStart).catch(function () {
      toast('Could not geocode default start address.', 'error');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

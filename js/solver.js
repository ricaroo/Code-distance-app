/**
 * solver.js
 * ---------------------------------------------------------------------------
 * Travelling Salesman Problem solver for the SG Route Optimizer.
 *
 * Solves an OPEN-PATH TSP: the route must start at a fixed node
 * (`startIndex`) and visit every other node exactly once, but does NOT need
 * to return to the start. This matches a delivery run where the driver
 * starts at a depot/home and simply finishes at the last stop.
 *
 * Strategy:
 *   1. Build an initial tour with the Nearest-Neighbour heuristic.
 *   2. Improve it with 2-opt local search until no improving move remains.
 *
 * Exposes a single global: `Solver`.
 *   Solver.solve(distanceMatrix, startIndex) -> { order, totalDistance }
 *
 *   - distanceMatrix: n x n array of numbers, distanceMatrix[i][j] is the
 *     travel cost (distance, time, whatever unit) from node i to node j.
 *     Does not need to be symmetric.
 *   - startIndex: index of the node the route must begin at (default 0).
 *   - order: array of indices, length n, order[0] === startIndex.
 *   - totalDistance: sum of the costs of the consecutive edges in `order`.
 */
(function (root) {
  'use strict';

  var EPSILON = 1e-9;

  /**
   * Sum the cost of travelling the given order, edge by edge (no return
   * edge back to the first node - this is an open path, not a cycle).
   */
  function totalDistanceOf(order, matrix) {
    var total = 0;
    for (var k = 0; k < order.length - 1; k++) {
      total += matrix[order[k]][order[k + 1]];
    }
    return total;
  }

  /**
   * Build an initial route with the nearest-neighbour heuristic, always
   * starting at `start` and repeatedly hopping to the closest unvisited
   * node.
   */
  function nearestNeighbourOrder(matrix, start) {
    var n = matrix.length;
    var visited = new Array(n).fill(false);
    var order = [start];
    visited[start] = true;
    var current = start;

    for (var step = 1; step < n; step++) {
      var best = -1;
      var bestDist = Infinity;
      for (var k = 0; k < n; k++) {
        if (!visited[k]) {
          var d = matrix[current][k];
          if (typeof d !== 'number' || isNaN(d)) {
            d = Infinity;
          }
          if (d < bestDist) {
            bestDist = d;
            best = k;
          }
        }
      }
      // Fallback safety net: if every remaining distance was invalid
      // (e.g. missing data), just take the next unvisited node in index
      // order so the solver never gets stuck.
      if (best === -1) {
        for (var m = 0; m < n; m++) {
          if (!visited[m]) {
            best = m;
            break;
          }
        }
      }
      order.push(best);
      visited[best] = true;
      current = best;
    }

    return order;
  }

  /**
   * Improve a route with 2-opt: repeatedly try reversing the segment
   * between two positions i..j (never touching position 0, which must stay
   * the fixed start) and keep the reversal whenever it shortens the total
   * open-path distance. Repeats full passes until a pass makes no
   * improvement at all.
   */
  function twoOptImprove(initialOrder, matrix) {
    var order = initialOrder.slice();
    var n = order.length;
    if (n < 4) {
      // Nothing meaningful to 2-opt with fewer than 4 nodes on an open path.
      return order;
    }

    var currentDistance = totalDistanceOf(order, matrix);
    var improved = true;
    var maxPasses = 200; // safety guard against pathological float loops
    var pass = 0;

    while (improved && pass < maxPasses) {
      improved = false;
      pass++;

      for (var i = 1; i < n - 1; i++) {
        for (var j = i + 1; j < n; j++) {
          var candidate = order
            .slice(0, i)
            .concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));

          var candidateDistance = totalDistanceOf(candidate, matrix);

          if (candidateDistance + EPSILON < currentDistance) {
            order = candidate;
            currentDistance = candidateDistance;
            improved = true;
          }
        }
      }
    }

    return order;
  }

  var Solver = {
    /**
     * Solve the open-path TSP.
     * @param {number[][]} distanceMatrix square cost matrix
     * @param {number} [startIndex=0] index the route must start from
     * @returns {{order: number[], totalDistance: number}}
     */
    solve: function (distanceMatrix, startIndex) {
      startIndex = startIndex || 0;

      var n = distanceMatrix ? distanceMatrix.length : 0;

      if (n === 0) {
        return { order: [], totalDistance: 0 };
      }

      if (n === 1) {
        return { order: [startIndex], totalDistance: 0 };
      }

      if (n === 2) {
        var other = startIndex === 0 ? 1 : 0;
        var order2 = [startIndex, other];
        return { order: order2, totalDistance: totalDistanceOf(order2, distanceMatrix) };
      }

      var nnOrder = nearestNeighbourOrder(distanceMatrix, startIndex);
      var improvedOrder = twoOptImprove(nnOrder, distanceMatrix);

      return {
        order: improvedOrder,
        totalDistance: totalDistanceOf(improvedOrder, distanceMatrix)
      };
    }
  };

  // Expose as a global for the browser, and export for Node/CommonJS
  // environments (useful for unit testing) without affecting the browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Solver;
  }
  root.Solver = Solver;
})(typeof window !== 'undefined' ? window : this);

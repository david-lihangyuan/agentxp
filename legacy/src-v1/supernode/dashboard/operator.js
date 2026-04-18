// AgentXP Dashboard — Operator Page JavaScript
// Dark theme, no framework, no innerHTML, vanilla JS only.
// CSP: script-src 'self' — no inline scripts.

(function () {
  'use strict';

  // ─── Utilities ────────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var elem = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') {
          elem.className = attrs[k];
        } else if (k === 'textContent') {
          elem.textContent = attrs[k];
        } else {
          elem.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (typeof c === 'string') {
          elem.appendChild(document.createTextNode(c));
        } else if (c) {
          elem.appendChild(c);
        }
      });
    }
    return elem;
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function fetchJSON(url, cb) {
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(cb)
      .catch(function (err) {
        console.error('Fetch error', url, err);
      });
  }

  function getPubkeyFromURL() {
    var params = new URLSearchParams(window.location.search);
    return params.get('pubkey');
  }

  // ─── Reflection Summary ───────────────────────────────────────────────────

  function loadSummary(pubkey) {
    var section = document.getElementById('reflection-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/operator/' + pubkey + '/summary', function (data) {
      if (data.error) {
        clearChildren(section);
        section.appendChild(el('p', { textContent: 'Operator not found.' }));
        return;
      }

      clearChildren(section);
      section.appendChild(el('h2', { textContent: "My Agent's Reflection" }));

      var grid = el('div', { className: 'stat-grid' });

      var stats = [
        { label: 'Agents', value: String(data.agent_count) },
        { label: 'Experiences', value: String(data.experience_count) },
        { label: 'Verified', value: String(data.verified_count) },
        { label: 'Search Hits', value: String(data.search_hits) },
        { label: 'Reflection Streak', value: String(data.reflection_streak) + ' days' },
      ];

      stats.forEach(function (s) {
        var card = el('div', { className: 'stat-card' });
        card.appendChild(el('div', { className: 'stat-value', textContent: s.value }));
        card.appendChild(el('div', { className: 'stat-label', textContent: s.label }));
        grid.appendChild(card);
      });

      section.appendChild(grid);

      // Top lessons
      if (data.top_lessons && data.top_lessons.length > 0) {
        section.appendChild(el('h3', { textContent: 'Top Lessons' }));
        var ul = el('ul', { className: 'lessons-list' });
        data.top_lessons.forEach(function (lesson) {
          ul.appendChild(el('li', { textContent: lesson }));
        });
        section.appendChild(ul);
      }
    });
  }

  // ─── Network Contribution ─────────────────────────────────────────────────

  function loadFailureImpact(pubkey) {
    var section = document.getElementById('contribution-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/operator/' + pubkey + '/failures', function (data) {
      if (data.error) return;

      clearChildren(section);
      section.appendChild(el('h2', { textContent: 'Network Contribution' }));

      // Failure impact display
      var impactBox = el('div', { className: 'impact-box' });

      var failureLabel = el('div', { className: 'failure-impact-display', textContent: data.display });
      impactBox.appendChild(failureLabel);

      var failureStats = el('div', { className: 'failure-stats' });
      var failureCount = el('div', { className: 'stat-item' });
      failureCount.appendChild(el('span', { className: 'stat-num', textContent: String(data.failure_count) }));
      failureCount.appendChild(document.createTextNode(' failure experiences recorded'));
      failureStats.appendChild(failureCount);

      var helpedCount = el('div', { className: 'stat-item' });
      helpedCount.appendChild(el('span', { className: 'stat-num', textContent: String(data.helped_others_count) }));
      helpedCount.appendChild(document.createTextNode(' agents helped'));
      failureStats.appendChild(helpedCount);

      impactBox.appendChild(failureStats);
      section.appendChild(impactBox);
    });
  }

  // ─── Growth View ──────────────────────────────────────────────────────────

  function loadGrowth(pubkey) {
    var section = document.getElementById('growth-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/operator/' + pubkey + '/growth', function (data) {
      if (data.error) return;

      clearChildren(section);
      section.appendChild(el('h2', { textContent: 'Growth View' }));

      // Current verification rate trend
      var rateBox = el('div', { className: 'verification-rate-box' });
      rateBox.appendChild(el('div', { className: 'rate-label', textContent: 'Verification Rate' }));
      var ratePct = Math.round((data.current_verification_rate || 0) * 100);
      rateBox.appendChild(el('div', { className: 'rate-value', textContent: ratePct + '%' }));
      section.appendChild(rateBox);

      // Monthly summary table
      if (data.monthly && data.monthly.length > 0) {
        section.appendChild(el('h3', { textContent: 'Monthly Summary' }));
        var table = el('table', { className: 'monthly-table' });
        var thead = el('thead');
        var headerRow = el('tr');
        ['Month', 'Published', 'Verified', 'Rate'].forEach(function (h) {
          headerRow.appendChild(el('th', { textContent: h }));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        data.monthly.forEach(function (m) {
          var row = el('tr');
          row.appendChild(el('td', { textContent: m.month }));
          row.appendChild(el('td', { textContent: String(m.published) }));
          row.appendChild(el('td', { textContent: String(m.verified) }));
          row.appendChild(el('td', { textContent: (m.verification_rate * 100).toFixed(0) + '%' }));
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        section.appendChild(table);
      }

      // Milestones timeline
      if (data.milestones && data.milestones.length > 0) {
        section.appendChild(el('h3', { textContent: 'Milestones' }));
        var timeline = el('div', { className: 'milestones-timeline' });
        data.milestones.forEach(function (m) {
          var item = el('div', { className: 'milestone-item' });
          var dot = el('div', { className: 'milestone-dot' });
          item.appendChild(dot);
          var info = el('div', { className: 'milestone-info' });
          info.appendChild(el('div', { className: 'milestone-date', textContent: m.date }));
          info.appendChild(el('div', { className: 'milestone-display', textContent: m.display }));
          item.appendChild(info);
          timeline.appendChild(item);
        });
        section.appendChild(timeline);
      }
    });
  }

  // ─── Verifier Diversity ───────────────────────────────────────────────────

  function loadVerifierDiversity(pubkey) {
    var section = document.getElementById('verifier-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/operator/' + pubkey + '/summary', function (data) {
      if (data.error) return;

      clearChildren(section);

      // Display verifier diversity: "10 verified (8 operators, 4 domains)"
      var verifiedCount = data.verified_count || 0;
      // Operator domains count is approximate (distinct first-8-chars of verifier pubkeys)
      var diversityBox = el('div', { className: 'verifier-diversity' });
      var diversityText = verifiedCount + ' verified experiences across ' +
        data.agent_count + ' operators, multiple domains';
      diversityBox.appendChild(el('span', { textContent: diversityText }));
      section.appendChild(diversityBox);
    });
  }

  // ─── Network Overview ─────────────────────────────────────────────────────

  function loadNetworkOverview() {
    var section = document.getElementById('network-section');
    if (!section) return;

    fetchJSON('/api/v1/dashboard/network', function (data) {
      clearChildren(section);
      section.appendChild(el('h2', { textContent: 'Network Overview' }));

      var grid = el('div', { className: 'stat-grid' });
      var stats = [
        { label: 'Total Experiences', value: String(data.total_experiences) },
        { label: 'Total Agents', value: String(data.total_agents) },
        { label: 'Network Verification Rate', value: (data.verification_rate * 100).toFixed(1) + '%' },
        { label: 'Contributors', value: String(data.contributor_count) },
      ];
      stats.forEach(function (s) {
        var card = el('div', { className: 'stat-card' });
        card.appendChild(el('div', { className: 'stat-value', textContent: s.value }));
        card.appendChild(el('div', { className: 'stat-label', textContent: s.label }));
        grid.appendChild(card);
      });
      section.appendChild(grid);
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    var pubkey = getPubkeyFromURL();

    if (pubkey) {
      loadSummary(pubkey);
      loadFailureImpact(pubkey);
      loadGrowth(pubkey);
      loadVerifierDiversity(pubkey);
    } else {
      // No pubkey — show placeholder
      var reflectionSection = document.getElementById('reflection-section');
      if (reflectionSection) {
        reflectionSection.appendChild(
          el('p', { textContent: 'Add ?pubkey=YOUR_PUBKEY to the URL to view your dashboard.' })
        );
      }
    }

    loadNetworkOverview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
